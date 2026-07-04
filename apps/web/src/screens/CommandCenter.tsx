import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, Badge, Button, Icon, EmptyState } from "../ds";
import { useApi } from "../api/hooks";
import { streamChat, api } from "../api/client";
import { useSpeech, useVoiceOutput } from "../hooks/useSpeech";
import type { ViewId } from "../components/AppShell";
import type { Agent, FeedItem, SystemHealth, StatusStripItem, AgentRunResult } from "@jarvis/shared";

const ACCENT = "var(--jv-cyan)";

// RadialVoiceViz — concentric rings + circular waveform. `level` (0..1) is the
// live mic amplitude and makes the core visibly react to your voice.
function RadialVoiceViz({ active = true, level = 0, bars = 96, size = 300, color = ACCENT, showBars = true, onClick }: { active?: boolean; level?: number; bars?: number; size?: number; color?: string; showBars?: boolean; onClick?: () => void }) {
  const seeds = useMemo(() => Array.from({ length: bars }, (_, i) => 0.32 + 0.68 * Math.abs(Math.sin(i * 2.3) * Math.cos(i * 0.7))), [bars]);
  const c = size / 2;
  const inner = size * 0.305;
  const maxLen = size * 0.15;
  const amp = active ? 0.85 + level * 0.9 : 1; // scale bar amplitude by mic level
  return (
    <button onClick={onClick} aria-label="Toggle listening" style={{ position: "relative", width: size, height: size, border: "none", background: "transparent", cursor: "pointer", padding: 0, transform: `scale(${1 + level * 0.14})`, transition: "transform 90ms linear" }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `1px dashed ${color}`, opacity: 0.22, animation: active ? "jv-glow-breathe 2.6s ease-out infinite" : "none" }} />
      <span style={{ position: "absolute", inset: size * 0.13, borderRadius: "50%", border: `1px solid ${color}`, opacity: 0.16 }} />
      <span style={{ position: "absolute", inset: size * 0.3, borderRadius: "50%", background: `radial-gradient(circle at 50% 45%, color-mix(in srgb, ${color} 30%, transparent), transparent 72%)`, animation: active ? "jv-pulse 2.6s ease-out infinite" : "none" }} />
      <span style={{ position: "absolute", top: "50%", left: "50%", width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: "50%", background: color, boxShadow: `0 0 ${18 + level * 46}px ${color}` }} />
      {showBars && (
        <svg viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", filter: `drop-shadow(0 0 4px color-mix(in srgb, ${color} 55%, transparent))` }}>
          {seeds.map((s, i) => {
            const ang = (i / bars) * 360;
            const len = maxLen * (active ? s * amp : 0.42);
            return (
              <g key={i} transform={`rotate(${ang} ${c} ${c})`}>
                <rect
                  x={c - 1.3}
                  y={c - inner - len}
                  width={2.6}
                  height={len}
                  rx={1.3}
                  fill={color}
                  style={{ transformBox: "fill-box", transformOrigin: "center bottom", animation: active ? `jv-equalize ${0.7 + (i % 6) * 0.16}s ease-out ${i * 0.03}s infinite` : "none" }}
                />
              </g>
            );
          })}
        </svg>
      )}
    </button>
  );
}

// ---- Browser command → animated browser stage ---------------------------
const SITE_ALIASES: Record<string, string> = {
  google: "google.com", youtube: "youtube.com", github: "github.com", gmail: "mail.google.com",
  stripe: "dashboard.stripe.com", notion: "notion.so", linkedin: "linkedin.com",
  twitter: "x.com", slack: "app.slack.com", amazon: "amazon.com", wikipedia: "wikipedia.org",
};

// Detect an "open a browser / go to a site" command and pull out a target URL.
function detectBrowserCommand(text: string): { url: string; label: string } | null {
  const t = text.toLowerCase();
  const wantsBrowser =
    /\b(go to|navigate to|pull up|browse to|take me to|visit)\b/.test(t) ||
    (/\b(open|launch|start|show me|bring up|pull up|fire up)\b/.test(t) &&
      /\b(browser|chrome|chromium|firefox|edge|safari|tab|new tab|website|web ?site|web ?page|the web|url|link|google|youtube|github|gmail|amazon|notion|linkedin|twitter|wikipedia|stripe|\.com|\.io|\.ai|\.org|\.net|\.co|\.dev)\b/.test(t));
  if (!wantsBrowser) return null;
  // Explicit URL / domain wins.
  const m = text.match(/\bhttps?:\/\/\S+|\b([a-z0-9-]+\.)+(com|io|ai|org|net|co|dev|so|app|gov|edu)(\/\S*)?/i);
  if (m) {
    const raw = m[0].replace(/[.,)]+$/, "");
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return { url, label: url.replace(/^https?:\/\//, "") };
  }
  // Named site alias (e.g. "open google chrome" → google.com).
  for (const [name, host] of Object.entries(SITE_ALIASES)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) return { url: `https://${host}`, label: host };
  }
  // Bare "open a browser / open chrome" → a real new tab (Google as the home).
  return { url: "https://www.google.com", label: "google.com" };
}

// BrowserStage — an animated browser window that opens in the center of the
// Command Center when a voice command asks to open a browser. It scales in,
// runs a load bar, and settles into a live session view. (Real remote browsing
// runs on the Hermes `browser` toolset; this is the operator-facing view.)
// A real server-side browser: the BFF drives a headless Chrome on the VPS and
// relays live screenshots. This shows the actual rendered page (not a mock).
function BrowserStage({ target, onClose }: { target: { url: string; label: string }; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [url, setUrl] = useState(target.url);
  const [addr, setAddr] = useState(target.label);
  const [nonce, setNonce] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 30);
    return () => window.clearTimeout(t);
  }, []);
  // Follow a new command target.
  useEffect(() => {
    setUrl(target.url);
    setAddr(target.label);
  }, [target.url, target.label]);
  // Point the server-side browser at the page, then request a fresh frame.
  useEffect(() => {
    setLoading(true);
    setError(null);
    api.post("/api/browser/open", { url }).catch(() => {});
    setNonce((n) => n + 1);
  }, [url]);
  // Live refresh — re-render the page on the server every few seconds.
  useEffect(() => {
    const id = window.setInterval(() => setNonce((n) => n + 1), 3000);
    return () => window.clearInterval(id);
  }, []);

  const shot = `/api/browser/screenshot?url=${encodeURIComponent(url)}&t=${nonce}`;
  const displayLabel = url.replace(/^https?:\/\//, "");
  const navigate = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    const next = /^https?:\/\//i.test(v) ? v : /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(v) ? `https://${v}` : `https://www.google.com/search?q=${encodeURIComponent(v)}`;
    setUrl(next);
  };
  const dot = (c: string) => <span style={{ width: 11, height: 11, borderRadius: "50%", background: c }} />;

  return (
    <div
      style={{
        width: "100%", maxWidth: 900, height: "min(60vh, 520px)", display: "flex", flexDirection: "column",
        borderRadius: "var(--r-lg)", overflow: "hidden", background: "var(--jv-void)",
        border: "1px solid var(--jv-border-cyan)", boxShadow: "var(--panel-shadow-active)",
        transform: mounted ? "scale(1)" : "scale(0.93)", opacity: mounted ? 1 : 0,
        transition: "transform 360ms cubic-bezier(0.34,1.15,0.64,1), opacity 300ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "var(--jv-surface-2)", borderBottom: "1px solid var(--jv-hairline)" }}>
        <div style={{ display: "flex", gap: 7 }}>{dot("var(--jv-red-400)")}{dot("var(--jv-amber)")}{dot("var(--jv-green)")}</div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: "var(--r-pill)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", minWidth: 0 }}>
          <Icon name="lock" size={12} color="var(--jv-cyan)" />
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") navigate(addr); }}
            spellCheck={false}
            aria-label="Address bar"
            style={{ flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: "var(--jv-text-soft)", font: "var(--fw-medium) 12px var(--font-mono)" }}
          />
        </div>
        <button onClick={() => setNonce((n) => n + 1)} title="Refresh" style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", color: "var(--jv-text-muted)", cursor: "pointer" }}>
          <Icon name={loading ? "loader" : "refresh-cw"} size={13} />
        </button>
        <span style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.1em", color: "var(--jv-cyan-300)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--jv-cyan)", boxShadow: "0 0 8px var(--jv-cyan)", animation: "jv-pulse 1.6s ease-out infinite" }} /> LIVE
        </span>
        <button onClick={onClose} title="Close browser" style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", color: "var(--jv-text-muted)", cursor: "pointer" }}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div style={{ height: 2 }}>{loading && <div style={{ height: "100%", width: "60%", background: "var(--jv-cyan)", boxShadow: "0 0 8px var(--jv-cyan)", animation: "jv-pulse 1.2s ease-out infinite" }} />}</div>
      <div style={{ flex: 1, position: "relative", overflow: "auto", background: "#0a0f1a" }}>
        {!error && (
          <img
            src={shot}
            alt={displayLabel}
            onLoad={() => { setLoading(false); setError(null); }}
            onError={() => { setLoading(false); setError("Couldn't render this page on the server."); }}
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        )}
        {loading && !error && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 52, height: 52, margin: "0 auto 12px", borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", color: "var(--jv-cyan)" }}><Icon name="globe" size={24} /></div>
              <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text-soft)" }}>Rendering {displayLabel} on the server…</div>
            </div>
          </div>
        )}
        {error && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24 }}>
            <div style={{ textAlign: "center", maxWidth: 360 }}>
              <Icon name="alert-triangle" size={22} color="var(--jv-amber)" />
              <div style={{ font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-soft)", marginTop: 8 }}>{error}</div>
              <button onClick={() => { setError(null); setLoading(true); setNonce((n) => n + 1); }} style={{ marginTop: 12, padding: "7px 14px", borderRadius: "var(--r-sm)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", color: "var(--jv-cyan-300)", cursor: "pointer", font: "var(--fw-semibold) 12px var(--font-body)" }}>Retry</button>
            </div>
          </div>
        )}
      </div>
      <div style={{ padding: "6px 12px", background: "var(--jv-surface-2)", borderTop: "1px solid var(--jv-hairline)", font: "var(--fw-regular) 10.5px var(--font-body)", color: "var(--jv-text-faint)", textAlign: "center" }}>
        Live browser running on the server · auto-refreshing
      </div>
    </div>
  );
}

// VoiceCore — real voice interaction: mic transcription (when the browser
// allows it — HTTPS/localhost + Chromium), a live transcript, an audio-reactive
// orb, and streamed replies from JARVIS. Falls back to a text composer so it
// works everywhere (e.g. plain-HTTP deployments where the mic is blocked).
function VoiceCore({ onModeChange }: { onModeChange?: (active: boolean) => void }) {
  const [youText, setYouText] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [browser, setBrowser] = useState<{ url: string; label: string } | null>(null);
  // Voice output on by default; the operator can mute it. Persist the choice.
  const [voiceOut, setVoiceOut] = useState(() => localStorage.getItem("jv.voiceOut") !== "off");
  // Command Center brain mode. "act" = grounded in this system's live state +
  // executes on Hermes (does things); "ask" = general Q&A. Persisted.
  const [mode, setMode] = useState<"act" | "ask">(() => (localStorage.getItem("jv.ccMode") === "ask" ? "ask" : "act"));

  const out = useVoiceOutput();
  // Refs so the streaming callback + effects always see current controls
  // without re-creating `send` (which would restart recognition mid-session).
  const speechRef = useRef<ReturnType<typeof useSpeech> | null>(null);
  const outRef = useRef(out);
  outRef.current = out;
  const voiceOutRef = useRef(voiceOut);
  voiceOutRef.current = voiceOut;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t) return;
    outRef.current.cancel(); // stop any in-flight speech
    // "open a browser / go to X" → the app opens a REAL server-side browser and
    // shows the live page. The LLM can't open apps, so don't ask it — act.
    const bcmd = detectBrowserCommand(t);
    if (bcmd) {
      setBrowser(bcmd);
      setYouText(t);
      const ack = `Opening ${bcmd.label} in a live browser on the server.`;
      setReply(ack);
      if (voiceOutRef.current) {
        speechRef.current?.pause();
        outRef.current.speak(ack, { onEnd: () => speechRef.current?.resume() });
      }
      return;
    }
    setYouText(t);
    setReply("");
    setBusy(true);
    let full = "";
    try {
      if (modeRef.current === "act") {
        // ACT: grounded in this system's live state + executed on Hermes (tools).
        const res = await api.post<AgentRunResult>("/api/command/run", { text: t });
        full = res.ok ? res.output : (res.detail || "I couldn't complete that.");
        setReply(full);
      } else {
        // ASK: general Q&A (streamed).
        await streamChat({ message: t, mode: null }, (d) => {
          full += d;
          setReply((r) => r + d);
        });
      }
    } catch {
      full = "I couldn't reach the agent gateway just now.";
      setReply(full);
    } finally {
      setBusy(false);
      // Speak the finished reply aloud, ducking the mic so JARVIS doesn't
      // transcribe its own voice; resume listening when it's done.
      if (voiceOutRef.current && full.trim()) {
        speechRef.current?.pause();
        outRef.current.speak(full, { onEnd: () => speechRef.current?.resume() });
      }
    }
  }, []);

  const speech = useSpeech(send);
  speechRef.current = speech;
  const listening = speech.listening;
  const active = listening || busy || out.speaking;
  const displayedYou = speech.interim || youText;

  // "Command mode": the operator is actively giving a command (speaking a
  // transcript, awaiting a reply, being spoken to, or a browser is open) — as
  // opposed to the mic idly listening. Reported up so the Command Center can
  // collapse the side panels for a focused view. A short linger avoids flicker.
  const rawActive = !!speech.interim || busy || out.speaking || !!browser;
  useEffect(() => {
    if (!onModeChange) return;
    if (rawActive) {
      onModeChange(true);
      return;
    }
    const id = window.setTimeout(() => onModeChange(false), 1800);
    return () => window.clearTimeout(id);
  }, [rawActive, onModeChange]);

  // Voice never auto-starts — the mic opens ONLY when the operator taps the core
  // (or the mic button). This keeps it off until explicitly activated.
  const toggle = () => {
    if (!speech.supported) return;
    outRef.current.cancel();
    if (listening) speech.stop();
    else speech.start();
  };

  const toggleVoiceOut = () => {
    setVoiceOut((v) => {
      const next = !v;
      localStorage.setItem("jv.voiceOut", next ? "on" : "off");
      if (!next) outRef.current.cancel();
      return next;
    });
  };

  const pickMode = (m: "act" | "ask") => { setMode(m); localStorage.setItem("jv.ccMode", m); };

  const status = out.speaking
    ? "Speaking…"
    : listening
      ? "I am listening…"
      : busy
        ? (mode === "act" ? "Working on it…" : "Thinking…")
        : speech.supported
          ? "Tap the core to speak"
          : "Voice unavailable";

  // A specific, actionable reason when voice can't run — so it's never a silent
  // dead orb. When there's a problem we also expose a text fallback below.
  const voiceProblem = !speech.supported
    ? !speech.secure
      ? "This page isn't a secure context. Open it over HTTPS (https://jarvis.srv1797540.hstgr.cloud), not http:// or an IP:port."
      : !speech.hasRecognition
        ? "This browser has no speech recognition. Use Chrome or Edge (desktop)."
        : "Voice is unavailable in this browser."
    : speech.error === "not-allowed"
      ? "Microphone blocked. Click the lock icon in the address bar → allow Microphone → reload."
      : speech.error === "service-not-allowed"
        ? "The browser's speech service is unavailable (some Chromium builds/Brave block it). Try Chrome or Edge."
        : speech.error === "mic-unavailable" || speech.error === "audio-capture"
          ? "No microphone was found on this device."
          : speech.error === "network"
            ? "Speech recognition hit a network error. Check the connection and try again."
            : null;

  const [draft, setDraft] = useState("");
  const submitDraft = () => {
    const t = draft.trim();
    if (!t || busy) return;
    setDraft("");
    send(t);
  };

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 480 }}>
      <div style={{ position: "absolute", width: 580, height: 580, borderRadius: "50%", background: `radial-gradient(circle at 50% 45%, color-mix(in srgb, ${ACCENT} 12%, transparent), transparent 62%)`, pointerEvents: "none" }} />
      {browser ? (
        <BrowserStage target={browser} onClose={() => setBrowser(null)} />
      ) : (
        <>
          <div style={{ position: "relative", textAlign: "center", marginBottom: 24 }}>
            <div style={{ font: "var(--fw-medium) 11px/1 var(--font-hud)", letterSpacing: "0.44em", color: "var(--jv-cyan-100)" }}>AI CORE · v3.0.0</div>
          </div>
          <RadialVoiceViz active={active} level={speech.level} bars={96} size={300} color={ACCENT} onClick={toggle} />
        </>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-semibold) 12px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: active ? ACCENT : "var(--jv-text-muted)" }}>
          {listening && !out.speaking ? (
            <>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: ACCENT, boxShadow: `0 0 8px ${ACCENT}`, animation: "jv-pulse 2s ease-out infinite" }} /> {status}
            </>
          ) : (
            <>
              <Icon name={out.speaking ? "volume-2" : busy ? "loader" : speech.supported ? "mic" : "mic-off"} size={14} /> {status}
            </>
          )}
        </div>
        {out.supported && (
          <button
            onClick={toggleVoiceOut}
            aria-label={voiceOut ? "Mute After Human voice" : "Unmute After Human voice"}
            title={voiceOut ? "After Human voice on" : "After Human voice muted"}
            style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: "50%", cursor: "pointer", background: voiceOut ? "var(--grad-cyan-soft)" : "var(--jv-surface-3)", border: `1px solid ${voiceOut ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}`, color: voiceOut ? ACCENT : "var(--jv-text-muted)" }}
          >
            <Icon name={voiceOut ? "volume-2" : "volume-x"} size={14} />
          </button>
        )}
      </div>

      {/* Mode: Act (grounded in this system + does things on Hermes) vs Ask (general Q&A) */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 14, padding: 3, borderRadius: "var(--r-pill)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)" }}>
        {([["act", "briefcase", "Act on the system"], ["ask", "message-circle", "Ask anything"]] as const).map(([m, ic, label]) => {
          const on = mode === m;
          return (
            <button key={m} onClick={() => pickMode(m)} title={m === "act" ? "Uses this system's live state + Hermes tools to actually do things" : "General questions — a normal assistant"}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: "var(--r-pill)", cursor: "pointer", border: "none", background: on ? "var(--grad-cyan)" : "transparent", color: on ? "var(--accent-contrast)" : "var(--jv-text-muted)", font: `${on ? "var(--fw-semibold)" : "var(--fw-medium)"} 11px var(--font-hud)`, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              <Icon name={ic} size={12} /> {label}
            </button>
          );
        })}
      </div>

      <div style={{ position: "relative", width: "100%", maxWidth: 460, marginTop: 16, display: "flex", flexDirection: "column", gap: 8, minHeight: 92 }}>
        {displayedYou && (
          <div style={{ alignSelf: "flex-end", maxWidth: "82%", padding: "9px 13px", borderRadius: "12px 12px 3px 12px", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", font: "var(--fw-medium) 12.5px/1.45 var(--font-body)", color: "var(--jv-text)" }}>
            {displayedYou}
          </div>
        )}
        {(reply || busy) && (
          <div style={{ alignSelf: "flex-start", maxWidth: "88%", display: "flex", gap: 9 }}>
            <span style={{ flex: "0 0 26px", width: 26, height: 26, marginTop: 1, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)", color: ACCENT }}>
              <Icon name="sparkles" size={13} />
            </span>
            <div style={{ padding: "9px 13px", borderRadius: "12px 12px 12px 3px", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-soft)" }}>
              {reply || <span style={{ opacity: 0.5 }}>…</span>}
            </div>
          </div>
        )}
        {!displayedYou && !reply && !busy && !voiceProblem && (
          <div style={{ textAlign: "center", font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-faint)" }}>
            {mode === "act"
              ? "Tap the core and tell me what to do — I know what's connected and can act on the system."
              : "Tap the core and ask me anything — general questions."}
          </div>
        )}
        {voiceProblem && (
          <div style={{ display: "flex", gap: 9, padding: "11px 13px", borderRadius: "var(--r-sm)", background: "color-mix(in srgb, var(--jv-amber) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-amber) 34%, transparent)" }}>
            <Icon name="alert-triangle" size={15} color="var(--jv-amber)" style={{ flex: "0 0 15px", marginTop: 1 }} />
            <div style={{ font: "var(--fw-regular) 12px/1.5 var(--font-body)", color: "var(--jv-text-soft)" }}>
              {voiceProblem} <span style={{ color: "var(--jv-text-faint)" }}>You can still type to After Human below.</span>
            </div>
          </div>
        )}
      </div>

      {/* Text fallback — only when voice can't run, so voice stays primary. */}
      {voiceProblem && (
        <div style={{ width: "100%", maxWidth: 460, marginTop: 14, display: "flex", alignItems: "center", gap: 10, padding: "8px 10px 8px 16px", borderRadius: "var(--r-md)", background: "var(--jv-void)", border: "1px solid var(--jv-border-cyan)" }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitDraft()}
            placeholder="Type to talk to After Human…"
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--jv-text)", font: "var(--fw-medium) 13.5px var(--font-body)" }}
          />
          <button onClick={submitDraft} disabled={busy || !draft.trim()} style={{ width: 36, height: 36, flex: "0 0 36px", display: "grid", placeItems: "center", borderRadius: "50%", background: draft.trim() ? "var(--jv-cyan)" : "var(--jv-surface-3)", border: "none", color: draft.trim() ? "var(--accent-contrast)" : "var(--jv-text-muted)", cursor: busy ? "default" : "pointer" }}>
            <Icon name={busy ? "loader" : "arrow-up"} size={17} />
          </button>
        </div>
      )}
    </div>
  );
}

function ViewAll({ children = "View All", onClick }: { children?: React.ReactNode; onClick?: () => void }) {
  return (
    <a href="#" onClick={(e) => { e.preventDefault(); onClick?.(); }} style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-cyan-300)" }}>
      {children} ›
    </a>
  );
}

function Feed() {
  const { data } = useApi<FeedItem[]>("/api/command/feed");
  const items = data ?? [];
  const tone: Record<string, "info" | "warn" | "optimal"> = { INFO: "info", WARN: "warn", TIP: "info", LIVE: "optimal" };
  if (items.length === 0) {
    return <EmptyState compact icon="radar" title="No intelligence yet" hint="Signals from your agents and integrations will show up here." />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 10px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
          <span style={{ width: 26, height: 26, flex: "0 0 26px", display: "grid", placeItems: "center", borderRadius: "var(--r-xs)", color: `var(--jv-${it.tone === "optimal" ? "green" : it.tone === "warn" ? "amber" : "cyan"})`, background: "rgba(41,211,245,0.08)" }}>
            <Icon name={it.icon} size={14} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</div>
            <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", color: "var(--jv-text-muted)", textTransform: "uppercase", marginTop: 2 }}>{it.sub}</div>
          </div>
          <Badge status={tone[it.tag] ?? "info"} dot={false}>{it.tag}</Badge>
        </div>
      ))}
    </div>
  );
}

function StatusStrip() {
  const { data } = useApi<SystemHealth>("/api/system/health");
  // Voice is a browser capability, computed here (not claimed by the server):
  // ready only when there's a secure context AND the SpeechRecognition API.
  const voiceReady =
    typeof window !== "undefined" &&
    (window.isSecureContext ?? false) &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const voiceTile: StatusStripItem = { icon: "mic", name: "Voice", status: voiceReady ? "Ready" : "Off", tone: voiceReady ? "optimal" : "warn" };
  const items = [...(data?.strip ?? []), voiceTile];
  const col = (t: string) => (t === "optimal" ? "var(--jv-green)" : t === "standby" ? "var(--jv-violet)" : t === "warn" ? "var(--jv-amber)" : "var(--jv-cyan)");
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "9px 16px", borderRadius: "var(--r-md)", background: "rgba(10,22,38,0.5)", border: "1px solid var(--jv-border-soft)", flex: 1, minWidth: 0, overflowX: "auto" }}>
      <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", color: "var(--jv-cyan-300)", marginRight: 4, whiteSpace: "nowrap" }}>SYSTEM STATUS</span>
      {items.length === 0 && (
        <span style={{ font: "var(--fw-medium) 11px var(--font-hud)", letterSpacing: "0.06em", color: "var(--jv-text-faint)", marginLeft: 16, whiteSpace: "nowrap" }}>—</span>
      )}
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderLeft: "1px solid var(--jv-hairline)", marginLeft: 12, whiteSpace: "nowrap" }}>
          <Icon name={it.icon} size={15} color={col(it.tone)} />
          <span style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)" }}>{it.name}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-medium) 11px var(--font-hud)", letterSpacing: "0.04em", color: col(it.tone) }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: col(it.tone), boxShadow: `0 0 6px ${col(it.tone)}` }} />
            {it.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function QuickBar({ onNav }: { onNav: (v: ViewId) => void }) {
  const cmds: [string, string, "primary" | "secondary", ViewId][] = [
    ["plus-circle", "New Task", "primary", "tasks"],
    ["calendar", "Calendar", "secondary", "calendar"],
    ["mic", "Voice Chat", "secondary", "conversations"],
    ["play", "Workflow", "secondary", "workflows"],
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
      {cmds.map(([ic, l, v, target], i) => (
        <Button key={i} size="sm" variant={v} icon={<Icon name={ic} size={14} />} onClick={() => onNav(target)}>
          {l}
        </Button>
      ))}
    </div>
  );
}

function AgentsList({ onNav }: { onNav: (v: ViewId) => void }) {
  const { data } = useApi<Agent[]>("/api/agents");
  const agents = data ?? [];
  return (
    <Panel
      title="Your Team"
      eyebrow
      action={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => onNav("agents")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              borderRadius: "var(--r-sm)",
              border: "1px solid var(--jv-border-cyan)",
              background: "var(--grad-cyan-soft)",
              color: "var(--jv-cyan-300)",
              font: "var(--fw-semibold) 10px var(--font-hud)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            <Icon name="plus" size={13} />
            New Agent
          </button>
          <ViewAll onClick={() => onNav("agents")} />
        </div>
      }
      style={{ height: "100%" }}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {agents.length === 0 && (
        <EmptyState
          compact
          icon="bot"
          title="No agents yet"
          hint="Hire an agent and it will join your team here."
          action={
            <Button size="sm" variant="primary" icon={<Icon name="plus" size={14} />} onClick={() => onNav("agents")}>
              New Agent
            </Button>
          }
        />
      )}
      {agents.map((a) => {
        const c = a.status === "optimal" ? "var(--jv-green)" : "var(--jv-violet)";
        return (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 11px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
            <span style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: "var(--r-sm)", display: "grid", placeItems: "center", color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 32%, transparent)` }}>
              <Icon name={a.icon} size={16} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{a.name}</div>
              <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 1 }}>{a.role}</div>
            </div>
            <span style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: c }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />
              {a.statusLabel}
            </span>
          </div>
        );
      })}
    </Panel>
  );
}

export default function CommandCenter({ onNav }: { onNav: (v: ViewId) => void }) {
  // When the operator is actively giving a voice command, collapse the side
  // panels ("Your Team" + "Live Intelligence") so the center takes full focus.
  const [commandMode, setCommandMode] = useState(false);
  const sidePanel = (child: React.ReactNode) => (
    <div style={{ minWidth: 0, height: "100%", overflow: "hidden", opacity: commandMode ? 0 : 1, pointerEvents: commandMode ? "none" : "auto", transition: "opacity 260ms ease" }}>
      {child}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <StatusStrip />
        <QuickBar onNav={onNav} />
      </div>
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: commandMode ? "0px 1fr 0px" : "300px 1fr 340px",
          gap: commandMode ? 0 : 16,
          minHeight: 0,
          transition: "grid-template-columns 420ms cubic-bezier(0.4,0,0.2,1), gap 420ms ease",
        }}
      >
        {sidePanel(<AgentsList onNav={onNav} />)}
        <VoiceCore onModeChange={setCommandMode} />
        {sidePanel(
          <Panel title="Live Intelligence Feed" eyebrow action={<Badge status="live" solid>Live</Badge>} active style={{ height: "100%" }}>
            <Feed />
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <ViewAll onClick={() => onNav("ledger")}>View All Intelligence</ViewAll>
            </div>
          </Panel>,
        )}
      </div>
    </div>
  );
}
