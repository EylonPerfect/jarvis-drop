import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";
import { openSync, readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { query, one } from "../db/pool.js";
import { config } from "../config.js";
import { getCompany } from "./company.js";
import { getActiveProvider, completeProviderChat } from "../lib/providers.js";
import { purgeCall } from "../lib/purge.js";
import { checkCapsForAgent, orgForAgent, recordLiveCallMinutes } from "../lib/metering.js";
import { compileClone } from "@jarvis/shared";
import { liveJoinGate, LIVE_GATE_MIN } from "./readiness.js";
import { orgCanGoLive } from "../lib/billing.js";
import { emit, EVENTS } from "../lib/analytics.js";

// The caller's org, falling back to the legacy org for the cookieless Recall
// browser (GET /api/live/* is auth-exempt). Multi-tenant live with a truly
// cookieless bridge must derive org from the call resource — see TENANCY-SCOPING.md.
function reqOrg(req: { orgId?: string }): string {
  return req.orgId ?? config.legacyOrgId;
}

// The E2B desktop key is PLATFORM infrastructure (one account for the whole
// deployment), not per-tenant. Read it consistently under the platform-config
// org so it never depends on — or leaks — an arbitrary tenant's integrations row.
const PLATFORM_ORG = config.legacyOrgId;

// ============================================================
// Live call service — closes the loop from Pre-call Check (join)
// through Director Console (feed + nudges) and Demo Canvas (stream).
// Spawns the proven call pipeline (/app/ah/call_up.mjs, or call_wake
// when a standby body exists), tails its log for PHASE lines, and
// talks to the in-call bridge via the sandbox nudge file.
// ============================================================

type LiveCall = {
  id: string; agent_id: string | null; meeting_id: string; mode: string;
  phase: string; sandbox_id: string | null; stream_url: string | null;
  phases: { t: string; phase: string; detail?: string }[];
  started_at: string; ended_at: string | null;
};

const AH = "/app/ah";
const logPath = (id: string) => `${AH}/live_${id}.log`;

async function e2bSandbox(sandboxId: string) {
  const { Sandbox } = await import("@e2b/desktop");
  const r = await one<{ values: { apiKey: string } }>(`SELECT values FROM integrations WHERE org_id=$1 AND id='e2b'`, [PLATFORM_ORG]);
  return Sandbox.connect(sandboxId, { apiKey: r!.values.apiKey });
}

// tail the pipeline log → phase updates on the row (runs in-process; cheap)
const monitors = new Map<string, ReturnType<typeof setInterval>>();
function startMonitor(callId: string) {
  if (monitors.has(callId)) return;
  const started = Date.now();
  const iv = setInterval(async () => {
    try {
      const row = await one<LiveCall>(`SELECT * FROM live_calls WHERE id=$1`, [callId]);
      if (!row || row.ended_at) { clearInterval(iv); monitors.delete(callId); return; }
      const lp = logPath(callId);
      const text = existsSync(lp) ? readFileSync(lp, "utf8") : "";
      const seen = new Set((row.phases || []).map((p) => p.phase + "|" + (p.detail || "")));
      const phases = [...(row.phases || [])];
      let sandbox = row.sandbox_id, stream = row.stream_url, phase = row.phase;
      for (const line of text.split("\n")) {
        const m = line.match(/^PHASE ([A-Z_]+)\s*(.*)$/);
        if (!m) continue;
        const key = m[1] + "|" + (m[2] || "").slice(0, 120);
        if (seen.has(key)) continue;
        seen.add(key);
        phases.push({ t: new Date().toISOString(), phase: m[1], detail: (m[2] || "").slice(0, 300) });
        if (m[1] === "SANDBOX" || m[1] === "RESUMING") sandbox = (m[2] || "").trim().split(/\s+/)[0] || sandbox;
        if (m[1] === "STREAM") stream = (m[2] || "").trim();
        phase = m[1].toLowerCase();
      }
      // stall watchdog: nothing new for 8 min and never reached ready → error
      if (phase !== "ready" && phases.length === (row.phases || []).length && Date.now() - started > 8 * 60_000 && phases.length < 3) {
        phase = "error"; phases.push({ t: new Date().toISOString(), phase: "ERROR", detail: "pipeline stalled — check the log" });
      }
      if (phase !== row.phase || phases.length !== (row.phases || []).length || sandbox !== row.sandbox_id || stream !== row.stream_url) {
        await query(`UPDATE live_calls SET phase=$2, phases=$3, sandbox_id=$4, stream_url=$5 WHERE id=$1`,
          [callId, phase, JSON.stringify(phases), sandbox, stream]);
      }
      if (phase === "ready") { clearInterval(iv); monitors.delete(callId); }
    } catch { /* keep polling */ }
  }, 3000);
  monitors.set(callId, iv);
}

// Push a freshly compiled persona into the RUNNING session (if one belongs to
// this agent): recompile (draft for unpinned clones), drop the text into the
// sandbox, and nudge the bridge to session.update its instructions. This is
// what makes storyboard/slider/fix edits land mid-call instead of next-session.
// Server-side guide nudge into the RUNNING call's bridge (same channel the
// director console uses) — lets bff routes (e.g. /api/coach) land coaching
// mid-call without a client round-trip.
export async function pushGuideNudge(org: string, agentId: string, text: string): Promise<boolean> {
  try {
    const row = await one<LiveCall>(`SELECT * FROM live_calls WHERE org_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [org]);
    if (!row?.sandbox_id || row.agent_id !== agentId) return false;
    const d = await e2bSandbox(row.sandbox_id);
    const payload = JSON.stringify({ kind: "guide", text: text.slice(0, 700), t: Date.now() }).replace(/'/g, "'\\''");
    await d.commands.run(`echo '${payload}' >> /tmp/nudges.jsonl`, { timeoutMs: 10000 });
    return true;
  } catch { return false; }
}

export async function pushPersonaReload(org: string, agentId: string): Promise<boolean> {
  try {
    const row = await one<LiveCall>(`SELECT * FROM live_calls WHERE org_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [org]);
    if (!row?.sandbox_id || row.agent_id !== agentId) return false;
    const ag = await one<any>(`SELECT * FROM agents WHERE id=$1 AND org_id=$2`, [agentId, org]);
    if (!ag) return false;
    let instructions: string = ag.golden_instructions || "";
    if (!ag.golden_persona_id && ag.persona?.identity) {
      const pb = ag.playbook && ag.playbook.kind === "calls" && ag.playbook.callPlaybook ? ag.playbook.callPlaybook : null;
      const company = await getCompany(org).then((c) => c.name || "the company").catch(() => "the company");
      instructions = compileClone(ag.persona, pb, ag.name, company);
      await query(`UPDATE agents SET golden_instructions=$2 WHERE id=$1 AND org_id=$3`, [agentId, instructions, org]);
    }
    if (!instructions) return false;
    const d = await e2bSandbox(row.sandbox_id);
    await d.files.write("/tmp/persona_reload.txt", instructions);
    const payload = JSON.stringify({ kind: "reload", text: "@file", t: Date.now() }).replace(/'/g, "'\\''");
    await d.commands.run(`echo '${payload}' >> /tmp/nudges.jsonl`, { timeoutMs: 10000 });
    return true;
  } catch { return false; }
}

export default async function liveRoutes(app: FastifyInstance) {
  // ---- join: launch the call pipeline (Zoom) or a rehearsal (no Zoom) ----
  app.post("/api/live/join", async (req, reply) => {
    const b = (req.body ?? {}) as { meetingId?: string; agentId?: string; mode?: string; personaMode?: string };
    const mode = b.mode === "rehearsal" ? "rehearsal" : "zoom";
    // personaMode: "draft" (default — today's behavior) or "golden" (rehearse the
    // PINNED compile even for flows that would recompile the draft).
    const personaMode = b.personaMode === "golden" ? "golden" : "draft";
    // Full Zoom links carry digits in the DOMAIN (us06web.zoom.us) — a naive
    // digit-strip would corrupt the id. Prefer the /j/<id> path segment, then
    // the last 9-11 digit run, then the old strip as a final fallback.
    const rawMeeting = b.meetingId || "";
    const jm = rawMeeting.match(/\/j\/(\d{9,11})/);
    const runs = rawMeeting.match(/\d{9,11}/g);
    const meeting = jm ? jm[1] : runs?.length ? runs[runs.length - 1] : rawMeeting.replace(/\D/g, "");
    if (mode === "zoom" && meeting.length < 9) return reply.code(400).send({ error: "meetingId required (9-11 digits, or paste the Zoom link)" });
    const org = reqOrg(req);
    // Per-org concurrency: only THIS org's active call blocks a new join.
    const active = await one<LiveCall>(`SELECT * FROM live_calls WHERE org_id = $1 AND ended_at IS NULL AND phase NOT IN ('error') ORDER BY started_at DESC LIMIT 1`, [org]);
    if (active && Date.now() - new Date(active.started_at).getTime() < 90 * 60_000) {
      return reply.code(409).send({ error: "a call is already active", callId: active.id });
    }
    const id = `lc_${Date.now().toString(36)}`;
    // Resolve which clone this call belongs to: explicit agentId from the UI,
    // else the last-pinned golden (legacy single-clone behavior). The id rides
    // into the bridge as AH_AGENT_ID so it loads THAT agent's golden only.
    let agentForCall = b.agentId ?? "";
    if (!agentForCall) {
      const legacy = await one<any>(`SELECT value FROM settings WHERE org_id=$1 AND key='live_golden_instructions'`, [org]);
      agentForCall = legacy?.value?.agentId ?? "";
    }
    // Cost safety: refuse a NEW live call when the org is hard-capped or the
    // global circuit breaker / kill-switch is engaged (fail-open on error).
    {
      const cap = await checkCapsForAgent(agentForCall || null);
      if (!cap.allowed) return reply.code(429).send({ error: "Cost cap: " + cap.reason, capState: cap.state });
    }
    // ---- THE LIVE GATE (sole safety stop). A LIVE (zoom) join is allowed only
    // at readiness >= 70. This is the STRUCTURAL backstop and it ALWAYS runs:
    // the scheduler and the instant-link path both delegate here, so the >=70
    // gate applies to EVERY live join and can never be bypassed (there is no
    // header/flag escape hatch — the scheduler/instant path pre-checks for a fast,
    // audited failure, but this recompute is the authoritative enforcement).
    // Rehearsals (mode!=='zoom') are exempt by design — below-70 clones may rehearse.
    if (mode === "zoom" && agentForCall) {
      const gate = await liveJoinGate(agentForCall);
      if (!gate.ok) {
        appendFileSync(logPath(id), `[live.ts] BLOCKED by live gate: ${gate.reason}\n`);
        return reply.code(403).send({ error: gate.reason, code: "readiness_gate", score: gate.score, min: LIVE_GATE_MIN });
      }
    }
    // BILLING GATE (free->paid wedge): a LIVE join requires an active paid
    // subscription with an available clone slot. Rehearsals are exempt. Fail-open
    // in the helper so a billing-lookup blip never blocks a paying call.
    if (mode === "zoom" && agentForCall) {
      const bill = await orgCanGoLive(org, agentForCall);
      if (!bill.allowed) {
        appendFileSync(logPath(id), `[live.ts] BLOCKED by billing gate: ${bill.reason}\n`);
        return reply.code(402).send({ error: bill.reason, code: bill.code, billing: true, plan: bill.plan, slots: bill.slots, liveClones: bill.liveClones });
      }
    }
    // Persona compile for this call. Draft (default): unpinned clones get their
    // CURRENT persona compiled (today's behavior, DB write kept for revive
    // compat). Golden: the PINNED version is compiled fresh and rides into the
    // bridge via env override — the DB row is never corrupted by a rehearsal.
    let instrOverride = "";
    let effectiveMode = personaMode;
    if (agentForCall) {
      const ag = await one<any>(`SELECT * FROM agents WHERE id=$1 AND org_id=$2`, [agentForCall, org]);
      const pb = ag?.playbook && ag.playbook.kind === "calls" && ag.playbook.callPlaybook ? ag.playbook.callPlaybook : null;
      const company = await getCompany(org).then((c) => c.name || "the company").catch(() => "the company");
      if (personaMode === "golden") {
        // Rehearse-the-golden: compile the PINNED version fresh and pass it via
        // env override — the DB row is never touched by a rehearsal.
        if (!ag?.golden_persona_id) return reply.code(400).send({ error: "nothing golden pinned for this clone — pin a golden version first, or rehearse the draft" });
        const vrow = await one<any>(`SELECT spec FROM persona_versions WHERE id=$1 AND org_id=$2`, [ag.golden_persona_id, org]);
        if (!vrow?.spec) return reply.code(400).send({ error: "the pinned golden version is missing — re-pin and retry" });
        try {
          instrOverride = compileClone(vrow.spec, pb, ag.name, company);
          appendFileSync(logPath(id), `[live.ts] personaMode=golden — compiled PINNED persona (${instrOverride.length} chars)\n`);
        } catch (e) {
          return reply.code(500).send({ error: `golden compile failed: ${String(e)}` });
        }
      } else if (ag && !ag.golden_persona_id && ag.persona?.identity) {
        // Default draft flow — exactly today's behavior for unpinned clones.
        try {
          const instructions = compileClone(ag.persona, pb, ag.name, company);
          await query(`UPDATE agents SET golden_instructions=$2 WHERE id=$1 AND org_id=$3`, [agentForCall, instructions, org]);
          appendFileSync(logPath(id), `[live.ts] compiled draft persona for unpinned ${agentForCall} (${instructions.length} chars)\n`);
        } catch (e) {
          appendFileSync(logPath(id), `[live.ts] draft-persona compile failed: ${String(e)}\n`);
        }
      } else if (ag?.golden_persona_id) {
        effectiveMode = "golden"; // pinned clone on the default flow runs its pin — label honestly
      }
    }
    await query(`INSERT INTO live_calls (id, org_id, agent_id, meeting_id, mode) VALUES ($1,$5,$2,$3,$4)`, [id, agentForCall || null, meeting || "rehearsal", mode, org]);
    await query(
      `INSERT INTO settings (org_id, key, value) VALUES ($2, 'live_persona_mode', $1) ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ callId: id, mode: effectiveMode }), org],
    );
    // pick the fast path when a standby body exists
    const script = mode === "rehearsal" ? `${AH}/rehearsal.mjs`
      : existsSync(`${AH}/standby.txt`) ? `${AH}/call_wake.mjs` : `${AH}/call_up.mjs`;
    const out = openSync(logPath(id), "a");
    const child = spawn("node", [script, meeting || "0"], {
      detached: true, stdio: ["ignore", out, out],
      env: {
        ...process.env,
        ...(agentForCall ? { AH_AGENT_ID: agentForCall } : {}),
        ...(instrOverride ? { AH_INSTR_B64: Buffer.from(instrOverride, "utf8").toString("base64"), AH_PERSONA_MODE: effectiveMode } : {}),
      },
    });
    child.unref();
    appendFileSync(logPath(id), `\n[live.ts] spawned ${script} pid=${child.pid}\n`);
    startMonitor(id);
    // OBSERVABILITY (metric 1 NS + metric 5): a real (non-rehearsal) call is the
    // north-star event. Fire-and-forget so instrumentation never delays the join
    // — also snapshot the clone's readiness at start (avg-score-of-live-clones).
    if (mode === "zoom") {
      void (async () => {
        try {
          let readiness: number | null = null;
          if (agentForCall) {
            const rr = await fetch(`http://localhost:${process.env.PORT || 8787}/api/readiness/${agentForCall}`, {
              headers: { "X-API-Key": process.env.BFF_API_KEY || "" }, signal: AbortSignal.timeout(15000),
            }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
            if (rr && typeof (rr as any).score === "number") readiness = (rr as any).score;
          }
          if (readiness != null) await query(`UPDATE live_calls SET readiness_at_start=$2 WHERE id=$1`, [id, readiness]);
          await emit(EVENTS.LIVE_CALL_RUN, { agentId: agentForCall || null, callId: id, value: readiness ?? undefined, props: { mode, personaMode: effectiveMode } });
        } catch { /* metrics are best-effort */ }
      })();
    }
    return reply.code(201).send({ callId: id, script });
  });

  // ---- status: the active (or latest) call ----
  app.get("/api/live/status", async (req) => {
    const org = reqOrg(req);
    // auto-expire: sandboxes hard-cap at 55 min, so any open row older than 65 min
    // is a dead call someone forgot to end — close it instead of blocking new joins
    await query(`UPDATE live_calls SET ended_at = now(), phase = 'expired' WHERE org_id = $1 AND ended_at IS NULL AND started_at < now() - interval '65 minutes'`, [org]);
    const row = await one<LiveCall>(`SELECT * FROM live_calls WHERE org_id = $1 ORDER BY started_at DESC LIMIT 1`, [org]);
    if (!row) return { call: null };
    if (!monitors.has(row.id) && !row.ended_at && row.phase !== "ready" && row.phase !== "error") startMonitor(row.id);
    // which persona compile this call runs (draft | golden) — set at join time
    let personaMode: string | undefined;
    try {
      const pm = await one<any>(`SELECT value FROM settings WHERE org_id=$1 AND key='live_persona_mode'`, [org]);
      if (pm?.value?.callId === row.id) personaMode = pm.value.mode;
    } catch { /* label only */ }
    return { call: personaMode ? { ...row, persona_mode: personaMode } : row };
  });

  // ---- room audio: the sandbox's ACTUAL spoken output (vspk sink), streamed ----
  // Raw PCM s16le 24k mono in base64 chunks — the room schedules it via Web
  // Audio, making the rehearsal acoustically identical to Zoom (same EL hybrid
  // voice, same pacing). Capture self-starts on the first poll (after=-1 asks
  // for the live edge); each poll tails up to 72KB (~1.5s of audio).
  app.get("/api/live/audio", async (req, reply) => {
    const q = (req.query ?? {}) as { after?: string };
    const after = Math.max(-1, parseInt(q.after ?? "-1", 10) || -1);
    const row = await one<LiveCall>(`SELECT * FROM live_calls WHERE org_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [reqOrg(req)]);
    if (!row?.sandbox_id) return { live: false, offset: 0, chunk: "", rate: 24000 };
    try {
      const d = await e2bSandbox(row.sandbox_id);
      if (after < 0) {
        // Self-start the recorder in e2b BACKGROUND mode (a foreground nohup gets
        // SIGKILLed with its process group when the RPC returns — same reason
        // rehearsal.mjs launches chrome/the bridge with background:true). The
        // marker file lets a later poll know the writer is already up. vspk is a
        // null-sink whose monitor emits continuous silence and real PCM while the
        // hybrid EL player writes to it — exactly what a Zoom listener hears.
        const chk = await d.commands.run(`test -f /tmp/room_audio.started && echo up || echo down`, { timeoutMs: 10000 });
        if ((chk.stdout || "").trim() !== "up") {
          await d.commands.run(
            `touch /tmp/room_audio.started; pacat --record --format=s16le --rate=24000 --channels=1 --device=vspk.monitor > /tmp/room_audio.raw 2>/dev/null`,
            { background: true },
          ).catch(() => { /* poll will retry */ });
          await new Promise((res) => setTimeout(res, 600));
        }
        const r = await d.commands.run(`stat -c %s /tmp/room_audio.raw 2>/dev/null || echo 0`, { timeoutMs: 10000 });
        const size = parseInt(((r.stdout || "0").trim().split("\n").pop() || "0"), 10) || 0;
        return { live: true, offset: size, chunk: "", rate: 24000 };
      }
      const r = await d.commands.run(`tail -c +${after + 1} /tmp/room_audio.raw 2>/dev/null | head -c 72000 | base64 -w0`, { timeoutMs: 10000 });
      const b64 = (r.stdout || "").replace(/\s+/g, "");
      const bytes = b64 ? Buffer.from(b64, "base64").length : 0;
      return { live: true, offset: after + bytes, chunk: b64, rate: 24000 };
    } catch {
      return reply.code(200).send({ live: false, offset: Math.max(0, after), chunk: "", rate: 24000 });
    }
  });

  // ---- feed: bridge transcript/tool events from the sandbox log ----
  // NOTE: returns the FULL parsed event list every time (the tail window shifts,
  // so line-index cursors drift) — the client replaces its transcript state.
  app.get("/api/live/feed", async (req, reply) => {
    const q = (req.query ?? {}) as { after?: string };
    const after = Math.max(0, parseInt(q.after || "0", 10) || 0);
    const row = await one<LiveCall>(`SELECT * FROM live_calls WHERE org_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [reqOrg(req)]);
    if (!row?.sandbox_id) return { events: [], next: 0, live: false };
    try {
      const d = await e2bSandbox(row.sandbox_id);
      const r = await d.commands.run("cat /tmp/duplexnav7.log 2>/dev/null | tail -c 60000", { timeoutMs: 15000 });
      const lines = ((r.stdout || "") + "").split("\n");
      const events: { seq: number; kind: string; text?: string; shot?: number; beat?: number; turn?: number }[] = [];
      lines.forEach((ln, i) => {
        let m;
        if ((m = ln.match(/^SAY (.*)$/))) events.push({ seq: i, kind: "say", text: m[1] });
        else if ((m = ln.match(/^BEAT (\d+)\s*(.*)$/))) events.push({ seq: i, kind: "beat", text: m[2].slice(0, 80), beat: Number(m[1]) });
        else if ((m = ln.match(/^NUDGE guest (.*)$/))) events.push({ seq: i, kind: "guest", text: m[1] });
        else if ((m = ln.match(/^GUEST (.*)$/))) events.push({ seq: i, kind: "guest", text: m[1] });
        else if ((m = ln.match(/^SHOT (\d+) (\w+)/))) events.push({ seq: i, kind: "shot", text: m[2], shot: Number(m[1]) });
        else if ((m = ln.match(/^TOOLCALL (\w+)\s*(.*)$/))) events.push({ seq: i, kind: "tool", text: `${m[1]} ${m[2].slice(0, 120)}` });
        else if ((m = ln.match(/^TOOLRESULT (\w+)\s*(.*)$/))) events.push({ seq: i, kind: "toolresult", text: `${m[1]}: ${m[2].slice(0, 160)}` });
        else if ((m = ln.match(/^SCREEN (.*)$/))) events.push({ seq: i, kind: "screen", text: m[1].slice(0, 200) });
        else if ((m = ln.match(/^NUDGE (.*)$/))) events.push({ seq: i, kind: "nudge", text: m[1].slice(0, 160) });
        else if ((m = ln.match(/^TURN_END (\d+)/))) events.push({ seq: i, kind: "turnend", turn: Number(m[1]) });
        else if (ln.startsWith("APIERR")) events.push({ seq: i, kind: "error", text: ln.slice(0, 160) });
      });
      return { events, next: lines.length, live: true };
    } catch (e) {
      return reply.code(200).send({ events: [], next: after, live: false, note: "sandbox unreachable" });
    }
  });

  // ---- flow coverage: which beats of the original flow have been covered by
  // the LIVE conversation so far, regardless of order. An LLM judge scores the
  // transcript against the beat sheet; cached per call until new events arrive.
  const coverageCache = new Map<string, { count: number; beats: { n: number; state: string }[] }>();
  app.get("/api/live/coverage", async (req, reply) => {
    const org = reqOrg(req);
    const row = await one<LiveCall>(`SELECT * FROM live_calls WHERE org_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [org]);
    if (!row?.sandbox_id || !row.agent_id) return reply.code(409).send({ error: "no live session" });
    const agent = await one<any>(`SELECT playbook FROM agents WHERE id=$1 AND org_id=$2`, [row.agent_id, org]);
    const stages: any[] = agent?.playbook?.callPlaybook?.stages ?? [];
    if (!stages.length) return { beats: [], covered: 0 };
    // read the conversation so far
    let lines: string[] = [];
    try {
      const d = await e2bSandbox(row.sandbox_id);
      const r = await d.commands.run("cat /tmp/duplexnav7.log 2>/dev/null | tail -c 40000", { timeoutMs: 15000 });
      lines = ((r.stdout || "") + "").split("\n").filter((l) => /^(SAY |GUEST |NUDGE guest |TOOLCALL |BEAT )/.test(l)).slice(-120);
    } catch { return reply.code(200).send({ beats: [], covered: 0, note: "sandbox unreachable" }); }
    const cached = coverageCache.get(row.id);
    if (cached && cached.count === lines.length) return { beats: cached.beats, covered: cached.beats.filter((b) => b.state === "covered").length, cached: true };
    if (!lines.length) {
      const empty = stages.map((_, i) => ({ n: i + 1, state: "pending" }));
      return { beats: empty, covered: 0 };
    }
    const provider = await getActiveProvider(org);
    if (!provider) return { beats: [], covered: 0, note: "no provider" };
    const stageDesc = stages.map((s, i) => `${i + 1}. ${s.name ?? "Beat"} — say: ${(s.voice?.objective ?? "").slice(0, 100)} — show: ${((s.screen?.actions ?? []) as string[]).slice(0, 4).join("; ").slice(0, 140)}`).join("\n");
    const sys = `You judge which stages of a sales-demo flow have been covered in a live conversation, in ANY order. Return ONLY a JSON array with one entry per stage: [{"n":1,"state":"covered"|"now"|"pending"}]. "covered" = substantively done (spoken about AND/OR its screen actions happened). "now" = the single stage currently in progress per the latest lines (BEAT markers are strong hints). Everything else "pending". At most one "now".`;
    const user = `STAGES:\n${stageDesc}\n\nCONVERSATION (oldest to newest; SAY = the rep, GUEST = customer, TOOLCALL = screen action, BEAT = rep's own stage marker):\n${lines.join("\n").slice(0, 9000)}`;
    try {
      const r = await completeProviderChat(provider, [{ role: "system", content: sys }, { role: "user", content: user }]);
      if (!r.ok) return { beats: [], covered: 0, note: "judge failed" };
      const m = r.content.match(/\[[\s\S]*\]/);
      const parsed = m ? (JSON.parse(m[0]) as { n: number; state: string }[]) : [];
      const beats = stages.map((_, i) => {
        const hit = parsed.find((p) => p.n === i + 1);
        const state = hit && ["covered", "now", "pending"].includes(hit.state) ? hit.state : "pending";
        return { n: i + 1, state };
      });
      coverageCache.set(row.id, { count: lines.length, beats });
      return { beats, covered: beats.filter((b) => b.state === "covered").length };
    } catch {
      return { beats: [], covered: 0, note: "judge error" };
    }
  });

  // ---- director screen-control recorder: while the operator drives the sandbox
  // browser, a CDP-injected script records the real click path (labels, typed
  // text, navigations). start installs it; stop reads + clears the log so the
  // demonstration becomes graph actions verbatim. Works on any running session —
  // it talks straight to the sandbox's Chrome, not through the bridge.
  app.post("/api/live/control/:op", async (req, reply) => {
    const { op } = req.params as { op: string };
    if (!["start", "stop"].includes(op)) return reply.code(400).send({ error: "op must be start|stop" });
    const row = await one<LiveCall>(`SELECT * FROM live_calls WHERE org_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [reqOrg(req)]);
    if (!row?.sandbox_id) return reply.code(409).send({ error: "no live session" });
    const recorder = [
      "(function(){",
      "if(window.__dirRecOn)return; window.__dirRecOn=true;",
      "var push=function(s){try{var a=JSON.parse(localStorage.__dirrec||'[]');if(a.length&&a[a.length-1]===s)return;a.push(s);localStorage.__dirrec=JSON.stringify(a.slice(-80));}catch(e){}};",
      "var label=function(el){var t=(el.closest&&el.closest('button,[role=button],a,[role=tab],[role=menuitem],input[type=submit]'))||el;var txt=((t.innerText||t.value||t.getAttribute('aria-label')||t.getAttribute('placeholder')||'')+'').trim().replace(/\\s+/g,' ').slice(0,60);return txt||t.tagName.toLowerCase();};",
      "document.addEventListener('click',function(e){try{push('click \"'+label(e.target)+'\"');}catch(x){}},true);",
      "document.addEventListener('change',function(e){try{var el=e.target;if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'))push('type \"'+(''+el.value).slice(0,60)+'\" into '+(el.placeholder||el.name||'the field'));}catch(x){}},true);",
      "window.addEventListener('hashchange',function(){push('navigate to '+location.pathname+location.hash);});",
      "var op_=history.pushState;history.pushState=function(){op_.apply(this,arguments);push('navigate to '+location.pathname);};",
      "})();",
    ].join("");
    const py = [
      "import asyncio, json, os, urllib.request, websockets",
      "MODE=os.environ['REC_MODE']; SRC=os.environ['REC_SRC']",
      "data=json.loads(urllib.request.urlopen('http://localhost:9222/json',timeout=5).read())",
      "ws_url=[t['webSocketDebuggerUrl'] for t in data if t.get('type')=='page'][0]",
      "async def main():",
      "    async with websockets.connect(ws_url, max_size=None) as ws:",
      "        async def call(id,method,params):",
      "            await ws.send(json.dumps({'id':id,'method':method,'params':params}))",
      "            while True:",
      "                m=json.loads(await ws.recv())",
      "                if m.get('id')==id: return m",
      "        if MODE=='start':",
      "            await call(1,'Page.enable',{})",
      "            await call(2,'Page.addScriptToEvaluateOnNewDocument',{'source':SRC})",
      "            await call(3,'Runtime.evaluate',{'expression':SRC})",
      "            print('REC_STARTED')",
      "        else:",
      "            r=await call(4,'Runtime.evaluate',{'expression':\"(function(){var a=localStorage.__dirrec||'[]';localStorage.__dirrec='[]';return a;})()\",'returnByValue':True})",
      "            print('REC_STEPS ' + str(r.get('result',{}).get('result',{}).get('value','[]')))",
      "asyncio.run(main())",
    ].join("\n");
    try {
      const d = await e2bSandbox(row.sandbox_id);
      const out = await d.commands.run(`python3 - <<'PYEOF'\n${py}\nPYEOF`, { timeoutMs: 25000, envs: { REC_MODE: op, REC_SRC: recorder } });
      const text = ((out.stdout || "") + (out.stderr || "")).trim();
      if (op === "start") return { ok: text.includes("REC_STARTED") };
      const m = text.match(/REC_STEPS (.*)$/s);
      let steps: string[] = [];
      try { steps = m ? (JSON.parse(m[1]) as string[]) : []; } catch { /* nothing recorded */ }
      return { ok: true, steps: steps.filter((s) => typeof s === "string").slice(0, 60) };
    } catch (e) {
      return reply.code(502).send({ error: `recorder ${op} failed: ${(e as Error).message}` });
    }
  });

  // ---- demo account login: the credentials the sandbox signs in with on every
  // session (rehearsals AND live Zoom calls). Stored in ${AH}/gp-login.json —
  // the exact file gp_login.mjs reads — so a save here applies everywhere.
  // The password is write-only: never returned to the client.
  app.get("/api/demo-login", async () => {
    try {
      const j = JSON.parse(readFileSync(`${AH}/gp-login.json`, "utf8")) as { email?: string; password?: string };
      return { email: j.email ?? "", hasPassword: !!j.password };
    } catch { return { email: "", hasPassword: false }; }
  });
  app.put("/api/demo-login", async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string; password?: string };
    const email = (b.email ?? "").trim();
    if (!email || !email.includes("@")) return reply.code(400).send({ error: "a valid email is required" });
    let current: { password?: string } = {};
    try { current = JSON.parse(readFileSync(`${AH}/gp-login.json`, "utf8")); } catch { /* first save */ }
    const password = (b.password ?? "").trim() || current.password || "";
    if (!password) return reply.code(400).send({ error: "password required" });
    writeFileSync(`${AH}/gp-login.json`, JSON.stringify({ email, password }, null, 2));
    return { email, hasPassword: true };
  });

  // ---- film gallery: every captured screen moment for a clone (storyboard picker) ----
  app.get("/api/clones/:agentId/film-gallery", async (req) => {
    const { agentId } = req.params as { agentId: string };
    const rows = await query<{ id: string; title: string; created_at: string }>(
      `SELECT id, title, created_at FROM clone_sources WHERE agent_id=$1 AND org_id=$2 AND kind='live_call' ORDER BY created_at DESC LIMIT 12`, [agentId, reqOrg(req)]);
    const films: { sourceId: string; title: string; at: string; shots: { n: number; action: string }[] }[] = [];
    for (const r of rows) {
      const dir = `${AH}/shots/${r.id}`;
      if (!existsSync(`${dir}/timeline.json`)) continue;
      try {
        const tl = JSON.parse(readFileSync(`${dir}/timeline.json`, "utf8")) as { events: { kind: string; text: string; shot?: number }[] };
        const have = new Set(readdirSync(dir).map((f) => { const m = f.match(/^s_(\d+)\.png$/); return m ? Number(m[1]) : 0; }).filter(Boolean));
        const shots = (tl.events || []).filter((e) => e.kind === "action" && e.shot && have.has(e.shot)).map((e) => ({ n: e.shot as number, action: e.text }));
        if (shots.length) films.push({ sourceId: r.id, title: r.title || r.id, at: r.created_at, shots });
      } catch { /* skip corrupt film */ }
    }
    return { films };
  });

  // ---- film review: persisted timeline + screenshots for a finished call ----
  app.get("/api/sources/:sourceId/timeline", async (req, reply) => {
    const { sourceId } = req.params as { sourceId: string };
    const f = `${AH}/shots/${sourceId.replace(/[^a-zA-Z0-9_-]/g, "")}/timeline.json`;
    if (!existsSync(f)) return reply.code(404).send({ error: "no film for this call" });
    return JSON.parse(readFileSync(f, "utf8"));
  });
  app.get("/api/sources/:sourceId/shot/:n", async (req, reply) => {
    const { sourceId, n } = req.params as { sourceId: string; n: string };
    const f = `${AH}/shots/${sourceId.replace(/[^a-zA-Z0-9_-]/g, "")}/s_${Math.max(1, parseInt(n, 10) || 0)}.png`;
    if (!existsSync(f)) return reply.code(404).send({ error: "no shot" });
    reply.header("Content-Type", "image/png").header("Cache-Control", "public, max-age=86400");
    return reply.send(readFileSync(f));
  });

  // ---- shot: screenshot captured at a tool call (film review / fix drawer) ----
  app.get("/api/live/shot/:n", async (req, reply) => {
    const { n } = req.params as { n: string };
    const num = Math.max(1, parseInt(n, 10) || 0);
    const row = await one<LiveCall>(`SELECT * FROM live_calls WHERE org_id = $1 AND sandbox_id IS NOT NULL ORDER BY started_at DESC LIMIT 1`, [reqOrg(req)]);
    if (!row?.sandbox_id) return reply.code(404).send({ error: "no call" });
    try {
      const d = await e2bSandbox(row.sandbox_id);
      const bytes = await d.files.read(`/tmp/shots/s_${num}.png`, { format: "bytes" });
      reply.header("Content-Type", "image/png").header("Cache-Control", "public, max-age=600");
      return reply.send(Buffer.from(bytes));
    } catch {
      return reply.code(404).send({ error: "shot not available" });
    }
  });

  // ---- purge: HARD-delete one finished call (row + sandbox + film) ----
  // Scoped to the caller's org (cookie-authenticated; not a Recall-exempt GET).
  app.delete("/api/live/call/:id", async (req, reply) => {
    if (!req.orgId) return reply.code(401).send({ error: "auth required" });
    const { id } = req.params as { id: string };
    const result = await purgeCall(req.orgId, id, { actor: req.user?.id });
    if (!result.ok) return reply.code(404).send({ error: "no such call for this org" });
    return { ok: true, purged: result.deleted, external: result.external };
  });

  // ---- nudge: director → bridge (guide | say | mute | unmute) ----
  app.post("/api/live/nudge", async (req, reply) => {
    const b = (req.body ?? {}) as { kind?: string; text?: string };
    const kind = ["guide", "say", "mute", "unmute", "guest", "direct", "advance", "stepmode"].includes(b.kind || "") ? b.kind : null;
    if (!kind) return reply.code(400).send({ error: "kind must be guide|say|direct|mute|unmute|guest|advance|stepmode" });
    const row = await one<LiveCall>(`SELECT * FROM live_calls WHERE org_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [reqOrg(req)]);
    if (!row?.sandbox_id) return reply.code(409).send({ error: "no live call" });
    const d = await e2bSandbox(row.sandbox_id);
    const payload = JSON.stringify({ kind, text: (b.text || "").slice(0, 500), t: Date.now() }).replace(/'/g, "'\\''");
    await d.commands.run(`echo '${payload}' >> /tmp/nudges.jsonl`, { timeoutMs: 10000 });
    return { ok: true };
  });

  // ---- end: graceful goodbye + teardown ----
  app.post("/api/live/end", async (req, reply) => {
    const org = reqOrg(req);
    const endBody = (req.body ?? {}) as { outcome?: string };
    const row = await one<LiveCall>(`SELECT * FROM live_calls WHERE org_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [org]);
    if (!row) return reply.code(409).send({ error: "no live call" });
    let sourceId: string | null = null;
    let bailed = false; // graceful bail-out detected (metric 5: bail-out rate)
    try {
      if (row.sandbox_id) {
        const d = await e2bSandbox(row.sandbox_id);
        await d.commands.run(`echo '{"kind":"say","text":"Wrap up the call in one warm sentence and say goodbye."}' >> /tmp/nudges.jsonl`, { timeoutMs: 8000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 9000));
        // persist the call transcript before teardown, then auto-debrief it
        try {
          const lg = await d.commands.run("cat /tmp/duplexnav7.log 2>/dev/null | tail -c 120000", { timeoutMs: 12000 });
          const lines = ((lg.stdout || "") + "").split("\n");
          // Graceful bail-out signal: the bridge emits a BAIL marker after N failed
          // recoveries ("let me have [rep] follow up"). Detect it from the log.
          if (lines.some((l) => /\bBAIL(OUT|ING)?\b/i.test(l) || /have\s+\w+\s+follow up/i.test(l))) bailed = true;
          const parts: string[] = [];
          for (const ln of lines) {
            let m;
            if ((m = ln.match(/^GUEST (.*)$/)) || (m = ln.match(/^NUDGE guest (.*)$/))) parts.push(`CUSTOMER: ${m[1]}`);
            else if ((m = ln.match(/^SAY (.*)$/))) parts.push(`MAYA: ${m[1]}`);
            else if ((m = ln.match(/^TOOLCALL (\w+)/))) parts.push(`[screen: ${m[1]}]`);
          }
          const transcript = parts.join("\n");
          if (row.agent_id && transcript.length > 80) {
            sourceId = `cs_${Date.now().toString(36)}_call`;
            const title = `Live call — ${new Date().toISOString().slice(0, 16).replace("T", " ")} (${row.mode})`;
            await query(`INSERT INTO clone_sources (id, agent_id, kind, title, transcript, org_id) VALUES ($1,$2,'live_call',$3,$4,$5)`,
              [sourceId, row.agent_id, title, transcript, org]);
            // film review: persist the per-action screenshots + a structured timeline
            try {
              const dir = `${AH}/shots/${sourceId}`;
              mkdirSync(dir, { recursive: true });
              const timeline: { kind: string; text: string; shot?: number }[] = [];
              let tn = 0;
              for (const ln of lines) {
                let m;
                if ((m = ln.match(/^GUEST (.*)$/)) || (m = ln.match(/^NUDGE guest (.*)$/))) timeline.push({ kind: "guest", text: m[1] });
                else if ((m = ln.match(/^SAY (.*)$/))) timeline.push({ kind: "maya", text: m[1] });
                else if ((m = ln.match(/^TOOLCALL (\w+)/))) { tn += 1; timeline.push({ kind: "action", text: m[1], shot: tn }); }
              }
              writeFileSync(`${dir}/timeline.json`, JSON.stringify({ events: timeline.slice(0, 400) }));
              for (let i = 1; i <= Math.min(tn, 40); i++) {
                try {
                  const bytes = await d.files.read(`/tmp/shots/s_${i}.png`, { format: "bytes" });
                  writeFileSync(`${dir}/s_${i}.png`, Buffer.from(bytes));
                } catch { /* a shot may not exist */ }
              }
            } catch { /* film material is best-effort */ }
          }
        } catch { /* transcript capture is best-effort */ }
        await d.kill().catch(() => {});
      }
    } catch { /* sandbox may already be gone */ }
    // outcome: explicit override > detected bail-out > completed (metric 5).
    const outcome = endBody.outcome === "bailed" || bailed ? "bailed" : (endBody.outcome || "completed");
    await query(`UPDATE live_calls SET ended_at=now(), phase='ended', outcome=$2 WHERE id=$1`, [row.id, outcome]);
    // Meter the billable live-call-minutes (started_at -> now). Fail-open.
    try {
      const startMs = new Date(row.started_at).getTime();
      const minutes = Math.max(0, (Date.now() - startMs) / 60000);
      const orgId = await orgForAgent(row.agent_id);
      void recordLiveCallMinutes({ orgId, agentId: row.agent_id, callId: row.id }, minutes, { path: "live.ts", mode: row.mode });
    } catch { /* fail-open */ }
    const iv = monitors.get(row.id); if (iv) { clearInterval(iv); monitors.delete(row.id); }
    // OBSERVABILITY: completion + bail-out events (best-effort, only for real calls).
    if (row.mode === "zoom") {
      void emit(EVENTS.LIVE_CALL_COMPLETED, { agentId: row.agent_id, callId: row.id, props: { outcome } }).catch(() => {});
      if (outcome === "bailed") void emit(EVENTS.CALL_BAIL_OUT, { agentId: row.agent_id, callId: row.id }).catch(() => {});
    }
    // fire-and-forget: build the debrief so it's waiting when the operator lands there
    if (sourceId && row.agent_id) {
      const key = process.env.BFF_API_KEY || "";
      const buildOnce = () => fetch(`http://localhost:${process.env.PORT || 8787}/api/debrief/build`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": key },
        body: JSON.stringify({ agentId: row.agent_id, sourceId }),
      });
      void (async () => {
        try {
          let r = await buildOnce();
          if (!r.ok) { await new Promise((res) => setTimeout(res, 20000)); r = await buildOnce(); }
          app.log.info({ status: r.status, sourceId }, "auto-debrief build");
        } catch (e) { app.log.warn({ err: String(e), sourceId }, "auto-debrief failed"); }
      })();
    }
    return { ok: true, callId: row.id, transcriptSaved: !!sourceId, debriefPending: !!sourceId };
  });
}
