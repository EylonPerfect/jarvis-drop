import { useMemo, useState } from "react";
import { Panel, Tag, StatTile, Button, Input, Icon, IconButton, EmptyState, ConfirmDialog } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { Task, TaskColumn, Priority } from "@jarvis/shared";

const COL_META: { id: TaskColumn; label: string; icon: string; tone: "info" | "warn" | "critical" | "optimal" }[] = [
  { id: "todo", label: "To Do", icon: "circle-dashed", tone: "info" },
  { id: "progress", label: "In Progress", icon: "loader", tone: "warn" },
  { id: "blocked", label: "Blocked", icon: "lock", tone: "critical" },
  { id: "done", label: "Done", icon: "check-circle", tone: "optimal" },
];

const toneVar = (t: string) =>
  t === "info" ? "cyan" : t === "warn" ? "amber" : t === "critical" ? "red" : "green";

function Card({
  task,
  onDelete,
  onMove,
  canMovePrev,
  canMoveNext,
}: {
  task: Task;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  canMovePrev: boolean;
  canMoveNext: boolean;
}) {
  const link = task.link;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      style={{ padding: 12, borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", display: "flex", flexDirection: "column", gap: 8, cursor: "grab" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ font: "var(--fw-semibold) 12.5px/1.35 var(--font-body)", color: "var(--jv-text)" }}>{task.title}</span>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, flex: "0 0 auto" }}>
          <Tag priority={task.priority} />
          {canMovePrev && <IconButton icon="chevron-left" tone="muted" title="Move left" size={24} onClick={() => onMove(-1)} />}
          {canMoveNext && <IconButton icon="chevron-right" tone="muted" title="Move right" size={24} onClick={() => onMove(1)} />}
          <IconButton icon="trash-2" tone="danger" title="Delete" size={24} onClick={onDelete} />
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {task.tags.map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
      </div>
      {link && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-medium) 11px var(--font-body)", color: link.startsWith("Waiting") ? "var(--jv-red)" : "var(--jv-cyan-300)" }}>
          <Icon name={link.startsWith("Waiting") ? "lock" : "git-branch"} size={12} />
          {link}
        </div>
      )}
    </div>
  );
}

export default function TasksKanban() {
  const { data, reload } = useApi<Task[]>("/api/tasks");
  const tasks = data ?? [];
  const [filter, setFilter] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) => t.title.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q)));
  }, [tasks, filter]);

  const byCol = (c: TaskColumn) => filtered.filter((t) => t.column === c);
  const count = (c: TaskColumn) => tasks.filter((t) => t.column === c).length;

  const addTask = async () => {
    const title = filter.trim() || "New task";
    try {
      await api.post<Task>("/api/tasks", { title, column: "todo", priority: "medium" as Priority, tags: [] });
      setFilter("");
      reload();
    } catch {
      /* offline — ignore */
    }
  };

  const removeTask = async (id: string) => {
    try {
      await api.del(`/api/tasks/${id}`);
      reload();
    } catch {
      /* offline — ignore */
    }
  };

  // Move a task to a target column (drag-drop or ◀/▶ fallback). No-op if the
  // target matches the current column.
  const moveTask = async (id: string, column: TaskColumn) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.column === column) return;
    try {
      await api.patch<Task>(`/api/tasks/${id}`, { column });
      reload();
    } catch {
      /* offline — ignore */
    }
  };

  // Move a card one column left/right in the COL_META order.
  const shiftTask = (t: Task, dir: -1 | 1) => {
    const i = COL_META.findIndex((c) => c.id === t.column);
    const next = COL_META[i + dir];
    if (next) moveTask(t.id, next.id);
  };

  const clearBoard = async () => {
    try {
      await api.del("/api/tasks");
      reload();
    } catch {
      /* offline — ignore */
    }
    setConfirmClear(false);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
      <Panel
        title="Tasks Kanban"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            {tasks.length > 0 && (
              <Button size="sm" variant="danger" glow={false} icon={<Icon name="trash-2" size={14} />} onClick={() => setConfirmClear(true)}>
                Clear board
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<Icon name="plus" size={14} />} onClick={addTask}>
              New Task
            </Button>
          </div>
        }
      >
        <div style={{ marginBottom: 14, maxWidth: 320 }}>
          <Input icon={<Icon name="filter" size={15} />} placeholder="Filter tasks…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {COL_META.map((c, ci) => {
            const cv = toneVar(c.tone);
            const cards = byCol(c.id);
            return (
              <div
                key={c.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) moveTask(id, c.id);
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                    paddingBottom: 8,
                    borderBottom: `1px solid color-mix(in srgb, var(--jv-${cv}) 30%, transparent)`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7, font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: `var(--jv-${cv})` }}>
                    <Icon name={c.icon} size={14} />
                    {c.label}
                  </div>
                  <span style={{ font: "var(--fw-bold) 11px var(--font-mono)", color: "var(--jv-text-muted)" }}>{count(c.id)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {cards.length === 0 ? (
                    <EmptyState compact icon={c.icon} title="Nothing here" hint={null} />
                  ) : (
                    cards.map((t) => (
                      <Card
                        key={t.id}
                        task={t}
                        onDelete={() => removeTask(t.id)}
                        onMove={(dir) => shiftTask(t, dir)}
                        canMovePrev={ci > 0}
                        canMoveNext={ci < COL_META.length - 1}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Mission Stats" eyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <StatTile value={count("todo")} label="Ready" tone="info" />
          <StatTile value={count("progress")} label="In Progress" tone="warn" />
          <StatTile value={count("blocked")} label="Blocked" tone="critical" />
          <StatTile value={count("done")} label="Done" tone="optimal" />
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmClear}
        danger
        title="Clear the board?"
        message="This permanently deletes every task in every column. This cannot be undone."
        confirmLabel="Clear board"
        onConfirm={clearBoard}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
