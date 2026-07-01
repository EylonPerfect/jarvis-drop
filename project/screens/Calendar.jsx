// Calendar — reminders grouped by overdue/today/upcoming, plus the Hubstaff
// time-tracking panel for today. Reconstructs the Calendar/Reminders screen.
(function () {
const { Panel, Icon } = window.JARVISDesignSystem_547efc;

const REMINDERS = {
  overdue: [
    ["Reply to Sarah about Q3 roadmap", "13 Jun, 1:30 pm"],
    ["Submit expense report for May", "12 Jun, 10:00 pm"],
    ["Deep-work block: Voice pipeline", "13 Jun, 7:00 pm"],
    ["Stand-up notes to Engineering Lead", "13 Jun, 9:30 pm"],
    ["Renew TLS certificate on jarvis-core", "11 Jun, 2:00 pm"],
    ["1:1 with Engineering Lead", "14 Jun, 3:00 pm"],
    ["Back up local Postgres volume", "14 Jun, 2:00 am"],
  ],
  today: [["Design freeze checkpoint", "15 Jun, 10:00 pm"]],
  upcoming: [
    ["Submit MSIX build to the Microsoft Store", "17 Jun, 2:00 pm"],
    ["Confirm v3.0.0 release date with PM", "18 Jun, 4:00 pm"],
  ],
};
const GROUP_C = { overdue: "var(--jv-red)", today: "var(--jv-amber)", upcoming: "var(--jv-cyan)" };

const HUBSTAFF = [
  ["Command Center V1 — HUD layout", "Jarvis Design", "2 h 22 m"],
  ["Voice pipeline latency profiling", "Jarvis Core", "1 h 30 m"],
  ["Design review prep", "Jarvis Design", "55 min"],
  ["Code review — PR #482", "Jarvis Core", "1 h 9 m"],
  ["Release notes for v3.0.0", "Jarvis Core", "35 min"],
];

function ReminderItem({ text, time, tone }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 4px", borderBottom: "1px solid var(--jv-hairline)" }}>
      <span style={{ width: 13, height: 13, flex: "0 0 13px", borderRadius: "50%", border: `1.5px solid ${tone}`, boxShadow: `0 0 6px color-mix(in srgb, ${tone} 60%, transparent)` }} />
      <span style={{ flex: 1, font: "var(--fw-medium) 13px var(--font-body)", color: "var(--jv-text-soft)" }}>{text}</span>
      <span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>{time}</span>
    </div>
  );
}

function Group({ id, items }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: GROUP_C[id], marginBottom: 4 }}>{id}</div>
      {items.map((r, i) => <ReminderItem key={i} text={r[0]} time={r[1]} tone={GROUP_C[id]} />)}
    </div>
  );
}

function Calendar() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
      <Panel title="Reminders" action={<span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>10 total</span>}>
        <Group id="overdue" items={REMINDERS.overdue} />
        <Group id="today" items={REMINDERS.today} />
        <Group id="upcoming" items={REMINDERS.upcoming} />
      </Panel>

      <Panel title="Hubstaff — Today" action={<span style={{ font: "var(--fw-semibold) 13px var(--font-mono)", color: "var(--jv-cyan-300)" }}>6 h 31 m</span>}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {HUBSTAFF.map((h, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 4px", borderBottom: i < HUBSTAFF.length - 1 ? "1px solid var(--jv-hairline)" : "none" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{h[0]}</span>
                <span style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-muted)", marginLeft: 8 }}>· {h[1]}</span>
              </div>
              <span style={{ font: "var(--fw-medium) 12px var(--font-mono)", color: "var(--jv-text-soft)" }}>{h[2]}</span>
            </div>
          ))}
        </div>
        {/* simple stacked bar of today's split */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 2 }}>
            {[["var(--jv-cyan)", 36], ["var(--jv-violet)", 23], ["var(--jv-green)", 14], ["var(--jv-amber)", 18], ["var(--jv-cyan-600)", 9]].map(([c, w], i) => (
              <span key={i} style={{ width: w + "%", background: c, boxShadow: `0 0 8px color-mix(in srgb, ${c} 60%, transparent)` }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
            {[["Design", "var(--jv-cyan)"], ["Core dev", "var(--jv-violet)"], ["Review", "var(--jv-green)"], ["Docs", "var(--jv-amber)"]].map(([l, c]) => (
              <span key={l} style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
              </span>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

Object.assign(window, { Calendar });
})();
