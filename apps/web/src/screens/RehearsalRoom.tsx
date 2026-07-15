import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { api, getAccessKey } from "../api/client";
import "../pds.css";

// ============================================================
// Rehearsal room — Perfect Design System 2026 (from the
// rehearsal-room concept mock). You play the guest in text or
// voice while the clone drives the real GoPerfect screen in a
// sandbox. Left: conversation rail with guest/Maya bubbles and
// purple dashed action chips. Right: live stage (stream iframe)
// plus the script beat strip. Fix drawer routes a correction to
// speech (persona) or screen (graph) via /api/rehearsal/fix.
// Wired to /api/live/* (status, join, feed, nudge, shot, end),
// /api/clones/:id/playbook + versions, /api/voice/speak.
// ============================================================

type LiveCallInfo = {
  id: string;
  mode: string;
  phase: string;
  agent_id?: string | null;
  sandbox_id?: string;
  stream_url?: string;
  phases?: string[];
  started_at?: string;
  ended_at?: string | null;
  persona_mode?: string;
};

// SSE reader for a calibration session message (same shape the studio uses).
// Exported + retained as a shared session-greet helper (see Decision 1 notes).
export async function streamSession(sessionId: string, text: string, onDelta: (t: string) => void): Promise<void> {
  const res = await fetch(`${api.base}/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(getAccessKey() ? { "X-API-Key": getAccessKey() } : {}) },
    body: JSON.stringify({ text }),
  });
  if (!res.body) return;
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split(/\n\n/); buf = frames.pop() ?? "";
    for (const f of frames) {
      const line = f.split(/\n/).find((l) => l.startsWith("data:")); if (!line) continue;
      const p = line.slice(5).trim(); if (p === "[DONE]") return;
      try { const d = JSON.parse(p)?.choices?.[0]?.delta?.content; if (d) onDelta(d); } catch { /* ignore */ }
    }
  }
}

const STYLE_META: { key: string; label: string }[] = [
  { key: "warmth", label: "Warmth" }, { key: "assertiveness", label: "Assertiveness" },
  { key: "verbosity", label: "Detail depth" }, { key: "formality", label: "Formality" },
  { key: "humor", label: "Humor" }, { key: "proactivity", label: "Proactivity" },
];
type FeedEvent = { seq: number; kind: string; text: string; shot?: number; beat?: number; turn?: number };
type Agent = {
  id: string;
  name: string;
  role?: string;
  icon?: string;
  buildTrack?: string;
  voice_id?: string;
  golden_persona_id?: string;
  persona?: { voice?: { elevenlabs_voice_id?: string } } & Record<string, unknown>;
};
type Stage = {
  id?: string;
  name?: string;
  voice?: { objective?: string } & Record<string, unknown>;
  screen?: { actions?: string[] } & Record<string, unknown>;
} & Record<string, unknown>;
type Playbook = { stages?: Stage[] } & Record<string, unknown>;
type VersionRow = { id: string; number: number; change_note?: string; created_by?: string; created_at?: string };
type FixProposal = Record<string, unknown> & {
  summary?: string;
  stageName?: string;
  before?: unknown;
  after?: unknown;
  delta?: unknown;
};
type FixTarget = {
  seq: number;
  kind: "speech" | "screen";
  guest: string;
  maya: string;
  action?: string;
  shot?: number;
};
// A rehearsal TURN = a guest line + the clone's reply that follows it: the
// say event(s) are the SPEECH part, the tool/screen(/shot) event(s) the SCREEN
// part, closed by the next `turnend` (its `turn` = authoritative turnSeq) or
// the next guest line. Grouped from the raw `events` feed, not the bubble list.
type RehearsalTurn = {
  key: string;
  turnSeq: number;
  guest: string;
  beatName?: string;
  speech: { seq: number; text: string } | null;
  screen: { seq: number; label: string; text: string; shot?: number } | null;
};

const PHASES = ["SANDBOX", "AUDIO_READY", "STREAM", "CHROME_LAUNCHED", "LOGGED_IN", "BRIDGE_UP", "READY"];
const PHASE_LABELS: Record<string, string> = {
  SANDBOX: "starting the sandbox",
  AUDIO_READY: "audio ready",
  STREAM: "screen stream up",
  CHROME_LAUNCHED: "chrome launched",
  LOGGED_IN: "logged in to GoPerfect",
  BRIDGE_UP: "voice bridge up",
  READY: "ready",
};
const TOOL_LABELS: Record<string, string> = {
  new_position: "created position",
  ask_perfect: "sent brief to Perfect AI",
  answer_question: "answered question card",
  show_screen: "navigated",
  read_screen: "read the screen",
  start_matching: "started matching",
  skip_candidate: "skipped candidate",
  start_autopilot: "started autopilot",
};
const SCENARIOS = ["Show me the matches", "Pricing pushback", "How is this different from LinkedIn"];

const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };
const pillStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 11px", borderRadius: 9999, fontSize: 11, fontWeight: 700 };
const versionPill: CSSProperties = { ...pillStyle, background: "var(--purple-soft)", color: "var(--purple-ink)" };
const ghostBtn: CSSProperties = { height: 38, padding: "0 16px", borderRadius: 9999, fontSize: 12.5, fontWeight: 700, background: "transparent", border: "1.5px solid var(--border)", color: "var(--ink1)", ...btnFont };
const fixLink: CSSProperties = { background: "none", border: "1px solid var(--border)", color: "var(--ink2)", borderRadius: 9999, fontSize: 10, fontWeight: 700, padding: "2px 9px", ...btnFont };
const whoStyle: CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 3 };
const dlabel: CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--ink3)" };

function phaseIs(p: string | undefined, want: string): boolean {
  return (p ?? "").toUpperCase() === want;
}
function prettyTool(text: string): string {
  const m = text.trim().match(/^([A-Za-z_]+)\s*([\s\S]*)$/);
  if (!m) return text;
  const label = TOOL_LABELS[m[1]] ?? m[1].replace(/_/g, " ");
  let detail = m[2].trim();
  if (detail.startsWith("{")) {
    try {
      const obj = JSON.parse(detail) as Record<string, unknown>;
      detail = Object.values(obj).filter((v): v is string => typeof v === "string").join(", ");
    } catch { detail = ""; /* args still streaming / incomplete — show the clean label, never a raw "{" */ }
  }
  if (detail.length > 90) detail = detail.slice(0, 90) + "…";
  return detail ? `${label} · ${detail}` : label;
}
// Beat names from the video-grounded blueprint often arrive with their own
// leading number ("1. Opening and discovery"); the UI adds its own index, so
// strip any leading number/punctuation before rendering to avoid "1. 1. …".
function cleanBeat(name: string | undefined | null): string {
  return (name ?? "Beat").replace(/^\s*\d+[.)\-:—\s]+/, "").trim() || "Beat";
}
function listify(v: unknown): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.map(String).join(" → ");
  if (typeof v === "object") {
    // screen-route proposals return { actions, waitBehavior }
    const o = v as { actions?: unknown; waitBehavior?: unknown };
    const acts = Array.isArray(o.actions) ? o.actions.map(String).join(" → ") : "";
    const wait = o.waitBehavior ? String(o.waitBehavior) : "";
    return [acts, wait ? `while it works: ${wait}` : ""].filter(Boolean).join(" · ");
  }
  return String(v);
}

type Item =
  | { t: "guest"; seq: number; text: string; pending?: boolean }
  | { t: "say"; seq: number; text: string }
  | { t: "tool"; seq: number; raw: string; label: string; shot?: number }
  | { t: "dim"; seq: number; text: string }
  | { t: "screen"; seq: number; text: string }
  | { t: "err"; seq: number; text: string };

export default function RehearsalRoom() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [call, setCall] = useState<LiveCallInfo | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  // Demo account the sandbox logs in with (stored server-side for ALL sessions)
  const [demoEmail, setDemoEmail] = useState("");
  const [demoHasPw, setDemoHasPw] = useState(false);
  const [demoEdit, setDemoEdit] = useState(false);
  const [demoFormEmail, setDemoFormEmail] = useState("");
  const [demoFormPw, setDemoFormPw] = useState("");
  const [demoSaving, setDemoSaving] = useState(false);
  const [demoErr, setDemoErr] = useState("");
  useEffect(() => {
    void api.get<{ email: string; hasPassword: boolean }>("/api/demo-login")
      .then((r) => { setDemoEmail(r.email); setDemoHasPw(r.hasPassword); setDemoFormEmail(r.email); })
      .catch(() => { /* leave empty */ });
  }, []);
  async function saveDemoLogin() {
    if (demoSaving) return;
    setDemoSaving(true); setDemoErr("");
    try {
      const r = await api.put<{ email: string; hasPassword: boolean }>("/api/demo-login", { email: demoFormEmail.trim(), ...(demoFormPw ? { password: demoFormPw } : {}) });
      setDemoEmail(r.email); setDemoHasPw(r.hasPassword); setDemoEdit(false); setDemoFormPw("");
    } catch (e) { setDemoErr(e instanceof Error ? e.message : String(e)); }
    setDemoSaving(false);
  }
  // ---- gears: rehearsal (voice + screen) and live call ----
  const [live, setLive] = useState(false);
  const liveInit = useRef(false);
  const prewarmed = useRef(false);
  // tuning drawer (the studio, absorbed: style · lexicon · rules · knowledge · versions)
  const [tuneOpen, setTuneOpen] = useState(false);
  const [tuneTab, setTuneTab] = useState<"style" | "lexicon" | "rules" | "knowledge" | "versions">("style");
  const [styleDraft, setStyleDraft] = useState<Record<string, number> | null>(null);
  const [tuneSaving, setTuneSaving] = useState(false);
  const tuneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [goldenId, setGoldenId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);

  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [inputMode, setInputMode] = useState<"guest" | "direct" | "coach">("guest");
  const [coachNote, setCoachNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const micOnRef = useRef(true);
  const boundRef = useRef(false);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { micOnRef.current = micOn; }, [micOn]);
  const [hear, setHear] = useState(true);
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [graphVersion, setGraphVersion] = useState(1);
  const [personaVersion, setPersonaVersion] = useState<number | null>(null);
  const [pinning, setPinning] = useState(false);
  const [pinned, setPinned] = useState(false);
  // fix drawer
  const [fix, setFix] = useState<FixTarget | null>(null);
  const [route, setRoute] = useState<"speech" | "screen">("screen");
  const [note, setNote] = useState("");
  const [proposal, setProposal] = useState<FixProposal | null>(null);
  const [proposing, setProposing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [fixErr, setFixErr] = useState<string | null>(null);
  const [fixedSeqs, setFixedSeqs] = useState<Record<number, boolean>>({});
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  // ---- rehearsal turn-review: per-turn approve/coach grades (backend intact) ----
  // keyed `${turnSeq}|${part}` → the verdict written to /api/rehearsal/grade
  const [grades, setGrades] = useState<Record<string, { verdict: "approve" | "coach"; coachRef?: string }>>({});
  const [turnCoachOpen, setTurnCoachOpen] = useState<string | null>(null);
  const [turnCoachText, setTurnCoachText] = useState("");
  const stepmodeSessionRef = useRef<string | null>(null);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const spokenRef = useRef<number | null>(null);
  const hearRef = useRef(true);
  const audioQ = useRef<HTMLAudioElement[]>([]);
  // ---- real call audio streamed from the sandbox (acoustic parity with Zoom) ----
  const liveAudioRef = useRef(false);
  const [liveAudioOn, setLiveAudioOn] = useState(false);
  const streamCtxRef = useRef<AudioContext | null>(null);
  const streamNextT = useRef(0);
  const streamOffset = useRef(-1);
  const streamSrcs = useRef<AudioBufferSourceNode[]>([]);
  const streamVoicedAt = useRef(0);
  const streamSpeaking = useRef(false);
  const [rehearseGolden, setRehearseGolden] = useState(false);
  const recogRef = useRef<{ stop: () => void } | null>(null);
  const shotCache = useRef<Record<number, string>>({});
  const agentRef = useRef<Agent | null>(null);

  const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
  const agent = agents.find((a) => a.id === agentId) ?? null;
  agentRef.current = agent;
  useEffect(() => { hearRef.current = hear; }, [hear]);

  const ended = !!call?.ended_at;
  // The room is the cockpit for BOTH rehearsals and real Zoom calls. On a real
  // call the operator directs (no guest input, no open mic) — the guest is real.
  const isZoom = !!call && !ended && call.mode !== "rehearsal";
  const bound = !!call && !ended && phaseIs(call.phase, "READY");
  const rehearsalStarting = (!!call && !ended && !phaseIs(call.phase, "READY")) || joining;

  // ---- agents ----
  useEffect(() => {
    void (async () => {
      const list = await api.get<Agent[]>("/api/agents").catch(() => [] as Agent[]);
      setAgents(list);
      const stored = (() => { try { return localStorage.getItem("pds_agent"); } catch { return null; } })();
      const clones = list.filter((a) => a.buildTrack === "clone");
      const pick = list.find((a) => a.id === stored)?.id ?? clones[0]?.id ?? list[0]?.id ?? "";
      setAgentId(pick);
    })();
  }, []);
  useEffect(() => {
    if (!agentId) return;
    try { localStorage.setItem("pds_agent", agentId); } catch { /* ignore */ }
    void api.get<{ playbook: Playbook }>(`/api/clones/${agentId}/playbook`).then((r) => {
      setPlaybook(r.playbook);
      const gv = (r.playbook as Record<string, unknown>).graphVersion;
      setGraphVersion(typeof gv === "number" ? gv : 1);
    }).catch(() => { setPlaybook(null); setGraphVersion(1); });
    void loadVersions(agentId);
  }, [agentId]);
  async function loadVersions(id: string) {
    try {
      const r = await api.get<{ versions: VersionRow[]; goldenVersionId: string | null }>(`/api/clones/${id}/versions`);
      setVersions(r.versions);
      setGoldenId(r.goldenVersionId ?? null);
      setPersonaVersion(r.versions.length ? Math.max(...r.versions.map((v) => v.number)) : null);
    } catch { setVersions([]); setGoldenId(null); setPersonaVersion(null); }
  }
  // the pinned golden version's NUMBER — for the "golden runs vN" gap indicator
  const goldenNumber = useMemo(() => versions.find((v) => v.id === goldenId)?.number ?? null, [versions, goldenId]);

  // ---- session status ----
  async function refreshStatus() {
    const r = await api.get<{ call: LiveCallInfo | null }>("/api/live/status").catch(() => null);
    if (r) setCall(r.call);
    setStatusLoaded(true);
    return r?.call ?? null;
  }
  useEffect(() => { void refreshStatus(); }, []);

  // First load: if a session is already running — rehearsal OR real Zoom call —
  // drop straight into the live gear. Otherwise stay cold — text first.
  useEffect(() => {
    if (!statusLoaded || liveInit.current) return;
    liveInit.current = true;
    if (call && !call.ended_at) {
      setLive(true);
      // the room follows the running call's clone, not the last-viewed one
      if (call.agent_id) setAgentId(call.agent_id);
    }
  }, [statusLoaded, call]);

  // Real-call discipline: never speak as the guest (they're real), direct by
  // default, no double audio (you hear him in Zoom already).
  const zoomInit = useRef(false);
  useEffect(() => {
    if (!isZoom || zoomInit.current) return;
    zoomInit.current = true;
    setMicOn(false); stopRecog();
    setInputMode("direct");
    setHear(false);
  }, [isZoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-warm: the sandbox starts booting the moment you land, so "Go live" is
  // ready by the time the first text passes are done. Fire-and-forget.
  useEffect(() => {
    if (!statusLoaded || !agentId || prewarmed.current) return;
    if (call && !call.ended_at) { prewarmed.current = true; return; } // something already running
    prewarmed.current = true;
    void api.post("/api/live/join", { mode: "rehearsal", agentId }).then(() => refreshStatus()).catch(() => { /* Go live can retry */ });
  }, [statusLoaded, agentId, call]);

  // ---- beat jump: any script block is a chapter marker you can drop into ----
  const [beatMenu, setBeatMenu] = useState<{ i: number; x: number; y: number } | null>(null);
  const [jumpNote, setJumpNote] = useState("");
  async function jumpLive(i: number) {
    const s = stages[i];
    if (!s) return;
    const acts = (s.screen?.actions ?? []).join(" → ");
    try {
      await api.post("/api/live/nudge", { kind: "direct", text: `JUMP to beat ${i + 1} of ${stages.length} — "${s.name ?? "beat"}". Treat every earlier beat as already covered. Do NOT recap, do NOT greet, do NOT announce the jump. Silently continue the call from this beat: ${acts ? `first take its screen actions (${acts}), then ` : ""}say its opening line to the guest and proceed from there.` });
      setJumpNote(`Directed ${firstName} to beat ${i + 1} — ${cleanBeat(s.name)}`);
    } catch {
      setJumpNote("Jump failed — is the session still live?");
    }
    setTimeout(() => setJumpNote(""), 4500);
  }

  // ---- tuning drawer: any spec edit becomes a persona version ----
  const spec = (agent?.persona ?? null) as (Record<string, unknown> & {
    style?: Record<string, number>;
    lexicon?: { signature_phrases?: { text: string; source?: string }[]; banned_phrases?: string[]; vocabulary_notes?: string };
    behaviors?: { rules?: { id: string; text: string; source?: string; active?: boolean }[] };
    knowledge_boundaries?: string[];
    few_shots?: { id: string; situation: string; human_response: string; source?: string; active?: boolean }[];
  }) | null;
  const agentStyle = spec?.style ?? null;
  useEffect(() => { setStyleDraft(agentStyle ? { ...agentStyle } : null); }, [agentId, tuneOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  async function commitSpec(next: Record<string, unknown>, note: string): Promise<number | null> {
    setTuneSaving(true);
    let num: number | null = null;
    try {
      const r = await api.post<{ version: { number?: number } }>(`/api/clones/${agentId}/versions`, { spec: next, changeNote: note });
      if (typeof r.version.number === "number") { setPersonaVersion(r.version.number); num = r.version.number; }
      setAgents((list) => list.map((a) => (a.id === agentId ? { ...a, persona: next as Agent["persona"] } : a)));
      void loadVersions(agentId);
    } catch (e) {
      setResumeNote(`Saving failed: ${e instanceof Error ? e.message : String(e)} — nothing was applied.`);
      setTimeout(() => setResumeNote(""), 8000);
    }
    setTuneSaving(false);
    return num;
  }
  function tuneSlider(key: string, v: number) {
    if (!spec || !styleDraft) return;
    const next = { ...styleDraft, [key]: v / 100 };
    setStyleDraft(next);
    if (tuneTimer.current) clearTimeout(tuneTimer.current);
    tuneTimer.current = setTimeout(() => { void commitSpec({ ...spec, style: next }, `Calibration room: set ${key} to ${Math.round(v)}`); }, 800);
  }
  function toggleRule(i: number) {
    if (!spec?.behaviors?.rules) return;
    const rules = spec.behaviors.rules.map((r, j) => (j === i ? { ...r, active: !(r.active ?? true) } : r));
    void commitSpec({ ...spec, behaviors: { ...spec.behaviors, rules } }, `${spec.behaviors.rules[i].active ?? true ? "Disabled" : "Enabled"} rule ${spec.behaviors.rules[i].id}`);
  }
  async function pinVersion(versionId: string) {
    if (pinningId) return;
    setPinningId(versionId);
    try {
      await api.post(`/api/clones/${agentId}/golden`, { versionId });
      setGoldenId(versionId);
      setPinned(true);
    } catch { /* leave as-is */ }
    setPinningId(null);
  }
  // Edit a reply in place: the corrected text is taught as a few-shot — "in this
  // situation, THIS is the line" — and applies from the next reply on.
  const [editTarget, setEditTarget] = useState<{ source: "live"; seq?: number; guest: string } | null>(null);
  const [editText, setEditText] = useState("");
  const [teaching, setTeaching] = useState(false);
  // live-gear bubbles: view-only removal (the call already heard them); the
  // feed re-polls every 4s, so hiding is by seq, not by array surgery.
  // Seqs restart per call — reset the hides when the call changes.
  const [hiddenSeqs, setHiddenSeqs] = useState<Record<number, boolean>>({});
  const hiddenCallRef = useRef<string | null>(null);
  useEffect(() => {
    const id = call?.id ?? null;
    if (id !== hiddenCallRef.current) { hiddenCallRef.current = id; setHiddenSeqs({}); }
  }, [call?.id]);
  function openEditLive(seq: number, text: string) {
    setEditTarget({ source: "live", seq, guest: nearestBefore(seq, "guest") }); setEditText(text);
  }
  async function teachReply() {
    if (!editTarget || !spec || teaching || !editText.trim()) return;
    setTeaching(true);
    const shots = spec.few_shots ?? [];
    const next = { ...spec, few_shots: [...shots, { id: `f${shots.length + 1}`, situation: editTarget.guest || "(opening the conversation)", human_response: editText.trim(), source: "reply edited in calibration", active: true }] };
    const vNum = await commitSpec(next, `Edited reply: "${editText.trim().slice(0, 50)}"`);
    if (vNum === null) { setTeaching(false); return; } // commitSpec already showed the error
    if (typeof editTarget.seq === "number") {
      setFixedSeqs((s) => ({ ...s, [editTarget.seq as number]: true }));
      buildResume(editTarget.seq); // next session resumes just before this moment
      if (bound) {
        void api.post("/api/live/nudge", { kind: "guide", text: `CORRECTION — applies RIGHT NOW in this call: when the guest says something like "${(editTarget.guest || "").slice(0, 120)}", reply in the spirit of: "${editText.trim().slice(0, 220)}". Use this from here on.` }).catch(() => { /* next session still gets it */ });
      }
    }
    setResumeNote(`Taught — persona v${vNum} · told him mid-call too · applies from his next reply.`);
    setTimeout(() => setResumeNote(""), 9000);
    setTeaching(false); setEditTarget(null); setEditText("");
  }

  // ---- add step: operator inserts a prescriptive step into the beat sheet ----
  const [stepOpen, setStepOpen] = useState(false);
  const [stepMode, setStepMode] = useState<"say" | "show">("say");
  const [stepBeat, setStepBeat] = useState(1);
  const [stepText, setStepText] = useState("");
  const [stepGuest, setStepGuest] = useState(""); // guest line directly above the anchor (few-shot teach)
  const [stepBusy, setStepBusy] = useState(false);
  const [stepNote, setStepNote] = useState("");
  const SHOW_CHIPS = ["Show the ranked matches", "Go to the outreach tab", "Back to the positions board"];
  function openStep(anchorGuest: string) {
    setStepMode("say");
    setStepText("");
    setStepGuest(anchorGuest);
    setStepBeat(Math.min(Math.max(currentBeat ?? 1, 1), Math.max(stages.length, 1)));
    setStepOpen(true);
  }
  async function addStep() {
    const text = stepText.trim();
    if (!text || stepBusy || !agentId) return;
    setStepBusy(true);
    try {
      const r = await api.get<{ playbook: Playbook }>(`/api/clones/${agentId}/playbook`);
      const pb = r.playbook ?? {};
      const stagesNow = Array.isArray(pb.stages) ? pb.stages : [];
      if (!stagesNow.length) throw new Error("no beat sheet yet — build beats in the storyboard first");
      const beat = Math.min(Math.max(stepBeat, 1), stagesNow.length);
      const gvNow = typeof (pb as Record<string, unknown>).graphVersion === "number" ? (pb as Record<string, unknown>).graphVersion as number : 1;
      const next = {
        ...pb,
        graphVersion: gvNow + 1,
        stages: stagesNow.map((s, i) => {
          if (i !== beat - 1) return s;
          if (stepMode === "say") {
            const lines = Array.isArray(s.voice?.exampleLines) ? s.voice.exampleLines as string[] : [];
            return { ...s, voice: { ...(s.voice ?? {}), exampleLines: [...lines, text] } };
          }
          const acts = Array.isArray(s.screen?.actions) ? s.screen.actions : [];
          return { ...s, screen: { ...(s.screen ?? {}), actions: [...acts, text] } };
        }),
      } as Playbook;
      const put = await api.put<{ ok: boolean; playbook: Playbook; goldenRecompiled?: boolean }>(`/api/clones/${agentId}/playbook`, { playbook: next });
      const saved = put.playbook ?? next;
      setPlaybook(saved);
      const gvSaved = (saved as Record<string, unknown>).graphVersion;
      const gvFinal = typeof gvSaved === "number" ? gvSaved : gvNow + 1;
      setGraphVersion(gvFinal);
      // Anchored under a guest line: a Say step is ALSO the ideal reply to that
      // moment — teach it as a few-shot via the same path as "Edit reply".
      if (stepMode === "say" && stepGuest.trim() && spec) {
        const shots = spec.few_shots ?? [];
        await commitSpec(
          { ...spec, few_shots: [...shots, { id: `f${shots.length + 1}`, situation: stepGuest.trim(), human_response: text, source: "step added in calibration", active: true }] },
          `Step added: "${text.slice(0, 50)}"`,
        );
      }
      // Session live: he takes the new step RIGHT NOW, not just next session.
      let told = false;
      if (bound && live) {
        const beatName = (stagesNow[beat - 1]?.name ?? "").trim();
        try {
          await api.post("/api/live/nudge", { kind: "direct", text: `NEW STEP just added to beat ${beat}${beatName ? ` (${beatName})` : ""}: ${stepMode === "say" ? "say this line now" : "do this on screen now"}: '${text}'. Execute it now, then continue the call.` });
          told = true;
        } catch { /* graph is saved — next session picks it up */ }
      }
      setStepNote(`Step added to beat ${beat} — graph v${gvFinal}${told ? " · told him mid-call too" : ""}`);
      setTimeout(() => setStepNote(""), 9000);
      setStepOpen(false); setStepText(""); setStepGuest("");
    } catch (e) {
      setStepNote(`Add step failed: ${e instanceof Error ? e.message : String(e)} — nothing was applied.`);
      setTimeout(() => setStepNote(""), 8000);
    }
    setStepBusy(false);
  }

  // erase a step from a beat — the mirror of addStep, same PUT + hot-reload rails
  const [stepRmArm, setStepRmArm] = useState<string | null>(null);
  async function removeStep(beatIdx: number, kind: "say" | "show", index: number) {
    const key = `${beatIdx}:${kind}:${index}`;
    if (stepRmArm !== key) { setStepRmArm(key); setTimeout(() => setStepRmArm((a) => (a === key ? null : a)), 3500); return; }
    setStepRmArm(null);
    if (stepBusy || !agentId) return;
    setStepBusy(true);
    try {
      const r = await api.get<{ playbook: Playbook }>(`/api/clones/${agentId}/playbook`);
      const pb = r.playbook ?? {};
      const stagesNow = Array.isArray(pb.stages) ? pb.stages : [];
      const gvNow = typeof (pb as Record<string, unknown>).graphVersion === "number" ? (pb as Record<string, unknown>).graphVersion as number : 1;
      const next = {
        ...pb,
        graphVersion: gvNow + 1,
        stages: stagesNow.map((s, i) => {
          if (i !== beatIdx) return s;
          if (kind === "say") {
            const lines = Array.isArray(s.voice?.exampleLines) ? (s.voice.exampleLines as string[]) : [];
            return { ...s, voice: { ...(s.voice ?? {}), exampleLines: lines.filter((_, j) => j !== index) } };
          }
          const acts = Array.isArray(s.screen?.actions) ? s.screen.actions : [];
          return { ...s, screen: { ...(s.screen ?? {}), actions: acts.filter((_, j) => j !== index) } };
        }),
      } as Playbook;
      const put = await api.put<{ ok: boolean; playbook: Playbook }>(`/api/clones/${agentId}/playbook`, { playbook: next });
      const saved = put.playbook ?? next;
      setPlaybook(saved);
      const gvSaved = (saved as Record<string, unknown>).graphVersion;
      const gvFinal = typeof gvSaved === "number" ? gvSaved : gvNow + 1;
      setGraphVersion(gvFinal);
      setStepNote(`Step erased from beat ${beatIdx + 1} — graph v${gvFinal} · it won't happen again`);
      setTimeout(() => setStepNote(""), 8000);
    } catch (e) {
      setStepNote(`Erase failed: ${e instanceof Error ? e.message : String(e)} — nothing was changed.`);
      setTimeout(() => setStepNote(""), 8000);
    }
    setStepBusy(false);
  }


  // ---- reshape the whole beat sheet from one instruction (diff-previewed) ----
  const [reshapeOpen, setReshapeOpen] = useState(false);
  const [reshapeText, setReshapeText] = useState("");
  const [reshapeBusy, setReshapeBusy] = useState(false);
  const [reshapeErr, setReshapeErr] = useState("");
  const [reshapeProp, setReshapeProp] = useState<Playbook | null>(null);
  function reshapeDiff(cur: Stage[], prop: Stage[]): { name: string; label: string }[] {
    const key = (st: Stage, i: number) => String((st as { id?: string }).id ?? `i${i}`);
    const curBy = new Map(cur.map((st, i) => [key(st, i), { st, i }]));
    const propIds = new Set(prop.map((st, i) => key(st, i)));
    const rows = prop.map((st, i) => {
      const k = key(st, i);
      const old = curBy.get(k);
      let label = "added";
      if (old) label = JSON.stringify(old.st) === JSON.stringify(st) ? (old.i === i ? "unchanged" : "moved") : "changed";
      return { name: String(st.name ?? `Beat ${i + 1}`), label };
    });
    for (const [k, v] of curBy) if (!propIds.has(k)) rows.push({ name: String(v.st.name ?? "beat"), label: "removed" });
    return rows;
  }
  async function proposeReshape() {
    const t = reshapeText.trim();
    if (!t || reshapeBusy || !agentId) return;
    setReshapeBusy(true); setReshapeErr(""); setReshapeProp(null);
    try {
      const res = await fetch(`${api.base}/api/clones/${agentId}/playbook/reshape`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getAccessKey() ? { "X-API-Key": getAccessKey() } : {}) },
        body: JSON.stringify({ instruction: t }),
      });
      const j = (await res.json().catch(() => ({}))) as { playbook?: Playbook; error?: string };
      if (!res.ok || !j.playbook) throw new Error(j.error || `reshape → ${res.status}`);
      setReshapeProp(j.playbook);
    } catch (e) { setReshapeErr(e instanceof Error ? e.message : String(e)); }
    setReshapeBusy(false);
  }
  async function applyReshape() {
    if (!reshapeProp || reshapeBusy || !agentId) return;
    setReshapeBusy(true); setReshapeErr("");
    try {
      const cur = await api.get<{ playbook: Playbook }>(`/api/clones/${agentId}/playbook`);
      const gv = (Number((cur.playbook as Record<string, unknown>)?.graphVersion) || 1) + 1;
      const next = { ...cur.playbook, ...reshapeProp, graphVersion: gv } as Playbook;
      const r = await api.put<{ ok: boolean; playbook: Playbook }>(`/api/clones/${agentId}/playbook`, { playbook: next });
      setPlaybook(r.playbook ?? next);
      const gvs = ((r.playbook ?? next) as Record<string, unknown>).graphVersion;
      setGraphVersion(typeof gvs === "number" ? gvs : gv);
      setReshapeOpen(false); setReshapeProp(null); setReshapeText("");
    } catch (e) { setReshapeErr(e instanceof Error ? e.message : String(e)); }
    setReshapeBusy(false);
  }

  // go live: reveal the hot gear; start the sandbox if pre-warm didn't
  async function goLive() {
    setLive(true);
    const active = call && !call.ended_at && call.mode === "rehearsal";
    if (!active) await join();
  }
  useEffect(() => {
    if (!rehearsalStarting) return;
    const t = setInterval(() => { void refreshStatus(); }, 3000);
    return () => clearInterval(t);
  }, [rehearsalStarting]);

  async function join() {
    if (!agentId || joining) return;
    setJoinErr(null); setJoining(true);
    try {
      await api.post("/api/live/join", { mode: "rehearsal", agentId, personaMode: rehearseGolden ? "golden" : "draft" });
      await refreshStatus();
    } catch (e) {
      setJoinErr(e instanceof Error ? e.message : String(e));
    }
    setJoining(false);
  }
  async function endRehearsal() {
    if (ending) return;
    const wasZoom = isZoom;
    setEnding(true);
    stopVoice();
    try { await api.post("/api/live/end"); } catch { /* ignore */ }
    setEvents([]); setPending([]); spokenRef.current = null; setFix(null);
    await refreshStatus();
    setEnding(false);
    // a real call flows straight into its debrief (auto-built on /end)
    if (wasZoom) nav("debrief");
  }
  // the room reflects the DB pin state, not just pins made in this session
  useEffect(() => {
    setPinned(Boolean(agents.find((a) => a.id === agentId)?.golden_persona_id));
  }, [agentId, agents]);
  const [unpinArm, setUnpinArm] = useState(false);
  const [goldenMenu, setGoldenMenu] = useState(false);
  async function unpinGolden() {
    if (!agentId || pinning) return;
    if (!unpinArm) { setUnpinArm(true); setTimeout(() => setUnpinArm(false), 3500); return; }
    setUnpinArm(false); setPinning(true);
    try {
      await api.post(`/api/clones/${agentId}/golden`, { unpin: true });
      setPinned(false);
      setGoldenId(null);
      void loadVersions(agentId); // keep the header chip's golden gap current
      setResumeNote("Unpinned — real calls use the live draft persona until you pin again.");
    } catch {
      setResumeNote("Unpin failed — try again.");
    }
    setTimeout(() => setResumeNote(""), 8000);
    setPinning(false);
    setGoldenMenu(false);
  }
  async function pinGolden() {
    if (!agentId || pinning) return;
    setPinning(true);
    try {
      await api.post(`/api/clones/${agentId}/golden`, {});
      setPinned(true);
      void loadVersions(agentId); // keep the header chip's golden gap current
      // golden pins the version — certification PROVES it: gates next, workspace after
      if (bound && live) {
        setResumeNote("Pinned as golden ✓ — run certification when you finish the session.");
        setTimeout(() => setResumeNote(""), 9000);
      } else {
        setResumeNote("Pinned as golden ✓ — opening certification to complete him…");
        setTimeout(() => nav("certification"), 1400);
      }
    } catch (e) {
      setResumeNote(`Pin failed: ${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setResumeNote(""), 8000);
    }
    setPinning(false);
  }

  // ---- transcript polling ----
  const greetedCallRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bound) return;
    let stop = false;
    const poll = async () => {
      const r = await api.get<{ events: FeedEvent[] }>("/api/live/feed?after=0").catch(() => null);
      if (!r || stop) return;
      const evs = [...r.events].sort((a, b) => a.seq - b.seq);
      setEvents(evs);
      setPending((p) => p.filter((tx) => !evs.some((e) => e.kind === "guest" && e.text.trim() === tx.trim())));
      const maxSeq = evs.length ? evs[evs.length - 1].seq : 0;
      if (spokenRef.current === null) {
        spokenRef.current = maxSeq; // don't speak the backlog on first load
        // The rep opens the room — rehearsals boot silent (nogreet, pre-warm),
        // so when the operator binds to a FRESH rehearsal (no conversation yet,
        // no resume replay pending), tell him to speak first. Zoom calls greet
        // at admit already; a resumed session replays the guest line instead.
        const callId = call?.id ?? "";
        const virgin = !evs.some((e) => e.kind === "say" || e.kind === "guest");
        if (virgin && !isZoom && callId && greetedCallRef.current !== callId && !resumeRef.current) {
          greetedCallRef.current = callId;
          void api.post("/api/live/nudge", { kind: "direct", text: "The rehearsal guest just joined and is listening. Open the call NOW: greet warmly in ONE short sentence in your identity, then ask ONE question about what they're hiring for. Keep it brief." }).catch(() => { /* they can still speak first */ });
        }
      } else {
        const fresh = evs.filter((e) => e.kind === "say" && e.seq > (spokenRef.current as number));
        spokenRef.current = Math.max(spokenRef.current, maxSeq);
        if (hearRef.current && !liveAudioRef.current) for (const e of fresh) void playText(e.text);
        else if (liveAudioRef.current) for (const e of fresh) ttsSpokenRef.current = (ttsSpokenRef.current + " " + e.text).slice(-800); // echo filter still knows his lines
      }
    };
    void poll();
    const t = setInterval(() => { void poll(); }, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [bound]);

  // ---- hear him: queued TTS per say event, with true barge-in ----
  // SpeechRecognition captures WITHOUT echo cancellation, so it must be fully
  // DEAF while his TTS plays (word-overlap filtering leaked — his lines came
  // back as guest turns). Barge-in survives via a separate ear: an energy
  // detector on an echo-cancelled getUserMedia stream (that one DOES null the
  // tab audio). Human speech detected → cut his audio → recognizer wakes up.
  const ttsSpokenRef = useRef("");
  const ttsStopAtRef = useRef(0);
  const vadStreamRef = useRef<MediaStream | null>(null);
  const vadCtxRef = useRef<AudioContext | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const vadCleanupRef = useRef<(() => void) | null>(null);
  function stopVadGuard() {
    if (vadRafRef.current !== null) cancelAnimationFrame(vadRafRef.current);
    vadRafRef.current = null;
    vadCleanupRef.current?.();
    vadCleanupRef.current = null;
  }
  async function startVadGuard() {
    if (!micOnRef.current || vadRafRef.current !== null) return;
    try {
      if (!vadStreamRef.current) {
        vadStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      }
      const ctx = vadCtxRef.current ?? new AudioContext();
      vadCtxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume();
      const src = ctx.createMediaStreamSource(vadStreamRef.current);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      vadCleanupRef.current = () => { try { src.disconnect(); } catch { /* gone */ } };
      const buf = new Uint8Array(an.fftSize);
      let hot = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
        const rms = Math.sqrt(sum / buf.length);
        hot = rms > 0.055 ? hot + 1 : 0;
        if (hot >= 4) { // ~sustained real speech, not a pop
          stopVoice(); // he shuts up instantly
          stopVadGuard();
          if (micOnRef.current && boundRef.current) startRecog(); // now listen for real
          return;
        }
        vadRafRef.current = requestAnimationFrame(tick);
      };
      vadRafRef.current = requestAnimationFrame(tick);
    } catch { /* no mic permission — TTS plays walkie-talkie style */ }
  }
  function isTtsEcho(t: string): boolean {
    // discard transcripts that are just his own lines leaking into the mic
    if (!audioQ.current.length && Date.now() - ttsStopAtRef.current > 2000) return false;
    const spoken = ttsSpokenRef.current.toLowerCase();
    if (!spoken) return false;
    const words = t.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 2);
    if (!words.length) return true;
    const hits = words.filter((w) => spoken.includes(w)).length;
    return hits / words.length > 0.7;
  }
  async function playText(text: string) {
    if (!text.trim()) return;
    try {
      const a = agentRef.current;
      const voiceId = a?.voice_id || a?.persona?.voice?.elevenlabs_voice_id || undefined; // voice_id is authoritative
      const key = getAccessKey();
      const res = await fetch(`${api.base}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { "X-API-Key": key } : {}) },
        body: JSON.stringify({ text, voiceId }),
      });
      if (!res.ok) throw new Error("tts");
      const url = URL.createObjectURL(await res.blob());
      const el = new Audio(url);
      audioQ.current.push(el);
      // a single bad clip must never jam the queue (that reads as "he stopped
      // speaking"): ended, error and blocked-play all advance to the next clip
      const pump = () => {
        const head = audioQ.current[0];
        if (!head) { stopVadGuard(); if (micOnRef.current && boundRef.current) startRecog(); return; } // his voice finished — reopen the mic
        head.play().catch(() => { audioQ.current = audioQ.current.slice(1); pump(); });
      };
      const finish = () => {
        if (!audioQ.current.includes(el)) return;
        audioQ.current = audioQ.current.filter((x) => x !== el);
        URL.revokeObjectURL(url);
        pump();
      };
      el.onended = finish;
      el.onerror = finish;
      ttsSpokenRef.current = (ttsSpokenRef.current + " " + text).slice(-800);
      if (audioQ.current.length === 1) {
        stopRecog(); // the recognizer must never hear him
        void startVadGuard(); // ...but the echo-cancelled ear watches for YOU
        pump();
      }
    } catch { /* voice is best-effort in the rehearsal room */ }
  }
  function streamFlush() {
    // operator interrupted: drop everything scheduled and rejoin at the live edge
    streamSrcs.current.forEach((x) => { try { x.stop(); } catch { /* done */ } });
    streamSrcs.current = [];
    streamOffset.current = -1;
    const ctx = streamCtxRef.current;
    if (ctx) streamNextT.current = ctx.currentTime;
  }
  function stopVoice() {
    audioQ.current.forEach((a) => a.pause());
    audioQ.current = [];
    ttsStopAtRef.current = Date.now();
    streamFlush();
    stopVadGuard();
  }

  // ---- coach: altitude instruction routed to persistent layers via /api/coach ----
  async function sendCoach(text: string) {
    const clean = text.trim();
    if (!clean || coachBusy || !agentId) return;
    setInput(""); setCoachBusy(true); setCoachNote(null);
    try {
      const lastGuest = [...items].reverse().find((it) => it.t === "guest");
      const lastSay = [...items].reverse().find((it) => it.t === "say");
      const moment = lastGuest || lastSay ? { guest: (lastGuest as { text?: string } | undefined)?.text ?? "", maya: (lastSay as { text?: string } | undefined)?.text ?? "" } : undefined;
      const res = await fetch(`${api.base}/api/coach`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getAccessKey() ? { "X-API-Key": getAccessKey() } : {}) },
        body: JSON.stringify({ agentId, text: clean, ...(moment ? { moment } : {}) }),
      });
      const j = (await res.json().catch(() => ({}))) as { appliedAs?: string[]; summary?: string; personaVersion?: number; graphVersion?: number; toldLive?: boolean; error?: string };
      if (!res.ok || !j.appliedAs) throw new Error(j.error || `coach → ${res.status}`);
      const bits = [`Coached: ${j.summary}`, `applied as ${j.appliedAs.join(" + ")}`];
      if (j.personaVersion) bits.push(`persona v${j.personaVersion}`);
      if (j.graphVersion) { bits.push(`graph v${j.graphVersion}`); setGraphVersion(j.graphVersion); }
      if (j.toldLive) bits.push("told him mid-call");
      setCoachNote({ ok: true, text: bits.join(" · ") });
      if (j.personaVersion) { setPersonaVersion(j.personaVersion); void loadVersions(agentId); }
      void api.get<{ playbook: Playbook }>(`/api/clones/${agentId}/playbook`).then((r) => setPlaybook(r.playbook)).catch(() => { /* keep */ });
    } catch (e) {
      setCoachNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
    setCoachBusy(false);
    setTimeout(() => setCoachNote(null), 12000);
  }

  // ---- speak as guest ----
  async function sendGuest(text: string) {
    const clean = text.trim();
    if (!clean || !bound) return;
    setInput("");
    setPending((p) => [...p, clean]);
    try { await api.post("/api/live/nudge", { kind: "guest", text: clean }); } catch { /* shows on next poll if it landed */ }
  }
  // ---- open mic: listening is the default in a live session; mute is the
  // exception. The browser stops recognition after silence, so it auto-restarts
  // while the mic is on, and pauses while her TTS voice plays (no self-echo).
  type SpeechRec = {
    lang: string; continuous: boolean; interimResults: boolean;
    onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null;
    onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null;
    start: () => void; stop: () => void; abort?: () => void;
  };
  function stopRecog() {
    const r = recogRef.current as SpeechRec | null;
    recogRef.current = null;
    try { if (r) { r.onend = null; (r.abort ?? r.stop).call(r); } } catch { /* already stopped */ }
    setListening(false);
  }
  function startRecog() {
    if (recogRef.current) return;
    const w = window as unknown as Record<string, unknown>;
    const SR = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRec) | undefined;
    if (!SR) { setJoinErr("Speech recognition is not supported in this browser."); setMicOn(false); return; }
    const r = new SR();
    recogRef.current = r as unknown as { stop: () => void };
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = false;
    (r as unknown as { onspeechstart: (() => void) | null }).onspeechstart = () => {
      // BARGE-IN: you started talking — he shuts up instantly
      if (audioQ.current.length) stopVoice();
    };
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          const t = e.results[i][0].transcript;
          if (t?.trim() && !isTtsEcho(t)) { if (audioQ.current.length) stopVoice(); void sendGuest(t); }
        }
      }
    };
    r.onerror = (e) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") { setMicOn(false); setJoinErr("Mic permission denied — allow it and click the mic to retry."); }
    };
    r.onend = () => {
      recogRef.current = null;
      setListening(false);
      if (restartTimer.current) clearTimeout(restartTimer.current);
      restartTimer.current = setTimeout(() => { if (micOnRef.current && boundRef.current && audioQ.current.length === 0) startRecog(); }, 350); // never wake while his TTS plays
    };
    try { r.start(); setListening(true); } catch { recogRef.current = null; }
  }
  function toggleMic() {
    if (micOn) { setMicOn(false); stopRecog(); }
    else { setMicOn(true); if (boundRef.current) startRecog(); }
  }
  // drop a beat from the flow — recompiles the live prompt so it never happens again
  const [dropArm, setDropArm] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);
  const [dropNote, setDropNote] = useState("");
  async function dropBeat(i: number) {
    if (!playbook || dropping) return;
    if (dropArm !== i) { setDropArm(i); setTimeout(() => setDropArm((a) => (a === i ? null : a)), 3000); return; }
    setDropArm(null); setDropping(true);
    try {
      const next = { ...playbook, stages: (playbook.stages ?? []).filter((_, j) => j !== i) };
      const r = await api.put<{ ok: boolean; playbook: Playbook; goldenRecompiled?: boolean }>(`/api/clones/${agentId}/playbook`, { playbook: next });
      setPlaybook(r.playbook ?? next);
      const gv = ((r.playbook ?? next) as Record<string, unknown>).graphVersion;
      setGraphVersion(typeof gv === "number" ? gv : graphVersion + 1);
      setDropNote(r.goldenRecompiled ? "Beat dropped — live prompt updated, it will not happen again." : "Beat dropped from the flow.");
      setTimeout(() => setDropNote(""), 5000);
    } catch (e) { setDropNote(`Drop failed: ${e instanceof Error ? e.message : String(e)}`); setTimeout(() => setDropNote(""), 6000); }
    setDropping(false);
  }

  // ---- rehearsal resume: after a fix, the next session continues from the
  // guest line right before the fixed moment instead of restarting the call ----
  type ResumeBundle = { agentId: string; history: string; lastGuest: string; fromCallId: string };
  const resumeRef = useRef<ResumeBundle | null>(null);
  const resumedCallRef = useRef<string | null>(null);
  const [resumeNote, setResumeNote] = useState("");
  useEffect(() => {
    try { const raw = localStorage.getItem("rr_resume"); if (raw) resumeRef.current = JSON.parse(raw); } catch { /* none */ }
  }, []);
  function buildResume(anchorSeq: number) {
    if (!call || !bound) return;
    const flat = items.filter((it) => it.t === "guest" || it.t === "say" || it.t === "tool");
    // the guest line right before (or at) the fixed moment — that's where we replay from
    let gi = -1;
    for (let i = flat.length - 1; i >= 0; i--) {
      const it = flat[i];
      if (it.t === "guest" && !("pending" in it && it.pending) && (anchorSeq < 0 || it.seq <= anchorSeq)) { gi = i; break; }
    }
    if (gi < 0) return;
    const lastGuest = (flat[gi] as { text: string }).text;
    const history = flat.slice(Math.max(0, gi - 14), gi)
      .map((it) => it.t === "guest" ? `GUEST: ${(it as { text: string }).text.slice(0, 160)}` : it.t === "say" ? `YOU: ${(it as { text: string }).text.slice(0, 160)}` : `[screen: ${(it as { label: string }).label.slice(0, 80)}]`)
      .join("\n").slice(-2600);
    const bundle: ResumeBundle = { agentId, history, lastGuest, fromCallId: call.id };
    resumeRef.current = bundle;
    try { localStorage.setItem("rr_resume", JSON.stringify(bundle)); } catch { /* fine */ }
  }
  // when a fresh session binds and we hold a resume point for this clone, skip
  // the cold open: brief him on the call so far, then replay the guest's line
  useEffect(() => {
    const b = resumeRef.current;
    if (isZoom) return; // never inject rehearsal guest lines into a real call
    if (!bound || !live || !b || b.agentId !== agentId || !call) return;
    if (call.id === b.fromCallId || resumedCallRef.current === call.id) return;
    resumedCallRef.current = call.id;
    resumeRef.current = null;
    try { localStorage.removeItem("rr_resume"); } catch { /* fine */ }
    void (async () => {
      try {
        await api.post("/api/live/nudge", { kind: "guide", text: `RESUME CONTEXT — this rehearsal continues the previous run, which was paused for a correction. The call so far (oldest to newest):\n${b.history}\n\nYou are MID-CALL: do NOT greet, do NOT restart, do NOT re-introduce yourself. The screen may have reset — quietly re-establish what you need with your tools when relevant. The guest will now repeat their last line; continue from exactly that point, applying your updated instructions.` });
        await api.post("/api/live/nudge", { kind: "guest", text: b.lastGuest });
        setPending((p) => [...p, b.lastGuest]);
        setResumeNote("Resumed from your last fix — replaying the guest's line.");
        setTimeout(() => setResumeNote(""), 8000);
      } catch { /* she just starts fresh */ }
    })();
  }, [bound, live, agentId, call]); // eslint-disable-line react-hooks/exhaustive-deps

  // take control: the operator drives the sandbox screen while the clone holds
  // still; handing back opens the fix drawer so the demonstration becomes a
  // permanent graph change.
  const [controlling, setControlling] = useState(false);
  const demoFixRef = useRef<FixTarget | null>(null);
  // from the fix drawer: keep THIS moment, close the drawer, take the screen —
  // hand-back reopens the same fix with the recorded steps in the note
  async function takeControlForFix() {
    demoFixRef.current = fix;
    setFix(null);
    await takeControl();
  }
  async function takeControl() {
    if (!bound || controlling) return;
    setControlling(true);
    stopRecog(); // don't feed him guest turns while the human drives
    try {
      await api.post("/api/live/nudge", { kind: "guide", text: "The DIRECTOR is taking over the screen RIGHT NOW to demonstrate something. FREEZE: no screen actions, no clicks, no typing, no navigation, and stay completely silent until the director tells you they are done. Watch what happens on screen — that is how it should be done." });
    } catch { /* banner still shows; worst case he keeps talking */ }
    // record the real click path so the demonstration becomes graph actions verbatim
    try { await api.post("/api/live/control/start", {}); } catch { /* fix drawer falls back to prose */ }
  }
  async function handBack() {
    if (!controlling) return;
    setControlling(false);
    if (micOnRef.current && boundRef.current) startRecog(); // reopen the mic
    try {
      await api.post("/api/live/nudge", { kind: "guide", text: "The director is done demonstrating on screen. Resume normally: wait for the guest, and from now on do it the way the director just showed." });
    } catch { /* ignore */ }
    // pull the recorded click path — the demonstration becomes the fix, verbatim
    let steps: string[] = [];
    try {
      const r = await api.post<{ ok: boolean; steps?: string[] }>("/api/live/control/stop", {});
      steps = r.steps ?? [];
    } catch { /* recorder unavailable — fall back to prose */ }
    const base = demoFixRef.current;
    demoFixRef.current = null;
    teachAnchorRef.current = base?.seq ?? -1;
    if (steps.length && stages.length) {
      // deterministic path: your exact clicks become the beat's screen steps — one click, no LLM
      setTeachSteps(steps.join("\n"));
      setTeachBeat(Math.min(Math.max(currentBeat ?? 1, 1), stages.length));
      return;
    }
    // no recorded steps (or no graph yet): fall back to the describe-it drawer
    setFix(base ?? { seq: -1, kind: "screen", guest: "(director demonstration)", maya: "", action: "director took the screen" });
    setRoute("screen");
    setNote("I took the screen and showed him: ");
    setProposal(null); setFixErr(null);
  }
  // one-click teach: recorded steps replace the chosen beat's screen actions
  const teachAnchorRef = useRef<number>(-1);
  const [teachSteps, setTeachSteps] = useState<string | null>(null);
  const [teachBeat, setTeachBeat] = useState(1);
  const [teachBusy, setTeachBusy] = useState(false);
  async function teachDemo() {
    if (teachSteps === null || !playbook || teachBusy) return;
    const stepList = teachSteps.split("\n").map((s) => s.trim()).filter(Boolean)
      // generalize hardcoded position ids so the lesson works on any position
      .map((s) => s.replace(/\/positions\/[a-f0-9]{12,}\//g, "/positions/<the current position>/"));
    if (!stepList.length) { setTeachSteps(null); return; }
    setTeachBusy(true);
    try {
      const next = {
        ...playbook,
        graphVersion: graphVersion + 1,
        stages: (playbook.stages ?? []).map((s, i) => (i === teachBeat - 1 ? { ...s, screen: { ...(s.screen ?? {}), actions: stepList } } : s)),
      } as Playbook;
      const r = await api.put<{ ok: boolean; playbook: Playbook; goldenRecompiled?: boolean }>(`/api/clones/${agentId}/playbook`, { playbook: next });
      setPlaybook(r.playbook ?? next);
      const gv = ((r.playbook ?? next) as Record<string, unknown>).graphVersion;
      setGraphVersion(typeof gv === "number" ? gv : graphVersion + 1);
      buildResume(teachAnchorRef.current);
      setResumeNote(`Taught — beat ${teachBeat} now runs your exact ${stepList.length} steps (graph v${typeof gv === "number" ? gv : graphVersion + 1}) · next session resumes here.`);
      setTimeout(() => setResumeNote(""), 9000);
      setTeachSteps(null);
    } catch (e) {
      setResumeNote(`Teach failed: ${e instanceof Error ? e.message : String(e)} — nothing was applied.`);
      setTimeout(() => setResumeNote(""), 8000);
    }
    setTeachBusy(false);
  }
  useEffect(() => { if (!bound) setControlling(false); }, [bound]);

  // silent director instruction — she acts on it immediately, the guest never hears it
  async function sendDirect(text: string) {
    const clean = text.trim();
    if (!clean || !bound) return;
    setInput("");
    try {
      await api.post("/api/live/nudge", { kind: "direct", text: clean });
      setJoinErr(null);
    } catch (e) {
      setJoinErr(`Direction failed: ${e instanceof Error ? e.message : String(e)} — sessions started before this feature shipped can't take directions; end and go live again.`);
    }
  }
  // mic follows the session: opens when the room goes live, closes when it ends
  useEffect(() => {
    boundRef.current = bound && live;
    if (bound && live && micOnRef.current) startRecog();
    if (!(bound && live)) stopRecog();
    return () => { if (restartTimer.current) clearTimeout(restartTimer.current); };
  }, [bound, live]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- stream engine: poll /api/live/audio, schedule PCM via Web Audio ----
  // What you hear in the room is the sandbox's ACTUAL output (EL hybrid voice,
  // real pacing). While streamed audio is voiced the recognizer pauses and the
  // echo-cancelled VAD guard listens for YOU — same discipline as TTS playback.
  useEffect(() => {
    if (!(bound && live) || isZoom) { liveAudioRef.current = false; setLiveAudioOn(false); return; }
    let stopped = false;
    const ctx = new AudioContext({ sampleRate: 24000 });
    streamCtxRef.current = ctx;
    streamNextT.current = 0;
    streamOffset.current = -1;
    const loop = async () => {
      while (!stopped) {
        try {
          const r = await api.get<{ live: boolean; offset: number; chunk: string; rate?: number }>(`/api/live/audio?after=${streamOffset.current}`);
          if (stopped) break;
          if (!r.live) {
            if (liveAudioRef.current) { liveAudioRef.current = false; setLiveAudioOn(false); }
            await new Promise((res) => setTimeout(res, 2000));
            continue;
          }
          if (!liveAudioRef.current) { liveAudioRef.current = true; setLiveAudioOn(true); }
          streamOffset.current = r.offset;
          if (r.chunk && hearRef.current) {
            const bin = atob(r.chunk);
            const n = bin.length & ~1;
            if (n > 1) {
              const f32 = new Float32Array(n / 2);
              let voiced = false;
              for (let i = 0; i < n / 2; i++) {
                let v = (bin.charCodeAt(2 * i + 1) << 8) | bin.charCodeAt(2 * i);
                if (v >= 0x8000) v -= 0x10000;
                f32[i] = v / 32768;
                if (v > 600 || v < -600) voiced = true;
              }
              if (voiced) streamVoicedAt.current = Date.now();
              const buf = ctx.createBuffer(1, f32.length, 24000);
              buf.getChannelData(0).set(f32);
              const src = ctx.createBufferSource();
              src.buffer = buf;
              src.connect(ctx.destination);
              const t = Math.max(ctx.currentTime + 0.12, streamNextT.current);
              src.start(t);
              streamNextT.current = t + buf.duration;
              streamSrcs.current.push(src);
              src.onended = () => { streamSrcs.current = streamSrcs.current.filter((x) => x !== src); };
            }
          }
          // mic discipline: pause recog while he speaks, VAD guard listens for you
          const now = Date.now();
          const voicedRecently = now - streamVoicedAt.current < 900;
          if (voicedRecently && !streamSpeaking.current) {
            streamSpeaking.current = true;
            stopRecog();
            void startVadGuard();
          } else if (!voicedRecently && streamSpeaking.current && now - streamVoicedAt.current > 1200) {
            streamSpeaking.current = false;
            stopVadGuard();
            if (micOnRef.current && boundRef.current) startRecog();
          }
        } catch { /* next poll */ }
        await new Promise((res) => setTimeout(res, 500));
      }
    };
    void loop();
    return () => {
      stopped = true;
      liveAudioRef.current = false;
      setLiveAudioOn(false);
      streamSpeaking.current = false;
      streamFlush();
      streamCtxRef.current = null;
      void ctx.close().catch(() => { /* closed */ });
    };
  }, [bound, live, isZoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- feed -> render items (attach shots to the preceding tool chip) ----
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const e of events) {
      if (e.kind === "shot") {
        for (let i = out.length - 1; i >= 0; i--) {
          const it = out[i];
          if (it.t === "tool") { it.shot = e.shot ?? it.shot; break; }
        }
        continue;
      }
      if (e.kind === "guest") { out.push({ t: "guest", seq: e.seq, text: e.text }); continue; }
      if (e.kind === "say") { out.push({ t: "say", seq: e.seq, text: e.text }); continue; }
      if (e.kind === "tool") { out.push({ t: "tool", seq: e.seq, raw: e.text, label: prettyTool(e.text) }); continue; }
      if (e.kind === "screen") { out.push({ t: "screen", seq: e.seq, text: e.text }); continue; }
      if (e.kind === "error") { out.push({ t: "err", seq: e.seq, text: e.text }); continue; }
      if (e.kind === "nudge") {
        // director/coach cues are control instructions TO the clone (e.g.
        // "direct The rehearsal guest just joined…", "[DIRECTOR — beat jump]"),
        // not conversation — never leak them into the visible transcript.
        if (/^(direct|guide|coach)\b/i.test(e.text) || /^\[(director|coach|beat)/i.test(e.text)) continue;
        // the guest nudge comes back as its own guest event; skip the duplicate
        if (events.some((g) => g.kind === "guest" && g.text.trim() === e.text.trim())) continue;
        out.push({ t: "dim", seq: e.seq, text: e.text });
        continue;
      }
      if (e.kind === "toolresult") { out.push({ t: "dim", seq: e.seq, text: e.text }); continue; }
    }
    for (const p of pending) out.push({ t: "guest", seq: Number.MAX_SAFE_INTEGER, text: p, pending: true });
    return out;
  }, [events, pending]);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  const lastTool = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) { const it = items[i]; if (it.t === "tool") return it.label; }
    return null;
  }, [items]);

  // ---- fix drawer ----
  function nearestBefore(seq: number, kind: string): string {
    let best = "";
    for (const e of events) { if (e.seq < seq && e.kind === kind) best = e.text; }
    return best;
  }
  function openFixSpeech(seq: number, mayaText: string) {
    const toolRaw = nearestBefore(seq, "tool");
    setFix({ seq, kind: "speech", guest: nearestBefore(seq, "guest"), maya: mayaText, action: toolRaw ? prettyTool(toolRaw) : undefined });
    setRoute("speech"); setNote(""); setProposal(null); setFixErr(null);
  }
  function openFixAction(it: Extract<Item, { t: "tool" }>) {
    setFix({ seq: it.seq, kind: "screen", guest: nearestBefore(it.seq, "guest"), maya: nearestBefore(it.seq, "say"), action: it.label, shot: it.shot });
    setRoute("screen"); setNote(""); setProposal(null); setFixErr(null);
  }
  function closeFix() { setFix(null); setFixErr(null); }

  // fetch the drawer screenshot as a blob (the endpoint needs X-API-Key)
  useEffect(() => {
    const shot = fix?.shot;
    setShotUrl(null);
    if (shot === undefined) return;
    if (shotCache.current[shot]) { setShotUrl(shotCache.current[shot]); return; }
    let gone = false;
    void (async () => {
      try {
        const key = getAccessKey();
        const res = await fetch(`${api.base}/api/live/shot/${shot}`, { headers: key ? { "X-API-Key": key } : {} });
        if (!res.ok) return;
        const url = URL.createObjectURL(await res.blob());
        shotCache.current[shot] = url;
        if (!gone) setShotUrl(url);
      } catch { /* no screenshot then */ }
    })();
    return () => { gone = true; };
  }, [fix?.shot]);

  const momentPayload = fix ? { guest: fix.guest, maya: fix.maya, action: fix.action, shot: fix.shot } : null;

  async function applyFix(pOverride?: FixProposal) {
    const prop = pOverride ?? proposal;
    if (!fix || !prop || applying) return;
    setApplying(true); setFixErr(null);
    try {
      const r = await api.post<Record<string, unknown>>("/api/rehearsal/fix", { agentId, route, note: note.trim(), moment: momentPayload, apply: true, proposal: prop });
      if (route === "speech") {
        const v = r.personaVersion ?? (r.version as Record<string, unknown> | undefined)?.number;
        setPersonaVersion(typeof v === "number" ? v : (personaVersion ?? 0) + 1);
        void loadVersions(agentId);
      } else {
        const v = r.graphVersion;
        setGraphVersion(typeof v === "number" ? v : graphVersion + 1);
      }
      setFixedSeqs((s) => ({ ...s, [fix.seq]: true }));
      if (fix.seq < 900000) buildResume(fix.seq); // next session resumes just before this moment
      // make it land NOW too: brief the live call so this run behaves corrected
      const vNum = route === "speech" ? (r.personaVersion ?? "") : (r.graphVersion ?? "");
      if (bound) {
        const acts = route === "screen" ? listify((prop as FixProposal).after) : "";
        void api.post("/api/live/nudge", { kind: "guide", text: `CORRECTION — this applies RIGHT NOW in this call, not just future ones: ${(prop as FixProposal).summary ?? note}. ${acts ? `The exact steps for that part are now: ${acts}. ` : ""}Do it this way from here on.` }).catch(() => { /* next session still gets it */ });
      }
      setResumeNote(`Fix applied — ${route === "speech" ? `persona v${vNum}` : `graph v${vNum}`} · told him mid-call too · next session resumes right before this moment.`);
      setTimeout(() => setResumeNote(""), 9000);
      setFix(null);
    } catch (e) { setFixErr(e instanceof Error ? e.message : String(e)); }
    setApplying(false);
  }
  // one click: propose + apply in a single motion (the two-step was abandoned
  // in practice and corrections silently never landed)
  async function fixNow() {
    if (!fix || !note.trim() || proposing || applying) return;
    setProposing(true); setFixErr(null);
    try {
      const r = await api.post<Record<string, unknown>>("/api/rehearsal/fix", { agentId, route, note: note.trim(), moment: momentPayload });
      const p = (r.proposal ?? r) as FixProposal;
      setProposal(p);
      setProposing(false);
      await applyFix(p);
    } catch (e) {
      setProposing(false);
      setFixErr(e instanceof Error ? e.message : String(e));
    }
  }

  // ---- derived bits ----
  const stages = playbook?.stages ?? [];
  // where she is on the flow: the bridge emits BEAT n when she moves stages
  const noteBeat = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind === "beat" && typeof e.beat === "number" && e.beat > 0) return e.beat;
    }
    return null;
  }, [events]);
  // coverage: which beats the conversation has covered, in ANY order (LLM judge)
  const [coverage, setCoverage] = useState<{ n: number; state: string }[]>([]);
  useEffect(() => {
    // Never carry a prior call's coverage into a new one — a fresh call opens
    // with zero beats covered until THIS session's transcript earns them.
    setCoverage([]);
    if (!bound || !live) return;
    let stop = false;
    const poll = async () => {
      try {
        const r = await api.get<{ beats: { n: number; state: string }[] }>("/api/live/coverage");
        if (!stop && r.beats?.length) setCoverage(r.beats);
      } catch { /* keep last */ }
    };
    void poll();
    const t = setInterval(() => void poll(), 20000);
    return () => { stop = true; clearInterval(t); };
  }, [bound, live, call?.id]);
  const currentBeat = useMemo(() => {
    const now = coverage.find((b) => b.state === "now");
    return now?.n ?? noteBeat;
  }, [coverage, noteBeat]);
  const beatState = (i: number): "covered" | "now" | "pending" => {
    const c = coverage.find((b) => b.n === i + 1);
    if (c && (c.state === "covered" || c.state === "now")) return c.state as "covered" | "now";
    if (currentBeat === i + 1) return "now";
    if (currentBeat !== null && i + 1 < currentBeat) return "covered";
    return "pending";
  };
  const streamUrl = call?.stream_url ?? "";
  const streamHost = useMemo(() => { try { return streamUrl ? new URL(streamUrl).host : ""; } catch { return ""; } }, [streamUrl]);
  const phaseIdx = PHASES.findIndex((p) => phaseIs(call?.phase, p));
  const donePhases = (call?.phases ?? []).map((p) => (typeof p === "string" ? p : (p as { phase?: string }).phase ?? "").toUpperCase());
  const themeIcon = theme === "dark" ? "light_mode" : "dark_mode";
  const firstName = agent?.name?.split(" ")[0] ?? "the clone";

  const chipDisabled = !bound;

  // ---- rehearsal turns: group the raw feed into guest→reply turns ----
  // Walk `events` in order. A guest line opens a turn; say → speech part,
  // tool/screen(/shot) → screen part; a `turnend` (its `turn`) or the next
  // guest closes it. The last turn is the CURRENT one (expanded for review);
  // earlier turns collapse. This is derived state only — no feed mutation.
  const rehearsalTurns = useMemo<RehearsalTurn[]>(() => {
    const turns: RehearsalTurn[] = [];
    let cur: RehearsalTurn | null = null;
    let curBeat: number | undefined;
    const flush = () => {
      if (!cur) return;
      if (curBeat !== undefined && stages[curBeat - 1]) cur.beatName = cleanBeat(stages[curBeat - 1].name);
      turns.push(cur);
      cur = null;
      curBeat = undefined;
    };
    for (const e of events) {
      if (e.kind === "guest") {
        flush();
        cur = { key: `turn-${e.seq}`, turnSeq: -1, guest: e.text, speech: null, screen: null };
        continue;
      }
      if (!cur) cur = { key: `turn-open-${e.seq}`, turnSeq: -1, guest: "", speech: null, screen: null };
      if (typeof e.beat === "number" && e.beat > 0) curBeat = e.beat;
      if (e.kind === "say") {
        cur.speech = cur.speech ? { seq: cur.speech.seq, text: `${cur.speech.text} ${e.text}`.trim() } : { seq: e.seq, text: e.text };
        continue;
      }
      if (e.kind === "tool") {
        const label = prettyTool(e.text);
        cur.screen = cur.screen
          ? { seq: cur.screen.seq, label: cur.screen.label ? `${cur.screen.label} → ${label}` : label, text: cur.screen.text || label, shot: e.shot ?? cur.screen.shot }
          : { seq: e.seq, label, text: label, shot: e.shot };
        continue;
      }
      if (e.kind === "screen") {
        cur.screen = cur.screen ? { ...cur.screen, text: e.text } : { seq: e.seq, label: "", text: e.text };
        continue;
      }
      if (e.kind === "shot") {
        if (cur.screen) cur.screen = { ...cur.screen, shot: e.shot ?? cur.screen.shot };
        continue;
      }
      if (e.kind === "turnend") {
        if (typeof e.turn === "number") cur.turnSeq = e.turn;
        flush();
        continue;
      }
      // nudge / toolresult / error do not form turn parts
    }
    flush();
    return turns.map((t, i) => ({ ...t, turnSeq: t.turnSeq >= 0 ? t.turnSeq : i + 1 }));
  }, [events, stages]);
  const rehTotal = Math.max(stages.length, rehearsalTurns.length, 1);
  const rehCurrentIdx = rehearsalTurns.length - 1;
  const rehProg = `Reply ${Math.min(Math.max(rehearsalTurns.length, 1), rehTotal)} of ${rehTotal}`;

  // read the grades back for this call — on mount + after each write
  async function refreshGrades(callId: string) {
    try {
      const r = await api.get<{ grades: { turnSeq: number; part: "speech" | "screen"; verdict: "approve" | "coach"; coachRef?: string }[] }>(`/api/rehearsal/grades?callId=${encodeURIComponent(callId)}`);
      const map: Record<string, { verdict: "approve" | "coach"; coachRef?: string }> = {};
      for (const g of r.grades ?? []) map[`${g.turnSeq}|${g.part}`] = { verdict: g.verdict, coachRef: g.coachRef };
      setGrades(map);
    } catch { /* keep local optimistic state */ }
  }
  async function gradePart(turnSeq: number, part: "speech" | "screen", verdict: "approve" | "coach", coachRef?: string) {
    const callId = call?.id;
    if (!callId || !agentId) return;
    setGrades((g) => ({ ...g, [`${turnSeq}|${part}`]: { verdict, coachRef } })); // optimistic
    try {
      await api.post("/api/rehearsal/grade", { callId, agentId, turnSeq, part, verdict, ...(coachRef ? { coachRef } : {}) });
      void refreshGrades(callId);
    } catch { /* optimistic state stays until next refresh */ }
  }
  function toggleTurnCoach(key: string) {
    setTurnCoachText("");
    setTurnCoachOpen((k) => (k === key ? null : key));
  }
  // Coach submit routes the note through the EXISTING coach flow (sendCoach —
  // it sticks to persona rules / beats / directives and lands mid-call) and
  // records a coach verdict against the turn part.
  function submitTurnCoach(turnSeq: number, part: "speech" | "screen") {
    const text = turnCoachText.trim();
    if (!text) return;
    void sendCoach(text);
    void gradePart(turnSeq, part, "coach", `coach:${part}:${turnSeq}`);
    setTurnCoachOpen(null);
    setTurnCoachText("");
  }
  // Screen coach by demonstration reuses the existing take-control flow (same
  // path as the transcript "Show him" button) and records a coach verdict.
  function coachTurnScreenByDemo(t: RehearsalTurn) {
    if (!t.screen) return;
    demoFixRef.current = { seq: t.screen.seq, kind: "screen", guest: t.guest, maya: t.speech?.text ?? "", action: t.screen.label, shot: t.screen.shot };
    void gradePart(t.turnSeq, "screen", "coach", `coach:screen:${t.turnSeq}:demo`);
    void takeControl();
  }
  async function approveTurnBoth(t: RehearsalTurn) {
    if (t.speech) await gradePart(t.turnSeq, "speech", "approve");
    if (t.screen) await gradePart(t.turnSeq, "screen", "approve");
  }
  // Approve & continue: settle any ungraded parts, then release the turn gate.
  async function advanceTurn(t: RehearsalTurn) {
    if (t.speech && !grades[`${t.turnSeq}|speech`]) await gradePart(t.turnSeq, "speech", "approve");
    if (t.screen && !grades[`${t.turnSeq}|screen`]) await gradePart(t.turnSeq, "screen", "approve");
    try { await api.post("/api/live/nudge", { kind: "advance" }); } catch { /* next guest line still moves it on */ }
  }
  // load grades when the rehearsal call binds / changes; clear outside rehearsal
  useEffect(() => {
    const callId = call?.id;
    if (!callId || !live || isZoom) { setGrades({}); return; }
    void refreshGrades(callId);
  }, [call?.id, live, isZoom]); // eslint-disable-line react-hooks/exhaustive-deps
  // turn gating: put the bridge in step-and-wait mode once the rehearsal review
  // is active (once per session); best-effort "off" on leaving/teardown.
  useEffect(() => {
    if (!(bound && live) || isZoom) return;
    const callId = call?.id ?? null;
    if (!callId) return;
    if (stepmodeSessionRef.current !== callId) {
      stepmodeSessionRef.current = callId;
      void api.post("/api/live/nudge", { kind: "stepmode", text: "on" }).catch(() => { /* review still renders */ });
    }
    return () => { void api.post("/api/live/nudge", { kind: "stepmode", text: "off" }).catch(() => { /* teardown best-effort */ }); };
  }, [bound, live, isZoom, call?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pmx" data-theme={theme} style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--ink1)", overflow: "hidden", position: "relative" }}>
      <style>{`
        @keyframes rrPulse { 0%,100%{opacity:1; transform:scale(1)} 50%{opacity:.45; transform:scale(.8)} }
        @keyframes rrBlink { 0%,100%{opacity:.25} 50%{opacity:1} }
        @media (prefers-reduced-motion: reduce){ .rr-dot{animation:none} .rr-typing span{animation:none} }
      `}</style>

      {/* ---------- top bar ---------- */}
      <header style={{ height: 62, flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "0 18px", background: "var(--nav-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--border)" }}>
        <button onClick={() => nav("agentshome")} title="Back to the roster" style={{ width: 36, height: 36, borderRadius: 10, border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "grid", placeItems: "center", ...btnFont }}>
          <span className="material-symbols-rounded" style={{ fontSize: 19 }}>arrow_back</span>
        </button>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: "radial-gradient(circle at 30% 30%, rgba(255,6,96,.45), rgba(163,66,255,.4))", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, color: "#fff" }}>
          {(agent?.name?.[0] ?? "?").toUpperCase()}
        </div>
        <div>
          <h1 style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: "-.02em", margin: 0 }}>{agent?.name ?? "Calibration room"}</h1>
          <div style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 600 }}>
            {agent ? `${agent.role ? `${agent.role} · ` : ""}rehearse with voice + the real screen, then run the call` : "pick a clone to calibrate"}
          </div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "stretch", borderRadius: 9999, overflow: "hidden" }}>
          <button
            onClick={() => { if (personaVersion !== null) { setTuneOpen(true); setTuneTab("versions"); } }}
            title="How he talks — every fix and slider move makes a new version; click for the history"
            style={{ ...versionPill, borderRadius: 0, border: "none", ...(personaVersion === null ? { color: "var(--ink3)", background: "var(--ghost)", cursor: "default" } : { ...btnFont }) , fontFamily: "inherit" }}
          >
            {personaVersion !== null ? `style v${personaVersion}` : "no style yet"}
          </button>
          <button
            onClick={() => nav("screenmap")}
            title="What he does on the call — the beat sheet; click to edit the storyboard"
            style={{ ...versionPill, borderRadius: 0, border: "none", borderLeft: "1px solid var(--border)", fontFamily: "inherit", ...btnFont }}
          >
            {`script v${graphVersion}`}
          </button>
          {pinned && goldenNumber !== null && personaVersion !== null && goldenNumber < personaVersion && (
            <span
              title={`Real calls still run v${goldenNumber} — promote again to ship your latest fixes`}
              style={{ ...pillStyle, borderRadius: 0, borderLeft: "1px solid var(--border)", background: "rgba(255,199,0,.14)", color: "var(--gold)" }}
            >
              · live runs v{goldenNumber}
            </span>
          )}
        </span>
        <span style={{ position: "relative" }}>
          <button onClick={() => { setGoldenMenu((m) => !m); setUnpinArm(false); }} disabled={!agentId} title="Golden — pin, unpin, certification" style={{ ...ghostBtn, display: "inline-flex", alignItems: "center", gap: 6, ...(pinned ? { borderColor: "var(--gold)", color: "var(--gold)" } : { color: "var(--ink2)" }) }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, ...(pinned ? { fontVariationSettings: "'FILL' 1" } : {}) }}>{pinned ? "star" : "star_outline"}</span>
            {pinning ? "Working…" : pinned ? "Live version" : "Not live"}
            <span className="material-symbols-rounded" style={{ fontSize: 15 }}>expand_more</span>
          </button>
          {goldenMenu && (
            <>
              <div onClick={() => { setGoldenMenu(false); setUnpinArm(false); }} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
              <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 61, width: 252, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 16px 42px rgba(0,0,0,.45)", padding: 6, display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)", padding: "7px 10px 5px" }}>
                  {pinned ? "Live version pinned — drives real calls" : "Nothing live yet — rehearsal only"}
                </div>
                {pinned ? (
                  <button onClick={() => void unpinGolden()} disabled={pinning} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 9, border: "none", background: unpinArm ? "var(--error-soft)" : "transparent", color: "var(--error-ink)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16 }}>star_outline</span>
                    {unpinArm ? "Sure? Take it off live" : "Take off live"}
                  </button>
                ) : (
                  <button onClick={() => { setGoldenMenu(false); void pinGolden(); }} disabled={pinning} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 9, border: "none", background: "transparent", color: "var(--gold)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16 }}>star</span>
                    Promote to live
                  </button>
                )}
                <button onClick={() => { setGoldenMenu(false); nav("certification"); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 9, border: "none", background: "transparent", color: "var(--ink1)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 16 }}>verified</span>
                  Run certification
                </button>
              </div>
            </>
          )}
        </span>
        {/* mode toggle: Rehearsal | Live call (both flip the shared `live` gear; isZoom decides which is active) */}
        {statusLoaded && (
          <span style={{ display: "inline-flex", alignItems: "center", background: "var(--sunk)", borderRadius: 9999, padding: 4, gap: 3 }}>
            <button
              onClick={() => setLive(true)}
              title="Rehearse with voice and the real screen"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 14px", borderRadius: 9999, border: "none", fontSize: 12.5, fontWeight: 700, ...btnFont, ...(live && !isZoom ? { background: "var(--card)", color: "var(--ink1)", boxShadow: "var(--shadow)" } : { background: "transparent", color: "var(--ink2)" }) }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>co_present</span>Rehearsal
            </button>
            <button
              onClick={() => setLive(true)}
              title="A real Zoom call — you are directing"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 14px", borderRadius: 9999, border: "none", fontSize: 12.5, fontWeight: 700, ...btnFont, ...(live && isZoom ? { background: "var(--accent)", color: "#fff" } : { background: "transparent", color: "var(--ink2)" }) }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>videocam</span>Live call
            </button>
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }}>
          <span className="material-symbols-rounded" style={{ fontSize: 20 }}>{themeIcon}</span>
        </button>
        <button onClick={() => setTuneOpen((o) => !o)} disabled={!agentStyle} title={agentStyle ? "Style sliders — every move compiles a new persona version" : "No persona to tune yet"} style={{ ...ghostBtn, display: "inline-flex", alignItems: "center", gap: 7, borderColor: tuneOpen ? "var(--purple)" : "var(--border)", color: tuneOpen ? "var(--purple-ink)" : "var(--ink1)", opacity: agentStyle ? 1 : 0.5 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 17 }}>tune</span>Tune
        </button>
        <button onClick={() => setHear((h) => { if (h) stopVoice(); return !h; })} title={hear ? `Hearing ${firstName} out loud — click to silence` : `${firstName} is silent — click to hear the lines out loud`} style={{ width: 36, height: 36, borderRadius: "50%", border: hear ? "1.5px solid var(--purple)" : "1px solid var(--border)", background: "transparent", color: hear ? "var(--purple-ink)" : "var(--ink2)", display: "grid", placeItems: "center", ...btnFont }}>
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>{hear ? "volume_up" : "volume_off"}</span>
        </button>
        {bound && (
          <button onClick={endRehearsal} disabled={ending} style={{ height: 38, padding: "0 16px", borderRadius: 9999, fontSize: 12.5, fontWeight: 700, border: "none", background: "var(--accent)", color: "#fff", boxShadow: "0 8px 24px rgba(255,6,96,.3)", opacity: ending ? 0.6 : 1, ...btnFont }}>
            {ending ? "Ending…" : isZoom ? "End call" : "End rehearsal"}
          </button>
        )}
      </header>

      {/* ---------- page title (mode toggle now lives in the header row) ---------- */}
      {statusLoaded && (
        <div style={{ flexShrink: 0, padding: "14px 18px 0" }}>
          <div className="page-h" style={{ padding: "0 0 10px" }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em" }}>Calibration Room</h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--ink2)" }}>Rehearse with voice and the real screen, then run the call.</p>
          </div>
        </div>
      )}

      {/* ---------- one-click teach: demonstrated steps → beat actions ---------- */}
      {teachSteps !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(2,2,20,.6)", display: "grid", placeItems: "center" }} onClick={() => !teachBusy && setTeachSteps(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: "92vw", background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: "22px 24px" }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Teach him what you just did</div>
            <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.5, marginBottom: 12 }}>
              These are your recorded steps, exactly as you did them. Pick which beat they belong to — they become that beat's screen actions, verbatim. Trim any stray lines first.
            </div>
            <select value={teachBeat} onChange={(e) => setTeachBeat(Number(e.target.value))} style={{ width: "100%", height: 38, borderRadius: 10, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 12.5, padding: "0 10px", marginBottom: 10 }}>
              {stages.map((s, i) => <option key={s.id ?? i} value={i + 1}>{i + 1}. {cleanBeat(s.name).slice(0, 60)}</option>)}
            </select>
            <textarea value={teachSteps} onChange={(e) => setTeachSteps(e.target.value)} rows={Math.min(10, Math.max(4, teachSteps.split("\n").length + 1))} style={{ width: "100%", borderRadius: 12, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.6, padding: "10px 12px", resize: "vertical" }} />
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
              <button onClick={() => void teachDemo()} disabled={teachBusy || !teachSteps.trim()} style={{ height: 42, padding: "0 20px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 800, boxShadow: "0 8px 24px rgba(255,6,96,.3)", cursor: "pointer", opacity: teachBusy ? 0.6 : 1, ...btnFont }}>
                {teachBusy ? "Teaching…" : `Teach him — beat ${teachBeat} runs these steps`}
              </button>
              <button onClick={() => setTeachSteps(null)} disabled={teachBusy} style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- add step: prescriptive Say/Show step straight into the beat sheet ---------- */}
      {stepOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(2,2,20,.6)", display: "grid", placeItems: "center" }} onClick={() => !stepBusy && setStepOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "92vw", background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: "22px 24px" }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Add a step</div>
            <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.5, marginBottom: 12 }}>
              A prescriptive step goes straight into {firstName}'s beat sheet — a line he says, or a move he makes on screen, at that beat.
            </div>
            <div style={{ display: "flex", borderRadius: 9999, border: "1px solid var(--border)", overflow: "hidden", width: "fit-content", marginBottom: 10 }}>
              <button onClick={() => setStepMode("say")} title="A line he should say at this moment" style={{ height: 30, padding: "0 16px", border: "none", background: stepMode === "say" ? "var(--purple-soft)" : "transparent", color: stepMode === "say" ? "var(--purple-ink)" : "var(--ink3)", fontSize: 11.5, fontWeight: 800, ...btnFont }}>Say</button>
              <button onClick={() => setStepMode("show")} title="Something he should do on the screen at this moment" style={{ height: 30, padding: "0 16px", border: "none", background: stepMode === "show" ? "var(--purple-soft)" : "transparent", color: stepMode === "show" ? "var(--purple-ink)" : "var(--ink3)", fontSize: 11.5, fontWeight: 800, ...btnFont }}>Show</button>
            </div>
            <select value={stepBeat} onChange={(e) => setStepBeat(Number(e.target.value))} style={{ width: "100%", height: 38, borderRadius: 10, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 12.5, padding: "0 10px", marginBottom: 10 }}>
              {stages.length === 0 && <option value={1}>No beats yet — build the storyboard first</option>}
              {stages.map((s, i) => <option key={s.id ?? i} value={i + 1}>{i + 1}. {cleanBeat(s.name).slice(0, 60)}</option>)}
            </select>
            <textarea
              value={stepText}
              onChange={(e) => setStepText(e.target.value)}
              rows={3}
              autoFocus
              placeholder={stepMode === "say" ? "The line he should say at this moment…" : "What he should do on screen, in plain words…"}
              style={{ width: "100%", borderRadius: 12, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.6, padding: "10px 12px", resize: "vertical" }}
            />
            {stepMode === "show" && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {SHOW_CHIPS.map((c) => (
                  <button key={c} onClick={() => setStepText(c)} style={{ height: 26, padding: "0 11px", borderRadius: 9999, border: "1px dashed var(--purple)", background: "transparent", color: "var(--purple-ink)", fontSize: 10.5, fontWeight: 700, ...btnFont }}>{c}</button>
                ))}
              </div>
            )}
            {stepMode === "say" && stepGuest.trim() && (
              <div style={{ fontSize: 10.5, color: "var(--ink3)", lineHeight: 1.5, marginTop: 8 }}>
                Anchored under a guest line — he also learns it as the ideal reply to “{stepGuest.trim().slice(0, 90)}”.
              </div>
            )}
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
              <button onClick={() => void addStep()} disabled={stepBusy || !stepText.trim() || !stages.length} style={{ height: 42, padding: "0 20px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", opacity: stepBusy || !stepText.trim() || !stages.length ? 0.6 : 1, ...btnFont }}>
                {stepBusy ? "Adding…" : "Add step"}
              </button>
              <button onClick={() => setStepOpen(false)} disabled={stepBusy} style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}


      {/* ---------- reshape by instruction: propose -> diff preview -> confirm ---------- */}
      {reshapeOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(2,2,20,.6)", display: "grid", placeItems: "center" }} onClick={() => !reshapeBusy && setReshapeOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: "94vw", maxHeight: "84vh", overflowY: "auto", background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: "22px 24px" }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Reshape the beat sheet</div>
            <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.5, marginBottom: 12 }}>One instruction reshapes the WHOLE flow — you get a per-beat diff before anything is applied.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={reshapeText} onChange={(e) => setReshapeText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void proposeReshape(); }} placeholder={"e.g. move pricing before autopilot"} style={{ flex: 1, height: 40, borderRadius: 10, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 12.5, padding: "0 12px" }} />
              <button onClick={() => void proposeReshape()} disabled={reshapeBusy || !reshapeText.trim()} style={{ height: 40, padding: "0 16px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer", opacity: reshapeBusy || !reshapeText.trim() ? 0.6 : 1, fontFamily: "inherit" }}>{reshapeBusy && !reshapeProp ? "Reshaping…" : "Preview"}</button>
            </div>
            {reshapeErr && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--error-ink)", marginTop: 10 }}>{reshapeErr}</div>}
            {reshapeProp && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 8 }}>Proposed flow · per-beat diff</div>
                {reshapeDiff(stages, (reshapeProp.stages ?? []) as Stage[]).map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 9, background: i % 2 ? "transparent" : "var(--sunk)" }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".05em", padding: "1px 8px", borderRadius: 9999, background: r.label === "added" ? "var(--success-soft)" : r.label === "removed" ? "var(--error-soft)" : r.label === "changed" ? "var(--purple-soft)" : r.label === "moved" ? "rgba(0,187,255,.15)" : "var(--ghost)", color: r.label === "added" ? "var(--success-ink)" : r.label === "removed" ? "var(--error-ink)" : r.label === "changed" ? "var(--purple-ink)" : r.label === "moved" ? "var(--decor)" : "var(--ink3)" }}>{r.label.toUpperCase()}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, textDecoration: r.label === "removed" ? "line-through" : "none", opacity: r.label === "removed" ? 0.6 : 1 }}>{r.name}</span>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
                  <button onClick={() => void applyReshape()} disabled={reshapeBusy} style={{ height: 42, padding: "0 20px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", opacity: reshapeBusy ? 0.6 : 1, fontFamily: "inherit" }}>{reshapeBusy ? "Applying…" : "Confirm — apply this flow"}</button>
                  <button onClick={() => { setReshapeProp(null); }} disabled={reshapeBusy} style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Discard proposal</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- tuning drawer: the studio, absorbed (both gears) ---------- */}
      {tuneOpen && spec && (
        <div style={{ position: "absolute", top: 62, right: 0, bottom: 0, width: 380, zIndex: 40, background: "var(--card)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow)", display: "flex", flexDirection: "column" }}>
          <div style={{ flexShrink: 0, padding: "14px 18px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ink3)" }}>Tune {firstName}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: tuneSaving ? "var(--purple-ink)" : "var(--ink3)" }}>{tuneSaving ? "compiling…" : personaVersion !== null ? `persona v${personaVersion}` : ""}</span>
            </div>
            <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 10 }} className="pds-scroll">
              {([["style", "Style"], ["lexicon", "Lexicon"], ["rules", "Rules"], ["knowledge", "Knowledge"], ["versions", "Versions"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setTuneTab(k)} style={{ flexShrink: 0, height: 30, padding: "0 12px", borderRadius: 9999, border: "none", background: tuneTab === k ? "var(--ink1)" : "var(--ghost)", color: tuneTab === k ? "var(--card)" : "var(--ink2)", fontFamily: "inherit", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>{label}</button>
              ))}
            </div>
          </div>
          <div className="pds-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 18px 18px" }}>
            {tuneTab === "style" && styleDraft && (
              <>
                <div style={{ fontSize: 11.5, color: "var(--ink2)", lineHeight: 1.5, marginBottom: 14 }}>Every move compiles a new version and applies on {firstName}'s next reply — text or live.</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {STYLE_META.map((m) => {
                    const v = Math.round(((styleDraft[m.key] ?? 0.5) as number) * 100);
                    return (
                      <div key={m.key}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{m.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--purple-ink)" }}>{v}</span>
                        </div>
                        <input type="range" min={0} max={100} value={v} onChange={(e) => tuneSlider(m.key, Number(e.target.value))} style={{ width: "100%", height: 5, cursor: "pointer", accentColor: "var(--purple)" }} />
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {tuneTab === "lexicon" && (
              <>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 8 }}>Signature phrases</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
                  {(spec.lexicon?.signature_phrases ?? []).map((p, i) => (
                    <span key={i} title={p.source || undefined} style={{ fontSize: 11.5, fontWeight: 600, padding: "6px 10px", borderRadius: 9999, background: "var(--sunk)" }}>"{p.text}"</span>
                  ))}
                  {!(spec.lexicon?.signature_phrases ?? []).length && <span style={{ fontSize: 12, color: "var(--ink3)" }}>No signature phrases extracted yet.</span>}
                </div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 8 }}>Never say</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
                  {(spec.lexicon?.banned_phrases ?? []).map((b, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, padding: "6px 10px", borderRadius: 9999, background: "var(--error-soft)", color: "var(--error-ink)" }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 13 }}>block</span>{b}
                    </span>
                  ))}
                  {!(spec.lexicon?.banned_phrases ?? []).length && <span style={{ fontSize: 12, color: "var(--ink3)" }}>Nothing banned yet — a "Fix speech" correction can add one.</span>}
                </div>
                {spec.lexicon?.vocabulary_notes ? (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 8 }}>Vocabulary notes</div>
                    <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.5 }}>{spec.lexicon.vocabulary_notes}</div>
                  </>
                ) : null}
              </>
            )}

            {tuneTab === "rules" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(spec.behaviors?.rules ?? []).map((r, i) => (
                  <div key={r.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, opacity: (r.active ?? true) ? 1 : 0.55 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 9999, background: "var(--purple-soft)", color: "var(--purple-ink)" }}>{r.id}</span>
                        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.45, marginTop: 6 }}>{r.text}</div>
                      </div>
                      <button onClick={() => toggleRule(i)} title={(r.active ?? true) ? "Disable rule" : "Enable rule"} style={{ flexShrink: 0, width: 38, height: 22, borderRadius: 9999, border: "none", cursor: "pointer", background: (r.active ?? true) ? "var(--purple)" : "var(--border)", position: "relative" }}>
                        <span style={{ position: "absolute", top: 2, left: (r.active ?? true) ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s ease" }} />
                      </button>
                    </div>
                  </div>
                ))}
                {!(spec.behaviors?.rules ?? []).length && <div style={{ fontSize: 12, color: "var(--ink3)" }}>No rules yet. "Fix speech" on a bad reply compiles the first one.</div>}
              </div>
            )}

            {tuneTab === "knowledge" && (
              <div>
                <div style={{ fontSize: 11.5, color: "var(--ink2)", lineHeight: 1.5, marginBottom: 12 }}>What {firstName} knows they don't know — {firstName} deflects or offers a follow-up instead of guessing.</div>
                {(spec.knowledge_boundaries ?? []).map((k, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "10px 0", borderBottom: "1px solid var(--divider)" }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16, color: "var(--decor)", marginTop: 1 }}>shield</span>
                    <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.45 }}>{k}</div>
                  </div>
                ))}
                {!(spec.knowledge_boundaries ?? []).length && <div style={{ fontSize: 12, color: "var(--ink3)" }}>No knowledge boundaries extracted yet.</div>}
              </div>
            )}

            {tuneTab === "versions" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {[...versions].sort((a, b) => b.number - a.number).map((v) => (
                  <div key={v.id} style={{ display: "flex", gap: 9 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--purple-ink)", background: "var(--purple-soft)", padding: "2px 7px", borderRadius: 9999, height: "fit-content", flexShrink: 0 }}>v{v.number}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.4 }}>{v.change_note || "No change note"}</div>
                      <div style={{ fontSize: 10.5, color: "var(--ink3)", marginTop: 2 }}>{v.created_by ?? ""}</div>
                    </div>
                    {v.id === goldenId ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: "var(--gold)", height: "fit-content", flexShrink: 0 }}>
                        <span className="material-symbols-rounded" style={{ fontSize: 13, fontVariationSettings: "'FILL' 1" }}>star</span>golden
                      </span>
                    ) : (
                      <button onClick={() => void pinVersion(v.id)} disabled={!!pinningId} style={{ fontSize: 11, fontWeight: 700, color: "var(--ink2)", background: "transparent", border: "none", cursor: "pointer", height: "fit-content", fontFamily: "inherit", flexShrink: 0, opacity: pinningId === v.id ? 0.5 : 1 }}>
                        {pinningId === v.id ? "Pinning…" : "Pin golden"}
                      </button>
                    )}
                  </div>
                ))}
                {!versions.length && <div style={{ fontSize: 12, color: "var(--ink3)" }}>Every slider move, rule toggle and applied fix lands here as a version.</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- pre-session states (live gear only) ---------- */}
      {!bound && (live || !statusLoaded) && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "grid", placeItems: "center", padding: 24 }} className="pds-scroll">
          <div style={{ background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: "32px 36px", maxWidth: 560, width: "100%" }}>
            {!statusLoaded ? (
              <div style={{ fontSize: 13, color: "var(--ink3)", textAlign: "center" }}>Checking for a live session…</div>
            ) : rehearsalStarting ? (
              <>
                <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Setting the room up</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 18 }}>Spinning up the sandbox and logging in to GoPerfect. This usually takes 3 to 4 minutes.</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {PHASES.map((p, i) => {
                    const done = donePhases.includes(p) || (phaseIdx >= 0 && i < phaseIdx);
                    const current = phaseIdx === i || (phaseIdx < 0 && i === 0 && !done);
                    return (
                      <div key={p} style={{ display: "flex", alignItems: "center", gap: 10, opacity: done || current ? 1 : 0.45 }}>
                        <span className="material-symbols-rounded" style={{ fontSize: 17, color: done ? "var(--success-ink)" : current ? "var(--purple)" : "var(--ink3)" }}>
                          {done ? "check_circle" : current ? "progress_activity" : "radio_button_unchecked"}
                        </span>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: done || current ? "var(--ink1)" : "var(--ink3)" }}>{PHASE_LABELS[p]}</span>
                        {current && !done && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink3)" }}>working…</span>}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>{pinned ? "Session ended" : "Session ended — nothing is golden yet"}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.6, marginBottom: 18 }}>
                  {pinned
                    ? <>A golden persona is pinned — that exact version drives {firstName}'s real calls. Fixes you applied in this session live in the draft; if they made {firstName} better, <b style={{ color: "var(--gold)" }}>pin again</b> to make them golden. Screen-flow edits reach real calls immediately either way.</>
                    : <>Every fix you applied is saved, but none of it drives real calls until you pin. Keep rehearsing — go live, correct {firstName}, repeat — and when a run feels perfect, hit <b style={{ color: "var(--gold)" }}>Pin as golden</b>: that exact persona and flow becomes what {firstName} runs on a real call. Until then {firstName} stays in rehearsal.</>}
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={() => void goLive()} disabled={!agentId || joining} style={{ height: 44, padding: "0 22px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13.5, fontWeight: 800, boxShadow: "0 8px 24px rgba(255,6,96,.3)", opacity: joining ? 0.6 : 1, ...btnFont }}>
                    {joining ? "Starting…" : "Rehearse again"}
                  </button>
                  {pinned ? (
                    <button onClick={() => nav("certification")} style={{ ...ghostBtn, borderColor: "var(--purple)", color: "var(--purple-ink)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 16 }}>verified</span>Run certification
                    </button>
                  ) : (
                    <button onClick={pinGolden} disabled={pinning || !agentId} style={{ ...ghostBtn, borderColor: "var(--gold)", color: "var(--gold)", opacity: pinning ? 0.6 : 1 }}>
                      {pinning ? "Pinning…" : "It was perfect — Pin as golden"}
                    </button>
                  )}
                </div>
              </>
            )}
            {joinErr && <div style={{ marginTop: 14, fontSize: 12, fontWeight: 600, color: "var(--error-ink)" }}>{joinErr}</div>}
          </div>
        </div>
      )}

      {/* ---------- idle / start: pick a clone, then go live (voice + real screen) ---------- */}
      {statusLoaded && !live && (
        <div className="pds-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 22px", display: "flex", justifyContent: "center" }}>
          <section style={{ width: "100%", maxWidth: 720, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ minWidth: 200, height: 36, borderRadius: 10, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 12.5, padding: "0 10px" }}>
                {agents.length === 0 && <option value="">No agents yet</option>}
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role ? ` — ${a.role}` : ""}</option>)}
              </select>
              {stages.length > 0 && (
                <div style={{ display: "flex", gap: 6, overflowX: "auto", flex: 1, minWidth: 0, alignItems: "center" }} className="pds-scroll">
                  {stages.slice(0, 8).map((s, i) => (
                    <span key={s.id ?? i} onClick={(e) => setBeatMenu({ i, x: e.clientX, y: e.clientY })} title="Edit · drop" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 8px 6px 11px", borderRadius: 9999, background: "var(--sunk)", border: "1px solid var(--border)", fontSize: 11, fontWeight: 700, color: "var(--ink2)", whiteSpace: "nowrap", cursor: "pointer" }}>
                      {i + 1}. {cleanBeat(s.name).slice(0, 26)}
                      <button onClick={(e) => { e.stopPropagation(); void dropBeat(i); }} disabled={dropping} title="Drop this beat — he stops doing it" style={{ display: "inline-flex", alignItems: "center", border: "none", background: dropArm === i ? "var(--error-soft)" : "transparent", color: dropArm === i ? "var(--error-ink)" : "var(--ink3)", cursor: "pointer", fontFamily: "inherit", borderRadius: 9999, padding: dropArm === i ? "1px 6px" : 0, fontSize: 9.5, fontWeight: 800 }}>
                        {dropArm === i ? "Drop?" : <span className="material-symbols-rounded" style={{ fontSize: 13 }}>close</span>}
                      </button>
                    </span>
                  ))}
                  {dropNote && <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: dropNote.startsWith("Drop failed") ? "var(--error-ink)" : "var(--success-ink)" }}>{dropNote}</span>}
                </div>
              )}
            </div>

            <div style={{ flex: 1, minHeight: 260, borderRadius: 16, border: "1px dashed var(--border)", background: "var(--card)", display: "grid", placeItems: "center", padding: 24 }}>
              <div style={{ textAlign: "center", maxWidth: 440 }}>
                {rehearsalStarting && !(call && call.agent_id && call.agent_id !== agentId) ? (
                  /* WARMING — show the boot checklist instead of the cold intro */
                  <>
                    <span className="material-symbols-rounded" style={{ fontSize: 40, color: "var(--purple)" }}>co_present</span>
                    <div style={{ fontSize: 16.5, fontWeight: 800, margin: "10px 0 4px" }}>Warming up {firstName}'s screen</div>
                    <div style={{ fontSize: 12, color: "var(--ink3)", lineHeight: 1.6, marginBottom: 18 }}>Spinning up the sandbox and signing in to GoPerfect — usually 3 to 4 minutes.</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 9, textAlign: "left", maxWidth: 280, margin: "0 auto" }}>
                      {PHASES.map((p, i) => {
                        const done = donePhases.includes(p) || (phaseIdx >= 0 && i < phaseIdx);
                        const current = phaseIdx === i || (phaseIdx < 0 && i === 0 && !done);
                        return (
                          <div key={p} style={{ display: "flex", alignItems: "center", gap: 10, opacity: done || current ? 1 : 0.45 }}>
                            <span className="material-symbols-rounded" style={{ fontSize: 17, color: done ? "var(--success-ink)" : current ? "var(--purple)" : "var(--ink3)" }}>
                              {done ? "check_circle" : current ? "progress_activity" : "radio_button_unchecked"}
                            </span>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: done || current ? "var(--ink1)" : "var(--ink3)" }}>{PHASE_LABELS[p]}</span>
                            {current && !done && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink3)" }}>working…</span>}
                          </div>
                        );
                      })}
                    </div>
                    {joinErr && <div style={{ marginTop: 14, fontSize: 12, fontWeight: 600, color: "var(--error-ink)" }}>{joinErr}</div>}
                  </>
                ) : (
                  /* COLD — nothing warming yet: explain + let them start */
                  <>
                    <span className="material-symbols-rounded" style={{ fontSize: 44, color: "var(--purple)" }}>co_present</span>
                    <div style={{ fontSize: 16.5, fontWeight: 800, margin: "10px 0 6px" }}>Ready when you are</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.6, marginBottom: 16 }}>
                      Go live spins up a sandbox where {firstName} speaks, shares the screen and drives the product — voice and the real GoPerfect UI, just like a call.
                    </div>
                    {call && !call.ended_at && call.mode === "rehearsal" && call.agent_id && call.agent_id !== agentId ? (
                      <div style={{ fontSize: 12, color: "var(--warning-ink)", fontWeight: 600, marginBottom: 12 }}>
                        The warm screen belongs to another clone — end it from the director console or switch back to rehearse live.
                      </div>
                    ) : null}
                    <label title={pinned ? "Rehearse the LIVE version — exactly what real calls run" : "Nothing live yet — promote a version first"} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 11.5, fontWeight: 700, color: rehearseGolden ? "var(--gold)" : "var(--ink3)", marginBottom: 10, cursor: pinned ? "pointer" : "default", opacity: pinned ? 1 : 0.55 }}>
                      <input type="checkbox" checked={rehearseGolden} disabled={!pinned} onChange={(e) => setRehearseGolden(e.target.checked)} style={{ accentColor: "var(--gold)" }} />
                      Rehearse the live version (next session)
                    </label>
                    <button onClick={() => void goLive()} disabled={!agentId || joining} style={{ height: 46, padding: "0 26px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 800, boxShadow: "0 8px 24px rgba(255,6,96,.3)", cursor: "pointer", opacity: joining ? 0.6 : 1, ...btnFont }}>
                      {bound ? "Go live — ready" : "Go live — voice + screen"}
                    </button>
                    <div style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 600, marginTop: 10 }}>Starts a fresh sandbox (3–4 min).</div>
                    {joinErr && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: "var(--error-ink)" }}>{joinErr}</div>}
                  </>
                )}
              </div>
            </div>

            {/* Demo account — the login the sandbox uses on every session */}
            <div style={{ padding: "12px 14px", borderRadius: 12, background: "var(--sunk)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 16, color: "var(--purple)" }}>key</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink3)" }}>Demo account</span>
                {!demoEdit && (
                  <button onClick={() => { setDemoEdit(true); setDemoFormEmail(demoEmail); setDemoFormPw(""); }} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--purple-ink)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{demoEmail ? "Change" : "Set up"}</button>
                )}
              </div>
              {!demoEdit ? (
                <div style={{ fontSize: 12.5, color: demoEmail ? "var(--ink2)" : "var(--warning-ink)", marginTop: 6, lineHeight: 1.5 }}>
                  {demoEmail
                    ? <>{firstName} logs into the product as <b style={{ color: "var(--ink1)" }}>{demoEmail}</b> on every rehearsal and live call.</>
                    : "No login saved — the screen will sit on the login page. Add the demo account once and every session uses it."}
                </div>
              ) : (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  <input value={demoFormEmail} onChange={(e) => setDemoFormEmail(e.target.value)} placeholder="Demo account email" style={{ height: 36, borderRadius: 9, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 12.5, padding: "0 12px" }} />
                  <input value={demoFormPw} onChange={(e) => setDemoFormPw(e.target.value)} type="password" placeholder={demoHasPw ? "Password (leave blank to keep current)" : "Password"} style={{ height: 36, borderRadius: 9, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 12.5, padding: "0 12px" }} />
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button onClick={() => void saveDemoLogin()} disabled={demoSaving || !demoFormEmail.trim() || (!demoHasPw && !demoFormPw)} style={{ height: 34, padding: "0 16px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: demoSaving || !demoFormEmail.trim() || (!demoHasPw && !demoFormPw) ? 0.6 : 1 }}>{demoSaving ? "Saving…" : "Save for all sessions"}</button>
                    <button onClick={() => { setDemoEdit(false); setDemoErr(""); }} style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--ink3)" }}>Stored on your server only, used by the sandbox to sign in. The password is never shown back.</div>
                  {demoErr && <div style={{ fontSize: 11.5, color: "var(--error-ink)", fontWeight: 600 }}>{demoErr}</div>}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ---------- bound: rail + stage ---------- */}
      {bound && live && (
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,0.82fr)" }}>
          {/* conversation rail */}
          <section style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--divider)", minHeight: 0 }}>
            <div className={`ctxbar ${isZoom ? "live" : "rehearse"}`} style={{ margin: "10px 12px 4px", flexWrap: "wrap" }}>
              <span className="rec" />
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>{isZoom ? "Live call · you are directing" : "Conversation · you are the guest"}</span>
              {call?.persona_mode && (
                <span title={call.persona_mode === "golden" ? "Running the LIVE version — exactly what real calls run" : "Running the current draft"} style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".05em", padding: "2px 8px", borderRadius: 9999, background: call.persona_mode === "golden" ? "rgba(255,199,0,.15)" : "var(--purple-soft)", color: call.persona_mode === "golden" ? "var(--gold)" : "var(--purple-ink)" }}>
                  {call.persona_mode === "golden" ? "LIVE VERSION" : "DRAFT VERSION"}
                </span>
              )}
              {liveAudioOn && (
                <span title="You are hearing the sandbox's real output — same voice and pacing a Zoom guest gets" style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".05em", padding: "2px 8px", borderRadius: 9999, background: "var(--success-soft)", color: "var(--success-ink)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 11 }}>graphic_eq</span>LIVE AUDIO
                </span>
              )}
              {resumeNote && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0, textTransform: "none", color: "var(--success-ink)" }}>{resumeNote}</span>}
              {jumpNote && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0, textTransform: "none", color: jumpNote.startsWith("Jump failed") ? "var(--error-ink)" : "var(--purple-ink)" }}>{jumpNote}</span>}
              {stepNote && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0, textTransform: "none", color: stepNote.includes("failed") ? "var(--error-ink)" : "var(--success-ink)" }}>{stepNote}</span>}
              </div>
              {!isZoom && (
                <>
                  <div style={{ flex: 1 }} />
                  <div className="prog">{rehProg}</div>
                </>
              )}
            </div>
            <div ref={feedRef} className="pds-scroll" style={{ flex: 1, overflowY: "auto", padding: "6px 16px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
              {/* REHEARSAL: turn-by-turn approve / coach cards. Zoom keeps the transcript feed (below, isZoom branch). */}
              {!isZoom && (
                rehearsalTurns.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--ink3)", padding: "18px 4px", lineHeight: 1.6 }}>
                    The room is live. Say something as the guest to kick the call off, or tap a scenario chip below — {firstName}'s replies land here as turns to approve or coach.
                  </div>
                ) : (
                  rehearsalTurns.map((t, i) => {
                    const sp = grades[`${t.turnSeq}|speech`];
                    const sc = grades[`${t.turnSeq}|screen`];
                    const isCurrent = i === rehCurrentIdx;
                    if (!isCurrent) {
                      const coached = sp?.verdict === "coach" || sc?.verdict === "coach";
                      return (
                        <div key={t.key} className="turn approved">
                          <div className="collapsed">
                            <div className="mini">
                              <div className="l">{t.beatName ?? `Reply ${t.turnSeq}`}</div>
                              <div className="s">{t.speech?.text ?? t.screen?.text ?? t.guest ?? ""}</div>
                            </div>
                            <span className={`badge ${coached ? "coached" : "ok"}`}>
                              <span className="material-symbols-rounded" style={{ fontSize: 13 }}>{coached ? "edit" : "check"}</span>
                              {coached ? "coached" : "approved"}
                            </span>
                          </div>
                        </div>
                      );
                    }
                    const speechKey = `${t.turnSeq}|speech`;
                    const screenKey = `${t.turnSeq}|screen`;
                    const stStatus = (g?: { verdict: string }) => (g?.verdict === "coach" ? "coached" : g?.verdict === "approve" ? "approved" : "waiting");
                    const teachBtn: CSSProperties = { height: 34, padding: "0 14px", borderRadius: 10, border: "none", background: "var(--purple)", color: "#fff", fontSize: 12, fontWeight: 700, flexShrink: 0, ...btnFont };
                    return (
                      <div key={t.key} className="turn current">
                        <div className="tguest">
                          {t.beatName && <span className="tbeat">{t.beatName}</span>}
                          <span>Prospect: <b>{t.guest || "(opening)"}</b></span>
                        </div>
                        <div className="tbody">
                          {t.speech && (
                            <div className="part speech">
                              <div className="ph">
                                <span className="ic"><span className="material-symbols-rounded" style={{ fontSize: 16 }}>mic</span></span>
                                <span className="lbl">What he says</span>
                                <span className="spacer" />
                                <div className="acts">
                                  <button className={`mini-btn approve${sp?.verdict === "approve" ? " done" : ""}`} onClick={() => void gradePart(t.turnSeq, "speech", "approve")}>
                                    <span className="material-symbols-rounded" style={{ fontSize: 15 }}>check</span>{sp?.verdict === "approve" ? "Approved" : "Approve"}
                                  </button>
                                  <button className={`mini-btn coach${sp?.verdict === "coach" ? " done" : ""}`} onClick={() => toggleTurnCoach(speechKey)}>
                                    <span className="material-symbols-rounded" style={{ fontSize: 15 }}>edit</span>Coach
                                  </button>
                                </div>
                              </div>
                              <div className="content">"{t.speech.text}"</div>
                              <div className={`coachbox${turnCoachOpen === speechKey ? " open" : ""}`}>
                                <div className="cin">
                                  <input value={turnCoachOpen === speechKey ? turnCoachText : ""} onChange={(e) => setTurnCoachText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitTurnCoach(t.turnSeq, "speech"); }} placeholder={`Tell ${firstName} how to say it better…`} />
                                  <button onClick={() => submitTurnCoach(t.turnSeq, "speech")} style={teachBtn}>Teach him</button>
                                </div>
                              </div>
                            </div>
                          )}
                          {t.screen && (
                            <div className="part screen">
                              <div className="ph">
                                <span className="ic"><span className="material-symbols-rounded" style={{ fontSize: 16 }}>desktop_windows</span></span>
                                <span className="lbl">What he shows</span>
                                <span className="spacer" />
                                <div className="acts">
                                  <button className={`mini-btn approve${sc?.verdict === "approve" ? " done" : ""}`} onClick={() => void gradePart(t.turnSeq, "screen", "approve")}>
                                    <span className="material-symbols-rounded" style={{ fontSize: 15 }}>check</span>{sc?.verdict === "approve" ? "Approved" : "Approve"}
                                  </button>
                                  <button className={`mini-btn coach${sc?.verdict === "coach" ? " done" : ""}`} onClick={() => toggleTurnCoach(screenKey)}>
                                    <span className="material-symbols-rounded" style={{ fontSize: 15 }}>edit</span>Coach
                                  </button>
                                </div>
                              </div>
                              <div className="content">
                                <div className="thumb">{(t.screen.label || "on screen").slice(0, 42)}</div>
                                <div>{t.screen.text || t.screen.label || "Screen action"}</div>
                              </div>
                              <div className={`coachbox${turnCoachOpen === screenKey ? " open" : ""}`}>
                                <div className="cin">
                                  <input value={turnCoachOpen === screenKey ? turnCoachText : ""} onChange={(e) => setTurnCoachText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitTurnCoach(t.turnSeq, "screen"); }} placeholder={`Tell ${firstName} what to show instead…`} />
                                  <button onClick={() => submitTurnCoach(t.turnSeq, "screen")} style={teachBtn}>Teach him</button>
                                </div>
                                {bound && (
                                  <div className="takeover" onClick={() => coachTurnScreenByDemo(t)}>
                                    <span className="material-symbols-rounded" style={{ fontSize: 14 }}>back_hand</span>Or take control and show him
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          {!t.speech && !t.screen && (
                            <div style={{ fontSize: 12.5, color: "var(--ink3)", padding: "10px 0" }}>Waiting for {firstName} to reply…</div>
                          )}
                        </div>
                        <div className="tfoot">
                          <div className="status">
                            {t.speech && <span>Speech <b style={{ color: sp ? "var(--success-ink)" : "var(--ink3)" }}>{stStatus(sp)}</b></span>}
                            {t.screen && <span>Screen <b style={{ color: sc ? "var(--success-ink)" : "var(--ink3)" }}>{stStatus(sc)}</b></span>}
                          </div>
                          <div className="spacer" />
                          <button onClick={() => void approveTurnBoth(t)} style={{ ...ghostBtn, height: 34, padding: "0 14px", fontSize: 12.5 }}>Approve both</button>
                          <button onClick={() => void advanceTurn(t)} style={{ height: 34, padding: "0 16px", borderRadius: 9999, border: "none", background: "var(--success)", color: "#04231a", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6, ...btnFont, fontWeight: 700 }}>
                            Continue<span className="material-symbols-rounded" style={{ fontSize: 15 }}>arrow_forward</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )
              )}
              {isZoom && (<>
              {items.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--ink3)", padding: "18px 4px", lineHeight: 1.6 }}>
                  {isZoom ? `${firstName} is on a real call. The two-way transcript lands here — whisper directions below, he acts silently.` : "The room is live. Say something as the guest to kick the call off, or tap a scenario chip below."}
                </div>
              )}
              {items.filter((it) => !hiddenSeqs[it.seq]).map((it, idx) => {
                const body = (() => {
                if (it.t === "guest") return (
                  <div key={`${it.seq}-${idx}`} style={{ maxWidth: "88%", alignSelf: "flex-end", opacity: it.pending ? 0.6 : 1 }}>
                    <div style={{ ...whoStyle, textAlign: "right", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
                      <button onClick={() => setHiddenSeqs((h) => ({ ...h, [it.seq]: true }))} title="Remove from view — the live call already heard it" style={{ border: "none", background: "transparent", color: "var(--ink3)", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center" }}>
                        <span className="material-symbols-rounded" style={{ fontSize: 13 }}>delete</span>
                      </button>
                      <span>You · guest</span>
                    </div>
                    <div className="bub guest">{it.text}</div>
                  </div>
                );
                if (it.t === "say") {
                  const isFixed = !!fixedSeqs[it.seq];
                  return (
                    <div key={`${it.seq}-${idx}`} style={{ maxWidth: "88%", alignSelf: "flex-start", width: editTarget?.source === "live" && editTarget.seq === it.seq ? "88%" : undefined }}>
                      <div style={whoStyle}>{firstName}{personaVersion !== null ? ` · persona v${personaVersion}` : ""}</div>
                      {editTarget?.source === "live" && editTarget.seq === it.seq ? (
                        <div>
                          <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4} autoFocus style={{ width: "100%", borderRadius: 14, padding: "9px 13px", fontSize: 12.5, lineHeight: 1.5, background: "var(--purple-soft)", color: "var(--ink1)", border: "1.5px solid var(--purple)", fontFamily: "inherit", resize: "vertical" }} />
                          <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
                            <button onClick={() => void teachReply()} disabled={teaching || !editText.trim()} style={{ height: 28, padding: "0 14px", borderRadius: 9999, border: "none", background: "var(--purple)", color: "#fff", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: teaching ? 0.6 : 1 }}>{teaching ? "Teaching…" : "Teach him this reply"}</button>
                            <button onClick={() => { setEditTarget(null); setEditText(""); }} style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="bub eli">{it.text}</div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                            <button onClick={() => openEditLive(it.seq, it.text)} style={fixLink}>Edit reply</button>
                            <button onClick={() => openFixSpeech(it.seq, it.text)} style={{ ...fixLink, ...(isFixed ? { borderColor: "var(--success)", color: "var(--success-ink)" } : {}) }}>
                              {isFixed ? "Fixed ✓" : "Fix speech"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                }
                if (it.t === "tool") {
                  const isFixed = !!fixedSeqs[it.seq];
                  return (
                    <div key={`${it.seq}-${idx}`} style={{ alignSelf: "stretch", display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", borderRadius: 11, background: "var(--sunk)", border: isFixed ? "1px solid var(--success)" : "1px dashed var(--border)" }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: isFixed ? "var(--success)" : "var(--purple)", flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 11.5, fontWeight: 600, color: isFixed ? "var(--success-ink)" : "var(--purple-ink)" }}>{it.label}</span>
                      <button onClick={() => openFixAction(it)} style={{ ...fixLink, ...(isFixed ? { borderColor: "var(--success)", color: "var(--success-ink)" } : {}) }}>
                        {isFixed ? "Fixed ✓" : "Fix action"}
                      </button>
                      <button onClick={() => { demoFixRef.current = { seq: it.seq, kind: "screen", guest: nearestBefore(it.seq, "guest"), maya: nearestBefore(it.seq, "say"), action: it.label, shot: it.shot }; void takeControl(); }} title="Freeze him and demonstrate this moment on the real screen — your clicks come back as the fix" style={{ ...fixLink, borderColor: "var(--decor)", color: "var(--decor)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span className="material-symbols-rounded" style={{ fontSize: 13 }}>back_hand</span>Show him
                      </button>
                    </div>
                  );
                }
                if (it.t === "screen") return (
                  <div key={`${it.seq}-${idx}`} style={{ alignSelf: "stretch", display: "flex", alignItems: "flex-start", gap: 7, padding: "6px 11px", borderRadius: 10, background: "rgba(100,116,139,.13)", border: "1px solid rgba(100,116,139,.35)" }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 14, color: "#8CA0B8", marginTop: 1 }}>visibility</span>
                    <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: "#8CA0B8", lineHeight: 1.45 }}>{it.text}</span>
                  </div>
                );
                if (it.t === "err") return (
                  <div key={`${it.seq}-${idx}`} style={{ fontSize: 11, fontWeight: 600, color: "var(--error-ink)", padding: "2px 4px" }}>{it.text}</div>
                );
                return (
                  <div key={`${it.seq}-${idx}`} style={{ fontSize: 10.5, color: "var(--ink3)", padding: "0 4px" }}>{it.text}</div>
                );
                })();
                return body;
              })}
              {pending.length > 0 && (
                <div style={{ maxWidth: "88%", alignSelf: "flex-start" }}>
                  <div style={whoStyle}>{firstName}</div>
                  <div className="rr-typing" style={{ borderRadius: 14, padding: "11px 13px", background: "var(--purple-soft)", display: "inline-flex", gap: 3 }}>
                    {[0, 1, 2].map((i) => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ink3)", animation: `rrBlink 1s infinite`, animationDelay: `${i * 0.18}s` }} />)}
                  </div>
                </div>
              )}
              </>)}
            </div>
            <div style={{ borderTop: "1px solid var(--divider)", padding: "10px 14px 14px" }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 9, alignItems: "center" }}>
                <div className="tri">
                  <button className={inputMode === "guest" ? "on" : (isZoom ? "disabled" : undefined)} onClick={() => setInputMode("guest")} title={isZoom ? "Speak as the guest — only for solo tests; a real prospect is also talking" : undefined}>As guest</button>
                  <button className={inputMode === "direct" ? "on" : undefined} onClick={() => setInputMode("direct")} title={`Silent instruction — the guest never hears it, ${firstName} acts on it immediately`}>Direct {firstName}</button>
                  <button className={inputMode === "coach" ? "on" : undefined} onClick={() => setInputMode("coach")} title="Coach — the instruction STICKS: routed to persona rules, sliders, beats or situational directives (and lands mid-call too)">Coach</button>
                </div>
                {inputMode === "guest" && SCENARIOS.map((s) => (
                  <button key={s} onClick={() => void sendGuest(s)} disabled={chipDisabled} style={{ height: 28, padding: "0 12px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink2)", fontSize: 11, fontWeight: 700, ...btnFont }}>
                    {s}
                  </button>
                ))}
                {coachNote && <span style={{ fontSize: 10.5, fontWeight: 700, color: coachNote.ok ? "var(--success-ink)" : "var(--error-ink)" }}>{coachBusy ? "Coaching…" : coachNote.text}</span>}
                {inputMode === "coach" && !coachNote && <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink3)" }}>{coachBusy ? "Routing the instruction…" : "Coaching sticks — it becomes rules, sliders, beat edits or directives."}</span>}
                {inputMode === "direct" && ["Go to the outreach tab", "Back to the positions board", "Show the matches now"].map((s) => (
                  <button key={s} onClick={() => void sendDirect(s)} disabled={chipDisabled} style={{ height: 28, padding: "0 12px", borderRadius: 9999, border: "1px dashed var(--purple)", background: "transparent", color: "var(--purple-ink)", fontSize: 11, fontWeight: 700, ...btnFont }}>
                    {s}
                  </button>
                ))}
              </div>
              {isZoom && (
                <div className="guardnote">
                  <span className="material-symbols-rounded" style={{ fontSize: 15 }}>warning</span>
                  On a real call you direct, not speak — whatever you send, the prospect hears {firstName}.
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => openStep("")} title="Insert a prescriptive step into the beat sheet" style={{ height: 42, padding: "0 13px", borderRadius: 9999, border: "1px dashed var(--purple)", background: "transparent", color: "var(--purple-ink)", fontSize: 11.5, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, ...btnFont }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 15 }}>add</span>Step
                </button>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void (inputMode === "coach" ? sendCoach(input) : inputMode === "direct" ? sendDirect(input) : sendGuest(input)); }}
                  placeholder={inputMode === "coach" ? `Coach ${firstName} — "when they ask about outreach performance, show the analytics screen"…` : inputMode === "direct" ? `Tell ${firstName} what to do — "go to the outreach section of the position"…` : "Say something as the guest…"}
                  style={{ flex: 1, height: 42, borderRadius: 9999, border: inputMode === "direct" ? "1px solid var(--purple)" : "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontFamily: "inherit", fontSize: 12.5, padding: "0 16px", outline: "none" }}
                />
                <button onClick={toggleMic} title={micOn ? "Mic is live — click to mute" : isZoom ? "Mic muted — click to talk as the guest (solo tests)" : "Mic muted — click to talk"} style={{ width: 42, height: 42, borderRadius: "50%", border: micOn ? "1.5px solid var(--accent)" : "1.5px solid var(--border)", background: micOn ? "rgba(255,6,96,.12)" : "transparent", color: micOn ? "var(--accent)" : "var(--ink2)", display: "grid", placeItems: "center", ...btnFont }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 18, animation: micOn && listening ? "rrBlink 2.4s ease infinite" : "none" }}>{micOn ? "mic" : "mic_off"}</span>
                </button>
                <button onClick={() => void (inputMode === "coach" ? sendCoach(input) : inputMode === "direct" ? sendDirect(input) : sendGuest(input))} title="Send" style={{ width: 42, height: 42, borderRadius: "50%", border: "none", background: "var(--purple)", color: "#fff", display: "grid", placeItems: "center", ...btnFont }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>{inputMode === "direct" ? "podium" : "send"}</span>
                </button>
              </div>
            </div>
          </section>

          {/* stage */}
          <section className="pds-scroll" style={{ display: "flex", flexDirection: "column", minWidth: 0, padding: "16px 18px 14px", gap: 12, overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, position: "sticky", top: -16, zIndex: 10, background: "var(--bg)", paddingTop: 16, marginTop: -16, paddingBottom: 8, marginBottom: -8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 30, padding: "0 14px", borderRadius: 9999, background: controlling ? "rgba(0,187,255,.15)" : "rgba(255,6,96,.14)", color: controlling ? "var(--decor)" : "var(--accent)", fontSize: 11.5, fontWeight: 800 }}>
                <span className="rr-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: controlling ? "var(--decor)" : "var(--accent)", animation: "rrPulse 1.6s ease-in-out infinite" }} />
                {controlling ? "YOU are driving — show him how it's done" : `${firstName} is driving`}
              </span>
              <button onClick={() => void (controlling ? handBack() : takeControl())} title={controlling ? "Give the screen back and turn what you showed into a fix" : isZoom ? "Freeze him and drive the screen yourself — the prospect SEES everything you do" : "Freeze him and drive the screen yourself — click inside the stream"} style={{ ...ghostBtn, height: 30, display: "inline-flex", alignItems: "center", gap: 6, borderColor: controlling ? "var(--decor)" : "var(--border)", color: controlling ? "var(--decor)" : "var(--ink1)" }}>
                <span className="material-symbols-rounded" style={{ fontSize: 15 }}>{controlling ? "keyboard_return" : "back_hand"}</span>
                {controlling ? "Hand back + teach" : "Take control"}
              </button>
              {stages.length > 0 && (currentBeat !== null || coverage.length > 0) && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 9999, background: "var(--purple-soft)", color: "var(--purple-ink)", fontSize: 11.5, fontWeight: 800 }}>
                  {currentBeat !== null ? `beat ${Math.min(currentBeat, stages.length)}/${stages.length} · ${(stages[Math.min(currentBeat, stages.length) - 1]?.name ?? "").replace(/^[\d:—\-.\s]+/, "").slice(0, 22)}` : `flow`}
                  {coverage.length > 0 && <span style={{ opacity: 0.75 }}>· {coverage.filter((b) => b.state === "covered").length} covered</span>}
                </span>
              )}
              <span style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>{lastTool ?? "waiting for the first move"}</span>
              {streamUrl && (
                <a href={streamUrl} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--decor)", textDecoration: "none" }}>Open full screen</a>
              )}
            </div>

            {!isZoom && (
              <div className="th" style={{ marginBottom: 10 }}>
                Beat: {currentBeat !== null && stages[Math.min(currentBeat, stages.length) - 1] ? cleanBeat(stages[Math.min(currentBeat, stages.length) - 1].name) : "warming up"}
              </div>
            )}
            <div className="browser" style={{ boxShadow: "var(--shadow)", flexShrink: 0 }}>
              <div className="bar">
                {[0, 1, 2].map((i) => <span key={i} className="d" />)}
                <span className="url">{streamHost || "sandbox screen"}</span>
              </div>
              <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", background: "#05070d" }} title={controlling ? "You are driving — click and type inside the screen" : "Watching — the wheel scrolls this panel; hit Take control to interact"}>
                {streamUrl ? (
                  // While watching, the stream ignores the mouse so the wheel scrolls
                  // the panel (otherwise the iframe eats it and the top/bottom of the
                  // screen are unreachable). Take control makes it interactive.
                  <iframe src={streamUrl} title="sandbox screen" allow="autoplay" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", pointerEvents: controlling ? "auto" : "none" }} />
                ) : (
                  <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600, color: "var(--ink3)" }}>
                    The sandbox has not published a stream url for this session.
                  </div>
                )}
              </div>
            </div>

            <div className="voicebar" style={{ flexShrink: 0 }}>
              <span className="live-dot" />
              {liveAudioOn ? "Live audio from the sandbox" : hear ? `Voice on — you hear ${firstName}` : `${firstName} is muted`}
              <div className="wave">
                <span style={{ animationDelay: "0s" }} />
                <span style={{ animationDelay: ".15s" }} />
                <span style={{ animationDelay: ".3s" }} />
                <span style={{ animationDelay: ".15s" }} />
                <span style={{ animationDelay: "0s" }} />
              </div>
              <span className="mut" style={{ marginLeft: "auto", fontSize: 12 }}>{firstName}, real voice</span>
            </div>

            {/* script beat strip */}
            <div style={{ background: "var(--card)", borderRadius: 18, boxShadow: "var(--shadow)", padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800 }}>Script</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink3)" }}>
                  {stages.length ? `${stages.length} beat${stages.length === 1 ? "" : "s"} · graph v${graphVersion}` : `graph v${graphVersion}`}
                </span>
                {dropNote && <span style={{ fontSize: 10.5, fontWeight: 700, color: dropNote.startsWith("Drop failed") ? "var(--error-ink)" : "var(--success-ink)" }}>{dropNote}</span>}
                <button onClick={() => { setReshapeOpen(true); setReshapeProp(null); setReshapeErr(""); }} style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "var(--purple-ink)", background: "none", border: "none", ...btnFont }}>Reshape by instruction</button>
                <button onClick={() => nav("screenmap")} style={{ fontSize: 11, fontWeight: 700, color: "var(--decor)", background: "none", border: "none", ...btnFont }}>Edit storyboard</button>
              </div>
              {stages.length === 0 ? (
                <div style={{ fontSize: 11.5, color: "var(--ink3)", padding: "6px 2px" }}>No call graph yet. Build one in the screen map and the beats show up here.</div>
              ) : (
                <div className="pds-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                  {stages.map((s, i) => {
                    const say = (s.voice?.objective ?? "").trim();
                    const acts = (s.screen?.actions ?? []).slice(0, 3);
                    const st = beatState(i);
                    const isCurrent = st === "now";
                    const isDone = st === "covered";
                    return (
                      <div key={s.id ?? i} onClick={(e) => setBeatMenu({ i, x: e.clientX, y: e.clientY })} title="Jump him here · edit · drop" ref={isCurrent ? (el) => el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }) : undefined} style={{ minWidth: 196, borderRadius: 13, padding: "10px 12px", background: isCurrent ? "var(--purple-soft)" : "var(--sunk)", border: isCurrent ? "1.5px solid var(--purple)" : "1px solid var(--divider)", flexShrink: 0, opacity: isDone ? 0.55 : 1, boxShadow: isCurrent ? "0 6px 18px rgba(163,66,255,.25)" : "none", cursor: "pointer" }}>
                        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: isCurrent ? "var(--purple-ink)" : "var(--ink3)", marginBottom: 5, display: "flex", alignItems: "center", gap: 5 }}>
                          {isDone && <span className="material-symbols-rounded" style={{ fontSize: 12, color: "var(--success-ink)" }}>check_circle</span>}
                          {isCurrent && <span className="rr-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "rrPulse 1.6s ease infinite" }} />}
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i + 1} · {cleanBeat(s.name)}</span>
                          <button onClick={(e) => { e.stopPropagation(); void dropBeat(i); }} disabled={dropping} title="Drop this beat — he stops doing it, live prompt recompiles" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, height: 16, padding: dropArm === i ? "0 7px" : "0 3px", borderRadius: 9999, border: "none", background: dropArm === i ? "var(--error-soft)" : "transparent", color: dropArm === i ? "var(--error-ink)" : "var(--ink3)", cursor: "pointer", fontFamily: "inherit", fontSize: 9, fontWeight: 800 }}>
                            {dropArm === i ? "Drop?" : <span className="material-symbols-rounded" style={{ fontSize: 12 }}>close</span>}
                          </button>
                        </div>
                        <div style={{ fontSize: 10.5, lineHeight: 1.45, color: "var(--ink2)", marginBottom: 6 }}>
                          <b style={{ fontWeight: 800, color: "var(--ink3)", fontSize: 8.5, letterSpacing: ".07em" }}>SAY</b> {say || "no voice objective yet"}
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--purple-ink)", fontWeight: 600 }}>
                          <b style={{ fontWeight: 800, color: "var(--ink3)", fontSize: 8.5, letterSpacing: ".07em" }}>SHOW</b> {acts.length ? acts.map(prettyTool).join(" → ") : "— talk only"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ---------- beat menu: rehearse-from-here / edit / drop ---------- */}
      {beatMenu && (
        <>
          <div onClick={() => setBeatMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div style={{ position: "fixed", left: Math.min(beatMenu.x, window.innerWidth - 250), top: Math.min(beatMenu.y + 8, window.innerHeight - 170), zIndex: 61, width: 236, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 16px 42px rgba(0,0,0,.45)", padding: 6, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)", padding: "7px 10px 5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Beat {beatMenu.i + 1} · {cleanBeat(stages[beatMenu.i]?.name)}
            </div>
            {bound && live && (
              <button
                onClick={() => { const i = beatMenu.i; setBeatMenu(null); void jumpLive(i); }}
                disabled={!agentId}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 9, border: "none", background: "transparent", color: "var(--purple-ink)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>skip_next</span>
                Jump {firstName} to this beat
              </button>
            )}
            <button onClick={() => { setBeatMenu(null); nav("screenmap"); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 9, border: "none", background: "transparent", color: "var(--ink1)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>edit_note</span>
              Edit in storyboard
            </button>
            <button
              onClick={async () => { const armed = dropArm === beatMenu.i; await dropBeat(beatMenu.i); if (armed) setBeatMenu(null); }}
              disabled={dropping}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 9, border: "none", background: dropArm === beatMenu.i ? "var(--error-soft)" : "transparent", color: "var(--error-ink)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>close</span>
              {dropArm === beatMenu.i ? "Sure? Drop it for good" : "Drop this beat"}
            </button>
            {(() => {
              const st = stages[beatMenu.i];
              const says = Array.isArray(st?.voice?.exampleLines) ? (st?.voice?.exampleLines as string[]) : [];
              const shows = st?.screen?.actions ?? [];
              if (!says.length && !shows.length) return null;
              const row = (kind: "say" | "show", text: string, j: number) => {
                const key = `${beatMenu.i}:${kind}:${j}`;
                const armed = stepRmArm === key;
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 10px" }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 14, color: kind === "say" ? "var(--ink3)" : "var(--purple-ink)", flexShrink: 0 }}>{kind === "say" ? "record_voice_over" : "web"}</span>
                    <span title={text} style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "var(--ink2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
                    <button onClick={() => void removeStep(beatMenu.i, kind, j)} disabled={stepBusy} title="Erase this step — click twice" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, border: "none", borderRadius: 9999, padding: armed ? "1px 8px" : "1px 3px", background: armed ? "var(--error-soft)" : "transparent", color: armed ? "var(--error-ink)" : "var(--ink3)", cursor: "pointer", fontFamily: "inherit", fontSize: 9.5, fontWeight: 800 }}>
                      {armed ? "Erase?" : <span className="material-symbols-rounded" style={{ fontSize: 13 }}>delete</span>}
                    </button>
                  </div>
                );
              };
              return (
                <>
                  <div style={{ borderTop: "1px solid var(--divider)", margin: "5px 0 2px" }} />
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)", padding: "4px 10px 2px" }}>Steps in this beat</div>
                  <div className="pds-scroll" style={{ maxHeight: 170, overflowY: "auto" }}>
                    {says.map((t, j) => row("say", t, j))}
                    {shows.map((t, j) => row("show", t, j))}
                  </div>
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* ---------- fix drawer ---------- */}
      <div onClick={closeFix} style={{ position: "fixed", inset: 0, background: "rgba(2,2,20,.55)", opacity: fix ? 1 : 0, pointerEvents: fix ? "auto" : "none", transition: "opacity .2s", zIndex: 40 }} />
      <aside aria-label="Fix this moment" style={{ position: "fixed", top: 0, right: fix ? 0 : -460, width: 440, height: "100vh", background: "var(--card)", boxShadow: "-18px 0 48px rgba(0,0,0,.5)", zIndex: 50, transition: "right .25s ease", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 20px 12px", borderBottom: "1px solid var(--divider)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-.01em" }}>Fix this moment</span>
          <span style={versionPill}>{fix?.kind === "speech" ? "speech" : "screen"}</span>
          <button onClick={closeFix} style={{ marginLeft: "auto", width: 36, height: 36, borderRadius: 10, border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "grid", placeItems: "center", ...btnFont }}>
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>
        {fix && (
          <div className="pds-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            {/* the moment */}
            <div style={{ background: "var(--sunk)", borderRadius: 13, padding: "12px 14px" }}>
              {fix.guest && (
                <div style={{ display: "flex", gap: 8, fontSize: 11.5, lineHeight: 1.5, marginBottom: 7 }}>
                  <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)", width: 44, paddingTop: 2 }}>Guest</span>
                  <span>{fix.guest}</span>
                </div>
              )}
              {fix.maya && (
                <div style={{ display: "flex", gap: 8, fontSize: 11.5, lineHeight: 1.5, marginBottom: 7 }}>
                  <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)", width: 44, paddingTop: 2 }}>{firstName}</span>
                  <span>"{fix.maya}"</span>
                </div>
              )}
              {fix.action && (
                <div style={{ display: "flex", gap: 8, fontSize: 11.5, lineHeight: 1.5 }}>
                  <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)", width: 44, paddingTop: 2 }}>Screen</span>
                  <span style={{ color: "var(--purple-ink)", fontWeight: 600 }}>▸ {fix.action}</span>
                </div>
              )}
              {fix.shot !== undefined && (
                <div style={{ borderRadius: 9, border: "1px solid var(--border)", overflow: "hidden", marginTop: 9, background: "var(--ghost)" }}>
                  {shotUrl ? (
                    <img src={shotUrl} alt="screen at this moment" style={{ display: "block", width: "100%", maxHeight: 160, objectFit: "cover" }} />
                  ) : (
                    <div style={{ height: 64, display: "flex", alignItems: "center", padding: "0 12px", fontSize: 10, color: "var(--ink3)", fontWeight: 700 }}>loading the screenshot…</div>
                  )}
                  <div style={{ padding: "5px 12px", fontSize: 10, color: "var(--ink3)", fontWeight: 700 }}>screen at this moment</div>
                </div>
              )}
            </div>

            {/* route toggle */}
            <div style={{ display: "flex", gap: 6 }}>
              {(["speech", "screen"] as const).map((r) => (
                <button key={r} onClick={() => { setRoute(r); setProposal(null); setFixErr(null); }} style={{ flex: 1, height: 36, borderRadius: 9999, border: route === r ? "1.5px solid var(--purple)" : "1.5px solid var(--border)", background: route === r ? "var(--purple-soft)" : "transparent", color: route === r ? "var(--purple-ink)" : "var(--ink2)", fontSize: 11.5, fontWeight: 800, ...btnFont }}>
                  {r === "speech" ? "Speech · persona" : "Screen · graph"}
                </button>
              ))}
            </div>

            {/* demonstrate instead: freeze him, drive the screen, the recorded
                click path lands back in THIS fix's note on hand-back */}
            {route === "screen" && bound && (
              <button onClick={() => void takeControlForFix()} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 38, borderRadius: 9999, border: "1.5px dashed var(--decor)", background: "rgba(0,187,255,.07)", color: "var(--decor)", fontSize: 12, fontWeight: 800, ...btnFont }}>
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>back_hand</span>
                Don't type it — take the screen and show him
              </button>
            )}

            {/* note */}
            <div>
              <div style={{ ...dlabel, marginBottom: 7 }}>Your note</div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder={route === "speech" ? `What should ${firstName} have said differently here?` : "What should the screen have done differently here?"}
                style={{ width: "100%", boxSizing: "border-box", background: "var(--sunk)", border: "1px solid var(--border)", borderRadius: 13, padding: "10px 13px", fontSize: 11.5, lineHeight: 1.5, color: "var(--ink1)", fontFamily: "inherit", resize: "vertical", outline: "none" }}
              />
            </div>

            {/* proposal */}
            {proposal && route === "screen" && (
              <div>
                <div style={{ ...dlabel, marginBottom: 7 }}>Change to graph{proposal.stageName ? ` · ${proposal.stageName}` : ""}</div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ background: "var(--diff-del)", padding: "9px 13px" }}>
                    <div style={{ fontSize: 8.5, fontWeight: 800, marginBottom: 2, color: "var(--error-ink)" }}>− BEFORE</div>
                    <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--ink1)", margin: 0 }}>{listify(proposal.before) || "no actions on this beat"}</p>
                  </div>
                  <div style={{ background: "var(--diff-add)", padding: "9px 13px" }}>
                    <div style={{ fontSize: 8.5, fontWeight: 800, marginBottom: 2, color: "var(--success-ink)" }}>+ AFTER</div>
                    <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--ink1)", margin: 0 }}>{listify(proposal.after) || proposal.summary || "no change proposed"}</p>
                  </div>
                </div>
                <p style={{ marginTop: 8, marginBottom: 0, fontSize: 10.5, color: "var(--ink3)", lineHeight: 1.5 }}>Applies to every future call and rehearsal on this graph. Provenance: rehearsal, {new Date().toLocaleDateString()}.</p>
              </div>
            )}
            {proposal && route === "speech" && (
              <div>
                <div style={{ ...dlabel, marginBottom: 7 }}>Change to persona</div>
                {proposal.summary && <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--ink1)", marginBottom: 8 }}>{proposal.summary}</div>}
                {Boolean(proposal.before || proposal.after) && (
                  <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 8 }}>
                    <div style={{ background: "var(--diff-del)", padding: "9px 13px" }}>
                      <div style={{ fontSize: 8.5, fontWeight: 800, marginBottom: 2, color: "var(--error-ink)" }}>− BEFORE</div>
                      <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--ink1)", margin: 0 }}>{listify(proposal.before)}</p>
                    </div>
                    <div style={{ background: "var(--diff-add)", padding: "9px 13px" }}>
                      <div style={{ fontSize: 8.5, fontWeight: 800, marginBottom: 2, color: "var(--success-ink)" }}>+ AFTER</div>
                      <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--ink1)", margin: 0 }}>{listify(proposal.after)}</p>
                    </div>
                  </div>
                )}
                <div className="pds-scroll" style={{ background: "var(--sunk)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 13px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10, lineHeight: 1.55, color: "var(--ink2)", whiteSpace: "pre-wrap", maxHeight: 180, overflowY: "auto" }}>
                  {JSON.stringify(proposal.delta ?? proposal, null, 2)}
                </div>
                <p style={{ marginTop: 8, marginBottom: 0, fontSize: 10.5, color: "var(--ink3)", lineHeight: 1.5 }}>Compiles into the next persona version. Provenance: rehearsal, {new Date().toLocaleDateString()}.</p>
              </div>
            )}
            {fixErr && <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--error-ink)" }}>{fixErr}</div>}
          </div>
        )}
        <div style={{ padding: "14px 20px 18px", borderTop: "1px solid var(--divider)", display: "flex", gap: 9 }}>
          <button onClick={closeFix} style={{ ...ghostBtn, flex: 1, height: 44 }}>Skip</button>
          <button onClick={() => void fixNow()} disabled={!note.trim() || proposing || applying} style={{ flex: 1, height: 44, borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 800, boxShadow: "0 8px 24px rgba(255,6,96,.3)", opacity: !note.trim() || proposing || applying ? 0.6 : 1, ...btnFont }}>
            {proposing ? "Thinking…" : applying ? "Applying…" : route === "screen" ? `Fix it now → graph v${graphVersion + 1}` : `Fix it now → persona v${(personaVersion ?? 0) + 1}`}
          </button>
        </div>
      </aside>
    </div>
  );
}
