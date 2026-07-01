// ToolsSkills — the tool & skill registry: connected MCP servers, built-in
// skills, and integrations, each with a status and toggle. 18 total.
(function () {
const { Panel, Badge, Icon, Switch, Button } = window.JARVISDesignSystem_547efc;

const GROUPS = [
  ["MCP Servers", [
    ["github", "GitHub", "Repos, PRs, issues", true, "optimal"],
    ["message-circle", "WhatsApp", "Messaging bridge", true, "warn"],
    ["hard-drive", "Filesystem", "Local file access", true, "optimal"],
    ["globe", "Web Search", "Live web + fetch", true, "optimal"],
    ["calendar", "Google Calendar", "Events & reminders", false, "neutral"],
    ["mail", "Gmail", "Read & draft mail", false, "neutral"],
  ]],
  ["Built-in Skills", [
    ["code", "Code Interpreter", "Run & test code", true, "optimal"],
    ["file-text", "Document Reader", "PDF / DOCX / PPTX", true, "optimal"],
    ["image", "Vision", "Screenshot analysis", true, "optimal"],
    ["mic", "Voice I/O", "STT + cascading TTS", true, "optimal"],
    ["database", "Memory Recall", "Vector retrieval", true, "optimal"],
    ["terminal", "Shell", "System commands", true, "warn"],
  ]],
  ["Integrations", [
    ["clock", "Hubstaff", "Time tracking", true, "optimal"],
    ["trello", "Jira", "Issue sync", false, "neutral"],
    ["figma", "Figma", "Design handoff", false, "neutral"],
    ["slack", "Slack", "Team notifications", true, "optimal"],
    ["credit-card", "Stripe", "Billing events", false, "neutral"],
    ["bell", "Notifications", "Desktop alerts", true, "optimal"],
  ]],
];

function ToolCard({ ic, name, desc, on, tone }) {
  const [enabled, setEnabled] = React.useState(on);
  const c = tone === "optimal" ? "var(--jv-green)" : tone === "warn" ? "var(--jv-amber)" : "var(--jv-text-faint)";
  return (
    <div style={{ padding: "13px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: `1px solid ${enabled ? "var(--jv-border)" : "var(--jv-border-soft)"}`, opacity: enabled ? 1 : 0.72, display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 38, height: 38, flex: "0 0 38px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: enabled ? "var(--jv-cyan)" : "var(--jv-text-muted)", background: enabled ? "rgba(41,211,245,0.08)" : "rgba(120,160,190,0.06)" }}><Icon name={ic} size={18} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{name}</span>
          {enabled && <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />}
        </div>
        <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2 }}>{desc}</div>
      </div>
      <Switch checked={enabled} onChange={setEnabled} />
    </div>
  );
}

function ToolsSkills() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {GROUPS.map(([label, items]) => (
        <Panel key={label} title={label} eyebrow action={<Badge status="info" dot={false}>{items.filter((i) => i[3]).length} active</Badge>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {items.map((t, i) => <ToolCard key={i} ic={t[0]} name={t[1]} desc={t[2]} on={t[3]} tone={t[4]} />)}
          </div>
        </Panel>
      ))}
    </div>
  );
}

Object.assign(window, { ToolsSkills });
})();
