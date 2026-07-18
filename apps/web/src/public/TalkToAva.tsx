import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Icon, type Nav } from "./PublicChrome";

// ============================================================
// After Human — "Talk to Ava" public live demo. The hero flow:
// a prospect clicks "Talk to Ava" and lands in a live voice +
// screen demo driven by Ava (After Human's own cloned AI rep).
//
// This is a full-screen, self-scoped (.ah-public) Demo Mode
// takeover mounted by PublicSite at #/ava. It reuses the demo
// vocabulary the product already speaks — the pulsing voice orb,
// the waveform, and the .browser frame that embeds the live E2B
// screen stream via <iframe src={streamUrl} allow="autoplay">
// (identical to RehearsalRoom's live stage) — recast into the
// public site's scoped tokens so no product style is touched.
//
// It is UNAUTHENTICATED (public demo endpoints need no key) and
// builds to this exact contract (another workstream ships it):
//   POST /api/demo/start                -> { sessionId, status:"ready"|"queued", streamUrl?, queuePosition?, expiresAt }
//   GET  /api/demo/:sessionId/status    -> { status:"connecting"|"live"|"ended"|"expired", streamUrl, remainingSec, transcript? }
//   POST /api/demo/:sessionId/say {text}
//   POST /api/demo/:sessionId/end       -> { endedAt }
//   POST /api/demo/:sessionId/lead {email} -> { ok }
//
// Email capture is at the END only — the demo is never gated
// behind it. Every state (connecting, queued, live, mid-demo
// death, pool-full/error, end) has a graceful, on-brand surface.
// ============================================================

// --- API contract types --------------------------------------------------
type StartResp = {
  sessionId: string;
  status: "ready" | "queued";
  streamUrl?: string;
  queuePosition?: number;
  expiresAt?: string;
};
type StatusResp = {
  status: "connecting" | "live" | "ended" | "expired";
  streamUrl?: string;
  remainingSec?: number;
  transcript?: RawTurn[];
};
type RawTurn = { role?: string; speaker?: string; who?: string; text?: string; content?: string };
type Turn = { ava: boolean; text: string };

// Dedicated, decoupled fetch for the PUBLIC demo endpoints. It deliberately
// does NOT go through api/client.ts: those endpoints are unauthenticated, and
// we must never send/clear the product access key or bounce a signed-in visitor
// to the login gate from the public marketing site. Same-origin relative paths
// mirror production (web + /api are served together).
async function demoFetch<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body != null ? { "Content-Type": "application/json" } : {},
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

// Normalize a transcript turn from whatever shape the backend sends.
function normalizeTurn(t: RawTurn): Turn {
  const label = (t.role || t.speaker || t.who || "").toLowerCase();
  const ava = /ava|assistant|agent|clone|rep|bot/.test(label);
  return { ava, text: (t.text || t.content || "").trim() };
}

type Phase = "connecting" | "queued" | "live" | "ended" | "error";
type EndReason = "user" | "expired" | "ended" | "died";

const PINK = "#FF0660";
const GREEN = "#2ED37D";

// Minimal SpeechRecognition typing (same browser API RehearsalRoom uses for
// mic capture). Kept local so we don't pull in product types.
type SR = { start: () => void; stop: () => void; abort: () => void; onresult: ((e: unknown) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; continuous: boolean; interimResults: boolean; lang: string };

export default function TalkToAva({ nav }: { nav: Nav }) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [streamUrl, setStreamUrl] = useState("");
  const [queuePos, setQueuePos] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [endReason, setEndReason] = useState<EndReason>("ended");
  const [errMsg, setErrMsg] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // email capture (END only)
  const [email, setEmail] = useState("");
  const [leadState, setLeadState] = useState<"idle" | "sending" | "done" | "error">("idle");

  const sessionRef = useRef<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failRef = useRef(0);
  const endedRef = useRef(false);
  const recRef = useRef<SR | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const finish = useCallback((reason: EndReason) => {
    if (endedRef.current) return;
    endedRef.current = true;
    stopPolling();
    try { recRef.current?.abort(); } catch { /* noop */ }
    setMicOn(false);
    setEndReason(reason);
    setPhase("ended");
  }, [stopPolling]);

  // Poll /status until live, then keep polling to refresh stream/remaining/
  // transcript. Tolerates transient failures; a run of them = session died.
  const poll = useCallback(async () => {
    const id = sessionRef.current;
    if (!id || endedRef.current) return;
    try {
      const s = await demoFetch<StatusResp>(`/api/demo/${id}/status`, "GET");
      failRef.current = 0;
      if (s.streamUrl) setStreamUrl(s.streamUrl);
      if (typeof s.remainingSec === "number") setRemaining(Math.max(0, Math.round(s.remainingSec)));
      if (Array.isArray(s.transcript)) setTranscript(s.transcript.map(normalizeTurn).filter((t) => t.text));
      if (s.status === "live") setPhase((p) => (p === "ended" || p === "error" ? p : "live"));
      else if (s.status === "connecting") setPhase((p) => (p === "queued" ? "queued" : "connecting"));
      else if (s.status === "ended") finish("ended");
      else if (s.status === "expired") finish("expired");
    } catch {
      failRef.current += 1;
      // A short blip is fine; a sustained run means the session died mid-demo.
      if (failRef.current >= 4) finish("died");
    }
  }, [finish]);

  // Kick off a session: POST /start, then begin polling.
  const start = useCallback(async () => {
    stopPolling();
    endedRef.current = false;
    failRef.current = 0;
    setErrMsg("");
    setTranscript([]);
    setRemaining(null);
    setQueuePos(null);
    setStreamUrl("");
    setPhase("connecting");
    try {
      const r = await demoFetch<StartResp>("/api/demo/start", "POST", {});
      sessionRef.current = r.sessionId;
      if (r.streamUrl) setStreamUrl(r.streamUrl);
      if (r.status === "queued") {
        setQueuePos(typeof r.queuePosition === "number" ? r.queuePosition : null);
        setPhase("queued");
      } else {
        setPhase("connecting");
      }
      // Begin polling (~2s) + a local 1s countdown between polls.
      pollRef.current = setInterval(poll, 2000);
      tickRef.current = setInterval(() => setRemaining((r2) => (r2 == null ? r2 : Math.max(0, r2 - 1))), 1000);
      poll();
    } catch {
      // Pool full, endpoint not live (dev), or network — one friendly surface
      // with a retry. Never a stack trace in front of a prospect.
      setErrMsg("Ava is at capacity right now. Give it a moment and try again.");
      setPhase("error");
    }
  }, [poll, stopPolling]);

  // Start on mount; clean up (and best-effort end) on unmount.
  useEffect(() => {
    start();
    return () => {
      stopPolling();
      try { recRef.current?.abort(); } catch { /* noop */ }
      const id = sessionRef.current;
      if (id && !endedRef.current) { demoFetch(`/api/demo/${id}/end`, "POST", {}).catch(() => {}); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll the transcript to the newest line.
  useEffect(() => {
    if (showTranscript) feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [transcript, showTranscript]);

  // --- prospect turns -----------------------------------------------------
  const say = useCallback(async (raw: string) => {
    const t = raw.trim();
    const id = sessionRef.current;
    if (!t || !id) return;
    // Optimistically show the prospect's line (backend echoes it in transcript).
    setTranscript((prev) => [...prev, { ava: false, text: t }]);
    setSending(true);
    try { await demoFetch(`/api/demo/${id}/say`, "POST", { text: t }); } catch { /* transient; poll will reconcile */ }
    setSending(false);
  }, []);

  const submitText = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    say(t);
  };

  // Mic capture via the browser SpeechRecognition API (same client the studio's
  // rehearsal uses). Each finalized phrase POSTs /say — which is also the
  // barge-in signal to the backend voice loop. Text input is the no-mic
  // fallback and is ALWAYS available.
  const toggleMic = useCallback(() => {
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) { setErrMsg("This browser can't capture your mic — type to Ava instead."); return; }
    if (micOn) { try { recRef.current?.stop(); } catch { /* noop */ } setMicOn(false); return; }
    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = "en-US";
      rec.onresult = (e: unknown) => {
        const ev = e as { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number };
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const phrase = ev.results[i][0]?.transcript;
          if (phrase) say(phrase);
        }
      };
      // The browser stops recognition after a silence; restart while mic is on.
      rec.onend = () => { if (recRef.current === rec && micOn) { try { rec.start(); } catch { /* noop */ } } };
      rec.onerror = () => { /* keep the session alive; the text box still works */ };
      recRef.current = rec;
      rec.start();
      setMicOn(true);
    } catch {
      setErrMsg("Couldn't start the mic — type to Ava instead.");
    }
  }, [micOn, say]);

  const endByUser = useCallback(() => {
    const id = sessionRef.current;
    if (id) demoFetch(`/api/demo/${id}/end`, "POST", {}).catch(() => {});
    finish("user");
  }, [finish]);

  const submitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = sessionRef.current;
    const em = email.trim();
    if (!em || leadState === "sending") return;
    setLeadState("sending");
    try {
      if (id) await demoFetch(`/api/demo/${id}/lead`, "POST", { email: em });
      setLeadState("done");
    } catch {
      // Don't strand the lead if the endpoint blips — treat as captured and let
      // them continue to signup (the signup flow re-collects the email anyway).
      setLeadState("done");
    }
  };

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const wrapUp = phase === "live" && remaining != null && remaining <= 30;

  return (
    <div
      className="ah-public"
      data-theme={nav.theme}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "var(--bg)", color: "var(--ink1)", display: "flex", flexDirection: "column" }}
      role="dialog"
      aria-modal="true"
      aria-label="Talk to Ava, After Human's live AI rep"
    >
      {/* Ambient brand glows (decorative) */}
      <div aria-hidden style={{ position: "absolute", top: -160, left: -120, width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,6,96,.14), transparent 70%)", pointerEvents: "none", animation: "ahpFloatA 9s ease-in-out infinite" }} />
      <div aria-hidden style={{ position: "absolute", top: -60, right: -80, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(163,66,255,.14), transparent 70%)", pointerEvents: "none", animation: "ahpFloatB 11s ease-in-out infinite" }} />

      {/* Top bar: identity, live status, countdown, close */}
      <header style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderBottom: "1px solid var(--divider)", background: "var(--nav-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/assets/afterhuman-mark.svg" alt="" style={{ width: 30, height: 30, display: "block" }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1 }}>Ava</div>
            <div style={{ fontSize: 11.5, color: "var(--ink3)", fontWeight: 500 }}>After Human's AI rep</div>
          </div>
        </div>
        <StatusPill phase={phase} endReason={endReason} />
        {phase === "live" && remaining != null && (
          <div title="Demo time remaining" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: wrapUp ? PINK : "var(--ink2)", padding: "5px 11px", borderRadius: 9999, border: "1px solid var(--border)" }}>
            <Icon name="timer" style={{ fontSize: 16 }} />{mmss(remaining)}
          </div>
        )}
        <button
          onClick={() => { const id = sessionRef.current; if (id && !endedRef.current) demoFetch(`/api/demo/${id}/end`, "POST", {}).catch(() => {}); stopPolling(); try { recRef.current?.abort(); } catch { /* noop */ } nav.go("#/"); }}
          title="Close the demo"
          aria-label="Close the demo and return to the site"
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 15px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink1)", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
        >
          <Icon name="close" style={{ fontSize: 18 }} />Close
        </button>
      </header>

      {/* Body */}
      <main style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px", overflowY: "auto" }}>
        {(phase === "connecting" || phase === "queued") && (
          <ConnectingView phase={phase} queuePos={queuePos} />
        )}

        {phase === "error" && (
          <RecoveryCard
            title="Ava couldn't pick up"
            body={errMsg || "We couldn't reach Ava right now."}
            onRetry={start}
            nav={nav}
          />
        )}

        {phase === "live" && (
          <LiveView
            streamUrl={streamUrl}
            transcript={transcript}
            showTranscript={showTranscript}
            setShowTranscript={setShowTranscript}
            feedRef={feedRef}
            wrapUp={wrapUp}
          />
        )}

        {phase === "ended" && (
          endReason === "died" ? (
            <RecoveryCard
              title="The demo dropped"
              body="Ava's session ended unexpectedly. It happens — start a fresh one and pick up where you left off."
              onRetry={start}
              nav={nav}
              secondary={
                <LeadCapture email={email} setEmail={setEmail} leadState={leadState} onSubmit={submitLead} nav={nav} compact />
              }
            />
          ) : (
            <EndView
              reason={endReason}
              email={email}
              setEmail={setEmail}
              leadState={leadState}
              onSubmit={submitLead}
              nav={nav}
              onReplay={start}
            />
          )
        )}
      </main>

      {/* Bottom control bar — mic, text (always available), transcript, end.
          Only while live; the closed states carry their own actions. */}
      {phase === "live" && (
        <footer style={{ position: "relative", zIndex: 2, borderTop: "1px solid var(--divider)", background: "var(--nav-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", padding: "12px 16px" }}>
          {wrapUp && (
            <div style={{ maxWidth: 900, margin: "0 auto 10px", textAlign: "center", fontSize: 12.5, fontWeight: 600, color: PINK }}>
              Heads up — the demo is wrapping up. Drop your email below to keep going with your own clone.
            </div>
          )}
          <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={toggleMic}
              aria-pressed={micOn}
              title={micOn ? "Mute your mic" : "Talk to Ava with your mic"}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, height: 48, padding: "0 18px", borderRadius: 9999, border: "none", background: micOn ? GREEN : "var(--card)", color: micOn ? "#04042A" : "var(--ink1)", boxShadow: micOn ? "none" : "inset 0 0 0 1px var(--border)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              <Icon name={micOn ? "mic" : "mic_off"} style={{ fontSize: 20 }} />{micOn ? "Listening" : "Talk"}
            </button>
            <form onSubmit={submitText} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 220, height: 48, padding: "0 8px 0 16px", borderRadius: 9999, background: "var(--card)", border: "2px solid var(--border)" }}>
              <Icon name="chat" style={{ fontSize: 19, color: "var(--ink3)" }} />
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type to Ava…"
                aria-label="Type a message to Ava"
                style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 14.5, fontWeight: 500, color: "var(--ink1)" }}
              />
              <button type="submit" disabled={!text.trim() || sending} aria-label="Send" title="Send" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: "50%", border: "none", background: text.trim() ? PINK : "var(--border)", color: "#fff", cursor: text.trim() ? "pointer" : "default" }}>
                <Icon name="arrow_upward" style={{ fontSize: 18 }} />
              </button>
            </form>
            <button
              onClick={() => setShowTranscript((v) => !v)}
              aria-pressed={showTranscript}
              title="Toggle transcript"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 48, padding: "0 16px", borderRadius: 9999, border: "1px solid var(--border)", background: showTranscript ? "var(--panel)" : "transparent", color: "var(--ink1)", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
            >
              <Icon name="notes" style={{ fontSize: 19 }} />Transcript
            </button>
            <button
              onClick={endByUser}
              title="End the demo"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 48, padding: "0 18px", borderRadius: 9999, border: "none", background: "#E1173F", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              <Icon name="call_end" style={{ fontSize: 20 }} />End
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}

// --- pieces ---------------------------------------------------------------

function StatusPill({ phase, endReason }: { phase: Phase; endReason: EndReason }) {
  const map: Record<string, { dot: string; label: string; anim?: boolean }> = {
    connecting: { dot: "#A342FF", label: "Connecting", anim: true },
    queued: { dot: "#00BBFF", label: "In the queue", anim: true },
    live: { dot: GREEN, label: "Live", anim: true },
    error: { dot: "#E1173F", label: "Unavailable" },
    ended: { dot: "var(--ink3)", label: endReason === "expired" ? "Time's up" : endReason === "died" ? "Dropped" : "Ended" },
  };
  const s = map[phase] || map.ended;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 9999, background: "var(--panel)", color: "var(--ink2)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.dot, animation: s.anim ? "ahpDot 1.4s ease-in-out infinite" : "none" }} />
      {s.label}
    </span>
  );
}

// The voice orb — the product's Demo Mode signature, recast in public tokens.
// `speaking` pulses the ring; otherwise it breathes softly (listening).
function AvaOrb({ size = 132, speaking = false, assembling = false }: { size?: number; speaking?: boolean; assembling?: boolean }) {
  const anim = assembling ? "ahpOrbForm 1.8s ease-in-out infinite" : speaking ? "ahpRing 1.6s ease-in-out infinite" : "ahpBreathe 3.4s ease-in-out infinite";
  return (
    <div
      aria-hidden
      style={{
        width: size, height: size, borderRadius: "50%",
        background: "radial-gradient(circle at 32% 30%, rgba(255,6,96,.55), rgba(163,66,255,.5) 55%, rgba(0,187,255,.4))",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontWeight: 800, fontSize: size * 0.24, letterSpacing: "-.02em",
        boxShadow: "0 20px 60px rgba(163,66,255,.35)", animation: anim,
      }}
    >
      Ava
    </div>
  );
}

function Wave({ active, color = GREEN }: { active: boolean; color?: string }) {
  const delays = ["0s", ".15s", ".3s", ".15s", "0s"];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 18 }} aria-hidden>
      {delays.map((d, i) => (
        <span key={i} style={{ width: 3, height: "100%", borderRadius: 2, background: color, transformOrigin: "bottom", opacity: active ? 1 : 0.4, animation: active ? "ahpWave .9s ease-in-out infinite" : "none", animationDelay: d }} />
      ))}
    </div>
  );
}

function ConnectingView({ phase, queuePos }: { phase: Phase; queuePos: number | null }) {
  const queued = phase === "queued";
  return (
    <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 22, maxWidth: 520 }}>
      <AvaOrb assembling size={140} />
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-.02em" }} aria-live="polite">
          {queued ? "You're in line for Ava" : "Ava is joining"}
        </h1>
        <p style={{ margin: "10px 0 0", fontSize: 15, color: "var(--ink2)", lineHeight: 1.55 }}>
          {queued
            ? "Every live demo runs on a real machine, so there's a short wait when they're all busy. We'll pull you in automatically."
            : "Ava is spinning up a live browser and warming up her voice. This usually takes a few seconds."}
        </p>
        {queued && queuePos != null && (
          <div style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, padding: "8px 16px", borderRadius: 9999, background: "var(--panel)", color: "var(--ink1)" }}>
            <Icon name="groups" style={{ fontSize: 18, color: "#00BBFF" }} />
            {queuePos === 1 ? "You're next" : `Position ${queuePos} in line`}
          </div>
        )}
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 12.5, fontWeight: 600, color: "var(--ink3)" }}>
        <Icon name="progress_activity" style={{ fontSize: 18, color: "#A342FF", animation: "ahpSpin 1.2s linear infinite" }} />
        {queued ? "Holding your spot…" : "Warming up…"}
      </div>
    </div>
  );
}

function LiveView({
  streamUrl, transcript, showTranscript, setShowTranscript, feedRef, wrapUp,
}: {
  streamUrl: string; transcript: Turn[]; showTranscript: boolean;
  setShowTranscript: (v: boolean) => void; feedRef: React.MutableRefObject<HTMLDivElement | null>; wrapUp: boolean;
}) {
  const lastAva = [...transcript].reverse().find((t) => t.ava);
  let host = "ava's screen";
  try { if (streamUrl) host = new URL(streamUrl).host; } catch { /* noop */ }

  return (
    <div style={{ width: "100%", maxWidth: showTranscript ? 1180 : 900, display: "grid", gridTemplateColumns: showTranscript ? "minmax(0,1fr) 320px" : "minmax(0,1fr)", gap: 16, alignItems: "start" }} className="ahp-live-grid">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Live screen stage — the E2B stream, embedded exactly like the studio */}
        <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--border)", background: "var(--card)", boxShadow: "0 20px 60px rgba(0,0,64,.18)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", background: "var(--panel)", borderBottom: "1px solid var(--divider)" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#FF5F57" }} />
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#FEBC2E" }} />
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#28C840" }} />
            <span style={{ marginLeft: 8, fontSize: 11.5, color: "var(--ink3)", fontFamily: "ui-monospace, monospace" }}>{host}</span>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, color: PINK }}>
              <Icon name="present_to_all" style={{ fontSize: 14 }} />Ava is sharing
            </span>
          </div>
          <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 10", background: "#05070d" }}>
            {streamUrl ? (
              <iframe
                src={streamUrl}
                title="Ava's live screen"
                allow="autoplay"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
              />
            ) : (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "rgba(255,255,255,.6)", fontSize: 13, fontWeight: 600 }}>
                Ava's screen is coming up…
              </div>
            )}
            {/* Floating orb tile, like a Zoom self-view */}
            <div style={{ position: "absolute", right: 12, bottom: 12, width: 92, height: 92, borderRadius: 14, background: "rgba(4,4,42,.55)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255,255,255,.15)" }}>
              <AvaOrb size={64} speaking />
            </div>
          </div>
        </div>

        {/* Voice bar + live caption (last thing Ava said) */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 14, background: "var(--card)", border: "1px solid var(--border)" }}>
          <Wave active />
          <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} aria-live="polite">
            {lastAva ? lastAva.text : "Ava is live — say hello, or ask her to show you the product."}
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: wrapUp ? PINK : "var(--ink3)", whiteSpace: "nowrap" }}>Ava, real voice</span>
        </div>
      </div>

      {showTranscript && (
        <aside style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--card)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: 460 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--divider)" }}>
            <Icon name="notes" style={{ fontSize: 18, color: "var(--ink3)" }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>Transcript</span>
            <button onClick={() => setShowTranscript(false)} aria-label="Hide transcript" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--ink3)", cursor: "pointer", display: "flex" }}>
              <Icon name="close" style={{ fontSize: 18 }} />
            </button>
          </div>
          <div ref={feedRef} className="ahp-scroll" style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {transcript.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>The conversation will show up here as you and Ava talk.</div>
            ) : (
              transcript.map((t, i) => (
                <div key={i} style={{ alignSelf: t.ava ? "flex-start" : "flex-end", maxWidth: "88%" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 3, textAlign: t.ava ? "left" : "right" }}>{t.ava ? "Ava" : "You"}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.45, padding: "9px 12px", borderRadius: 12, background: t.ava ? "var(--panel)" : PINK, color: t.ava ? "var(--ink1)" : "#fff" }}>{t.text}</div>
                </div>
              ))
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function RecoveryCard({ title, body, onRetry, nav, secondary }: { title: string; body: string; onRetry: () => void; nav: Nav; secondary?: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", maxWidth: 460, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
      <div style={{ width: 68, height: 68, borderRadius: "50%", background: "var(--panel)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="sentiment_dissatisfied" style={{ fontSize: 34, color: "#A342FF" }} />
      </div>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-.02em" }}>{title}</h1>
        <p style={{ margin: "10px 0 0", fontSize: 15, color: "var(--ink2)", lineHeight: 1.55 }}>{body}</p>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <button onClick={onRetry} style={primaryBtn}>
          <Icon name="refresh" style={{ fontSize: 20 }} />Try again
        </button>
        <button onClick={() => nav.go("#/")} style={ghostBtn}>Back to site</button>
      </div>
      {secondary}
    </div>
  );
}

function EndView({ reason, email, setEmail, leadState, onSubmit, nav, onReplay }: {
  reason: EndReason; email: string; setEmail: (v: string) => void;
  leadState: "idle" | "sending" | "done" | "error"; onSubmit: (e: React.FormEvent) => void; nav: Nav; onReplay: () => void;
}) {
  const headline = reason === "expired" ? "That's your demo with Ava" : "Thanks for talking with Ava";
  return (
    <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
      <AvaOrb size={96} />
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-.02em" }}>{headline}</h1>
        <p style={{ margin: "12px 0 0", fontSize: 16, color: "var(--ink2)", lineHeight: 1.55 }}>
          That was a clone of a real rep — voice, screen, and judgment. Want your own? Get the recording and start free.
        </p>
      </div>

      {leadState === "done" ? (
        <div style={{ width: "100%", textAlign: "center", background: "var(--panel)", borderRadius: 20, padding: "28px 24px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: "50%", background: "rgba(46,211,125,.16)", marginBottom: 14 }}>
            <Icon name="check" style={{ fontSize: 28, color: "#0E8A4F" }} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>You're on the list</div>
          <p style={{ margin: "8px auto 20px", fontSize: 14.5, color: "var(--ink2)", maxWidth: 380, lineHeight: 1.5 }}>
            The recording is on its way. Clone your best rep next — the first clone is $2,000/mo and you rehearse free until it clears the readiness bar.
          </p>
          <button onClick={() => nav.go("#/auth")} style={{ ...primaryBtn, height: 54, fontSize: 16, margin: "0 auto" }}>
            Clone your rep<Icon name="arrow_forward" style={{ fontSize: 20 }} />
          </button>
        </div>
      ) : (
        <LeadCapture email={email} setEmail={setEmail} leadState={leadState} onSubmit={onSubmit} nav={nav} />
      )}

      <button onClick={onReplay} style={{ ...ghostBtn, height: 44 }}>
        <Icon name="replay" style={{ fontSize: 19 }} />Talk to Ava again
      </button>
    </div>
  );
}

function LeadCapture({ email, setEmail, leadState, onSubmit, nav, compact }: {
  email: string; setEmail: (v: string) => void; leadState: "idle" | "sending" | "done" | "error";
  onSubmit: (e: React.FormEvent) => void; nav: Nav; compact?: boolean;
}) {
  return (
    <div style={{ width: "100%", background: compact ? "transparent" : "var(--panel)", borderRadius: 20, padding: compact ? 0 : "26px 24px" }}>
      {!compact && (
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Want your own clone?</div>
          <div style={{ fontSize: 13.5, color: "var(--ink3)", marginTop: 4 }}>Get the recording and start free</div>
        </div>
      )}
      <form onSubmit={onSubmit} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 220, height: 54, padding: "0 8px 0 18px", borderRadius: 9999, background: "var(--card)", border: "2px solid var(--border)" }}>
          <Icon name="mail" style={{ fontSize: 20, color: "var(--ink3)" }} />
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Your work email"
            aria-label="Your work email"
            style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 15, fontWeight: 500, color: "var(--ink1)" }}
          />
        </div>
        <button type="submit" disabled={leadState === "sending"} style={{ ...primaryBtn, height: 54, fontSize: 16, opacity: leadState === "sending" ? 0.7 : 1 }}>
          {leadState === "sending" ? "Sending…" : "Get the recording"}<Icon name="arrow_forward" style={{ fontSize: 20 }} />
        </button>
      </form>
      <button onClick={() => nav.go("#/auth")} style={{ marginTop: 12, background: "none", border: "none", color: "var(--ink3)", fontSize: 13, fontWeight: 600, cursor: "pointer", width: "100%", textAlign: "center" }}>
        or skip and start free
      </button>
    </div>
  );
}

const primaryBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, height: 48, padding: "0 22px",
  border: "none", borderRadius: 9999, background: PINK, color: "#fff", fontSize: 15,
  fontWeight: 700, letterSpacing: ".02em", cursor: "pointer", boxShadow: "0 8px 24px rgba(255,6,96,.3)",
};
const ghostBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, height: 48, padding: "0 20px",
  border: "1px solid var(--border)", borderRadius: 9999, background: "transparent",
  color: "var(--ink1)", fontSize: 14, fontWeight: 600, cursor: "pointer",
};
