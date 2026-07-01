import { useCallback, useMemo, useState } from "react";
import { Panel, Badge, Button, Icon } from "../ds";
import { useApi } from "../api/hooks";
import { streamChat } from "../api/client";
import { useSpeech } from "../hooks/useSpeech";
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
  const [draft, setDraft] = useState("");

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      setYouText(t);
      setReply("");
      setBusy(true);
      try {
        await streamChat({ message: t, mode: null }, (d) => setReply((r) => r + d));
      } catch {
        setReply("I couldn't reach the agent gateway just now.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const speech = useSpeech(send);
  const listening = speech.listening;
  const active = listening || busy;
  const displayedYou = speech.interim || youText;

  const toggle = () => {
    if (!speech.supported) return;
    if (listening) speech.stop();
    else speech.start();
  };

  const submitDraft = () => {
    const t = draft.trim();
    if (!t || busy) return;
    setDraft("");
    send(t);
  };

  const status = listening ? "I am listening…" : busy ? "Thinking…" : speech.supported ? "Tap the core to speak" : "Type to talk to JARVIS";

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 480 }}>
      <div style={{ position: "absolute", width: 580, height: 580, borderRadius: "50%", background: `radial-gradient(circle at 50% 45%, color-mix(in srgb, ${ACCENT} 12%, transparent), transparent 62%)`, pointerEvents: "none" }} />
      <div style={{ position: "relative", textAlign: "center", marginBottom: 24 }}>
        <div style={{ font: "var(--fw-bold) 42px/1 var(--font-display)", letterSpacing: "0.34em", color: ACCENT, textShadow: "var(--glow-cyan-lg)" }}>JARVIS</div>
        <div style={{ font: "var(--fw-medium) 11px/1 var(--font-hud)", letterSpacing: "0.44em", color: "var(--jv-cyan-100)", marginTop: 10 }}>AI CORE · v3.0.0</div>
      </div>
      <RadialVoiceViz active={active} level={speech.level} bars={96} size={300} color={ACCENT} onClick={toggle} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 24, font: "var(--fw-semibold) 12px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: active ? ACCENT : "var(--jv-text-muted)" }}>
        {listening ? (
          <>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: ACCENT, boxShadow: `0 0 8px ${ACCENT}`, animation: "jv-pulse 2s ease-out infinite" }} /> {status}
          </>
        ) : (
          <>
            <Icon name={busy ? "loader" : speech.supported ? "mic" : "keyboard"} size={14} /> {status}
          </>
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
        {!displayedYou && !reply && !busy && (
          <div style={{ textAlign: "center", font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-faint)" }}>
            {speech.supported ? "Tap the core and speak, or type below." : "Speak needs HTTPS + a Chromium browser — type below to talk to JARVIS."}
          </div>
        )}
      </div>

      {/* composer — always available so the core works even where the mic is blocked */}
      <div style={{ width: "100%", maxWidth: 460, marginTop: 16, display: "flex", alignItems: "center", gap: 10, padding: "8px 10px 8px 16px", borderRadius: "var(--r-md)", background: "var(--jv-void)", border: "1px solid var(--jv-border-cyan)", boxShadow: "0 0 20px rgba(41,211,245,0.08)" }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitDraft()}
          placeholder="Ask JARVIS anything…"
          style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--jv-text)", font: "var(--fw-medium) 13.5px var(--font-body)" }}
        />
        <button
          onClick={submitDraft}
          disabled={busy || !draft.trim()}
          style={{ width: 36, height: 36, flex: "0 0 36px", display: "grid", placeItems: "center", borderRadius: "50%", background: draft.trim() ? "var(--jv-cyan)" : "var(--jv-surface-3)", border: "none", color: draft.trim() ? "var(--accent-contrast)" : "var(--jv-text-muted)", cursor: busy ? "default" : "pointer", boxShadow: draft.trim() ? "var(--glow-cyan)" : "none" }}
        >
          <Icon name={busy ? "loader" : "arrow-up"} size={17} />
        </button>
      </div>
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

const FEED_SEED: FeedItem[] = [
  { icon: "calendar", tone: "info", title: "Design review with the product team", sub: "Meeting", tag: "INFO" },
  { icon: "alert-triangle", tone: "warn", title: '2 tasks are overdue — "Polish voic…"', sub: "Overdue", tag: "WARN" },
  { icon: "git-pull-request", tone: "info", title: "3 pull requests are awaiting your revi…", sub: "Github", tag: "TIP" },
  { icon: "lightbulb", tone: "info", title: "Your deep-work block is 2–4 PM. Noti…", sub: "Focus", tag: "TIP" },
  { icon: "activity", tone: "optimal", title: "CPU usage at 15%", sub: "System load nominal", tag: "LIVE" },
];

function Feed() {
  const { data } = useApi<FeedItem[]>("/api/command/feed");
  const items = data ?? FEED_SEED;
  const tone: Record<string, "info" | "warn" | "optimal"> = { INFO: "info", WARN: "warn", TIP: "info", LIVE: "optimal" };
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

const STRIP_SEED: StatusStripItem[] = [
  { icon: "cpu", name: "AI Core", status: "Active", tone: "optimal" },
  { icon: "database", name: "Memory", status: "3,380", tone: "info" },
  { icon: "mic", name: "Voice", status: "Online", tone: "optimal" },
  { icon: "bot", name: "Agents", status: "2 Running", tone: "standby" },
  { icon: "boxes", name: "LLMs", status: "4 Connected", tone: "optimal" },
  { icon: "shield-check", name: "System", status: "Optimal", tone: "optimal" },
];

function StatusStrip() {
  const { data } = useApi<SystemHealth>("/api/system/health");
  const items = data?.strip ?? STRIP_SEED;
  const col = (t: string) => (t === "optimal" ? "var(--jv-green)" : t === "standby" ? "var(--jv-violet)" : t === "warn" ? "var(--jv-amber)" : "var(--jv-cyan)");
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "9px 16px", borderRadius: "var(--r-md)", background: "rgba(10,22,38,0.5)", border: "1px solid var(--jv-border-soft)", flex: 1, minWidth: 0, overflowX: "auto" }}>
      <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", color: "var(--jv-cyan-300)", marginRight: 4, whiteSpace: "nowrap" }}>SYSTEM STATUS</span>
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

const AGENTS_SEED: Agent[] = [
  { id: "ag_coding", icon: "code", name: "Coding Agent", role: "Writing code", status: "optimal", statusLabel: "Active" },
  { id: "ag_research", icon: "search", name: "Research Agent", role: "Deep analysis", status: "optimal", statusLabel: "Active" },
  { id: "ag_memory", icon: "database", name: "Memory Agent", role: "Idle", status: "standby", statusLabel: "Standby" },
  { id: "ag_browser", icon: "globe", name: "Browser Agent", role: "Idle", status: "standby", statusLabel: "Standby" },
  { id: "ag_task", icon: "list-checks", name: "Task Agent", role: "Idle", status: "standby", statusLabel: "Standby" },
  { id: "ag_system", icon: "shield-check", name: "System Agent", role: "Monitoring", status: "optimal", statusLabel: "Active" },
];

function AgentsList({ onNav }: { onNav: (v: ViewId) => void }) {
  const { data } = useApi<Agent[]>("/api/agents");
  const agents = data ?? AGENTS_SEED;
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
            <ViewAll>View All Intelligence</ViewAll>
          </div>
        </Panel>
      </div>
    </div>
  );
}
