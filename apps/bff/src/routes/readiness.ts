import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { orgId } from "../lib/auth.js";
import { getSetting } from "../lib/settingsStore.js";
import { agentInOrg } from "../lib/tenancy.js";
import { emit, EVENTS } from "../lib/analytics.js";
import { notifyFunnelEvent } from "../lib/alerts.js";
import { orgCanGoLive } from "../lib/billing.js";

// Emit reached_70 the FIRST time a clone crosses the live gate (activation
// metric numerator). Idempotent via a ledger existence check keyed on agent.
async function markReached70(agentId: string, score: number): Promise<void> {
  if (score < 70) return;
  try {
    const prior = await one(`SELECT id FROM usage_events WHERE name=$1 AND agent_id=$2 LIMIT 1`, [EVENTS.REACHED_70, agentId]);
    if (!prior) await emit(EVENTS.REACHED_70, { agentId, value: score });
  } catch { /* best-effort */ }
}

// READINESS — the self-serve fusion layer. Collapses gates/verify/red-team/
// fidelity into ONE 0-100 score, a lifecycle stage, a plain sentence, and an
// approvals queue of one-click human decisions. Reads ONLY data that already
// exists; actions chain EXISTING endpoints (never raw writes). Promotion is
// always a human act and unlocks at fused score >= 70 AND red-team >= 70.

const PORT = process.env.PORT || 8787;
const KEY = process.env.BFF_API_KEY || "";
// Bind the TARGET org into every internal self-call (follow-up #73): each call
// carries X-Service-Org so resolveRequestAuth scopes it to this agent's tenant
// instead of pinning to legacy.
function makeApi(org: string) {
  return async function api<T = unknown>(method: string, path: string, body?: unknown, timeoutMs = 120_000): Promise<{ status: number; json: T }> {
    const r = await fetch(`http://localhost:${PORT}${path}`, {
      method,
      headers: { "X-API-Key": KEY, "X-Service-Org": org, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await r.json().catch(() => ({}))) as T;
    return { status: r.status, json };
  };
}

// mode types the next step: "judgment" is a real human decision (corrections,
// promote, coach); "auto" is a system run the operator merely starts (measure).
type Approval = { id: string; kind: "corrections" | "promote" | "coach" | "measure"; mode: "judgment" | "auto"; title: string; detail: string; evidence: string; action: string; ready: boolean; blocked?: string };

// The 7 quality-check gates, derived in ONE place. Every screen (roster,
// quality checks) reads these instead of recomputing the pass/fail rules, so
// they can no longer drift. score is only meaningful for the two measured
// gates (verify, redteam) and is null for the rest.
type GateKey = "sources" | "persona" | "playbook" | "verify" | "golden" | "voice" | "redteam";
type GateResult = { key: GateKey; label: string; pass: boolean; score: number | null };
type GateInput = { sources: number; hasPersona: boolean; stages: number; verifyAvg: number | null; hasGolden: boolean; hasVoice: boolean; redteamAvg: number | null };

function buildGates(g: GateInput): GateResult[] {
  return [
    { key: "sources", label: "Call sources added", pass: g.sources > 0, score: null },
    { key: "persona", label: "Persona extracted", pass: g.hasPersona, score: null },
    { key: "playbook", label: "Call playbook built", pass: g.stages > 0, score: null },
    { key: "verify", label: "Verification score", pass: g.verifyAvg != null && g.verifyAvg >= 0.7, score: g.verifyAvg },
    { key: "golden", label: "Live version pinned", pass: g.hasGolden, score: null },
    { key: "voice", label: "Voice ready", pass: g.hasVoice, score: null },
    { key: "redteam", label: "Red team", pass: g.redteamAvg != null && g.redteamAvg >= 0.7, score: g.redteamAvg },
  ];
}

// voice is ready if the agent has a voice id OR the persona carries a cloned
// elevenlabs voice — matches what the roster and quality-checks screens show.
function gateInputFrom(agent: any, sources: number, stages: number, verify: any, redteam: any): GateInput {
  return {
    sources,
    hasPersona: !!agent.persona?.identity,
    stages,
    verifyAvg: typeof verify?.average === "number" ? verify.average : null,
    hasGolden: !!agent.golden_persona_id,
    hasVoice: !!(agent.voice_id || agent.persona?.voice?.elevenlabs_voice_id),
    redteamAvg: typeof redteam?.average === "number" ? redteam.average : null,
  };
}

// Lightweight gate read for the roster and quality-checks screens — the same
// derivation the readiness fusion uses, without the approvals/activity work.
async function computeGates(agentId: string, org: string) {
  const agent = await one<any>(`SELECT * FROM agents WHERE id=$1 AND org_id=$2`, [agentId, org]);
  if (!agent) return null;
  const sources = await query<any>(
    `SELECT id FROM clone_sources WHERE agent_id=$1 AND org_id=$2 AND kind != 'live_call'`,
    [agentId, org],
  ).catch(() => [] as any[]);
  const verify = await getSetting<any>(org, `verify_result:${agentId}`);
  const redteam = await getSetting<any>(org, `redteam_result:${agentId}`);
  const pb = agent.playbook?.kind === "calls" ? agent.playbook.callPlaybook : null;
  const stages = Array.isArray(pb?.stages) ? pb.stages.length : 0;
  const gates = buildGates(gateInputFrom(agent, sources.length, stages, verify, redteam));
  return { gates, passed: gates.filter((x) => x.pass).length, total: 7 };
}

// ---------------------------------------------------------------------------
// LIVE-JOIN GATE — the SOLE hard safety stop (Launch decision #1). A clone may
// go live (scheduled OR instant) only at readiness score >= 70; below 70 is
// rehearsal-only. This is the single derivation every join path calls so the
// gate can NEVER be bypassed. Returns the score + the decision + a human reason.
//
// The fused score is recomputed here from the same inputs computeReadiness uses,
// kept deliberately small (no approvals/sentence work) so join stays cheap.
// Org-scoped (Phase-2): the agent row is fetched by its globally-unique id, and
// its org_id then scopes every downstream read so the gate never crosses tenants.
export const LIVE_GATE_MIN = 70;
export type LiveGate = { ok: boolean; score: number; redteamAvg: number | null; reason: string };

export async function liveJoinGate(agentId: string): Promise<LiveGate> {
  const agent = await one<any>(`SELECT * FROM agents WHERE id=$1`, [agentId]);
  if (!agent) return { ok: false, score: 0, redteamAvg: null, reason: "clone not found" };
  const org = agent.org_id;
  const sources = await query<any>(
    `SELECT id FROM clone_sources WHERE agent_id=$1 AND org_id=$2 AND kind != 'live_call'`, [agentId, org],
  ).catch(() => [] as any[]);
  const verify = await getSetting<any>(org, `verify_result:${agentId}`);
  const redteam = await getSetting<any>(org, `redteam_result:${agentId}`);
  const fidelity = await getSetting<any>(org, `fidelity_report:${agentId}`);
  const pb = agent.playbook?.kind === "calls" ? agent.playbook.callPlaybook : null;
  const stages = Array.isArray(pb?.stages) ? pb.stages.length : 0;
  const gateList = buildGates(gateInputFrom(agent, sources.length, stages, verify, redteam));
  const gatesDone = gateList.filter((g) => g.pass).length;
  const parts: { w: number; v: number | null }[] = [
    { w: 0.3, v: gatesDone / 7 },
    { w: 0.2, v: typeof verify?.average === "number" ? verify.average : null },
    { w: 0.2, v: typeof redteam?.average === "number" ? redteam.average : null },
    { w: 0.3, v: typeof fidelity?.avg === "number" ? fidelity.avg : null },
  ];
  const present = parts.filter((p) => p.v !== null);
  const wSum = present.reduce((a, p) => a + p.w, 0) || 1;
  const score = Math.round((present.reduce((a, p) => a + p.w * (p.v as number), 0) / wSum) * 100);
  const redteamAvg = typeof redteam?.average === "number" ? redteam.average : null;
  const ok = score >= LIVE_GATE_MIN;
  return {
    ok, score, redteamAvg,
    reason: ok ? `readiness ${score}% ≥ ${LIVE_GATE_MIN}` : `readiness ${score}% is below the ${LIVE_GATE_MIN}% live gate — rehearsal only until it clears`,
  };
}

async function computeReadiness(agentId: string, org: string) {
  const agent = await one<any>(`SELECT * FROM agents WHERE id=$1 AND org_id=$2`, [agentId, org]);
  if (!agent) return null;
  const first = String(agent.name || "This clone").split(/\s+/)[0];
  const sources = await query<any>(
    `SELECT id, title, url, (observed IS NOT NULL) AS grounded FROM clone_sources WHERE agent_id=$1 AND org_id=$2 AND kind != 'live_call' ORDER BY created_at`,
    [agentId, org],
  ).catch(() => [] as any[]);
  const verify = await getSetting<any>(org, `verify_result:${agentId}`);
  const redteam = await getSetting<any>(org, `redteam_result:${agentId}`);
  const fidelity = await getSetting<any>(org, `fidelity_report:${agentId}`);
  const tip = await one<{ n: number }>(`SELECT COALESCE(MAX(number),0) AS n FROM persona_versions WHERE agent_id=$1 AND org_id=$2`, [agentId, org]);
  const pinnedRow = agent.golden_persona_id ? await one<{ number: number }>(`SELECT number FROM persona_versions WHERE id=$1 AND org_id=$2`, [agent.golden_persona_id, org]) : null;
  const pb = agent.playbook?.kind === "calls" ? agent.playbook.callPlaybook : null;
  const stages = Array.isArray(pb?.stages) ? pb.stages.length : 0;

  // the same 7 quality checks the roster and quality-checks screens show —
  // derived once via buildGates so every screen reads one source
  const hasPersona = !!agent.persona?.identity;
  const gateList = buildGates(gateInputFrom(agent, sources.length, stages, verify, redteam));
  const gatesDone = gateList.filter((g) => g.pass).length;

  // fuse — weights redistribute when a component has never been measured
  const parts: { w: number; v: number | null }[] = [
    { w: 0.3, v: gatesDone / 7 },
    { w: 0.2, v: typeof verify?.average === "number" ? verify.average : null },
    { w: 0.2, v: typeof redteam?.average === "number" ? redteam.average : null },
    { w: 0.3, v: typeof fidelity?.avg === "number" ? fidelity.avg : null },
  ];
  const present = parts.filter((p) => p.v !== null);
  const wSum = present.reduce((a, p) => a + p.w, 0) || 1;
  const score = Math.round((present.reduce((a, p) => a + p.w * (p.v as number), 0) / wSum) * 100);

  const promotePending = hasPersona && (!agent.golden_persona_id || (tip?.n ?? 0) > (pinnedRow?.number ?? 0));
  const promoteUnlocked = score >= 70 && typeof redteam?.average === "number" && redteam.average >= 0.7;

  // A rehearsal (or grounding replay) uses a live session; while one is
  // un-ended, "start the rehearsal" is in-progress, not an available action.
  const runningRow = await one<any>(`SELECT id FROM live_calls WHERE agent_id=$1 AND org_id=$2 AND ended_at IS NULL LIMIT 1`, [agentId, org]);
  const running = !!runningRow;

  const approvals: Approval[] = [];
  // Corrections from grounding only become a real decision once there is a
  // scored rehearsal to weigh them against — before that they are just noise.
  if (fidelity) for (const s of sources.filter((x: any) => x.grounded)) {
    approvals.push({
      id: `corr:${s.id}`, kind: "corrections", mode: "judgment",
      title: "Review the changes the recording suggests",
      detail: `We watched the recording of "${(s.title || s.id).slice(0, 70)}" frame by frame and found spots where the demo flow differs from what actually happened.`,
      evidence: `Source: ${s.title || s.id}`,
      action: "Review the changes",
      ready: true,
    });
  }
  if (promotePending) {
    const fidBit = typeof fidelity?.avg === "number"
      ? (typeof fidelity?.prevAvg === "number"
        ? ` Real-call match moved ${fidelity.prevAvg <= fidelity.avg ? "up" : "down"}: ${Math.round(fidelity.prevAvg * 100)}% → ${Math.round(fidelity.avg * 100)}%.`
        : ` Latest real-call match: ${Math.round(fidelity.avg * 100)}%.`)
      : "";
    approvals.push({
      id: "promote", kind: "promote", mode: "judgment",
      title: agent.golden_persona_id ? `Promote the improved version to live` : `Put ${first} live for the first time`,
      detail: `${first}'s working version (v${tip?.n ?? "?"}) is now ahead of the live one${pinnedRow ? ` (v${pinnedRow.number})` : ""}.${fidBit} One click runs the adversarial quality check and, if it clears 70%, goes live.`,
      evidence: `Working v${tip?.n ?? "?"} vs live ${pinnedRow ? `v${pinnedRow.number}` : "(none)"} · demo flow v${(pb as any)?.graphVersion ?? 1}${typeof redteam?.average === "number" ? ` · last adversarial check ${Math.round(redteam.average * 100)}%` : ""}`,
      action: "Run checks & promote",
      ready: promoteUnlocked,
      blocked: promoteUnlocked ? undefined : `Go live unlocks at 70% quality — now ${score}%.${running ? " The scoring run is raising it now." : " Score against the real call to raise it."}`,
    });
  }
  if (Array.isArray(fidelity?.topGaps)) {
    fidelity.topGaps.forEach((g: any, i: number) => {
      if (typeof g?.fidelity === "number" && g.fidelity < 0.5 && g.gap) {
        approvals.push({
          id: `coach:${i}`, kind: "coach", mode: "judgment",
          title: "Coach a weak moment from the rehearsal",
          detail: String(g.gap).slice(0, 220),
          evidence: `Rehearsal moment at ${Math.round(g.atSec ?? 0)}s scored ${Math.round(g.fidelity * 100)}% against the real call`,
          action: "Coach this in",
          ready: true,
        });
      }
    });
  }
  const grounded = sources.find((x: any) => x.grounded);
  if (grounded && (running || !fidelity)) {
    approvals.push({
      id: `measure:${grounded.id}`, kind: "measure", mode: "auto",
      title: running ? `${first} is being scored against the real call` : `Score ${first} against the real call`,
      detail: running
        ? `${first} is replaying the customer's real lines from "${(grounded.title || "").slice(0, 60)}" and being scored moment by moment. The score updates here when it finishes, about 10 minutes.`
        : `${first} replays the customer's real lines from "${(grounded.title || "").slice(0, 60)}" and gets scored moment by moment. Takes about 10 minutes and runs only while no live session is up.`,
      evidence: `Grounded recording: ${grounded.title || grounded.id}`,
      action: "Start scoring",
      ready: !running,
      blocked: running ? "Scoring now — the result updates here when it finishes." : undefined,
    });
  }

  const stage = (!hasPersona || gatesDone < 2) ? "learning"
    : (agent.golden_persona_id && !promotePending) ? "live"
    : (score >= 70 && promotePending) ? "ready-to-review"
    : "rehearsing";
  const readyN = approvals.filter((a) => a.ready).length;

  // The ONE next step: the single ready approval (chosen by priority when more
  // than one is ready). Its mode frames the sentence — a human judgment call
  // ("needs your judgment: …") vs. a system run the operator just kicks off
  // ("next step: …"). Each kind maps to a short lowercase label.
  const priority: Approval["kind"][] = ["promote", "corrections", "coach", "measure"];
  const nextStep = approvals
    .filter((a) => a.ready)
    .sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind))[0];
  const nextLabel = (a: Approval): string => {
    if (a.kind === "corrections") return "review the recording's suggested changes";
    if (a.kind === "promote") return agent.golden_persona_id ? "run the checks and promote the new version" : `run the checks and put ${first} live`;
    if (a.kind === "coach") return "coach the weak moment from the rehearsal";
    return "score against the real call"; // measure
  };
  const sentence = nextStep
    ? nextStep.mode === "judgment"
      ? `${first} is ${score}% ready — needs your judgment: ${nextLabel(nextStep)}.`
      : `${first} is ${score}% ready — next step: ${nextLabel(nextStep)}.`
    : stage === "learning"
      ? `${first} is still learning from the calls — ${score}% ready so far.`
      : running
        ? `${first} is being scored against the real call — the result updates here when it finishes.`
        : stage === "live"
          ? `${first} is live at ${score}% readiness — nothing needs you right now.`
          : `${first} is ${score}% ready — improving without you; check back soon.`;

  // Name-free, percent-free next-action line for the roster card. The card
  // shows ONLY this (never the "{name} is {score}%" sentence above): the ready
  // decisions if there are any, otherwise a stage-appropriate holding line.
  const nextAction = readyN > 0
    ? `${readyN} thing${readyN === 1 ? "" : "s"} need${readyN === 1 ? "s" : ""} your judgment`
    : stage === "learning" ? "Learning from the calls"
      : stage === "rehearsing" ? "Rehearsing against the real call"
        : stage === "live" ? "Cleared for live calls"
          : "Improving on its own";

  const activity: string[] = [];
  if (fidelity?.runAt) activity.push(`Rehearsed against "${String(fidelity.sourceTitle || "").slice(0, 40)}" ${String(fidelity.runAt).slice(0, 16).replace("T", " ")} — ${Math.round((fidelity.avg ?? 0) * 100)}% match${Array.isArray(fidelity.autoFixes) && fidelity.autoFixes.length ? `, ${fidelity.autoFixes.length} self-fixes` : ""}`);
  if (redteam?.at) activity.push(`Adversarial check ${String(redteam.at).slice(0, 16).replace("T", " ")} — ${Math.round((redteam.average ?? 0) * 100)}%`);
  if (verify?.at) activity.push(`Line-by-line match ${String(verify.at).slice(0, 16).replace("T", " ")} — ${Math.round((verify.average ?? 0) * 100)}%`);

  // ACTIVATION QUALITY (#4) — legible readiness for onboarding. Distance-to-70 and
  // a CONCRETE "to reach 70, do Y" checklist derived from the failing gates + the
  // measured dimensions, plus per-dimension confidence. Purely informative: the
  // >=70 gate stays the sole hard stop; this only tells the operator what to do next.
  const distanceTo70 = Math.max(0, 70 - score);
  const pct = (v: number | null | undefined) => (typeof v === "number" ? Math.round(v * 100) : null);
  const dimensions = [
    { key: "sources", label: "Real calls ingested", confidence: sources.length > 0 ? 100 : 0, pass: sources.length > 0 },
    { key: "persona", label: "Persona extracted", confidence: hasPersona ? 100 : 0, pass: hasPersona },
    { key: "playbook", label: "Call playbook built", confidence: stages > 0 ? 100 : 0, pass: stages > 0 },
    { key: "match", label: "Line-by-line match", confidence: pct(verify?.average), pass: typeof verify?.average === "number" && verify.average >= 0.7 },
    { key: "resilience", label: "Adversarial resilience", confidence: pct(redteam?.average), pass: typeof redteam?.average === "number" && redteam.average >= 0.7 },
    { key: "fidelity", label: "Real-call fidelity", confidence: pct(fidelity?.avg), pass: typeof fidelity?.avg === "number" && fidelity.avg >= 0.7 },
    { key: "voice", label: "Voice ready", confidence: (agent.voice_id || agent.persona?.voice?.elevenlabs_voice_id) ? 100 : 0, pass: !!(agent.voice_id || agent.persona?.voice?.elevenlabs_voice_id) },
  ];
  const toReach70: string[] = [];
  if (!(sources.length > 0)) toReach70.push("Add at least one real call of the rep to learn from.");
  if (!hasPersona) toReach70.push("Extract the persona from the calls.");
  if (!(stages > 0)) toReach70.push("Build the call playbook (the demo beat sheet).");
  if (!(agent.voice_id || agent.persona?.voice?.elevenlabs_voice_id)) toReach70.push("Set the clone's voice.");
  if (typeof verify?.average === "number" && verify.average < 0.7) toReach70.push(`Raise the line-by-line match to 70% (now ${pct(verify.average)}%) — coach the weak answers.`);
  else if (verify?.average == null) toReach70.push("Run the line-by-line verification against the real calls.");
  if (typeof redteam?.average === "number" && redteam.average < 0.7) toReach70.push(`Pass the adversarial check at 70% (now ${pct(redteam.average)}%) — fix the weak answers on the Quality checks screen.`);
  else if (redteam?.average == null) toReach70.push("Run the adversarial (red-team) check.");
  if (grounded && typeof fidelity?.avg !== "number") toReach70.push("Score the clone against the real call to raise real-call fidelity.");
  if (!agent.golden_persona_id && score >= 70) toReach70.push("Promote the clone to put it live.");

  return {
    agentId, name: agent.name, score, stage, sentence, nextAction, approvals, activity,
    promoteUnlocked,
    gates: gateList,
    distanceTo70,
    toReach70,
    dimensions,
    components: {
      checks: { done: gatesDone, of: 7 },
      match: typeof verify?.average === "number" ? Math.round(verify.average * 100) : null,
      resilience: typeof redteam?.average === "number" ? Math.round(redteam.average * 100) : null,
      fidelity: typeof fidelity?.avg === "number" ? Math.round(fidelity.avg * 100) : null,
    },
  };
}

export default async function readinessRoutes(app: FastifyInstance) {
  app.get("/api/readiness/:agentId", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const org = orgId(req);
    if (!(await agentInOrg(agentId, org))) return reply.code(404).send({ error: "not found" });
    const r = await computeReadiness(agentId, org);
    if (!r) return reply.code(404).send({ error: "agent not found" });
    void markReached70(agentId, r.score); // activation metric (guarded, once per clone)
    return r;
  });

  // Server-authoritative gate read — the roster and quality-checks screens
  // read this instead of recomputing the 7 pass/fail rules client-side.
  app.get("/api/clones/:id/gates", async (req, reply) => {
    const { id } = req.params as { id: string };
    const org = orgId(req);
    if (!(await agentInOrg(id, org))) return reply.code(404).send({ error: "not found" });
    const g = await computeGates(id, org);
    if (!g) return reply.code(404).send({ error: "agent not found" });
    return g;
  });

  // One-click approval actions — chained server-side through EXISTING endpoints.
  app.post("/api/readiness/:agentId/act", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const b = (req.body ?? {}) as { id?: string };
    const id = (b.id ?? "").trim();
    if (!id) return reply.code(400).send({ error: "id required" });
    const org = orgId(req);
    const api = makeApi(org); // chained self-calls (redteam/golden/coach/fidelity) run in the agent's tenant (follow-up #73)
    if (!(await agentInOrg(agentId, org))) return reply.code(404).send({ error: "not found" });
    const r = await computeReadiness(agentId, org);
    if (!r) return reply.code(404).send({ error: "agent not found" });

    if (id === "promote") {
      // promotion unlocks at fused score >= 70 AND a fresh adversarial check >= 70
      if (r.score < 70) return reply.code(400).send({ error: `not promoted — readiness is ${r.score}% (needs 70%). Let the rehearsal loop raise it first.` });
      // chain: adversarial check first (fresh), require >= 0.7, then pin.
      const rt = await api<{ average?: number }>("POST", `/api/redteam/${agentId}`, {}, 600_000);
      const avg = typeof rt.json?.average === "number" ? rt.json.average : null;
      if (rt.status !== 200 || avg === null) return reply.code(502).send({ error: `the adversarial check failed to run (${rt.status})` });
      if (avg < 0.7) return reply.code(400).send({ error: `not promoted — the adversarial check came back at ${Math.round(avg * 100)}% (needs 70%). The weak answers are on the Quality checks screen.`, redteam: Math.round(avg * 100) });
      // BILLING GATE (free->paid wedge): promoting a clone to LIVE consumes a
      // paid clone slot. Below-plan orgs may rehearse but cannot go live.
      const bill = await orgCanGoLive(org, agentId);
      if (!bill.allowed) {
        // "no paid plan" -> payment_required so the FE opens the go-live paywall
        // -> checkout; other blocks (e.g. no_slot) keep their specific code.
        const code = bill.code === "no_subscription" ? "payment_required" : bill.code;
        return reply.code(402).send({ error: bill.reason, code, billing: true, plan: bill.plan, slots: bill.slots, liveClones: bill.liveClones });
      }
      const pin = await api<{ ok?: boolean; versionId?: string }>("POST", `/api/clones/${agentId}/golden`, {});
      if (pin.status !== 200) return reply.code(502).send({ error: `checks passed (${Math.round(avg * 100)}%) but the promote step failed (${pin.status})` });
      app.log.info({ agentId, redteam: avg }, "readiness: promoted to live");
      // OBSERVABILITY: went-live = free->paid signal + activation confirmation.
      void emit(EVENTS.WENT_LIVE, { agentId, value: r.score, props: { redteam: Math.round(avg * 100) } }).catch(() => {});
      // OBSERVABILITY: a clone going live is a headline launch event — ping the operator.
      void notifyFunnelEvent("first_go_live", { agentId, score: r.score, redteam: Math.round(avg * 100) }).catch(() => {});
      return { done: true, redteam: Math.round(avg * 100), promoted: true, receipt: `Adversarial check ${Math.round(avg * 100)}% → promoted to live.` };
    }
    if (id.startsWith("coach:")) {
      const idx = parseInt(id.slice(6), 10) || 0;
      const fid = await getSetting<any>(org, `fidelity_report:${agentId}`);
      const gap = fid?.topGaps?.[idx];
      if (!gap?.gap) return reply.code(404).send({ error: "that gap is no longer in the latest rehearsal report" });
      const c = await api<{ appliedAs?: string[]; summary?: string }>("POST", "/api/coach", { agentId, text: `In rehearsal he under-performed at this moment: "${String(gap.gap).slice(0, 300)}". Coach him so he handles that moment the way the real rep did.` }, 180_000);
      if (c.status !== 200 || !c.json?.appliedAs) return reply.code(502).send({ error: "coaching failed — try again" });
      return { done: true, receipt: `Coached in (${c.json.appliedAs.join(" + ")}): ${c.json.summary}` };
    }
    if (id.startsWith("measure:")) {
      const sourceId = id.slice(8);
      // fire-and-forget — the run takes ~10 min and refuses to start over a live call
      void api("POST", "/api/fidelity/run", { agentId, sourceId }, 30 * 60_000).catch(() => { /* report lands in settings */ });
      return { done: true, started: true, receipt: "Scoring started — the result updates here when it finishes (~10 min)." };
    }
    if (id.startsWith("corr:")) {
      return { done: false, clientAction: "review", receipt: "Open the corrections review." };
    }
    return reply.code(400).send({ error: "unknown approval id" });
  });
}
