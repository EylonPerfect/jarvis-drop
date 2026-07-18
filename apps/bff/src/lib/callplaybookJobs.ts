import { randomUUID } from "node:crypto";
import { query, one } from "../db/pool.js";
import { getSetting, setSetting } from "./settingsStore.js";
import { getActiveProvider, completeProviderChat, cheapModel, type AiProviderRow } from "../lib/providers.js";
import {
  WIREFRAME_ARCHETYPES,
  type CallPlaybook,
  type CallSource,
  type CallStage,
  type CloneCallsJobStatus,
  type WireframeArchetype,
} from "@jarvis/shared";

// ---------------------------------------------------------------------------
// Two-phase LLM analysis that turns >=4 pasted call transcripts into a single
// generic CallPlaybook. Runs as a background job (4+ extraction calls + 1
// unification call ~ 1-3 min). Job state lives in memory AND is written through
// to the settings table so a bff restart mid-job yields a truthful status
// instead of a silent 404.
// ---------------------------------------------------------------------------

const TRANSCRIPT_CAP = 40_000; // chars fed to the model per call (middle-out)
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

const jobs = new Map<string, CloneCallsJobStatus>();

function settingsKey(id: string) {
  return `clone_calls_job_${id}`;
}

async function persist(org: string, status: CloneCallsJobStatus) {
  jobs.set(status.jobId, status);
  try {
    await setSetting(org, settingsKey(status.jobId), { ...status, _at: Date.now() });
  } catch {
    /* settings write is best-effort; in-memory copy is authoritative while alive */
  }
}

export async function getJob(org: string, jobId: string): Promise<CloneCallsJobStatus | null> {
  const live = jobs.get(jobId);
  if (live) return live;
  // Fall back to the settings snapshot (survives restarts). If it wasn't a
  // terminal state when snapshotted, it can only be stale now — report it as
  // interrupted so the client offers a retry rather than polling forever.
  const value = await getSetting<any>(org, settingsKey(jobId));
  if (!value) return null;
  const row = { value };
  const snap = row.value as CloneCallsJobStatus & { _at?: number };
  if (snap.phase !== "done" && snap.phase !== "error") {
    return { ...snap, phase: "error", error: "Analysis was interrupted (server restarted). Please retry." };
  }
  return snap;
}

// Middle-out truncation keeps the open (rapport/discovery) and close (pricing/
// next steps) — the parts that matter most for the flow — when a call is long.
function clampTranscript(t: string): string {
  const s = (t || "").trim();
  if (s.length <= TRANSCRIPT_CAP) return s;
  const half = Math.floor(TRANSCRIPT_CAP / 2);
  return `${s.slice(0, half)}\n\n…[middle of call trimmed]…\n\n${s.slice(-half)}`;
}

// Pull a JSON value out of an LLM reply (tolerates ```json fences / prose).
function extractJson<T = any>(text: string): T | null {
  let t = (text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

async function chatJson<T = any>(p: AiProviderRow, system: string, user: string): Promise<T | null> {
  const first = await completeProviderChat(p, [
    { role: "system", content: system },
    { role: "user", content: user },
  ], { model: cheapModel(p), kind: "playbook" });
  let parsed = first.ok ? extractJson<T>(first.content) : null;
  if (parsed) return parsed;
  // one retry, harder instruction
  const retry = await completeProviderChat(p, [
    { role: "system", content: system + "\n\nReturn ONLY valid JSON — no prose, no markdown fences." },
    { role: "user", content: user },
  ], { model: cheapModel(p), kind: "playbook" });
  parsed = retry.ok ? extractJson<T>(retry.content) : null;
  return parsed;
}

const ARCHETYPE_GUIDE =
  "talk-only (no screen shown / pure conversation), dashboard (home / overview with cards), " +
  "list (a searchable list or pipeline of records), record-detail (one record opened with detail panes), " +
  "form-wizard (a create/setup form or multi-step wizard), chat-assistant (an AI chat/assistant panel), " +
  "progress (a loading/building/processing state), compose (writing a message/email/sequence), " +
  "settings (configuration / preferences).";

const EXTRACT_SYS = (company: string) =>
  `You analyze ONE recorded sales or customer-success call transcript from ${company}. ` +
  `Extract the call's STRUCTURE (not a summary). Identify the sequence of phases the rep moved through, ` +
  `what they did and said, what was on their shared screen at each phase, the qualifying questions they asked, ` +
  `the facts/claims they stated, objections and how they answered, any pricing discussion, and how they closed. ` +
  `Also list SPECIFICS unique to THIS call (customer names, specific job titles/positions, industries, numbers) ` +
  `so a later step can keep the generic flow separate from these examples. ` +
  `For each phase's screenActivity.archetype choose EXACTLY one of: ${ARCHETYPE_GUIDE} ` +
  `Return ONLY JSON of shape: {"phases":[{"name":str,"whatRepDid":str,"repQuotes":[str],` +
  `"screenActivity":{"shown":bool,"archetype":str,"screenTitle":str,"regions":[str]},"customerReaction":str}],` +
  `"qualifyQuestions":[str],"factsClaimed":[str],"objections":[{"objection":str,"response":str}],` +
  `"pricingDiscussion":str,"close":{"buyerContext":str,"closeUsed":str},"specifics":[str]}`;

const UNIFY_SYS =
  `You merge several per-call analyses into ONE reusable CallPlaybook for an AI teammate to run this kind of call. ` +
  `CRITICAL: separate the GENERIC FLOW from call-specific examples. Nothing in any call's "specifics" may leak into ` +
  `the playbook — genericize example lines (say "a {role} position" or "the product", never a real customer/position name). ` +
  `Produce 6-10 stages in the natural order these calls follow. For each stage pick the wireframe archetype (one of: ` +
  `${ARCHETYPE_GUIDE}) that best represents the screen during that stage; use "talk-only" with regions [] when nothing is demoed. ` +
  `Keep a fact only if it appeared in >=2 calls or is clearly stable. Deduplicate objections, keeping the strongest response. ` +
  `Group closes by the buyer type observed. Return ONLY JSON of shape: ` +
  `{"stages":[{"name":str,"goal":str,"wireframe":{"archetype":str,"screenTitle":str,"regions":[str]},` +
  `"voice":{"objective":str,"moves":[str],"exampleLines":[str],"listenFor":[str]},` +
  `"screen":{"actions":[str],"waitBehavior":str},"exitCriteria":str}],` +
  `"facts":[str],"objections":[{"objection":str,"response":str}],"pricing":str,"closes":[{"buyerType":str,"close":str}]}`;

function coerceArchetype(a: any): WireframeArchetype {
  return WIREFRAME_ARCHETYPES.includes(a) ? a : "talk-only";
}

function coerceStage(s: any, i: number): CallStage {
  const wf = s?.wireframe ?? {};
  return {
    id: `stage_${i + 1}`,
    name: String(s?.name ?? `Stage ${i + 1}`).slice(0, 80),
    goal: String(s?.goal ?? "").slice(0, 300),
    wireframe: {
      archetype: coerceArchetype(wf.archetype),
      screenTitle: String(wf.screenTitle ?? "").slice(0, 80),
      regions: Array.isArray(wf.regions) ? wf.regions.map((r: any) => String(r)).slice(0, 5) : [],
    },
    voice: {
      objective: String(s?.voice?.objective ?? "").slice(0, 300),
      moves: Array.isArray(s?.voice?.moves) ? s.voice.moves.map((x: any) => String(x)).slice(0, 8) : [],
      exampleLines: Array.isArray(s?.voice?.exampleLines) ? s.voice.exampleLines.map((x: any) => String(x)).slice(0, 5) : [],
      listenFor: Array.isArray(s?.voice?.listenFor) ? s.voice.listenFor.map((x: any) => String(x)).slice(0, 8) : [],
    },
    screen: {
      actions: Array.isArray(s?.screen?.actions) ? s.screen.actions.map((x: any) => String(x)).slice(0, 8) : [],
      waitBehavior: String(s?.screen?.waitBehavior ?? "").slice(0, 300),
    },
    exitCriteria: s?.exitCriteria ? String(s.exitCriteria).slice(0, 200) : undefined,
  };
}

export function startJob(
  sources: CallSource[],
  ctx: { org: string; role: string; agentName: string; companyName: string },
): string {
  const jobId = randomUUID();
  const ready = sources.filter((s) => (s.transcript ?? "").trim().length > 500);
  const status: CloneCallsJobStatus = {
    jobId,
    phase: "extracting",
    pct: 2,
    perSource: ready.map((s) => ({ id: s.id, title: s.title, state: "queued" })),
  };
  void persist(ctx.org, status);
  void run(jobId, ready, ctx).catch(async (err) => {
    const cur = jobs.get(jobId);
    await persist(ctx.org, {
      ...(cur ?? status),
      phase: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  });
  // Best-effort prune of old snapshots (this org only).
  void query(
    `DELETE FROM settings WHERE org_id = $2 AND key LIKE 'clone_calls_job_%' AND (value->>'_at')::bigint < $1`,
    [Date.now() - JOB_TTL_MS, ctx.org],
  ).catch(() => {});
  return jobId;
}

async function run(
  jobId: string,
  sources: CallSource[],
  ctx: { org: string; role: string; agentName: string; companyName: string },
) {
  const provider = await getActiveProvider(ctx.org);
  const status = jobs.get(jobId)!;
  if (!provider) {
    await persist(ctx.org, { ...status, phase: "error", error: "No AI provider is connected. Configure one in AI Core, then retry." });
    return;
  }

  // Phase 1: per-call extraction (sequential; 0 -> 75%).
  const extractions: any[] = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    status.perSource[i].state = "extracting";
    status.pct = Math.round(2 + (i / sources.length) * 73);
    await persist(ctx.org, status);
    const user =
      `CALL ${i + 1} of ${sources.length}${s.title ? ` — "${s.title}"` : ""}\n\nTRANSCRIPT:\n${clampTranscript(s.transcript ?? "")}`;
    const ext = await chatJson(provider, EXTRACT_SYS(ctx.companyName), user);
    extractions.push(ext ?? { phases: [], specifics: [], _failed: true });
    status.perSource[i].state = ext ? "done" : "error";
    await persist(ctx.org, status);
  }

  if (extractions.every((e) => e?._failed)) {
    await persist(ctx.org, { ...status, phase: "error", error: "The model could not read any transcript. Check the AI provider and try again." });
    return;
  }

  // Phase 2: unification (75 -> 95%).
  status.phase = "unifying";
  status.pct = 80;
  await persist(ctx.org, status);
  const unifyUser =
    `Agent name: ${ctx.agentName}\nRole: ${ctx.role}\nCompany: ${ctx.companyName}\n\n` +
    `PER-CALL ANALYSES (JSON):\n${JSON.stringify(extractions)}`;
  const merged = await chatJson(provider, UNIFY_SYS, unifyUser);
  if (!merged || !Array.isArray(merged.stages) || merged.stages.length === 0) {
    await persist(ctx.org, { ...status, phase: "error", error: "Could not build a unified playbook from these calls. Try re-analyzing." });
    return;
  }

  const playbook: CallPlaybook = {
    sources: sources.map((s) => ({ id: s.id, url: s.url, title: s.title })),
    stages: merged.stages.map((s: any, i: number) => coerceStage(s, i)),
    facts: Array.isArray(merged.facts) ? merged.facts.map((x: any) => String(x)).slice(0, 20) : [],
    objections: Array.isArray(merged.objections)
      ? merged.objections
          .filter((o: any) => o?.objection && o?.response)
          .map((o: any) => ({ objection: String(o.objection), response: String(o.response) }))
          .slice(0, 12)
      : [],
    pricing: merged.pricing ? String(merged.pricing) : undefined,
    closes: Array.isArray(merged.closes)
      ? merged.closes
          .filter((c: any) => c?.buyerType && c?.close)
          .map((c: any) => ({ buyerType: String(c.buyerType), close: String(c.close) }))
      : [],
    generatedAt: new Date().toISOString(),
    approved: false,
  };

  await persist(ctx.org, { ...status, phase: "done", pct: 100, playbook });
}
