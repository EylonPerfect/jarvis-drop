// AppShell — JARVIS HUD chrome: left rail (logo + nav + voice status + focus),
// top bar (status, clock, search, model, operator), and bottom "TALK TO JARVIS" dock.
// Composes design-system primitives from window.JARVISDesignSystem_547efc.
(function () {
const { NavItem, Input, Badge, Waveform, VoiceOrb, Button, Icon, Logo } = window.JARVISDesignSystem_547efc;

const NAV = [
  { id: "command", icon: "layout-grid", label: "Command Center" },
  { id: "aicore", icon: "cpu", label: "AI Core" },
  { id: "agents", icon: "bot", label: "Agents" },
  { id: "tasks", icon: "list-checks", label: "Tasks", count: 3 },
  { id: "calendar", icon: "calendar", label: "Calendar" },
  { id: "memory", icon: "database", label: "Memory" },
  { id: "conversations", icon: "message-square", label: "Conversations", count: 12 },
  { id: "knowledge", icon: "network", label: "Knowledge Base" },
  { id: "tools", icon: "wrench", label: "Tools & Skills", count: 18 },
  { id: "workflows", icon: "workflow", label: "Workflows" },
  { id: "monitor", icon: "gauge", label: "System Monitor" },
];

function useClock() {
  const [t, setT] = React.useState(new Date());
  React.useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function Clock() {
  const t = useClock();
  const time = t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
  return (
    <div style={{ textAlign: "center", lineHeight: 1.1 }}>
      <div style={{ font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-soft)" }}>Monday, 15 June 2026</div>
      <div style={{ font: "var(--fw-bold) 28px/1 var(--font-display)", color: "var(--jv-cyan-300)", textShadow: "var(--glow-cyan)", letterSpacing: "0.02em" }}>{time.toLowerCase()}</div>
    </div>
  );
}

function Rail({ active, onNav }) {
  return (
    <aside style={{ width: 260, flex: "0 0 260px", display: "flex", flexDirection: "column", background: "linear-gradient(180deg, #0a1626, #070f1c)", borderRight: "1px solid var(--jv-border)", padding: "0 14px 14px" }}>
      {/* logo */}
      <div style={{ display: "flex", alignItems: "center", height: 80, padding: "0 4px", borderBottom: "1px solid var(--jv-hairline)", marginBottom: 14 }}>
        {Logo ? <Logo size={44} wordmark /> : (
          <div>
            <div style={{ font: "var(--fw-bold) 20px/1 var(--font-display)", letterSpacing: "0.22em", color: "var(--jv-text)" }}>JARVIS</div>
            <div style={{ font: "var(--fw-medium) 9px/1 var(--font-hud)", letterSpacing: "0.30em", color: "var(--jv-text-muted)", marginTop: 5 }}>COMMAND CENTER</div>
          </div>
        )}
      </div>
      {/* nav */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 3, overflowY: "auto", flex: 1, margin: "0 -4px", padding: "0 4px" }}>
        {NAV.map((n) => (
          <NavItem key={n.id} icon={<Icon name={n.icon} size={18} />} label={n.label} count={n.count} active={active === n.id} onClick={() => onNav(n.id)} />
        ))}
      </nav>
      {/* voice runs center-screen now; keep a slim spacer above the footer actions */}
      <div style={{ flex: "0 0 8px" }} />
      <button style={{ marginTop: 10, height: 38, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: "var(--r-sm)", border: "1px solid var(--jv-border)", background: "rgba(41,211,245,0.05)", color: "var(--jv-text-soft)", font: "var(--fw-semibold) 12px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}>
        <Icon name="zap" size={15} color="var(--jv-cyan)" /> Focus Mode
      </button>
    </aside>
  );
}

function TeamCost() {
  // Session spend across providers — mirrors the Memory “Session cost” panel.
  const total = "$0.7421";
  return (
    <div title="anthropic $0.6112 · groq $0.0934 · openai $0.0375" style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", borderRadius: "var(--r-sm)", border: "1px solid var(--jv-border)", clipPath: "var(--clip-chamfer)", background: "rgba(4,12,22,0.5)" }}>
      <Icon name="circle-dollar-sign" size={16} color="var(--jv-cyan)" />
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Team cost · today</div>
        <div style={{ font: "var(--fw-bold) 22px/1 var(--font-mono)", color: "var(--jv-cyan-300)", textShadow: "var(--glow-cyan)", marginTop: 3 }}>{total}</div>
      </div>
    </div>
  );
}

function TopBar({ onAbout }) {
  return (
    <header style={{ height: 64, flex: "0 0 64px", display: "flex", alignItems: "center", gap: 18, padding: "0 22px", borderBottom: "1px solid var(--jv-border)", background: "linear-gradient(180deg, rgba(12,26,46,0.6), transparent)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: "var(--r-sm)", border: "1px solid var(--jv-border)", clipPath: "var(--clip-chamfer)", background: "rgba(4,12,22,0.5)" }}>
        <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.14em", color: "var(--jv-text-muted)" }}>SYSTEM STATUS</span>
        <Badge status="optimal">Optimal</Badge>
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 18 }}><Clock /><TeamCost /></div>
      <Input icon={<Icon name="search" size={16} />} placeholder="Search…" wrapStyle={{ width: 240, height: 36 }} />
      <select style={{ height: 36, padding: "0 10px", borderRadius: "var(--r-sm)", background: "rgba(4,12,22,0.6)", border: "1px solid var(--jv-border)", color: "var(--jv-text-soft)", font: "var(--fw-medium) 12px var(--font-mono)" }}>
        <option>claude-opus-4-8</option>
        <option>claude-sonnet-4-6</option>
      </select>
      {["layout-grid", "bell", "info", "settings"].map((n) => (
        <button key={n} onClick={n === "info" ? onAbout : undefined} title={n === "info" ? "About J.A.R.V.I.S." : undefined} style={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", border: "1px solid var(--jv-border)", background: "transparent", color: "var(--jv-text-muted)", cursor: "pointer" }}>
          <Icon name={n} size={17} />
        </button>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px 5px 14px", borderRadius: "var(--r-pill)", border: "1px solid var(--jv-border-cyan)", background: "var(--grad-cyan-soft)" }}>
        <div style={{ textAlign: "right", lineHeight: 1.2 }}>
          <div style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)" }}>Operator</div>
          <div style={{ font: "var(--fw-medium) 9px var(--font-hud)", letterSpacing: "0.1em", color: "var(--jv-cyan-300)" }}>Commander</div>
        </div>
        <span style={{ width: 30, height: 30, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)" }}><Icon name="user" size={16} color="var(--jv-cyan)" /></span>
      </div>
    </header>
  );
}

function Dock() {
  return (
    <footer style={{ height: 72, flex: "0 0 72px", display: "flex", alignItems: "center", gap: 16, padding: "0 22px", borderTop: "1px solid var(--jv-border)", background: "linear-gradient(0deg, rgba(12,26,46,0.7), transparent)" }}>
      <div style={{ display: "flex", gap: 18 }}>
        {[["map-pin", "Location", "Bhimber, Paki…"], ["sun", "Weather", "28°C Overcast"], ["wifi", "Network", "Excellent"]].map(([ic, k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name={ic} size={16} color="var(--jv-cyan)" />
            <div style={{ lineHeight: 1.25 }}>
              <div style={{ font: "var(--fw-medium) 9px var(--font-hud)", letterSpacing: "0.08em", color: "var(--jv-text-muted)", textTransform: "uppercase" }}>{k}</div>
              <div style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text-soft)" }}>{v}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 26px", borderRadius: "var(--r-pill)", border: "1px solid var(--jv-border-cyan)", background: "var(--grad-cyan-soft)", boxShadow: "var(--glow-cyan)" }}>
          <Waveform height={20} bars={10} active color="var(--jv-cyan-300)" />
          <div style={{ textAlign: "center" }}>
            <div style={{ font: "var(--fw-bold) 14px var(--font-hud)", letterSpacing: "0.18em", color: "var(--jv-cyan-300)" }}>TALK TO JARVIS</div>
            <div style={{ font: "var(--fw-medium) 10px var(--font-body)", color: "var(--jv-text-soft)" }}>I am listening…</div>
          </div>
          <Waveform height={20} bars={10} active color="var(--jv-cyan-300)" />
        </div>
      </div>
      <Button variant="secondary" icon={<Icon name="play" size={14} />}>Executive Briefing</Button>
    </footer>
  );
}

function AppShell({ active, onNav, showDock = true, onAbout, children }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "var(--grad-app)", overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Rail active={active} onNav={onNav} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <TopBar onAbout={onAbout} />
          <main style={{ flex: 1, overflowY: "auto", padding: 18 }}>{children}</main>
        </div>
      </div>
      {showDock && <Dock />}
    </div>
  );
}

Object.assign(window, { AppShell });
})();
