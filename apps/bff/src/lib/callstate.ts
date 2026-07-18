// Shared-state blackboard for a live call session — the single source of truth
// both loops read/write, so voice and screen never drift:
//  - the OPERATOR loop writes what it actually did (committed screen, results)
//  - the VOICE loop reads committed state and narrates ONLY that (never claims a
//    page it hasn't landed on), and fills latency while an action is in flight.
// In-memory + ephemeral (a call is transient); keyed by call session id.

export interface TranscriptLine { who: "customer" | "agent"; text: string; at: number }
export interface CallState {
  id: string;
  orgId: string; // owning tenant — calls are isolated per org
  agentId: string;
  goal: string;
  phase: "connecting" | "live" | "ended";
  // What the customer is actually looking at, per the operator loop.
  screen: { url: string; title?: string; summary?: string; committed: boolean };
  // Something the operator loop is doing right now (voice should cover this).
  inFlight?: { action: string; note?: string; startedAt: number };
  transcript: TranscriptLine[];
  shown: string[]; // pages/sections the customer has actually seen
  said: string[]; // key points the agent has actually made
  lastResult?: string; // outcome of the last operator step (for verify/re-plan)
  lastError?: string;
  updatedAt: number;
  startedAt: number;
}

const calls = new Map<string, CallState>();

export function createCall(id: string, orgId: string, agentId: string, goal: string, startUrl = ""): CallState {
  const s: CallState = {
    id, orgId, agentId, goal, phase: "connecting",
    screen: { url: startUrl, committed: !!startUrl },
    transcript: [], shown: [], said: [], updatedAt: Date.now(), startedAt: Date.now(),
  };
  calls.set(id, s);
  return s;
}

// Fetch a call by id. When `orgId` is supplied (route-facing calls always should
// pass req.orgId) the call is only returned if it belongs to that org — so one
// tenant can never read or drive another tenant's live call, even by guessing an
// id. Internal blackboard writers (computer-use loop) may omit it.
export function getCall(id: string, orgId?: string): CallState | undefined {
  const s = calls.get(id);
  if (!s) return undefined;
  if (orgId !== undefined && s.orgId !== orgId) return undefined;
  return s;
}

// The org's active (non-ended) call, if any. Replaces the old single global
// "current call": each org has its own, so two orgs run calls concurrently.
export function currentCallForOrg(orgId: string): CallState | undefined {
  let latest: CallState | undefined;
  for (const s of calls.values()) {
    if (s.orgId === orgId && s.phase !== "ended") {
      if (!latest || s.updatedAt > latest.updatedAt) latest = s;
    }
  }
  return latest;
}

export function updateCall(id: string, patch: Partial<CallState>): CallState | undefined {
  const s = calls.get(id);
  if (!s) return undefined;
  Object.assign(s, patch, { updatedAt: Date.now() });
  return s;
}

export function addTranscript(id: string, who: TranscriptLine["who"], text: string): void {
  const s = calls.get(id);
  if (!s || !text.trim()) return;
  s.transcript.push({ who, text: text.trim(), at: Date.now() });
  if (s.transcript.length > 200) s.transcript.splice(0, s.transcript.length - 200);
  if (who === "agent") { s.said.push(text.trim()); if (s.said.length > 40) s.said.shift(); }
  s.updatedAt = Date.now();
}

// Operator loop: mark the screen it actually committed to (customer now sees it).
export function commitScreen(id: string, url: string, title?: string, summary?: string): void {
  const s = calls.get(id);
  if (!s) return;
  s.screen = { url, title, summary, committed: true };
  if (url && !s.shown.includes(url)) s.shown.push(url);
  s.inFlight = undefined;
  s.updatedAt = Date.now();
}

// Operator loop: something is happening (navigating, clicking) — not yet done.
export function setInFlight(id: string, action: string | null, note?: string): void {
  const s = calls.get(id);
  if (!s) return;
  s.inFlight = action ? { action, note, startedAt: Date.now() } : undefined;
  if (action) s.screen.committed = false;
  s.updatedAt = Date.now();
}

export function setResult(id: string, result?: string, error?: string): void {
  const s = calls.get(id);
  if (!s) return;
  if (result !== undefined) s.lastResult = result;
  if (error !== undefined) s.lastError = error;
  s.updatedAt = Date.now();
}

// Compact grounding block the voice loop injects so it speaks only confirmed
// state (and knows what's mid-action so it can fill the gap naturally).
export function groundingFor(id: string): string {
  const s = calls.get(id);
  if (!s) return "";
  const lines: string[] = [];
  lines.push(`CALL GOAL: ${s.goal}`);
  if (s.screen.committed && s.screen.url) lines.push(`ON SCREEN NOW (confirmed — safe to reference): ${s.screen.title || s.screen.url}${s.screen.summary ? ` — ${s.screen.summary}` : ""}`);
  if (s.inFlight) lines.push(`IN PROGRESS (do NOT claim it's done yet — say you're pulling it up): ${s.inFlight.action}${s.inFlight.note ? ` (${s.inFlight.note})` : ""}`);
  if (s.shown.length) lines.push(`ALREADY SHOWN: ${s.shown.slice(-5).join(", ")}`);
  return lines.join("\n");
}

export function endCall(id: string): void {
  const s = calls.get(id);
  if (s) { s.phase = "ended"; s.updatedAt = Date.now(); }
  // keep briefly for post-call read; reaper clears it
}

// Reap ended/stale calls.
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of calls) {
    if (now - s.updatedAt > 45 * 60 * 1000) calls.delete(id);
  }
}, 5 * 60 * 1000).unref?.();
