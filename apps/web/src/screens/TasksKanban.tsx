import { useMemo, useState } from "react";
import { Panel, Tag, StatTile, Button, Input, Icon } from "../ds";
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

const SEED: Task[] = [
  { id: "t1", title: "Design holographic onboarding tour", column: "todo", priority: "high", tags: ["ux", "onboarding", "hud"], link: "Unblocks 1" },
  { id: "t2", title: "Write voice pipeline integration tests", column: "todo", priority: "medium", tags: ["voice", "testing"], link: null },
  { id: "t3", title: "Audit MSIX capability manifest for mic + camera", column: "todo", priority: "critical", tags: ["msix", "security", "store"], link: "Unblocks 2" },
  { id: "t4", title: "Refactor command-center weather provider failover", column: "todo", priority: "low", tags: ["command-center", "weather"], link: null },
  { id: "t5", title: "Build unified /command_center/today endpoint", column: "progress", priority: "critical", tags: ["command-center", "api", "flagship"], link: "Unblocks 3" },
  { id: "t6", title: "Wire Kokoro + edge-tts cascading TTS fallback", column: "progress", priority: "high", tags: ["voice", "tts"], link: "Unblocks 1" },
  { id: "t7", title: "Reduce Electron cold-boot below 7 seconds", column: "progress", priority: "medium", tags: ["performance", "electron", "boot"], link: null },
  { id: "t8", title: "Enable email verification in auth-api", column: "blocked", priority: "high", tags: ["auth", "email", "verification"], link: "Waiting on 2" },
  { id: "t9", title: "Ship Store trial + license enforcement gate", column: "blocked", priority: "critical", tags: ["store", "licensing", "billing"], link: "Waiting on 1" },
  { id: "t10", title: "Fix mic permission handler in Electron + MSIX", column: "done", priority: "critical", tags: ["voice", "permissions", "electron"], link: null },
  { id: "t11", title: "Split system.py god object into 8 modules", column: "done", priority: "high", tags: ["refactor", "architecture"], link: null },
  { id: "t12", title: "Reorganize core/ into 7 domain subpackages", column: "done", priority: "medium", tags: ["refactor", "core"], link: null },
  { id: "t13", title: "Add admin error-reporting dashboard pipeline", column: "done", priority: "high", tags: ["admin", "observability"], link: null },
  { id: "t14", title: "Migrate task schema to Alembic revision", column: "done", priority: "low", tags: ["database", "alembic", "tasks"], link: null },
];

function Card({ task }: { task: Task }) {
  const link = task.link;
  return (
    <div style={{ padding: 12, borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ font: "var(--fw-semibold) 12.5px/1.35 var(--font-body)", color: "var(--jv-text)" }}>{task.title}</span>
        <Tag priority={task.priority} />
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
  const tasks = data ?? SEED;
  const [filter, setFilter] = useState("");

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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
      <Panel
        title="Tasks Kanban"
        action={
          <div style={{ display: "flex", gap: 8 }}>
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
          {COL_META.map((c) => {
            const cv = toneVar(c.tone);
            return (
              <div key={c.id}>
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
                  {byCol(c.id).map((t) => (
                    <Card key={t.id} task={t} />
                  ))}
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
    </div>
  );
}
