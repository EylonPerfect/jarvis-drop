// Calendar — reminders grouped by overdue/today/upcoming, plus the Hubstaff
// time-tracking panel for today. Reconstructs the Calendar/Reminders screen.
import { useState } from "react";
import { Panel, Button, Icon, Input, IconButton, EmptyState, ConfirmDialog } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { Reminder, ReminderGroup, TimeEntry } from "@jarvis/shared";

const GROUP_C: Record<ReminderGroup, string> = {
  overdue: "var(--jv-red)",
  today: "var(--jv-amber)",
  upcoming: "var(--jv-cyan)",
};

const GROUP_ORDER: ReminderGroup[] = ["overdue", "today", "upcoming"];

// Palette cycled across time-tracking categories for the split bar + legend.
const CAT_COLORS = ["var(--jv-cyan)", "var(--jv-violet)", "var(--jv-green)", "var(--jv-amber)", "var(--jv-cyan-600)"];

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

function ReminderItem({ text, time, tone, onDelete }: { text: string; time: string; tone: string; onDelete: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 4px", borderBottom: "1px solid var(--jv-hairline)" }}>
      <span style={{ width: 13, height: 13, flex: "0 0 13px", borderRadius: "50%", border: `1.5px solid ${tone}`, boxShadow: `0 0 6px color-mix(in srgb, ${tone} 60%, transparent)` }} />
      <span style={{ flex: 1, font: "var(--fw-medium) 13px var(--font-body)", color: "var(--jv-text-soft)" }}>{text}</span>
      <span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>{time}</span>
      <IconButton icon="trash-2" tone="danger" title="Delete" size={26} onClick={onDelete} />
    </div>
  );
}

function Group({ id, items, onDelete }: { id: ReminderGroup; items: Reminder[]; onDelete: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: GROUP_C[id], marginBottom: 4 }}>{id}</div>
      {items.map((r) => <ReminderItem key={r.id} text={r.text} time={r.time} tone={GROUP_C[id]} onDelete={() => onDelete(r.id)} />)}
    </div>
  );
}

export default function Calendar() {
  const { data: reminders, reload: reloadReminders } = useApi<Reminder[]>("/api/calendar/reminders");
  const { data: entries } = useApi<TimeEntry[]>("/api/calendar/time");

  const rems = reminders ?? [];
  const times = entries ?? [];

  const [confirmClear, setConfirmClear] = useState(false);
  const [newText, setNewText] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newGroup, setNewGroup] = useState<ReminderGroup>("today");

  const grouped: Record<ReminderGroup, Reminder[]> = { overdue: [], today: [], upcoming: [] };
  for (const r of rems) grouped[r.group].push(r);

  const totalMinutes = times.reduce((sum, e) => sum + e.minutes, 0);

  // Category totals computed from the real time entries (no fabricated split).
  const catMap = new Map<string, number>();
  for (const e of times) {
    const key = e.category ?? "Uncategorized";
    catMap.set(key, (catMap.get(key) ?? 0) + e.minutes);
  }
  const cats = [...catMap.entries()].map(([label, minutes], i) => ({
    label,
    minutes,
    color: CAT_COLORS[i % CAT_COLORS.length],
    pct: totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0,
  }));

  const addReminder = async () => {
    const text = newText.trim();
    if (!text) return;
    try {
      await api.post<Reminder>("/api/calendar/reminders", { text, time: newTime.trim(), group: newGroup });
      setNewText("");
      setNewTime("");
      reloadReminders();
    } catch {
      /* offline — ignore */
    }
  };

  const removeReminder = async (id: string) => {
    try {
      await api.del(`/api/calendar/reminders/${id}`);
      reloadReminders();
    } catch {
      /* offline — ignore */
    }
  };

  const clearReminders = async () => {
    try {
      await api.del("/api/calendar/reminders");
      reloadReminders();
    } catch {
      /* offline — ignore */
    }
    setConfirmClear(false);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
      <Panel
        title="Reminders"
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>{rems.length} total</span>
            {rems.length > 0 && (
              <Button variant="danger" size="sm" glow={false} icon={<Icon name="trash-2" size={13} />} onClick={() => setConfirmClear(true)}>
                Clear all
              </Button>
            )}
          </div>
        }
      >
        {/* Create control — add a new reminder. */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 180px", minWidth: 140 }}>
            <Input
              icon={<Icon name="bell" size={15} />}
              placeholder="New reminder…"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addReminder()}
            />
          </div>
          <div style={{ flex: "0 1 130px" }}>
            <Input placeholder="Time" value={newTime} onChange={(e) => setNewTime(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addReminder()} />
          </div>
          <select
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value as ReminderGroup)}
            style={{
              height: 40,
              padding: "0 10px",
              borderRadius: "var(--r-sm)",
              background: "rgba(4, 12, 22, 0.6)",
              border: "1px solid var(--jv-border)",
              color: "var(--jv-text)",
              font: "var(--fw-medium) 12px var(--font-body)",
              cursor: "pointer",
              outline: "none",
            }}
          >
            {GROUP_ORDER.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <Button size="md" variant="secondary" icon={<Icon name="plus" size={14} />} onClick={addReminder}>
            Add
          </Button>
        </div>

        {rems.length === 0 ? (
          <EmptyState icon="bell" title="No reminders" hint="Add a reminder above to keep track of what's due, today, and upcoming." />
        ) : (
          GROUP_ORDER.map((id) => <Group key={id} id={id} items={grouped[id]} onDelete={removeReminder} />)
        )}
      </Panel>

      <Panel title="Hubstaff — Today" action={<span style={{ font: "var(--fw-semibold) 13px var(--font-mono)", color: "var(--jv-cyan-300)" }}>{fmtTotal(totalMinutes)}</span>}>
        {times.length === 0 ? (
          <EmptyState icon="clock" title="No time tracked" hint="Time entries for today will appear here once tracking begins." />
        ) : (
          <>
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
            {/* Stacked bar of today's split — computed from the real entries above. */}
            {cats.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 2 }}>
                  {cats.map((c, i) => (
                    <span key={i} style={{ width: c.pct + "%", background: c.color, boxShadow: `0 0 8px color-mix(in srgb, ${c.color} 60%, transparent)` }} />
                  ))}
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
                  {cats.map((c) => (
                    <span key={c.label} style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} />
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      <ConfirmDialog
        open={confirmClear}
        danger
        title="Clear all reminders?"
        message="This permanently removes every reminder. This cannot be undone."
        confirmLabel="Clear all"
        onConfirm={clearReminders}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
