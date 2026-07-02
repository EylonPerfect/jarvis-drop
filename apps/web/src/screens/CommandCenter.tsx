import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, Badge, Button, Icon, EmptyState } from "../ds";
import { useApi } from "../api/hooks";
import { streamChat } from "../api/client";
import { useSpeech, useVoiceOutput } from "../hooks/useSpeech";
import type { ViewId } from "../components/AppShell";
import type { Agent, FeedItem, SystemHealth, StatusStripItem } from "@jarvis/shared";

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

// VoiceCore — real voice interaction: mic transcription (when the browser
// allows it — HTTPS/localhost + Chromium), a live transcript, an audio-reactive
// orb, and streamed replies from JARVIS. Falls back to a text composer so it
// works everywhere (e.g. plain-HTTP deployments where the mic is blocked).
function VoiceCore() {
  const [youText, setYouText] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  // Voice output on by default; the operator can mute it. Persist the choice.
  const [voiceOut, setVoiceOut] = useState(() => localStorage.getItem("jv.voiceOut") !== "off");

  const out = useVoiceOutput();
  // Refs so the streaming callback + effects always see current controls
  // without re-creating `send` (which would restart recognition mid-session).
  const speechRef = useRef<ReturnType<typeof useSpeech> | null>(null);
  const outRef = useRef(out);
  outRef.current = out;
  const voiceOutRef = useRef(voiceOut);
  voiceOutRef.current = voiceOut;

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t) return;
    outRef.current.cancel(); // stop any in-flight speech
    setYouText(t);
    setReply("");
    setBusy(true);
    let full = "";
    try {
      await streamChat({ message: t, mode: null }, (d) => {
        full += d;
        setReply((r) => r + d);
      });
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

  // Auto-open the mic when the Command Center loads (if the browser allows it).
  const autostarted = useRef(false);
  useEffect(() => {
    if (autostarted.current || !speech.supported) return;
    autostarted.current = true;
    speech.start();
  }, [speech]);

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

  const status = out.speaking
    ? "Speaking…"
    : listening
      ? "I am listening…"
      : busy
        ? "Thinking…"
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
      <div style={{ position: "relative", textAlign: "center", marginBottom: 24 }}>
        <div style={{ font: "var(--fw-bold) 42px/1 var(--font-display)", letterSpacing: "0.16em", color: ACCENT, textShadow: "var(--glow-cyan-lg)", whiteSpace: "nowrap" }}>LIVING SHADOW</div>
        <div style={{ font: "var(--fw-medium) 11px/1 var(--font-hud)", letterSpacing: "0.44em", color: "var(--jv-cyan-100)", marginTop: 10 }}>AI CORE · v3.0.0</div>
      </div>
      <RadialVoiceViz active={active} level={speech.level} bars={96} size={300} color={ACCENT} onClick={toggle} />
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
            aria-label={voiceOut ? "Mute Living Shadow voice" : "Unmute Living Shadow voice"}
            title={voiceOut ? "Living Shadow voice on" : "Living Shadow voice muted"}
            style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: "50%", cursor: "pointer", background: voiceOut ? "var(--grad-cyan-soft)" : "var(--jv-surface-3)", border: `1px solid ${voiceOut ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}`, color: voiceOut ? ACCENT : "var(--jv-text-muted)" }}
          >
            <Icon name={voiceOut ? "volume-2" : "volume-x"} size={14} />
          </button>
        )}
      </div>

      <div style={{ position: "relative", width: "100%", maxWidth: 460, marginTop: 22, display: "flex", flexDirection: "column", gap: 8, minHeight: 92 }}>
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
            Tap the core and speak — Living Shadow replies out loud.
          </div>
        )}
        {voiceProblem && (
          <div style={{ display: "flex", gap: 9, padding: "11px 13px", borderRadius: "var(--r-sm)", background: "color-mix(in srgb, var(--jv-amber) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-amber) 34%, transparent)" }}>
            <Icon name="alert-triangle" size={15} color="var(--jv-amber)" style={{ flex: "0 0 15px", marginTop: 1 }} />
            <div style={{ font: "var(--fw-regular) 12px/1.5 var(--font-body)", color: "var(--jv-text-soft)" }}>
              {voiceProblem} <span style={{ color: "var(--jv-text-faint)" }}>You can still type to Living Shadow below.</span>
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
            placeholder="Type to talk to Living Shadow…"
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
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <StatusStrip />
        <QuickBar onNav={onNav} />
      </div>
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "300px 1fr 340px", gap: 16, minHeight: 0 }}>
        <AgentsList onNav={onNav} />
        <VoiceCore />
        <Panel title="Live Intelligence Feed" eyebrow action={<Badge status="live" solid>Live</Badge>} active style={{ height: "100%" }}>
          <Feed />
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <ViewAll onClick={() => onNav("ledger")}>View All Intelligence</ViewAll>
          </div>
        </Panel>
      </div>
    </div>
  );
}
