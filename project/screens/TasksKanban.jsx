// TasksKanban — the Tasks view: four status columns of task cards + mission stats.
(function () {
const { Panel, Tag, StatTile, Button, Input, Icon } = window.JARVISDesignSystem_547efc;

const COLS = [
  { id: "todo", label: "To Do", icon: "circle-dashed", tone: "info", count: 4, cards: [
    ["Design holographic onboarding tour", "high", ["ux", "onboarding", "hud"], "Unblocks 1"],
    ["Write voice pipeline integration tests", "medium", ["voice", "testing"], null],
    ["Audit MSIX capability manifest for mic + camera", "critical", ["msix", "security", "store"], "Unblocks 2"],
    ["Refactor command-center weather provider failover", "low", ["command-center", "weather"], null],
  ]},
  { id: "progress", label: "In Progress", icon: "loader", tone: "warn", count: 3, cards: [
    ["Build unified /command_center/today endpoint", "critical", ["command-center", "api", "flagship"], "Unblocks 3"],
    ["Wire Kokoro + edge-tts cascading TTS fallback", "high", ["voice", "tts"], "Unblocks 1"],
    ["Reduce Electron cold-boot below 7 seconds", "medium", ["performance", "electron", "boot"], null],
  ]},
  { id: "blocked", label: "Blocked", icon: "lock", tone: "critical", count: 2, cards: [
    ["Enable email verification in auth-api", "high", ["auth", "email", "verification"], "Waiting on 2"],
    ["Ship Store trial + license enforcement gate", "critical", ["store", "licensing", "billing"], "Waiting on 1"],
  ]},
  { id: "done", label: "Done", icon: "check-circle", tone: "optimal", count: 5, cards: [
    ["Fix mic permission handler in Electron + MSIX", "critical", ["voice", "permissions", "electron"], null],
    ["Split system.py god object into 8 modules", "high", ["refactor", "architecture"], null],
    ["Reorganize core/ into 7 domain subpackages", "medium", ["refactor", "core"], null],
    ["Add admin error-reporting dashboard pipeline", "high", ["admin", "observability"], null],
    ["Migrate task schema to Alembic revision", "low", ["database", "alembic", "tasks"], null],
  ]},
];

function Card({ title, priority, tags, link }) {
  return (
    <div style={{ padding: 12, borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ font: "var(--fw-semibold) 12.5px/1.35 var(--font-body)", color: "var(--jv-text)" }}>{title}</span>
        <Tag priority={priority} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>
      {link && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-medium) 11px var(--font-body)", color: link.startsWith("Waiting") ? "var(--jv-red)" : "var(--jv-cyan-300)" }}>
          <Icon name={link.startsWith("Waiting") ? "lock" : "git-branch"} size={12} />{link}
        </div>
      )}
    </div>
  );
}

function TasksKanban() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
      <Panel title="Tasks Kanban" action={<div style={{ display: "flex", gap: 8 }}><Button size="sm" variant="secondary" icon={<Icon name="plus" size={14} />}>New Task</Button></div>}>
        <div style={{ marginBottom: 14, maxWidth: 320 }}><Input icon={<Icon name="filter" size={15} />} placeholder="Filter tasks…" /></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {COLS.map((c) => (
            <div key={c.id}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid color-mix(in srgb, var(--jv-${c.tone === "info" ? "cyan" : c.tone === "warn" ? "amber" : c.tone === "critical" ? "red" : "green"}) 30%, transparent)` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: `var(--jv-${c.tone === "info" ? "cyan" : c.tone === "warn" ? "amber" : c.tone === "critical" ? "red" : "green"})` }}>
                  <Icon name={c.icon} size={14} />{c.label}
                </div>
                <span style={{ font: "var(--fw-bold) 11px var(--font-mono)", color: "var(--jv-text-muted)" }}>{c.count}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{c.cards.map((cd, i) => <Card key={i} title={cd[0]} priority={cd[1]} tags={cd[2]} link={cd[3]} />)}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Mission Stats" eyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <StatTile value={4} label="Ready" tone="info" />
          <StatTile value={3} label="In Progress" tone="warn" />
          <StatTile value={2} label="Blocked" tone="critical" />
          <StatTile value={5} label="Done" tone="optimal" />
        </div>
      </Panel>
    </div>
  );
}

Object.assign(window, { TasksKanban });
})();
