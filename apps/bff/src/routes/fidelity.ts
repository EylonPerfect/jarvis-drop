import type { FastifyInstance } from "fastify";
import { one } from "../db/pool.js";
import { getCompany } from "./company.js";
import { providerChatJson } from "../lib/callVision.js";
import { orgId } from "../lib/auth.js";
import { getSetting, setSetting } from "../lib/settingsStore.js";
import { agentInOrg } from "../lib/tenancy.js";

// ============================================================
// Fidelity loop — converge the clone on the real call with no
// human in the loop. Boots a rehearsal, replays the REAL
// customer's turns as guest nudges, diffs the clone's replies
// (and screen evidence) against what the human rep actually did
// at that moment (timed transcript + observed screen timeline),
// LLM-judges each moment, then applies a small capped batch of
// auto-fixes through the SAME public endpoints the Studio UI
// uses (persona versions / playbook PUT) — never raw writes.
// ============================================================

const PORT = process.env.PORT || 8787;
const KEY = process.env.BFF_API_KEY || "";

// Bind the TARGET org into every internal self-call (follow-up #73): each call
// carries X-Service-Org so resolveRequestAuth scopes it to this agent's tenant
// instead of pinning to legacy. org is fixed for the whole fidelity run.
function makeApi(org: string) {
  return async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
    // Content-Type only when a body rides along: Fastify 400s a bodyless POST
    // that claims application/json (bit us on /api/live/end — leaked a sandbox).
    const r = await fetch(`http://localhost:${PORT}${path}`, {
      method,
      headers: { "X-API-Key": KEY, "X-Service-Org": org, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(120_000),
    });
    const json = (await r.json().catch(() => ({}))) as T;
    return { status: r.status, json };
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type Utterance = { start: number; speaker: string; domain: string; text: string };
type Observed = { segments: { fromSec: number; toSec: number; screenKey: string; popups: string[]; notable?: string }[]; turns: Utterance[] };
type FeedEvent = { seq: number; kind: string; text: string };

type Moment = {
  idx: number;
  atSec: number;
  customer: string;
  humanReply: string;
  humanScreen: string;
  cloneReply: string;
  cloneEvidence: string[];
  fidelity: number;
  gap: string;
  fixType: "none" | "few_shot" | "rule" | "beat_say" | "beat_screen";
  fix: string;
  /** false = the human's reaction depended on signals a clean-text replay can't reproduce — excluded from avg */
  reproducible?: boolean;
};

type AutoFix = {
  momentIdx: number;
  fixType: string;
  before: string;
  after: string;
  result: string; // e.g. "persona v12" | "playbook stage st3 updated" | error
};

async function getVoiceMode(org: string): Promise<string> {
  const v = await getSetting<string>(org, "call_voice_mode");
  return typeof v === "string" ? v : "auto";
}
async function setVoiceMode(org: string, mode: string): Promise<void> {
  await setSetting(org, "call_voice_mode", mode);
}

// customer→rep moment plan from the timed transcript
function planMoments(turns: Utterance[], companyDomain: string, maxTurns: number): { atSec: number; customer: string; humanReply: string }[] {
  // the rep = the speaker on the operator company's domain; if none matches,
  // fall back to the most-talkative speaker (same heuristic as clone-voice)
  let isRep = (u: Utterance) => !!companyDomain && u.domain === companyDomain;
  if (!turns.some(isRep)) {
    const byWords = new Map<string, number>();
    for (const u of turns) byWords.set(u.speaker, (byWords.get(u.speaker) || 0) + u.text.split(/\s+/).length);
    const top = [...byWords.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    isRep = (u) => u.speaker === top;
  }
  const moments: { atSec: number; customer: string; humanReply: string }[] = [];
  for (let i = 0; i < turns.length && moments.length < maxTurns; i++) {
    const u = turns[i];
    if (isRep(u) || u.text.trim().length < 12) continue;
    // human reply = the next consecutive rep utterances
    let reply = "";
    for (let k = i + 1; k < turns.length; k++) {
      if (!isRep(turns[k])) break;
      reply = reply ? `${reply} ${turns[k].text}` : turns[k].text;
      if (reply.length > 600) break;
    }
    if (!reply) continue;
    moments.push({ atSec: u.start, customer: u.text.slice(0, 500), humanReply: reply.slice(0, 700) });
  }
  return moments;
}

function screenAt(observed: Observed, atSec: number): string {
  const seg = (observed.segments || []).find((s) => s.fromSec <= atSec && atSec < s.toSec)
    ?? (observed.segments || []).filter((s) => s.fromSec <= atSec).pop();
  if (!seg) return "unknown";
  return `${seg.screenKey}${seg.popups?.length ? ` (popups: ${seg.popups.join(" | ")})` : ""}`;
}

// feed snapshots drift (the tail window shifts), so track counts per kind
function feedCounts(events: FeedEvent[]): { say: number; act: number } {
  return {
    say: events.filter((e) => e.kind === "say").length,
    act: events.filter((e) => e.kind === "tool" || e.kind === "beat").length,
  };
}

export default async function fidelityRoutes(app: FastifyInstance) {
  let running = false;

  app.post("/api/fidelity/run", async (req, reply) => {
    const b = (req.body ?? {}) as { agentId?: string; sourceId?: string; maxTurns?: number };
    if (!b.agentId || !b.sourceId) return reply.code(400).send({ error: "agentId and sourceId required" });
    if (running) return reply.code(409).send({ error: "a fidelity run is already in progress" });
    const maxTurns = Math.max(2, Math.min(25, b.maxTurns ?? 12));

    const org = orgId(req);
    const api = makeApi(org); // self-calls below run in the agent's tenant (follow-up #73)
    if (!(await agentInOrg(b.agentId, org))) return reply.code(404).send({ error: "not found" });

    const agent = await one<any>(`SELECT * FROM agents WHERE id=$1 AND org_id=$2`, [b.agentId, org]);
    if (!agent) return reply.code(404).send({ error: "agent not found" });
    const src = await one<any>(`SELECT id, title, observed FROM clone_sources WHERE agent_id=$1 AND id=$2 AND org_id=$3`, [b.agentId, b.sourceId, org]);
    if (!src) return reply.code(404).send({ error: "source not found" });
    const observed = src.observed as Observed | null;
    if (!observed?.turns?.length) return reply.code(409).send({ error: "this source has no observed timeline — run POST /api/fathom/observe-screens first" });

    // Precondition: never displace a real call. /api/live/status also expires
    // stale rows, so ask IT rather than reading live_calls directly.
    const st0 = await api("GET", "/api/live/status");
    const active0 = st0.json?.call && !st0.json.call.ended_at && st0.json.call.phase !== "error" && st0.json.call.phase !== "expired";
    if (active0) return reply.code(409).send({ error: "a live call exists — not starting a fidelity run", callId: st0.json.call.id });

    const companyDomain = ((await getCompany(orgId(req))).domain || "").toLowerCase().trim();
    const plan = planMoments(observed.turns, companyDomain, maxTurns);
    if (plan.length < 2) return reply.code(400).send({ error: "could not derive enough customer→rep moments from the timed transcript" });

    running = true;
    const prevVoiceMode = await getVoiceMode(org);
    const prevReport = await getSetting<any>(org, `fidelity_report:${b.agentId}`);
    const moments: Moment[] = [];
    let callId: string | null = null;
    let aborted: string | null = null;

    try {
      // cheap voice for the unattended run; restored in finally
      await setVoiceMode(org, "openai");

      // boot a rehearsal and wait for ready (~4 min typical)
      const join = await api("POST", "/api/live/join", { mode: "rehearsal", agentId: b.agentId });
      if (join.status !== 201 || !join.json?.callId) {
        return reply.code(502).send({ error: `rehearsal join failed (${join.status}): ${join.json?.error ?? "?"}` });
      }
      callId = join.json.callId as string;
      app.log.info({ callId, agentId: b.agentId, plannedTurns: plan.length }, "fidelity: rehearsal booting");
      const bootT0 = Date.now();
      for (;;) {
        await sleep(6000);
        const st = await api("GET", "/api/live/status");
        const c = st.json?.call;
        if (!c || c.id !== callId || c.ended_at) { aborted = "the rehearsal was ended externally during boot"; break; }
        if (c.phase === "ready") break;
        if (c.phase === "error") { aborted = "the rehearsal pipeline errored during boot"; break; }
        if (Date.now() - bootT0 > 7 * 60_000) { aborted = "rehearsal never reached ready within 7 minutes"; break; }
      }

      // replay the real customer, one turn at a time
      if (!aborted) {
        await sleep(8000); // let the opening line land before the first guest turn
        let feed = await api<{ events: FeedEvent[] }>("GET", "/api/live/feed");
        let counts = feedCounts(feed.json?.events ?? []);
        for (let i = 0; i < plan.length; i++) {
          // a user join can only happen if someone tore our run down first —
          // poll status between turns and stand down gracefully.
          const st = await api("GET", "/api/live/status");
          const c = st.json?.call;
          if (!c || c.id !== callId || c.ended_at) { aborted = `call lost before turn ${i + 1} (a user may have taken the slot)`; break; }

          const p = plan[i];
          const before = counts;
          const n = await api("POST", "/api/live/nudge", { kind: "guest", text: p.customer });
          if (n.status !== 200) { aborted = `nudge failed at turn ${i + 1} (${n.status})`; break; }

          let cloneReply = "";
          const evidence: string[] = [];
          const t0 = Date.now();
          while (Date.now() - t0 < 75_000) {
            await sleep(3000);
            feed = await api<{ events: FeedEvent[] }>("GET", "/api/live/feed");
            const events = feed.json?.events ?? [];
            counts = feedCounts(events);
            if (counts.say > before.say) {
              // give a multi-sentence reply a beat to finish, then snapshot
              await sleep(4000);
              feed = await api<{ events: FeedEvent[] }>("GET", "/api/live/feed");
              const evs = feed.json?.events ?? [];
              counts = feedCounts(evs);
              cloneReply = evs.filter((e) => e.kind === "say").slice(before.say).map((e) => e.text).join(" ");
              evidence.push(...evs.filter((e) => e.kind === "tool" || e.kind === "beat").slice(before.act).map((e) => `${e.kind}: ${e.text}`));
              break;
            }
          }
          moments.push({
            idx: i,
            atSec: p.atSec,
            customer: p.customer,
            humanReply: p.humanReply,
            humanScreen: screenAt(observed, p.atSec),
            cloneReply: cloneReply || "(no reply within 75s)",
            cloneEvidence: evidence.slice(0, 8),
            fidelity: 0, gap: "", fixType: "none", fix: "",
          });
          app.log.info({ callId, turn: i + 1, of: plan.length, gotReply: !!cloneReply }, "fidelity: turn replayed");
        }
      }
    } finally {
      // teardown + voice restore, whatever happened above
      try {
        const st = await api("GET", "/api/live/status");
        if (callId && st.json?.call?.id === callId && !st.json.call.ended_at) {
          const endR = await api("POST", "/api/live/end");
          if (endR.status !== 200) app.log.error({ callId, status: endR.status }, "fidelity: /api/live/end FAILED — sandbox may be leaked, end it manually");
        }
      } catch { /* sandbox may be gone */ }
      try { await setVoiceMode(org, prevVoiceMode); } catch { app.log.error("fidelity: FAILED to restore call_voice_mode"); }
      running = false;
    }

    // ---- diff pass: judge every replayed moment against the real call ----
    // Artifact-awareness: the replay feeds the customer's words as CLEAN TEXT.
    // Moments where the human's behavior depended on signals the replay cannot
    // reproduce (garbled audio, purely visual context, interruption timing)
    // are flagged unreproducible and EXCLUDED from the average — otherwise the
    // score carries a permanent handicap no fix can remove.
    for (const m of moments) {
      const j = await providerChatJson<{ fidelity: number; gap: string; fixType: string; fix: string; reproducible: boolean }>(
        orgId(req),
        `You judge how faithfully an AI clone of a sales rep reproduced the REAL rep's behavior at one moment of a demo call. IMPORTANT CONTEXT: this is a text replay — the clone received the customer's words as clean, legible text. First decide "reproducible": false when the human's reaction depended on signals absent from a clean-text replay (they asked to repeat because audio was garbled; they reacted to something purely visual or to being interrupted mid-word). Unreproducible moments are measurement artifacts, not clone flaws. For reproducible moments, compare substance, tone, and screen behavior (the human's screen at that moment vs the clone's screen-action evidence; evidence lines are the clone's tool calls — an empty list while the human was showing a product screen is a gap ONLY if the reply should have driven the screen). Return ONLY JSON {"reproducible":bool,"fidelity":0..1,"gap":str,"fixType":"none"|"few_shot"|"rule"|"beat_say"|"beat_screen","fix":str}. fixType: few_shot = the clone needs the human's actual reply as an example; rule = a standing behavioral rule; beat_say = the playbook's voice track is wrong for this beat; beat_screen = the playbook's screen actions are wrong for this beat; none = close enough (fidelity >= 0.7 is usually none; always none when reproducible=false). fix = one imperative sentence describing the exact change.`,
        `CUSTOMER SAID (${mmss(m.atSec)}): ${m.customer}\nHUMAN REP REPLIED: ${m.humanReply}\nHUMAN'S SCREEN THEN: ${m.humanScreen}\nCLONE REPLIED: ${m.cloneReply}\nCLONE SCREEN EVIDENCE: ${m.cloneEvidence.join(" | ") || "(none)"}`,
      );
      m.fidelity = Math.max(0, Math.min(1, Number(j?.fidelity ?? 0)));
      m.gap = String(j?.gap ?? "").slice(0, 300);
      m.fixType = (["none", "few_shot", "rule", "beat_say", "beat_screen"].includes(j?.fixType ?? "") ? j!.fixType : "none") as Moment["fixType"];
      m.fix = String(j?.fix ?? "").slice(0, 300);
      m.reproducible = j?.reproducible !== false;
      if (!m.reproducible) m.fixType = "none"; // artifacts never drive auto-fixes
    }
    const judged = moments.filter((m) => m.cloneReply && !m.cloneReply.startsWith("(no reply"));
    const scoreable = judged.filter((m) => m.reproducible !== false);
    const avg = scoreable.length ? scoreable.reduce((a, m) => a + m.fidelity, 0) / scoreable.length : 0;

    // ---- auto-fix: capped, low-fidelity moments only, via public endpoints ----
    const autoFixes: AutoFix[] = [];
    const eligible = moments.filter((m) => m.fidelity < 0.5 && m.fixType !== "none" && m.fix).slice(0, 5);
    for (const m of eligible) {
      try {
        if (m.fixType === "few_shot" || m.fixType === "rule") {
          const ag = await one<any>(`SELECT persona, name, role FROM agents WHERE id=$1 AND org_id=$2`, [b.agentId, org]);
          const spec = ag?.persona?.identity ? JSON.parse(JSON.stringify(ag.persona)) : null;
          if (!spec) { autoFixes.push({ momentIdx: m.idx, fixType: m.fixType, before: "", after: m.fix, result: "skipped: agent has no persona spec yet" }); continue; }
          let before = "";
          if (m.fixType === "few_shot") {
            before = `few_shots: ${spec.few_shots.length}`;
            spec.few_shots.push({ id: `f${spec.few_shots.length + 1}`, situation: m.customer, human_response: m.humanReply, source: `fidelity:${src.id}@${mmss(m.atSec)}`, active: true });
          } else {
            before = `rules: ${spec.behaviors.rules.length}`;
            spec.behaviors.rules.push({ id: `r${spec.behaviors.rules.length + 1}`, text: m.fix, source: `fidelity:${src.id}@${mmss(m.atSec)}`, active: true });
          }
          const r = await api("POST", `/api/clones/${b.agentId}/versions`, { spec, changeNote: `Fidelity auto-fix (${m.fixType}) @ ${mmss(m.atSec)}: ${m.gap.slice(0, 80)}` });
          autoFixes.push({ momentIdx: m.idx, fixType: m.fixType, before, after: m.fixType === "few_shot" ? `few_shot: "${m.customer.slice(0, 60)}…" → rep's real line` : m.fix, result: r.status === 200 ? `persona v${r.json?.version?.number}` : `versions POST failed (${r.status})` });
        } else {
          // beat_say | beat_screen — targeted playbook edit through GET → PUT
          const pbR = await api("GET", `/api/clones/${b.agentId}/playbook`);
          const pb = pbR.json?.playbook;
          if (!pb?.stages?.length) { autoFixes.push({ momentIdx: m.idx, fixType: m.fixType, before: "", after: m.fix, result: "skipped: no playbook" }); continue; }
          const trimmed = pb.stages.map((s: any) => ({ id: s.id, name: s.name, goal: s.goal, voice: s.voice, screen: s.screen }));
          const edit = await providerChatJson<{ stageId: string; voice?: any; screen?: { actions: string[]; waitBehavior: string } }>(
            orgId(req),
            `You apply ONE fix to a live-demo playbook. Pick the single stage the fix concerns and return it corrected. Return ONLY JSON {"stageId":str${m.fixType === "beat_say" ? `,"voice":{"objective":str,"moves":[str],"exampleLines":[str],"listenFor":[str]}` : `,"screen":{"actions":[str],"waitBehavior":str}`}}. Change only what the fix requires; keep everything else as-is.`,
            `STAGES: ${JSON.stringify(trimmed)}\nMOMENT (${mmss(m.atSec)}) — customer: ${m.customer}\nHUMAN DID: ${m.humanReply}${m.fixType === "beat_screen" ? `\nHUMAN'S SCREEN: ${m.humanScreen}` : ""}\nFIX: ${m.fix}`,
          );
          const idx = pb.stages.findIndex((s: any) => s.id === edit?.stageId);
          if (!edit || idx < 0) { autoFixes.push({ momentIdx: m.idx, fixType: m.fixType, before: "", after: m.fix, result: "skipped: could not map the fix to a stage" }); continue; }
          const beforeStage = JSON.stringify(m.fixType === "beat_say" ? pb.stages[idx].voice : pb.stages[idx].screen).slice(0, 400);
          if (m.fixType === "beat_say" && edit.voice) {
            pb.stages[idx].voice = {
              objective: String(edit.voice.objective ?? pb.stages[idx].voice?.objective ?? ""),
              moves: Array.isArray(edit.voice.moves) ? edit.voice.moves.map(String) : pb.stages[idx].voice?.moves ?? [],
              exampleLines: Array.isArray(edit.voice.exampleLines) ? edit.voice.exampleLines.map(String) : pb.stages[idx].voice?.exampleLines ?? [],
              listenFor: Array.isArray(edit.voice.listenFor) ? edit.voice.listenFor.map(String) : pb.stages[idx].voice?.listenFor ?? [],
            };
          } else if (m.fixType === "beat_screen" && edit.screen) {
            pb.stages[idx].screen = {
              actions: Array.isArray(edit.screen.actions) ? edit.screen.actions.map(String) : pb.stages[idx].screen?.actions ?? [],
              waitBehavior: String(edit.screen.waitBehavior ?? pb.stages[idx].screen?.waitBehavior ?? ""),
            };
          } else { autoFixes.push({ momentIdx: m.idx, fixType: m.fixType, before: beforeStage, after: m.fix, result: "skipped: edit carried no usable block" }); continue; }
          const afterStage = JSON.stringify(m.fixType === "beat_say" ? pb.stages[idx].voice : pb.stages[idx].screen).slice(0, 400);
          const put = await api("PUT", `/api/clones/${b.agentId}/playbook`, { playbook: pb });
          autoFixes.push({ momentIdx: m.idx, fixType: m.fixType, before: beforeStage, after: afterStage, result: put.status === 200 ? `playbook stage ${edit.stageId} updated` : `playbook PUT failed (${put.status})` });
        }
      } catch (e) {
        autoFixes.push({ momentIdx: m.idx, fixType: m.fixType, before: "", after: m.fix, result: `error: ${(e as Error).message.slice(0, 120)}` });
      }
    }

    const report = {
      runAt: new Date().toISOString(),
      agentId: b.agentId,
      sourceId: b.sourceId,
      sourceTitle: src.title,
      callId,
      aborted,
      plannedTurns: plan.length,
      repliedTurns: judged.length,
      avg: Math.round(avg * 100) / 100,
      prevAvg: typeof prevReport?.avg === "number" ? prevReport.avg : null,
      scoreableTurns: scoreable.length,
      excludedAsArtifacts: judged.length - scoreable.length,
      topGaps: [...scoreable].sort((a, x) => a.fidelity - x.fidelity).slice(0, 3).map((m) => ({ atSec: m.atSec, fidelity: m.fidelity, gap: m.gap })),
      moments,
      autoFixes,
      voiceModeRestored: prevVoiceMode,
    };
    await setSetting(org, `fidelity_report:${b.agentId}`, report);
    app.log.info({ agentId: b.agentId, avg: report.avg, fixes: autoFixes.length, aborted }, "fidelity: run complete");
    return report;
  });

  app.get("/api/fidelity/latest", async (req) => {
    const { agentId } = (req.query ?? {}) as { agentId?: string };
    if (!agentId) return { report: null };
    const report = await getSetting<any>(orgId(req), `fidelity_report:${agentId}`);
    return { report: report ?? null };
  });
}
