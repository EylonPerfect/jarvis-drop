// Workflows — saved multi-step automations. Each has a trigger, an ordered set
// of steps (agent/tool nodes), a status and a run control.
(function () {
const { Panel, Badge, Button, Icon, StatTile } = window.JARVISDesignSystem_547efc;

const FLOWS = [
  ["Morning Briefing", "Every day · 8:00 am", "optimal", "Enabled", [
    ["calendar", "Pull today's calendar"], ["mail", "Summarize unread mail"], ["list-checks", "List overdue tasks"], ["mic", "Speak the briefing"],
  ]],
  ["Release Notes", "On git tag push", "optimal", "Enabled", [
    ["github", "Collect merged PRs"], ["code", "Diff since last tag"], ["file-text", "Draft notes"], ["message-square", "Post to Slack"],
  ]],
  ["Inbox Triage", "Every 2 hours", "standby", "Paused", [
    ["mail", "Fetch new mail"], ["sparkles", "Classify + prioritize"], ["list-checks", "Create tasks"],
  ]],
  ["Nightly Backup", "Every day · 2:00 am", "optimal", "Enabled", [
    ["database", "Dump Postgres"], ["hard-drive", "Snapshot vectors"], ["shield-check", "Verify integrity"],
  ]],
];

function StepNode({ ic, label, last }) {
  return (
    <React.Fragment>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", whiteSpace: "nowrap" }}>
        <Icon name={ic} size={14} color="var(--jv-cyan)" />
        <span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-soft)" }}>{label}</span>
      </div>
      {!last && <Icon name="chevron-right" size={15} color="var(--jv-text-faint)" />}
    </React.Fragment>
  );
}

function FlowCard({ name, trigger, tone, status, steps }) {
  const paused = status === "Paused";
  return (
    <div style={{ padding: 16, borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)" }}>{name}</span>
            <Badge status={paused ? "standby" : "optimal"}>{status}</Badge>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--fw-medium) 11.5px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 4 }}><Icon name="clock" size={12} />{trigger}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="ghost" icon={<Icon name="settings" size={13} />}>Edit</Button>
          <Button size="sm" variant={paused ? "secondary" : "primary"} icon={<Icon name={paused ? "play" : "play"} size={13} />}>Run</Button>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {steps.map((s, i) => <StepNode key={i} ic={s[0]} label={s[1]} last={i === steps.length - 1} />)}
      </div>
    </div>
  );
}

function Workflows() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
      <Panel title="Workflows" action={<Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />}>New Workflow</Button>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {FLOWS.map((f, i) => <FlowCard key={i} name={f[0]} trigger={f[1]} tone={f[2]} status={f[3]} steps={f[4]} />)}
        </div>
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel title="Automation" eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <StatTile value={4} label="Workflows" tone="info" />
            <StatTile value={3} label="Enabled" tone="optimal" />
            <StatTile value={1} label="Paused" tone="standby" />
            <StatTile value={28} label="Runs / week" tone="info" />
          </div>
        </Panel>
        <Panel title="Recent runs" eyebrow bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[["Morning Briefing", "8:00 am", "optimal"], ["Nightly Backup", "2:00 am", "optimal"], ["Release Notes", "yesterday", "optimal"], ["Inbox Triage", "paused", "standby"]].map(([n, t, tone], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 11px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-medium) 12.5px var(--font-body)", color: "var(--jv-text-soft)" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--jv-${tone === "optimal" ? "green" : "violet"})`, boxShadow: `0 0 6px var(--jv-${tone === "optimal" ? "green" : "violet"})` }} />{n}</span>
              <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{t}</span>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

Object.assign(window, { Workflows });
})();
