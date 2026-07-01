// CommandCenter — the flagship dashboard view. Reconstructs the HUD grid:
// AI Core overview, orbital globe hero, intelligence feed, agents, timeline,
// quick commands, system monitor, memory insights, LLM status.
(function () {
const { Panel, Badge, StatusRow, ProgressRing, VoiceOrb, Waveform, Button, Icon } = window.JARVISDesignSystem_547efc;

// RadialVoiceViz — concentric rings + a circular waveform (no mic icon).
function RadialVoiceViz({ active = true, bars = 56, size = 210, color = "var(--jv-cyan)", showBars = true, onClick }) {
  const seeds = React.useMemo(
    () => Array.from({ length: bars }, (_, i) => 0.32 + 0.68 * Math.abs(Math.sin(i * 2.3) * Math.cos(i * 0.7))),
    [bars]
  );
  const c = size / 2;
  const inner = size * 0.305;
  const maxLen = size * 0.15;
  return (
    <button onClick={onClick} aria-label="Toggle listening" style={{ position: "relative", width: size, height: size, border: "none", background: "transparent", cursor: "pointer", padding: 0 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `1px dashed ${color}`, opacity: 0.22, animation: active ? "jv-glow-breathe 2.6s ease-out infinite" : "none" }} />
      <span style={{ position: "absolute", inset: size * 0.13, borderRadius: "50%", border: `1px solid ${color}`, opacity: 0.16 }} />
      <span style={{ position: "absolute", inset: size * 0.30, borderRadius: "50%", background: `radial-gradient(circle at 50% 45%, color-mix(in srgb, ${color} 30%, transparent), transparent 72%)`, animation: active ? "jv-pulse 2.6s ease-out infinite" : "none" }} />
      <span style={{ position: "absolute", top: "50%", left: "50%", width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: "50%", background: color, boxShadow: `0 0 18px ${color}` }} />
      {showBars && (
        <svg viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", filter: `drop-shadow(0 0 4px color-mix(in srgb, ${color} 55%, transparent))` }}>
          {seeds.map((s, i) => {
            const ang = (i / bars) * 360;
            const len = maxLen * (active ? s : 0.42);
            return (
              <g key={i} transform={`rotate(${ang} ${c} ${c})`}>
                <rect x={c - 1.3} y={c - inner - len} width={2.6} height={len} rx={1.3} fill={color}
                  style={{ transformBox: "fill-box", transformOrigin: "center bottom", animation: active ? `jv-equalize ${0.7 + (i % 6) * 0.16}s ease-out ${i * 0.03}s infinite` : "none" }} />
              </g>
            );
          })}
        </svg>
      )}
    </button>
  );
}

// VoiceCore — the centerpiece: speak with JARVIS. Circular waveform, listening
// state and a rolling transcript exchange.
function VoiceCore({ tweaks = {} }) {
  const { viz = "radial", bars = 56, showTranscript = true, accentColor = "var(--jv-cyan)" } = tweaks;
  const EXCHANGES = [
    { you: "JARVIS, what's my system status?", jarvis: "All systems optimal, Commander. CPU at 15%, two agents running, memory at 3,380 vectors." },
    { you: "Draft the v3.0.0 release notes.", jarvis: "On it. Pulling 14 merged PRs since the last tag — I'll have a draft in the Compose panel shortly." },
    { you: "Anything overdue today?", jarvis: "Two tasks: \u201cPolish voice pipeline\u201d and the MSIX capability audit. Want me to reschedule them?" },
  ];
  const [listening, setListening] = React.useState(true);
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    if (!listening) return;
    const id = setInterval(() => setI((n) => (n + 1) % EXCHANGES.length), 5200);
    return () => clearInterval(id);
  }, [listening]);
  const ex = EXCHANGES[i];
  const toggle = () => setListening((v) => !v);
  const bigSize = tweaks.vizSize || 300;

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 480 }}>
      {/* ambient glow — no box */}
      <div style={{ position: "absolute", width: 580, height: 580, borderRadius: "50%", background: "radial-gradient(circle at 50% 45%, color-mix(in srgb, " + accentColor + " 12%, transparent), transparent 62%)", pointerEvents: "none" }} />

      {/* header */}
      <div style={{ position: "relative", textAlign: "center", marginBottom: 24 }}>
        <div style={{ font: "var(--fw-bold) 42px/1 var(--font-display)", letterSpacing: "0.34em", color: accentColor, textShadow: "var(--glow-cyan-lg)" }}>JARVIS</div>
        <div style={{ font: "var(--fw-medium) 11px/1 var(--font-hud)", letterSpacing: "0.44em", color: "var(--jv-cyan-100)", marginTop: 10 }}>AI CORE · v3.0.0</div>
      </div>

      {/* visualizer */}
      {viz === "linear" ? (
        <div style={{ position: "relative", width: bigSize, height: bigSize, display: "grid", placeItems: "center", cursor: "pointer" }} onClick={toggle}>
          <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `1px dashed ${accentColor}`, opacity: 0.2, animation: listening ? "jv-glow-breathe 2.6s ease-out infinite" : "none" }} />
          <span style={{ position: "absolute", inset: bigSize * 0.14, borderRadius: "50%", border: `1px solid ${accentColor}`, opacity: 0.14 }} />
          <Waveform height={92} bars={Math.round(bars / 2)} active={listening} color={accentColor} style={{ width: bigSize * 0.58 }} />
        </div>
      ) : (
        <RadialVoiceViz active={listening} bars={bars} size={bigSize} color={accentColor} showBars={viz !== "pulse"} onClick={toggle} />
      )}

      {/* status */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 24, font: "var(--fw-semibold) 12px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: listening ? accentColor : "var(--jv-text-muted)" }}>
        {listening
          ? <React.Fragment><span style={{ width: 7, height: 7, borderRadius: "50%", background: accentColor, boxShadow: "0 0 8px " + accentColor, animation: "jv-pulse 2s ease-out infinite" }} /> I am listening…</React.Fragment>
          : <React.Fragment><Icon name="hand" size={14} /> Tap to speak</React.Fragment>}
      </div>

      {/* transcript */}
      {showTranscript && (
        <div style={{ position: "relative", width: "100%", maxWidth: 460, marginTop: 22, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ alignSelf: "flex-end", maxWidth: "82%", padding: "9px 13px", borderRadius: "12px 12px 3px 12px", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", font: "var(--fw-medium) 12.5px/1.45 var(--font-body)", color: "var(--jv-text)" }}>
            {ex.you}
          </div>
          <div style={{ alignSelf: "flex-start", maxWidth: "88%", display: "flex", gap: 9 }}>
            <span style={{ flex: "0 0 26px", width: 26, height: 26, marginTop: 1, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)", color: accentColor }}><Icon name="sparkles" size={13} /></span>
            <div style={{ padding: "9px 13px", borderRadius: "12px 12px 12px 3px", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-soft)" }}>
              {ex.jarvis}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewAll({ children = "View All" }) {
  return <a href="#" style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-cyan-300)" }}>{children} ›</a>;
}

function Feed() {
  const items = [
    ["calendar", "info", "Design review with the product team", "Meeting", "INFO"],
    ["alert-triangle", "warn", "2 tasks are overdue — \"Polish voic…\"", "Overdue", "WARN"],
    ["git-pull-request", "info", "3 pull requests are awaiting your revi…", "Github", "TIP"],
    ["lightbulb", "info", "Your deep-work block is 2–4 PM. Noti…", "Focus", "TIP"],
    ["activity", "optimal", "CPU usage at 15%", "System load nominal", "LIVE"],
  ];
  const tone = { INFO: "info", WARN: "warn", TIP: "info", LIVE: "optimal" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map(([ic, t, title, sub, tag], i) => (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 10px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
          <span style={{ width: 26, height: 26, flex: "0 0 26px", display: "grid", placeItems: "center", borderRadius: "var(--r-xs)", color: `var(--jv-${t === "optimal" ? "green" : t === "warn" ? "amber" : "cyan"})`, background: "rgba(41,211,245,0.08)" }}><Icon name={ic} size={14} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
            <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", color: "var(--jv-text-muted)", textTransform: "uppercase", marginTop: 2 }}>{sub}</div>
          </div>
          <Badge status={tone[tag]} dot={false}>{tag}</Badge>
        </div>
      ))}
    </div>
  );
}

function StatusStrip() {
  const items = [
    ["cpu", "AI Core", "Active", "optimal"],
    ["database", "Memory", "3,380", "info"],
    ["mic", "Voice", "Online", "optimal"],
    ["bot", "Agents", "2 Running", "standby"],
    ["boxes", "LLMs", "4 Connected", "optimal"],
    ["shield-check", "System", "Optimal", "optimal"],
  ];
  const col = (t) => (t === "optimal" ? "var(--jv-green)" : t === "standby" ? "var(--jv-violet)" : t === "warn" ? "var(--jv-amber)" : "var(--jv-cyan)");
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "9px 16px", borderRadius: "var(--r-md)", background: "rgba(10,22,38,0.5)", border: "1px solid var(--jv-border-soft)", flex: 1, minWidth: 0, overflowX: "auto" }}>
      <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", color: "var(--jv-cyan-300)", marginRight: 4, whiteSpace: "nowrap" }}>SYSTEM STATUS</span>
      {items.map(([ic, n, s, t], i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderLeft: "1px solid var(--jv-hairline)", marginLeft: 12, whiteSpace: "nowrap" }}>
          <Icon name={ic} size={15} color={col(t)} />
          <span style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)" }}>{n}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-medium) 11px var(--font-hud)", letterSpacing: "0.04em", color: col(t) }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: col(t), boxShadow: `0 0 6px ${col(t)}` }} />{s}
          </span>
        </div>
      ))}
    </div>
  );
}

function QuickBar() {
  const cmds = [["plus-circle", "New Task", "primary"], ["calendar", "Calendar", "secondary"], ["mic", "Voice Chat", "secondary"], ["play", "Workflow", "secondary"]];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
      {cmds.map(([ic, l, v], i) => (
        <Button key={i} size="sm" variant={v} icon={<Icon name={ic} size={14} />}>{l}</Button>
      ))}
    </div>
  );
}

function AgentsList() {
  const agents = [
    ["code", "Coding Agent", "Writing code", "optimal"],
    ["search", "Research Agent", "Deep analysis", "optimal"],
    ["database", "Memory Agent", "Idle", "standby"],
    ["globe", "Browser Agent", "Idle", "standby"],
    ["list-checks", "Task Agent", "Idle", "standby"],
    ["shield-check", "System Agent", "Monitoring", "optimal"],
  ];
  return (
    <Panel title="Your Team" eyebrow action={<div style={{ display: "flex", alignItems: "center", gap: 10 }}><button style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: "var(--r-sm)", border: "1px solid var(--jv-border-cyan)", background: "var(--grad-cyan-soft)", color: "var(--jv-cyan-300)", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="plus" size={13} />New Agent</button><ViewAll /></div>} style={{ height: "100%" }} bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {agents.map(([ic, n, role, t], i) => {
        const c = t === "optimal" ? "var(--jv-green)" : "var(--jv-violet)";
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 11px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
            <span style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: "var(--r-sm)", display: "grid", placeItems: "center", color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 32%, transparent)` }}><Icon name={ic} size={16} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{n}</div>
              <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 1 }}>{role}</div>
            </div>
            <span style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: c }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />{t === "optimal" ? "Active" : "Standby"}
            </span>
          </div>
        );
      })}
    </Panel>
  );
}

function CommandCenter({ tweaks = {} }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      {/* top — system status + quick commands (inline, not blocks) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <StatusStrip />
        <QuickBar />
      </div>

      {/* main — teammates (left) · JARVIS core (center, no box) · feed (right) */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "300px 1fr 340px", gap: 16, minHeight: 0 }}>
        <AgentsList />
        <VoiceCore tweaks={tweaks} />
        <Panel title="Live Intelligence Feed" eyebrow action={<Badge status="live" solid>Live</Badge>} active style={{ height: "100%" }}>
          <Feed />
          <div style={{ textAlign: "center", marginTop: 12 }}><ViewAll>View All Intelligence</ViewAll></div>
        </Panel>
      </div>
    </div>
  );
}

Object.assign(window, { CommandCenter });
})();
