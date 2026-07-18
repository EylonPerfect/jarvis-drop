import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { api, getAccessKey } from "../api/client";
import "../pds.css";

// ============================================================
// Pre-call check — Perfect Design System 2026
// (from Pre-Call Check.dc.html). A fast pre-call gate that runs
// REAL checks: provider reachable (GET /api/agents), golden
// version pinned (GET versions), persona present, playbook
// present, voice configured (with a live voice test via
// POST /api/voice/speak). Any failure blocks the Join button.
// Join is REAL: paste a Zoom link or meeting id, POST
// /api/live/join, then follow the phase progression from
// GET /api/live/status until Maya is live on the call.
// ============================================================

type PersonaVoice = { elevenlabs_voice_id?: string };
type Persona = { identity?: unknown; voice?: PersonaVoice };
type Agent = {
  id: string; name: string; role?: string; icon?: string; status?: string;
  buildTrack?: string; persona?: Persona; golden_persona_id?: string; voice_id?: string;
};
type VersionRow = { id: string; number: number };
type PlaybookStage = { id: string; name: string };

type CheckState = "pass" | "fail" | "running";
type Check = { key: string; label: string; detail: string; state: CheckState; fixView?: string; canTestVoice?: boolean };

type LivePhase = { t: number; phase: string; detail?: string };
type LiveCall = {
  id: string; agent_id: string; meeting_id: string; mode: string; phase: string;
  sandbox_id?: string | null; stream_url?: string | null;
  phases: LivePhase[]; started_at: number | string; ended_at?: number | string | null;
};
type LiveStatus = { call: LiveCall | null };

const PHASE_LABELS: Record<string, string> = {
  sandbox: "Spinning up the sandbox",
  audio_ready: "Audio pipeline ready",
  stream: "Screen stream up",
  chrome_launched: "Chrome launched",
  zoom_installed: "Zoom installed",
  join_clicked: "Joining the Zoom meeting",
  waiting_admission: "Waiting for you to ADMIT {name} in Zoom",
  admitted: "Admitted to the meeting",
  auto_login: "Logging in to the demo account",
  logged_in: "Logged in",
  snapshotted: "Snapshot saved",
  bridge_up: "Voice bridge up",
  shared_verified: "Screen share verified",
  unmuted_verified: "Mic is live",
  ready: "{name} is live on the call",
};
const READY_PHASES = new Set(["ready", "shared_verified", "unmuted_verified"]);

/** Digits of a Zoom meeting id, from a raw id or a pasted link. */
function parseMeetingId(raw: string): string {
  const j = raw.match(/\/j\/(\d+)/); // zoom.us/j/123456789
  if (j) return j[1];
  const runs = raw.replace(/[\s-]/g, "").match(/\d+/g) ?? [];
  const best = runs.reduce((a, b) => (b.length > a.length ? b : a), "");
  return best.length >= 8 ? best : "";
}

const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
const initials = (n: string) => n.split(/\s+/).map((w) => w.charAt(0)).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

const CHECK_LOOK: Record<CheckState, { icon: string; iconColor: string; detailColor: string }> = {
  pass: { icon: "check_circle", iconColor: "var(--success-ink)", detailColor: "var(--ink2)" },
  fail: { icon: "cancel", iconColor: "var(--error-ink)", detailColor: "var(--error-ink)" },
  running: { icon: "progress_activity", iconColor: "var(--purple)", detailColor: "var(--ink3)" },
};

const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

const PENDING: Check[] = [
  { key: "provider", label: "Provider reachable", detail: "Checking the agents API…", state: "running" },
  { key: "golden", label: "Live version", detail: "Checking versions…", state: "running" },
  { key: "persona", label: "Persona present", detail: "Checking the persona spec…", state: "running" },
  { key: "playbook", label: "Playbook present", detail: "Checking call stages…", state: "running" },
  { key: "voice", label: "Voice configured", detail: "Checking the voice id…", state: "running" },
];

export default function PreCallCheck() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [checks, setChecks] = useState<Check[]>(PENDING);
  const [checking, setChecking] = useState(true);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [joinNote, setJoinNote] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const voiceIdRef = useRef<string>("");
  const [meetingInput, setMeetingInput] = useState("");
  const [joinState, setJoinState] = useState<"idle" | "joining" | "live" | "conflict">("idle");
  const [liveCall, setLiveCall] = useState<LiveCall | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const startStatusPolling = useCallback(() => {
    stopPolling();
    const tick = async () => {
      try {
        const s = await api.get<LiveStatus>("/api/live/status");
        setLiveCall(s.call);
        if (!s.call || s.call.ended_at) { stopPolling(); setJoinState("idle"); return; }
        if (READY_PHASES.has(s.call.phase)) { stopPolling(); setLiveCall(s.call); setJoinState("live"); }
      } catch { /* transient poll failure; keep trying */ }
    };
    void tick();
    pollRef.current = setInterval(() => void tick(), 3000);
  }, [stopPolling]);

  const joinCall = useCallback(async (override: boolean) => {
    const meetingId = parseMeetingId(meetingInput);
    if (!meetingId) { setJoinNote("Paste a Zoom link or a meeting id (digits) first."); return; }
    setJoinNote(override ? "Override logged for review · joining anyway." : null);
    setJoinState("joining");
    setLiveCall(null);
    try {
      const agentId = agent?.id || localStorage.getItem("pds_agent") || undefined;
      await api.post<{ callId: string }>("/api/live/join", { meetingId, ...(agentId ? { agentId } : {}) });
      startStatusPolling();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("409")) { setJoinState("conflict"); }
      else { setJoinState("idle"); setJoinNote(`Join failed (${msg}). Check the meeting id and try again.`); }
    }
  }, [agent, meetingInput, startStatusPolling]);

  const runChecks = useCallback(async () => {
    setChecking(true);
    setJoinNote(null);
    setChecks(PENDING);
    const t0 = performance.now();

    let list: Agent[] = [];
    let providerOk = false;
    try {
      list = await api.get<Agent[]>("/api/agents");
      providerOk = true;
    } catch { providerOk = false; }

    const stored = localStorage.getItem("pds_agent");
    const a = list.find((x) => x.id === stored) ?? list[0] ?? null;
    setAgent(a);
    if (a) localStorage.setItem("pds_agent", a.id);

    let goldenId: string | null = a?.golden_persona_id ?? null;
    let goldenNumber: number | null = null;
    let stageCount = 0;
    if (a) {
      const [ver, pb] = await Promise.all([
        api.get<{ versions: VersionRow[]; goldenVersionId: string | null }>(`/api/clones/${a.id}/versions`).catch(() => null),
        api.get<{ playbook: { stages: PlaybookStage[] } }>(`/api/clones/${a.id}/playbook`).catch(() => null),
      ]);
      if (ver) {
        goldenId = ver.goldenVersionId ?? goldenId;
        goldenNumber = ver.versions.find((v) => v.id === goldenId)?.number ?? null;
      }
      stageCount = pb?.playbook?.stages?.length ?? 0;
    }

    const hasPersona = !!a?.persona?.identity;
    const voiceId = a?.voice_id || a?.persona?.voice?.elevenlabs_voice_id || "";
    voiceIdRef.current = voiceId;

    const next: Check[] = [
      providerOk
        ? { key: "provider", label: "Provider reachable", detail: `Agents API responding · ${list.length} agent${list.length === 1 ? "" : "s"}`, state: "pass" }
        : { key: "provider", label: "Provider reachable", detail: "Agents API not responding", state: "fail", fixView: "agentshome" },
      goldenId
        ? { key: "golden", label: "Live version", detail: goldenNumber ? `persona v${goldenNumber} drives the live bridge` : "a live version is pinned", state: "pass" }
        : { key: "golden", label: "Live version", detail: a ? "no live version pinned · the live bridge has nothing to run" : "no clone selected", state: "fail", fixView: "pdsstudio" },
      hasPersona
        ? { key: "persona", label: "Persona present", detail: "identity extracted from source calls", state: "pass" }
        : { key: "persona", label: "Persona present", detail: a ? "no persona extracted yet" : "no clone selected", state: "fail", fixView: "pdsstudio" },
      stageCount > 0
        ? { key: "playbook", label: "Playbook present", detail: `${stageCount} call stage${stageCount === 1 ? "" : "s"} ready`, state: "pass" }
        : { key: "playbook", label: "Playbook present", detail: a ? "no call playbook built yet" : "no clone selected", state: "fail", fixView: "pdsstudio" },
      voiceId
        ? { key: "voice", label: "Voice configured", detail: "voice id set · play a live sample to confirm", state: "pass", canTestVoice: true }
        : { key: "voice", label: "Voice configured", detail: a ? "no voice id on the agent or persona" : "no clone selected", state: "fail", fixView: "pdsstudio" },
    ];
    setChecks(next);
    setElapsedMs(performance.now() - t0);
    setChecking(false);
  }, []);

  useEffect(() => { void runChecks(); }, [runChecks]);

  // Adopt a join that's already in flight (the roster's "Test on Zoom" POSTs
  // /api/live/join BEFORE navigating here) — never ask for the link twice.
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current) return;
    adopted.current = true;
    void (async () => {
      try {
        const s = await api.get<LiveStatus>("/api/live/status");
        const c = s.call;
        if (!c || c.ended_at || c.mode === "rehearsal") return;
        setMeetingInput(c.meeting_id || "");
        setLiveCall(c);
        setJoinState(READY_PHASES.has(c.phase) ? "live" : "joining");
        if (!READY_PHASES.has(c.phase)) startStatusPolling();
      } catch { /* no active call — show the normal join form */ }
    })();
  }, [startStatusPolling]);

  async function testVoice() {
    if (speaking) return;
    setSpeaking(true);
    try {
      const key = getAccessKey();
      const res = await fetch(`${api.base}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { "X-API-Key": key } : {}) },
        body: JSON.stringify({ text: `Hi, this is ${agent?.name ?? "the clone"}. Quick voice check before the call.`, voiceId: voiceIdRef.current || undefined }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setSpeaking(false); };
      audio.onerror = () => { URL.revokeObjectURL(url); setSpeaking(false); };
      await audio.play();
    } catch {
      setSpeaking(false);
    }
  }

  const failing = checks.filter((c) => c.state === "fail").length;
  const allClear = !checking && failing === 0;

  const themeIcon = theme === "dark" ? "light_mode" : "dark_mode";
  const sourceGrad = theme === "dark"
    ? "radial-gradient(circle at 30% 30%, rgba(255,6,96,.4), rgba(163,66,255,.35))"
    : "radial-gradient(circle at 30% 30%, #FFE0EB, #F1E3FF)";

  const meetingId = parseMeetingId(meetingInput);
  const joining = joinState === "joining";
  const joinedLive = joinState === "live";
  const firstName = agent?.name?.split(/\s+/)[0] || "the agent";
  const withName = (label: string) => label.replace("{name}", firstName);
  const seenPhases = liveCall?.phases ?? [];
  const currentPhase = liveCall?.phase ?? "";
  const waitingAdmission = joining && currentPhase === "waiting_admission";

  return (
    <div className="pds pds-scroll" data-theme={theme} style={{ height: "100%", overflowY: "auto", background: "radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--bg) 88%, var(--purple)), var(--bg) 60%)", display: "flex", flexDirection: "column", alignItems: "center", padding: "26px 20px 50px" }}>
      <style>{"@keyframes pdsSpin { to { transform: rotate(360deg); } }"}</style>
      <div style={{ width: "100%", maxWidth: 580, display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <button onClick={() => nav("agentshome")} style={{ width: 36, height: 36, borderRadius: 10, border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }} aria-label="Back">
          <span className="material-symbols-rounded" style={{ fontSize: 22 }}>arrow_back</span>
        </button>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => void runChecks()} disabled={checking} style={{ height: 32, padding: "0 13px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink2)", fontSize: 12, fontWeight: 700, opacity: checking ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6, ...btnFont }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, animation: checking ? "pdsSpin 1s linear infinite" : undefined }}>refresh</span>
            {checking ? "Checking…" : "Run again"}
          </button>
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }} aria-label="Toggle theme">
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>{themeIcon}</span>
          </button>
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 580, background: "var(--card)", borderRadius: 24, boxShadow: "var(--shadow)", overflow: "hidden" }}>
        <div style={{ padding: "26px 28px", borderBottom: "1px solid var(--divider)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--purple-ink)" }}>
            Pre-call check · 60 seconds{elapsedMs != null ? ` · ran in ${(elapsedMs / 1000).toFixed(1)}s` : ""}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
            <div style={{ width: 46, height: 46, borderRadius: "50%", background: sourceGrad, color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15 }}>{agent ? initials(agent.name) : "—"}</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{agent ? `${agent.name} is joining a call` : checking ? "Finding the clone…" : "No clone selected"}</div>
              <div style={{ fontSize: 13, color: "var(--ink2)" }}>{agent ? `${agent.role ? `${agent.role} · ` : ""}checks run against the live agent config · paste a Zoom meeting below to join` : "create a clone first, then run this gate"}</div>
            </div>
          </div>
        </div>

        <div style={{ padding: "10px 28px" }}>
          {checks.map((c) => {
            const look = CHECK_LOOK[c.state];
            return (
              <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 0", borderBottom: "1px solid var(--divider)" }}>
                <span className="material-symbols-rounded" style={{ fontSize: 26, color: look.iconColor, fontVariationSettings: "'FILL' 1", animation: c.state === "running" ? "pdsSpin 1s linear infinite" : undefined }}>{look.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{c.label}</div>
                  <div style={{ fontSize: 12.5, color: look.detailColor, marginTop: 2 }}>{c.detail}</div>
                </div>
                {c.canTestVoice && (
                  <button onClick={() => void testVoice()} disabled={speaking} style={{ display: "flex", alignItems: "center", gap: 5, height: 34, padding: "0 12px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink1)", fontSize: 12, fontWeight: 700, opacity: speaking ? 0.6 : 1, ...btnFont }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16, color: "var(--purple)" }}>volume_up</span>
                    {speaking ? "Playing…" : "Test voice"}
                  </button>
                )}
                {c.state === "fail" && c.fixView && (
                  <button onClick={() => nav(c.fixView as string)} style={{ height: 34, padding: "0 14px", borderRadius: 9999, border: "none", background: "var(--error-soft)", color: "var(--error-ink)", fontSize: 12.5, fontWeight: 700, ...btnFont }}>Fix now</button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ padding: "22px 28px", background: "var(--sunk)" }}>
          {!checking && (joinState === "idle" || joinState === "conflict") && (
            <div style={{ position: "relative", marginBottom: 14 }}>
              <span className="material-symbols-rounded" style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 19, color: "var(--ink3)" }}>videocam</span>
              <input
                value={meetingInput}
                onChange={(e) => setMeetingInput(e.target.value)}
                placeholder="Paste a Zoom link or meeting id…"
                style={{ width: "100%", boxSizing: "border-box", height: 48, padding: "0 16px 0 44px", borderRadius: 14, border: `1px solid ${meetingInput && !meetingId ? "var(--error-ink)" : "var(--border)"}`, background: "var(--card)", color: "var(--ink1)", fontSize: 13.5, outline: "none", fontFamily: "inherit" }}
              />
              {meetingId && <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 11.5, fontWeight: 700, color: "var(--success-ink)" }}>meeting {meetingId}</span>}
            </div>
          )}
          {checking && (
            <div style={{ display: "flex", alignItems: "center", gap: 9, height: 54, borderRadius: 9999, background: "var(--track)", color: "var(--ink3)", justifyContent: "center", fontSize: 16, fontWeight: 800, letterSpacing: ".02em" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 22, animation: "pdsSpin 1s linear infinite" }}>progress_activity</span>Running checks…
            </div>
          )}
          {!checking && joinState === "idle" && allClear && (
            <button onClick={() => void joinCall(false)} disabled={!meetingId} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 9, height: 54, borderRadius: 9999, background: meetingId ? "var(--accent)" : "var(--track)", color: meetingId ? "#fff" : "var(--ink3)", border: "none", fontSize: 16, fontWeight: 800, letterSpacing: ".02em", boxShadow: meetingId ? "0 8px 24px rgba(255,6,96,.3)" : "none", cursor: meetingId ? "pointer" : "default", fontFamily: "inherit" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 22 }}>videocam</span>{meetingId ? "Join call" : "Paste a meeting to join"}
            </button>
          )}
          {!checking && joinState === "idle" && !allClear && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 9, height: 54, borderRadius: 9999, background: "var(--track)", color: "var(--ink3)", justifyContent: "center", fontSize: 16, fontWeight: 800, letterSpacing: ".02em" }}>
                <span className="material-symbols-rounded" style={{ fontSize: 22 }}>lock</span>Join blocked · {failing} check{failing === 1 ? "" : "s"} failing
              </div>
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button onClick={() => void joinCall(true)} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink2)", background: "transparent", border: "none", textDecoration: "underline", ...btnFont }}>
                  Override and join anyway · logged for review
                </button>
              </div>
            </>
          )}
          {joining && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12, fontSize: 15, fontWeight: 800, color: "var(--ink1)" }}>
                <span className="material-symbols-rounded" style={{ fontSize: 22, color: "var(--purple)", animation: "pdsSpin 1s linear infinite" }}>progress_activity</span>
                {withName(PHASE_LABELS[currentPhase] ?? (currentPhase ? currentPhase.replace(/_/g, " ") : `${firstName} is joining the call…`))}
              </div>
              {waitingAdmission && (
                <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 12, background: "var(--warning-soft)", color: "var(--warning-ink)", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 19 }}>front_hand</span>
                  Waiting for you to ADMIT {firstName} in Zoom — open the meeting and let them in.
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {seenPhases.map((p, i) => {
                  const isLast = i === seenPhases.length - 1;
                  return (
                    <div key={`${p.phase}-${p.t}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: isLast ? "var(--ink1)" : "var(--ink3)", fontWeight: isLast ? 700 : 500 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 16, color: isLast ? "var(--purple)" : "var(--success-ink)" }}>{isLast ? "arrow_forward" : "check"}</span>
                      {withName(PHASE_LABELS[p.phase.toLowerCase()] ?? p.phase.replace(/_/g, " "))}
                    </div>
                  );
                })}
                {seenPhases.length === 0 && <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>Contacting the live bridge…</div>}
              </div>
            </div>
          )}
          {joinedLive && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14, fontSize: 15.5, fontWeight: 800, color: "var(--success-ink)" }}>
                <span className="material-symbols-rounded" style={{ fontSize: 24, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                {firstName} is live on meeting {liveCall?.meeting_id ?? meetingId}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {/* one cockpit: full room on desktop, thin remote on a phone */}
                <button onClick={() => nav("rehearsal")} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 48, borderRadius: 9999, background: "var(--accent)", color: "#fff", border: "none", fontSize: 14, fontWeight: 800, ...btnFont }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 19 }}>tune</span>Open the cockpit
                </button>
                {liveCall?.stream_url && (
                  <a href={liveCall.stream_url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, height: 48, padding: "0 18px", borderRadius: 9999, color: "var(--ink1)", border: "1px solid var(--border)", fontSize: 13, fontWeight: 800, textDecoration: "none", ...btnFont }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 18 }}>present_to_all</span>Watch stream
                  </a>
                )}
              </div>
            </div>
          )}
          {joinState === "conflict" && (
            <div style={{ padding: "12px 14px", borderRadius: 12, background: "var(--warning-soft)", color: "var(--warning-ink)", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 19 }}>phone_in_talk</span>
              A call is already active.
              <button onClick={() => nav("rehearsal")} style={{ fontSize: 13, fontWeight: 800, color: "var(--warning-ink)", background: "transparent", border: "none", textDecoration: "underline", ...btnFont }}>Open the cockpit</button>
            </div>
          )}
          {joinNote && (
            <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--ink2)", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 14px", display: "flex", alignItems: "flex-start", gap: 8, lineHeight: 1.45 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 17, color: "var(--purple)", marginTop: 1 }}>info</span>
              {joinNote}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
