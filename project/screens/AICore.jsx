// AICore — the AI Control Center: connect provider keys, choose the active model,
// keep expert routing controls available. Reconstructs the provider-setup screen.
(function () {
const { Panel, Badge, Button, Input, Switch, Icon } = window.JARVISDesignSystem_547efc;

function MetaTile({ icon, label, value }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--grad-panel)", border: "1px solid var(--jv-border-soft)" }}>
      <span style={{ width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}><Icon name={icon} size={16} /></span>
      <div>
        <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>{label}</div>
        <div style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)", marginTop: 3 }}>{value}</div>
      </div>
    </div>
  );
}

function ProviderCard({ name, tier, tierTone, placeholder, filled, mono = true }) {
  const [v, setV] = React.useState(filled ? "sk-••••••••••••••••••" : "");
  const [show, setShow] = React.useState(false);
  const tierC = { free: "var(--jv-green)", paid: "var(--jv-violet)", "free tier": "var(--jv-green)" }[tierTone] || "var(--jv-cyan)";
  return (
    <div style={{ padding: 16, borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: `1px solid ${filled ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}`, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ font: "var(--fw-bold) 14px var(--font-body)", color: "var(--jv-text)" }}>{name}</span>
          <span style={{ padding: "2px 7px", borderRadius: 3, font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: tierC, background: `color-mix(in srgb, ${tierC} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${tierC} 34%, transparent)` }}>{tier}</span>
        </div>
        <a href="#" style={{ display: "flex", alignItems: "center", gap: 4, font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>Get key <Icon name="external-link" size={12} /></a>
      </div>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input value={show ? v : v} onChange={(e) => setV(e.target.value)} type={show ? "text" : "password"} placeholder={placeholder}
          style={{ width: "100%", height: 40, padding: "0 40px 0 14px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", color: "var(--jv-text)", font: `var(--fw-medium) 13px ${mono ? "var(--font-mono)" : "var(--font-body)"}`, outline: "none", boxSizing: "border-box" }} />
        <button onClick={() => setShow((s) => !s)} style={{ position: "absolute", right: 10, background: "none", border: "none", color: "var(--jv-text-muted)", cursor: "pointer", display: "grid", placeItems: "center" }}><Icon name={show ? "eye-off" : "eye"} size={16} /></button>
      </div>
      <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>Paste a key here to connect this provider to Jarvis.</div>
    </div>
  );
}

function AICore() {
  const [routing, setRouting] = React.useState(true);
  const [stream, setStream] = React.useState(true);
  const [verify, setVerify] = React.useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* hero */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>
        <Panel>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <Badge status="optimal">Ready for chat</Badge>
            <Badge status="info" dot={false}><Icon name="shield" size={11} style={{ marginRight: 4 }} />guarded privacy</Badge>
          </div>
          <div style={{ font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 8 }}>AI Control Center</div>
          <p style={{ margin: "0 0 16px", maxWidth: 620, font: "var(--fw-regular) 13.5px/1.6 var(--font-body)", color: "var(--jv-text-soft)" }}>Connect provider keys, choose the model Jarvis uses in chat, and keep expert routing controls available without making setup feel technical.</p>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="primary" icon={<Icon name="refresh-cw" size={14} />}>Refresh models</Button>
            <Button variant="ghost" icon={<Icon name="zap" size={14} />}>Get free Groq key</Button>
          </div>
        </Panel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <MetaTile icon="cpu" label="Active model" value="claude-opus-4-8" />
          <MetaTile icon="plug" label="Connected providers" value="4 ready" />
          <MetaTile icon="git-branch" label="Fallbacks" value="Use active model" />
        </div>
      </div>

      {/* connect providers */}
      <Panel title="Connect AI providers" action={<Button size="sm" variant="secondary" icon={<Icon name="lock" size={13} />}>Save provider keys</Button>}>
        <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12px/1.55 var(--font-body)", color: "var(--jv-text-muted)", maxWidth: 640 }}>Add or update provider keys here. Jarvis stores them in your per-user configuration and refreshes available models immediately, so packaged Electron installs do not depend on .env files.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
          {[["Saved keys", "4 of 5"], ["Recommended start", "Groq free tier"], ["Storage", "Jarvis user config"]].map(([l, v]) => (
            <div key={l} style={{ padding: 14, borderRadius: "var(--r-md)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>{l}</div>
              <div style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)", marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <ProviderCard name="Groq" tier="Free" tierTone="free" placeholder="gsk_…" filled />
          <ProviderCard name="OpenRouter" tier="Paid" tierTone="paid" placeholder="sk-or-…" />
          <ProviderCard name="Gemini" tier="Free tier" tierTone="free tier" placeholder="AIza…" />
          <ProviderCard name="OpenAI" tier="Paid" tierTone="paid" placeholder="sk-…" />
          <ProviderCard name="Claude" tier="Paid" tierTone="paid" placeholder="sk-ant-…" />
        </div>
      </Panel>

      {/* advanced */}
      <Panel title="Advanced settings" eyebrow>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {[["Expert model routing", "Route each turn to the best-fit model automatically", routing, setRouting], ["Token streaming", "Stream responses token-by-token to the HUD", stream, setStream], ["Response verification pass", "Run a second-model check on critical answers", verify, setVerify]].map(([t, d, val, set], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderBottom: i < 2 ? "1px solid var(--jv-hairline)" : "none" }}>
              <div>
                <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{t}</div>
                <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2 }}>{d}</div>
              </div>
              <Switch checked={val} onChange={set} />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

Object.assign(window, { AICore });
})();
