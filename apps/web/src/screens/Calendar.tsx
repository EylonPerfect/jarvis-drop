// Calendar — reminders grouped by overdue/today/upcoming, plus the Hubstaff
// time-tracking panel for today. Reconstructs the Calendar/Reminders screen.
import { Panel } from "../ds";
import { useApi } from "../api/hooks";
import type { Reminder, ReminderGroup, TimeEntry } from "@jarvis/shared";

const REMINDERS_SEED: Reminder[] = [
  { id: "r1", text: "Reply to Sarah about Q3 roadmap", time: "13 Jun, 1:30 pm", group: "overdue" },
  { id: "r2", text: "Submit expense report for May", time: "12 Jun, 10:00 pm", group: "overdue" },
  { id: "r3", text: "Deep-work block: Voice pipeline", time: "13 Jun, 7:00 pm", group: "overdue" },
  { id: "r4", text: "Stand-up notes to Engineering Lead", time: "13 Jun, 9:30 pm", group: "overdue" },
  { id: "r5", text: "Renew TLS certificate on jarvis-core", time: "11 Jun, 2:00 pm", group: "overdue" },
  { id: "r6", text: "1:1 with Engineering Lead", time: "14 Jun, 3:00 pm", group: "overdue" },
  { id: "r7", text: "Back up local Postgres volume", time: "14 Jun, 2:00 am", group: "overdue" },
  { id: "r8", text: "Design freeze checkpoint", time: "15 Jun, 10:00 pm", group: "today" },
  { id: "r9", text: "Submit MSIX build to the Microsoft Store", time: "17 Jun, 2:00 pm", group: "upcoming" },
  { id: "r10", text: "Confirm v3.0.0 release date with PM", time: "18 Jun, 4:00 pm", group: "upcoming" },
];

const TIME_SEED: TimeEntry[] = [
  { id: "t1", title: "Command Center V1 — HUD layout", project: "Jarvis Design", minutes: 142, category: "Design" },
  { id: "t2", title: "Voice pipeline latency profiling", project: "Jarvis Core", minutes: 90, category: "Core dev" },
  { id: "t3", title: "Design review prep", project: "Jarvis Design", minutes: 55, category: "Design" },
  { id: "t4", title: "Code review — PR #482", project: "Jarvis Core", minutes: 69, category: "Review" },
  { id: "t5", title: "Release notes for v3.0.0", project: "Jarvis Core", minutes: 35, category: "Docs" },
];

const GROUP_C: Record<ReminderGroup, string> = {
  overdue: "var(--jv-red)",
  today: "var(--jv-amber)",
  upcoming: "var(--jv-cyan)",
};

const GROUP_ORDER: ReminderGroup[] = ["overdue", "today", "upcoming"];

// Render minutes back to the source's time strings ("2 h 22 m", "55 min", …).
function fmt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} m` : `${h} h`;
  return `${m} min`;
}

// Total time for the panel header (e.g. "6 h 31 m").
function fmtTotal(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${m} m`;
}

function ReminderItem({ text, time, tone }: { text: string; time: string; tone: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 4px", borderBottom: "1px solid var(--jv-hairline)" }}>
      <span style={{ width: 13, height: 13, flex: "0 0 13px", borderRadius: "50%", border: `1.5px solid ${tone}`, boxShadow: `0 0 6px color-mix(in srgb, ${tone} 60%, transparent)` }} />
      <span style={{ flex: 1, font: "var(--fw-medium) 13px var(--font-body)", color: "var(--jv-text-soft)" }}>{text}</span>
      <span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>{time}</span>
    </div>
  );
}

function Group({ id, items }: { id: ReminderGroup; items: Reminder[] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: GROUP_C[id], marginBottom: 4 }}>{id}</div>
      {items.map((r) => <ReminderItem key={r.id} text={r.text} time={r.time} tone={GROUP_C[id]} />)}
    </div>
  );
}

export default function Calendar() {
  const { data: reminders } = useApi<Reminder[]>("/api/calendar/reminders");
  const { data: entries } = useApi<TimeEntry[]>("/api/calendar/time");

  const rems = reminders ?? REMINDERS_SEED;
  const times = entries ?? TIME_SEED;

  const grouped: Record<ReminderGroup, Reminder[]> = { overdue: [], today: [], upcoming: [] };
  for (const r of rems) grouped[r.group].push(r);

  const totalMinutes = times.reduce((sum, e) => sum + e.minutes, 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
      <Panel title="Reminders" action={<span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>{rems.length} total</span>}>
        {GROUP_ORDER.map((id) => <Group key={id} id={id} items={grouped[id]} />)}
      </Panel>

      <Panel title="Hubstaff — Today" action={<span style={{ font: "var(--fw-semibold) 13px var(--font-mono)", color: "var(--jv-cyan-300)" }}>{fmtTotal(totalMinutes)}</span>}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {times.map((h, i) => (
            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 4px", borderBottom: i < times.length - 1 ? "1px solid var(--jv-hairline)" : "none" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{h.title}</span>
                <span style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-muted)", marginLeft: 8 }}>· {h.project}</span>
              </div>
              <span style={{ font: "var(--fw-medium) 12px var(--font-mono)", color: "var(--jv-text-soft)" }}>{fmt(h.minutes)}</span>
            </div>
          ))}
        </div>
        {/* simple stacked bar of today's split */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 2 }}>
            {([["var(--jv-cyan)", 36], ["var(--jv-violet)", 23], ["var(--jv-green)", 14], ["var(--jv-amber)", 18], ["var(--jv-cyan-600)", 9]] as [string, number][]).map(([c, w], i) => (
              <span key={i} style={{ width: w + "%", background: c, boxShadow: `0 0 8px color-mix(in srgb, ${c} 60%, transparent)` }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
            {([["Design", "var(--jv-cyan)"], ["Core dev", "var(--jv-violet)"], ["Review", "var(--jv-green)"], ["Docs", "var(--jv-amber)"]] as [string, string][]).map(([l, c]) => (
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
