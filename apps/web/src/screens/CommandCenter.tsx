import { useEffect, useMemo, useState } from "react";
import { Panel, Badge, Button, Icon } from "../ds";
import { useApi } from "../api/hooks";
import type { ViewId } from "../components/AppShell";
import type { Agent, FeedItem, SystemHealth, StatusStripItem } from "@jarvis/shared";

const ACCENT = "var(--jv-cyan)";

// RadialVoiceViz — concentric rings + circular waveform (no mic icon).
function RadialVoiceViz({ active = true, bars = 96, size = 300, color = ACCENT, showBars = true, onClick }: { active?: boolean; bars?: number; size?: number; color?: string; showBars?: boolean; onClick?: () => void }) {
  const seeds = useMemo(() => Array.from({ length: bars }, (_, i) => 0.32 + 0.68 * Math.abs(Math.sin(i * 2.3) * Math.cos(i * 0.7))), [bars]);
  const c = size / 2;
  const inner = size * 0.305;
  const maxLen = size * 0.15;
  return (
    <button onClick={onClick} aria-label="Toggle listening" style={{ position: "relative", width: size, height: size, border: "none", background: "transparent", cursor: "pointer", padding: 0 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `1px dashed ${color}`, opacity: 0.22, animation: active ? "jv-glow-breathe 2.6s ease-out infinite" : "none" }} />
      <span style={{ position: "absolute", inset: size * 0.13, borderRadius: "50%", border: `1px solid ${color}`, opacity: 0.16 }} />
      <span style={{ position: "absolute", inset: size * 0.3, borderRadius: "50%", background: `radial-gradient(circle at 50% 45%, color-mix(in srgb, ${color} 30%, transparent), transparent 72%)`, animation: active ? "jv-pulse 2.6s ease-out infinite" : "none" }} />
      <span style={{ position: "absolute", top: "50%", left: "50%", width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: "50%", background: color, boxShadow: `0 0 18px ${color}` }} />
      {showBars && (
        <svg viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", filter: `drop-shadow(0 0 4px color-mix(in srgb, ${color} 55%, transparent))` }}>
          {seeds.map((s, i) => {
            const ang = (i / bars) * 360;
            const len = maxLen * (active ? s : 0.42);
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

const EXCHANGES = [
  { you: "JARVIS, what's my system status?", jarvis: "All systems optimal, Commander. CPU at 15%, two agents running, memory at 3,380 vectors." },
  { you: "Draft the v3.0.0 release notes.", jarvis: "On it. Pulling 14 merged PRs since the last tag — I'll have a draft in the Compose panel shortly." },
  { you: "Anything overdue today?", jarvis: "Two tasks: “Polish voice pipeline” and the MSIX capability audit. Want me to reschedule them?" },
];

function VoiceCore() {
  const [listening, setListening] = useState(true);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!listening) return;
    const id = setInterval(() => setI((n) => (n + 1) % EXCHANGES.length), 5200);
    return () => clearInterval(id);
  }, [listening]);
  const ex = EXCHANGES[i];
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 480 }}>
      <div style={{ position: "absolute", width: 580, height: 580, borderRadius: "50%", background: `radial-gradient(circle at 50% 45%, color-mix(in srgb, ${ACCENT} 12%, transparent), transparent 62%)`, pointerEvents: "none" }} />
      <div style={{ position: "relative", textAlign: "center", marginBottom: 24 }}>
        <div style={{ font: "var(--fw-bold) 42px/1 var(--font-display)", letterSpacing: "0.34em", color: ACCENT, textShadow: "var(--glow-cyan-lg)" }}>JARVIS</div>
        <div style={{ font: "var(--fw-medium) 11px/1 var(--font-hud)", letterSpacing: "0.44em", color: "var(--jv-cyan-100)", marginTop: 10 }}>AI CORE · v3.0.0</div>
      </div>
      <RadialVoiceViz active={listening} bars={96} size={300} color={ACCENT} onClick={() => setListening((v) => !v)} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 24, font: "var(--fw-semibold) 12px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: listening ? ACCENT : "var(--jv-text-muted)" }}>
        {listening ? (
          <>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: ACCENT, boxShadow: `0 0 8px ${ACCENT}`, animation: "jv-pulse 2s ease-out infinite" }} /> I am listening…
          </>
        ) : (
          <>
            <Icon name="hand" size={14} /> Tap to speak
          </>
        )}
      </div>
      <div style={{ position: "relative", width: "100%", maxWidth: 460, marginTop: 22, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ alignSelf: "flex-end", maxWidth: "82%", padding: "9px 13px", borderRadius: "12px 12px 3px 12px", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", font: "var(--fw-medium) 12.5px/1.45 var(--font-body)", color: "var(--jv-text)" }}>
          {ex.you}
        </div>
        <div style={{ alignSelf: "flex-start", maxWidth: "88%", display: "flex", gap: 9 }}>
          <span style={{ flex: "0 0 26px", width: 26, height: 26, marginTop: 1, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)", color: ACCENT }}>
            <Icon name="sparkles" size={13} />
          </span>
          <div style={{ padding: "9px 13px", borderRadius: "12px 12px 12px 3px", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-soft)" }}>
            {ex.jarvis}
          </div>
        </div>
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
