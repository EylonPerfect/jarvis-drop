// AgentCockpit — the control panel for ONE agent. Each block keeps its
// placeholder empty-state and has an Edit (pencil) button at its top-right that
// opens a full modal to define that block. Everything persists on the agent
// (plan, routine, calendar/schedule, budget, permissions, skills & tools).
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Panel, Badge, Button, Icon, EmptyState, IconButton, StatTile } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { Agent, AgentPermission, AgentPerformance, AgentComm, LedgerEntry, WeekdayKey, AgentRunResult, AgentRunRecord } from "@jarvis/shared";

const TOOL_CHOICES = ["web_search", "code_interpreter", "filesystem", "github", "memory.query", "calendar", "gmail", "whatsapp", "shell", "vision"];

// Friendly labels for enabled connection ids. Unknown ids fall back to a
// title-cased version of the id.
const CONNECTION_LABELS: Record<string, string> = {
  browser: "Browser",
  whatsapp: "WhatsApp",
  slack: "Slack",
  email: "Email",
  stripe: "Stripe",
  web: "Web",
  terminal: "Terminal",
  cron: "Cron",
  memory: "Memory",
  telegram: "Telegram",
  discord: "Discord",
  calendar: "Calendar",
  notion: "Notion",
  code: "Code",
};
const connLabel = (id: string) => CONNECTION_LABELS[id] ?? (id.charAt(0).toUpperCase() + id.slice(1));

const WEEKDAYS: [WeekdayKey, string][] = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
];

const fieldStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "var(--r-sm)",
  background: "var(--jv-void)",
  border: "1px solid var(--jv-border)",
  color: "var(--jv-text)",
  font: "var(--fw-medium) 13px var(--font-body)",
  outline: "none",
  boxSizing: "border-box" as const,
};

const proseStyle = { font: "var(--fw-regular) 12.5px/1.6 var(--font-body)", color: "var(--jv-text-soft)", whiteSpace: "pre-wrap" as const, margin: 0 };

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: "var(--r-pill)",
        border: `1px solid ${active ? "var(--jv-border-cyan)" : "var(--jv-border)"}`,
        background: active ? "var(--grad-cyan-soft)" : "var(--jv-void)",
        color: active ? "var(--jv-cyan-300)" : "var(--jv-text-muted)",
        font: `${active ? "var(--fw-semibold)" : "var(--fw-medium)"} 12px var(--font-mono)`,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// A full-screen modal for editing one block.
function EditModal({ title, icon, onCancel, onSave, children }: { title: string; icon: string; onCancel: () => void; onSave: () => void; children: ReactNode }) {
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(3,8,16,0.66)", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 92vw)", borderRadius: "var(--r-lg)", background: "var(--grad-panel)", border: "1px solid var(--jv-border-cyan)", boxShadow: "var(--panel-shadow-active)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--jv-hairline)" }}>
          <span style={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}><Icon name={icon} size={18} /></span>
          <div style={{ flex: 1, font: "var(--fw-bold) 16px var(--font-body)", color: "var(--jv-text)" }}>{title}</div>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: "var(--jv-text-muted)", cursor: "pointer", display: "grid", placeItems: "center" }}><Icon name="x" size={18} /></button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 20px", borderTop: "1px solid var(--jv-hairline)" }}>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" icon={<Icon name="save" size={14} />} onClick={onSave}>Save</Button>
        </div>
      </div>
    </div>
  );
}

// How the agent is performing, over day / week / month. Counts are real (from
// the activity log) — 0 until the agent logs work.
function PerformanceBox({ agentId }: { agentId: string }) {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const { data } = useApi<AgentPerformance>(`/api/agents/${agentId}/performance?period=${period}`);
  const p = data ?? { period, goals: 0, tasks: 0, routine: 0, scheduled: 0, workflow: 0 };
  const periods: ["daily" | "weekly" | "monthly", string][] = [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]];
  const tiles: [string, number, "info" | "optimal"][] = [
    ["Goals", p.goals, "info"],
    ["Tasks done", p.tasks, "optimal"],
    ["Routine done", p.routine, "info"],
    ["Scheduled done", p.scheduled, "info"],
    ["Workflows done", p.workflow, "optimal"],
  ];
  return (
    <Panel
      title="Performance"
      eyebrow
      action={
        <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: "var(--r-pill)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)" }}>
          {periods.map(([val, label]) => (
            <button key={val} onClick={() => setPeriod(val)} style={{ padding: "4px 12px", borderRadius: "var(--r-pill)", cursor: "pointer", border: "none", background: period === val ? "var(--grad-cyan-soft)" : "transparent", color: period === val ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", font: `${period === val ? "var(--fw-semibold)" : "var(--fw-medium)"} 11px var(--font-hud)`, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</button>
          ))}
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        {tiles.map(([label, value, tone]) => <StatTile key={label} value={value} label={label} tone={tone} />)}
      </div>
      <div style={{ marginTop: 12, font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>
        Completed by {p.period === "daily" ? "today" : p.period === "weekly" ? "this week" : "this month"} · updates as the agent works.
      </div>
    </Panel>
  );
}

// Latest Slack + email the agent sent/received.
function CommsBox({ agentId }: { agentId: string }) {
  const { data } = useApi<AgentComm[]>(`/api/agents/${agentId}/communications`);
  const items = data ?? [];
  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };
  return (
    <Panel title="Latest communication" eyebrow action={<Badge status="info" dot={false}>Slack · Email</Badge>} bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.length === 0 ? (
        <EmptyState compact icon="messages-square" title="No messages yet" hint="Slack messages and emails this agent sends or receives will show up here." />
      ) : (
        items.map((c) => {
          const col = c.channel === "slack" ? "var(--jv-violet)" : "var(--jv-cyan)";
          return (
            <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <span style={{ width: 28, height: 28, flex: "0 0 28px", display: "grid", placeItems: "center", borderRadius: "var(--r-xs)", color: col, background: `color-mix(in srgb, ${col} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${col} 30%, transparent)` }}>
                <Icon name={c.channel === "slack" ? "slack" : "mail"} size={14} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.subject || c.party || (c.channel === "slack" ? "Slack message" : "Email")}</span>
                  <span style={{ font: "10.5px var(--font-mono)", color: "var(--jv-text-muted)", whiteSpace: "nowrap" }}>{fmt(c.at)}</span>
                </div>
                {(c.preview || c.party) && <div style={{ font: "var(--fw-regular) 11.5px/1.45 var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.party ? `${c.party} — ` : ""}{c.preview ?? ""}</div>}
              </div>
            </div>
          );
        })
      )}
    </Panel>
  );
}

// Recent sessions reported by the agent runtime (Hermes). These are NOT tied to
// a single app-agent, so they're presented honestly as the runtime's recent
// sessions, not "this agent's session". Real data from GET /api/agents/sessions.
type RuntimeSession = { id: string; model?: string; source?: string; messages?: number; iterations?: number };

function SessionsPane() {
  const { data } = useApi<RuntimeSession[]>("/api/agents/sessions");
  const sessions = data ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", overflow: "hidden", boxShadow: "var(--panel-shadow)", minHeight: 360 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--jv-hairline)" }}>
        <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Hermes runtime sessions</span>
        <div style={{ flex: 1 }} />
        <Badge status="info" dot={false}>Agent runtime</Badge>
      </div>
      {sessions.length === 0 ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 16 }}>
          <EmptyState icon="monitor" title="No active runtime sessions" hint="Recent sessions reported by the agent runtime will stream here." />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
          {sessions.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <span style={{ width: 28, height: 28, flex: "0 0 28px", display: "grid", placeItems: "center", borderRadius: "var(--r-xs)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
                <Icon name="monitor" size={14} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", font: "var(--fw-semibold) 12.5px var(--font-mono)", color: "var(--jv-text)" }}>{s.id}</span>
                  {s.source && <span style={{ flex: "0 0 auto", padding: "2px 8px", borderRadius: "var(--r-pill)", font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-text-muted)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)" }}>{s.source}</span>}
                </div>
                {(s.model || s.messages != null || s.iterations != null) && (
                  <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {[s.model, s.messages != null ? `${s.messages} msgs` : null, s.iterations != null ? `${s.iterations} iters` : null].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Deploy the agent and run a one-off task now. Deploy flips status → "optimal"
// on the backend, then we trigger the cockpit's existing agent reload. Run posts
// the task and shows the runtime's result (executed on Hermes, or the AI-provider
// fallback). The last result stays visible until the next run.
function RunBox({ agent, agentId, reload }: { agent: Agent | undefined; agentId: string; reload: () => void }) {
  const [task, setTask] = useState("");
  const [running, setRunning] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: historyData, reload: reloadHistory } = useApi<AgentRunRecord[]>(`/api/agents/${agentId}/runs`);
  const history = historyData ?? [];
  const [openRun, setOpenRun] = useState<number | null>(null);

  const deployed = agent?.status === "optimal";

  const deploy = async () => {
    setDeploying(true);
    setError(null);
    try {
      await api.post<Agent>(`/api/agents/${agentId}/deploy`);
      reload();
    } catch {
      setError("Couldn't deploy the agent. Please try again.");
    } finally {
      setDeploying(false);
    }
  };

  const run = async () => {
    const t = task.trim();
    if (!t) return;
    setRunning(true);
    setError(null);
    try {
      const res = await api.post<AgentRunResult>(`/api/agents/${agentId}/run`, { task: t });
      setResult(res);
      setTask("");
      reloadHistory();
    } catch {
      setError("The task couldn't be run. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  const viaLabel = (via: AgentRunResult["via"]) => (via === "hermes" ? "Ran on Hermes" : via === "provider" ? "Ran via AI Core" : "No runtime available");
  const fmtWhen = (iso?: string) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
  };
  const runTone = (s: AgentRunRecord["status"]) => (s === "done" ? "var(--jv-green)" : s === "failed" ? "var(--jv-red)" : "var(--jv-cyan-300)");
  const runIcon = (s: AgentRunRecord["status"]) => (s === "done" ? "check-circle" : s === "failed" ? "octagon-x" : "loader");

  return (
    <Panel
      title="Run"
      eyebrow
      brackets
      action={
        deployed ? (
          <Badge status="optimal" solid={false}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="check-circle" size={11} />Deployed</span>
          </Badge>
        ) : (
          <Button size="sm" variant="primary" icon={<Icon name={deploying ? "loader" : "rocket"} size={14} />} disabled={deploying} onClick={deploy}>
            {deploying ? "Deploying…" : "Deploy agent"}
          </Button>
        )
      }
      bodyStyle={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div style={{ font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)" }}>
        Give this agent a task to do right now. It runs on the Hermes runtime, falling back to the AI Core.
      </div>
      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Describe a task for this agent to do now — e.g. 'Draft a renewal check-in email for account X'"
        style={{ ...fieldStyle, height: 96, resize: "vertical", font: "var(--fw-regular) 13px/1.5 var(--font-body)" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }} />
        <Button
          size="md"
          variant="primary"
          icon={<Icon name={running ? "loader" : "play"} size={14} />}
          disabled={running || task.trim().length === 0}
          onClick={run}
        >
          {running ? "Running…" : "Run task"}
        </Button>
      </div>

      {error && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 7, padding: "9px 12px", borderRadius: "var(--r-sm)", color: "var(--jv-red)", background: "color-mix(in srgb, var(--jv-red) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-red) 30%, transparent)", font: "var(--fw-medium) 12px/1.5 var(--font-body)" }}>
          <Icon name="octagon-x" size={13} />
          <span style={{ flex: 1 }}>{error}</span>
        </div>
      )}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: result.ok ? "var(--jv-green)" : "var(--jv-amber)" }}>
              <Icon name={result.ok ? "check-circle" : "octagon-x"} size={12} />{result.ok ? "Done" : "Failed"}
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: "var(--r-pill)", font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-cyan-300)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
              <Icon name="cpu" size={11} />{viaLabel(result.via)}
            </span>
          </div>
          {!result.ok && result.detail && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 7, padding: "9px 12px", borderRadius: "var(--r-xs)", color: "var(--jv-amber)", background: "color-mix(in srgb, var(--jv-amber) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-amber) 30%, transparent)", font: "var(--fw-medium) 12px/1.5 var(--font-body)" }}>
              <Icon name="triangle-alert" size={13} />
              <span style={{ flex: 1 }}>{result.detail}</span>
            </div>
          )}
          {result.output && (
            <pre style={{ margin: 0, maxHeight: 320, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", font: "var(--fw-regular) 12.5px/1.6 var(--font-mono)", color: "var(--jv-text-soft)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", borderRadius: "var(--r-xs)", padding: "12px 14px" }}>{result.output}</pre>
          )}
        </div>
      )}

      {/* Run history — every task this agent has executed. */}
      <div style={{ marginTop: 4, paddingTop: 12, borderTop: "1px solid var(--jv-hairline)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ flex: 1, font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Run history</span>
          {history.length > 0 && <span style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>{history.length}</span>}
          <button onClick={reloadHistory} title="Refresh" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--jv-cyan-300)", display: "grid", placeItems: "center" }}>
            <Icon name="refresh-cw" size={13} color="var(--jv-cyan-300)" />
          </button>
        </div>
        {history.length === 0 ? (
          <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-faint)" }}>No runs yet — give the agent a task above.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {history.map((h) => {
              const open = openRun === h.id;
              return (
                <div key={h.id} style={{ borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", overflow: "hidden" }}>
                  <button onClick={() => setOpenRun(open ? null : h.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <Icon name={runIcon(h.status)} size={13} color={runTone(h.status)} />
                    <span style={{ flex: 1, minWidth: 0, font: "var(--fw-medium) 12.5px var(--font-body)", color: "var(--jv-text-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.task}</span>
                    {h.via && <span style={{ font: "var(--fw-medium) 9px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-text-faint)" }}>{h.via === "hermes" ? "Hermes" : h.via === "provider" ? "AI Core" : h.via}</span>}
                    <span style={{ font: "var(--fw-regular) 10.5px var(--font-mono)", color: "var(--jv-text-faint)", whiteSpace: "nowrap" }}>{fmtWhen(h.createdAt)}</span>
                    <Icon name={open ? "chevron-down" : "chevron-right"} size={13} color="var(--jv-text-faint)" />
                  </button>
                  {open && (
                    <div style={{ padding: "0 12px 12px 34px" }}>
                      {h.status === "running" ? (
                        <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-cyan-300)" }}>Still running on Hermes… refresh to check.</div>
                      ) : h.output ? (
                        <pre style={{ margin: 0, maxHeight: 280, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", font: "var(--fw-regular) 12px/1.6 var(--font-mono)", color: "var(--jv-text-soft)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", borderRadius: "var(--r-xs)", padding: "10px 12px" }}>{h.output}</pre>
                      ) : (
                        <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-faint)" }}>No output recorded.</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}

export default function AgentCockpit({ agentId, onExit }: { agentId: string; onExit: () => void }) {
  const { data, reload } = useApi<Agent[]>("/api/agents");
  const agent = (data ?? []).find((a) => a.id === agentId);

  // Global recent tool ledger (system-wide; the entry shape has no agent field).
  const { data: ledgerData } = useApi<LedgerEntry[]>("/api/system/ledger");
  const ledger = ledgerData ?? [];

  const [editing, setEditing] = useState<string | null>(null);

  // Editable buffers, seeded from the agent.
  const [plan, setPlan] = useState("");
  const [routine, setRoutine] = useState("");
  const [budget, setBudget] = useState("");
  const [schedule, setSchedule] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [perms, setPerms] = useState<AgentPermission[]>([]);
  const [newPerm, setNewPerm] = useState("");

  const reseed = () => {
    if (!agent) return;
    setPlan(agent.plan ?? "");
    setRoutine(agent.routine ?? "");
    setBudget(agent.budget ?? "");
    setSchedule(agent.schedule ?? "");
    setTools(agent.tools ?? []);
    setPerms(agent.permissions ?? []);
    setNewPerm("");
  };
  useEffect(reseed, [agent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: Partial<Agent>) => {
    await api.patch(`/api/agents/${agentId}`, patch).catch(() => {});
    reload();
  };
  const open = (k: string) => setEditing(k);
  const cancel = () => {
    reseed(); // discard unsaved buffer edits
    setEditing(null);
  };
  const commit = (patch: Partial<Agent>) => {
    save(patch);
    setEditing(null);
  };

  const toggleTool = (t: string) => setTools((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const togglePerm = (i: number) => setPerms((cur) => cur.map((p, j) => (j === i ? { ...p, allowed: !p.allowed } : p)));
  const removePerm = (i: number) => setPerms((cur) => cur.filter((_, j) => j !== i));
  const addPerm = () => {
    const label = newPerm.trim();
    if (!label) return;
    setPerms((cur) => [...cur, { label, allowed: true }]);
    setNewPerm("");
  };

  const EditBtn = ({ k }: { k: string }) => <IconButton icon="pencil" tone="muted" title="Edit" size={28} onClick={() => open(k)} />;

  const c = agent?.status === "optimal" ? "var(--jv-green)" : "var(--jv-violet)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 16px", borderRadius: "var(--r-md)", background: "var(--grad-panel)", border: "1px solid var(--jv-border)", boxShadow: "var(--panel-shadow)" }}>
        <button onClick={onExit} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "var(--jv-text-muted)", cursor: "pointer", font: "var(--fw-medium) 12px var(--font-body)" }}><Icon name="chevron-left" size={16} />Roster</button>
        <span style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 32%, transparent)` }}><Icon name={agent?.icon ?? "bot"} size={16} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)" }}>{agent?.name ?? "Agent"}</div>
          <div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)" }}>{agent?.role ?? "Cockpit · live drill-down"}</div>
        </div>
        {agent?.buildTrack && (
          <span title={agent.buildTrack === "clone" && agent.cloneSource ? [agent.cloneSource.title, agent.cloneSource.email].filter(Boolean).join(" · ") : undefined} style={{ display: "flex" }}>
            <Badge status="info" dot={false}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Icon name={agent.buildTrack === "clone" ? "copy" : "sparkles"} size={11} />
                {agent.buildTrack === "clone" ? `Cloned from ${agent.cloneSource?.name ?? "someone"}` : "Built from scratch"}
              </span>
            </Badge>
          </span>
        )}
        <Badge status={agent?.status === "optimal" ? "live" : "standby"} solid>{agent?.status === "optimal" ? "Running" : "Standby"}</Badge>
        <button onClick={() => save({ status: "optimal", statusLabel: "Active" })} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 13px", height: 34, borderRadius: "var(--r-sm)", border: "1px solid var(--jv-border)", background: "transparent", color: "var(--jv-text-soft)", font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="play" size={14} />Activate</button>
        <button onClick={() => save({ status: "standby", statusLabel: "Standby" })} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 13px", height: 34, borderRadius: "var(--r-sm)", border: "1px solid color-mix(in srgb, var(--jv-red) 40%, transparent)", background: "color-mix(in srgb, var(--jv-red) 12%, transparent)", color: "var(--jv-red)", font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="octagon-x" size={14} />Stop</button>
      </div>

      {/* overview — short descriptive line under the header (wizard step 1) */}
      {agent?.overview && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 16px", borderRadius: "var(--r-md)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", borderLeft: "2px solid var(--jv-border-cyan)" }}>
          <Icon name="info" size={15} color="var(--jv-cyan)" />
          <p style={{ ...proseStyle, flex: 1 }}>{agent.overview}</p>
        </div>
      )}

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Run — deploy + give the agent a task now (Hermes runtime, AI-provider fallback) */}
      <RunBox agent={agent} agentId={agentId} reload={reload} />
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr 300px", gap: 14 }}>
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
          <Panel title="Plan" eyebrow action={<EditBtn k="plan" />}>
            {agent?.plan ? <p style={proseStyle}>{agent.plan}</p> : <EmptyState compact icon="list-checks" title="No plan yet" hint="The agent's steps appear here once it starts a task." />}
          </Panel>
          <Panel title="Routine" eyebrow action={<EditBtn k="routine" />}>
            {agent?.routine ? <p style={proseStyle}>{agent.routine}</p> : <EmptyState compact icon="repeat" title="No routine yet" hint="Define the recurring steps this agent follows." />}
          </Panel>
          <Panel title="Calendar" eyebrow action={<EditBtn k="schedule" />}>
            {agent?.schedule ? <div style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}><Icon name="calendar" size={15} color="var(--jv-cyan)" />{agent.schedule}</div> : <EmptyState compact icon="calendar" title="No schedule set" hint="Choose when this agent runs." />}
          </Panel>
          <Panel title="Playbook" eyebrow>
            {agent?.playbook && agent.playbook.kind !== "none" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 30, height: 30, flex: "0 0 30px", display: "grid", placeItems: "center", borderRadius: "var(--r-xs)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
                  <Icon name={agent.playbook.kind === "notion" ? "book-open" : agent.playbook.kind === "file" ? "file-text" : "text-cursor"} size={15} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.playbook.name || connLabel(agent.playbook.kind)}</div>
                  <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginTop: 2 }}>{agent.playbook.kind}</div>
                </div>
                {agent.playbook.kind === "notion" && agent.playbook.url && (
                  <a href={agent.playbook.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: "var(--r-pill)", textDecoration: "none", color: "var(--jv-cyan-300)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    <Icon name="external-link" size={12} />Open
                  </a>
                )}
              </div>
            ) : (
              <EmptyState compact icon="book-open" title="No playbook linked" hint="Attach a Notion doc, file, or text reference for this role." />
            )}
          </Panel>
        </div>

        {/* CENTER — real data from the agent runtime (Hermes). Shows the runtime's
            recent sessions (id / model / source). These are runtime-wide, not
            tied to this specific app-agent, and are labeled honestly as such.
            Falls back to a graceful empty state when unreachable/empty. */}
        <SessionsPane />

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
          <Panel title="Budget" eyebrow action={agent?.budgetConfig ? undefined : <EditBtn k="budget" />} bodyStyle={agent?.budgetConfig ? { display: "flex", flexDirection: "column", gap: 8 } : {}}>
            {agent?.budgetConfig ? (
              (() => {
                const b = agent.budgetConfig;
                const money = (n: number) => `${b.currency} ${n.toLocaleString()}`;
                const rows: [string, ReactNode][] = [];
                if (b.monthlyCap != null) rows.push(["Monthly cap", money(b.monthlyCap)]);
                if (b.perActionLimit != null) rows.push(["Per-action limit", money(b.perActionLimit)]);
                if (b.approvalThreshold != null) rows.push(["Approval threshold", money(b.approvalThreshold)]);
                rows.push([
                  "Payments",
                  <span style={{ display: "flex", alignItems: "center", gap: 4, color: b.allowPayments ? "var(--jv-green)" : "var(--jv-red)", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    <Icon name={b.allowPayments ? "check" : "x"} size={12} />{b.allowPayments ? "Allowed" : "Blocked"}
                  </span>,
                ]);
                if (b.tokenBudgetUsd != null) rows.push(["Token budget", `USD ${b.tokenBudgetUsd.toLocaleString()}`]);
                if (b.maxMessagesPerDay != null) rows.push(["Max messages/day", String(b.maxMessagesPerDay)]);
                if (b.maxBrowserSessionsPerDay != null) rows.push(["Max browser sessions/day", String(b.maxBrowserSessionsPerDay)]);
                return (
                  <>
                    {rows.map(([label, val], i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-medium) 12px var(--font-body)" }}>
                        <span style={{ flex: 1, color: "var(--jv-text-muted)" }}>{label}</span>
                        <span style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)" }}>{val}</span>
                      </div>
                    ))}
                    {b.notes && <p style={{ ...proseStyle, marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--jv-hairline)" }}>{b.notes}</p>}
                  </>
                );
              })()
            ) : agent?.budget ? (
              <div style={{ font: "var(--fw-bold) 20px var(--font-body)", color: "var(--jv-text)" }}>{agent.budget}</div>
            ) : (
              <EmptyState compact icon="wallet" title="No budget set" hint="Set a spend cap when this agent runs a task." />
            )}
          </Panel>
          <Panel title="Permissions" eyebrow action={<EditBtn k="permissions" />} bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(agent?.permissions ?? []).length === 0 ? (
              <EmptyState compact icon="shield" title="No permissions granted" hint="Grant capabilities before this agent acts." />
            ) : (
              (agent?.permissions ?? []).map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-medium) 12px var(--font-body)" }}>
                  <span style={{ flex: 1, color: "var(--jv-text-soft)" }}>{p.label}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, color: p.allowed ? "var(--jv-green)" : "var(--jv-red)", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase" }}><Icon name={p.allowed ? "check" : "x"} size={12} />{p.allowed ? "Allow" : "Deny"}</span>
                </div>
              ))
            )}
          </Panel>
          <Panel title="Skills & tools" eyebrow action={<EditBtn k="tools" />}>
            {(agent?.tools ?? []).length ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(agent?.tools ?? []).map((t) => <span key={t} style={{ padding: "4px 9px", borderRadius: 3, font: "var(--fw-medium) 11px var(--font-mono)", color: "var(--jv-text-soft)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)" }}>{t}</span>)}
              </div>
            ) : (
              <EmptyState compact icon="wrench" title="No tools granted" hint="Choose the skills & tools this agent may call." />
            )}
          </Panel>
          <Panel title="Connections" eyebrow>
            {(agent?.connections ?? []).length ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(agent?.connections ?? []).map((id) => (
                  <span key={id} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: "var(--r-pill)", font: "var(--fw-medium) 11px var(--font-mono)", color: "var(--jv-cyan-300)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--jv-cyan)" }} />{connLabel(id)}
                  </span>
                ))}
              </div>
            ) : (
              <EmptyState compact icon="plug" title="No connections" hint="Enable the systems this agent may reach." />
            )}
          </Panel>
          <Panel title="Recent ledger" eyebrow style={{ flex: 1, minHeight: 0 }} bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ledger.length === 0 ? (
              <EmptyState compact icon="receipt" title="No activity yet" hint="This agent's actions and costs will be logged here." />
            ) : (
              ledger.map((e, i) => {
                const cv = e.tone === "green" ? "green" : e.tone === "red" ? "red" : e.tone === "amber" ? "amber" : "cyan";
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-medium) 12px var(--font-body)" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", flex: "0 0 auto", background: `var(--jv-${cv})` }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--jv-text-soft)" }}>{e.tool}</span>
                    <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: `var(--jv-${cv})` }}>{e.status}</span>
                    <span style={{ font: "11px var(--font-mono)", color: "var(--jv-text-faint)" }}>{e.duration}</span>
                  </div>
                );
              })
            )}
          </Panel>
        </div>
      </div>

      {/* Wizard step-3 operating spec — weekly plan + calendar-triggered playbooks */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Panel title="Weekly plan" eyebrow bodyStyle={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(() => {
            const wp = agent?.weeklyPlan;
            const activeDays = WEEKDAYS.filter(([k]) => (wp?.days?.[k]?.length ?? 0) > 0);
            const daily = wp?.daily ?? [];
            if (activeDays.length === 0 && daily.length === 0) {
              return <EmptyState compact icon="calendar-days" title="No weekly plan" hint="Set per-day focus and daily repeatable tasks." />;
            }
            return (
              <>
                {activeDays.map(([k, label]) => (
                  <div key={k}>
                    <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 6 }}>{label}</div>
                    <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                      {(wp?.days?.[k] ?? []).map((t, i) => <li key={i} style={proseStyle}>{t}</li>)}
                    </ul>
                  </div>
                ))}
                {daily.length > 0 && (
                  <div style={{ paddingTop: activeDays.length ? 10 : 0, borderTop: activeDays.length ? "1px solid var(--jv-hairline)" : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}><Icon name="repeat" size={12} color="var(--jv-text-muted)" />Daily</div>
                    <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                      {daily.map((t, i) => <li key={i} style={proseStyle}>{t}</li>)}
                    </ul>
                  </div>
                )}
              </>
            );
          })()}
        </Panel>
        <Panel title="Calendar playbooks" eyebrow bodyStyle={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(agent?.calendarPlaybooks ?? []).length ? (
            (agent?.calendarPlaybooks ?? []).map((pb) => (
              <div key={pb.id} style={{ padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pb.name}</span>
                  <span style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: "var(--r-pill)", font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--jv-text-muted)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)" }}><Icon name="zap" size={11} />trigger: {pb.trigger}</span>
                </div>
                <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                  {pb.steps.map((s, i) => <li key={i} style={proseStyle}>{s}</li>)}
                </ol>
              </div>
            ))
          ) : (
            <EmptyState compact icon="calendar-clock" title="No calendar playbooks" hint="Define scenarios triggered by calendar events." />
          )}
        </Panel>
      </div>

      {/* Two-track hire spec — goals (both tracks) + evidence gallery (scratch) */}
      <Panel title="Goals" eyebrow bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(agent?.goals ?? []).length ? (
          (agent?.goals ?? []).map((g, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <Icon name="target" size={15} color="var(--jv-cyan)" />
              <span style={{ flex: 1, minWidth: 0, font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{g.objective}</span>
              {g.metric && (
                <span style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: "var(--r-pill)", font: "var(--fw-medium) 10.5px var(--font-mono)", color: "var(--jv-cyan-300)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
                  <Icon name="gauge" size={11} />{g.metric}
                </span>
              )}
            </div>
          ))
        ) : (
          <EmptyState compact icon="target" title="No goals set" hint="Define the objectives and success metrics this agent is hired for." />
        )}
      </Panel>

      {(() => {
        const ob = agent?.onboarding;
        const access = ob?.access ?? [];
        const meetings = ob?.meetings ?? [];
        const mgr = ob?.reportsTo;
        if (!ob || (!(mgr && (mgr.name || mgr.email)) && access.length === 0 && meetings.length === 0)) return null;
        const sColor = (s: string) => (s === "granted" ? "var(--jv-green)" : s === "pending" ? "var(--jv-amber)" : "var(--jv-text-muted)");
        const sLabel = (s: string) => (s === "granted" ? "Granted" : s === "pending" ? "Pending" : "Needed");
        const eyebrowLbl = (t: string) => (
          <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 8 }}>{t}</div>
        );
        return (
          <Panel title="Onboarding" eyebrow action={<Badge status="info" dot={false}>Access &amp; org</Badge>} bodyStyle={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {mgr && (mgr.name || mgr.email) && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <Icon name="user-round" size={15} color="var(--jv-cyan)" />
                <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Reports to</span>
                <span style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{mgr.name}{mgr.email ? ` · ${mgr.email}` : ""}</span>
              </div>
            )}
            {meetings.length > 0 && (
              <div>
                {eyebrowLbl("Meetings to join")}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {meetings.map((m, i) => (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: "var(--r-pill)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-soft)" }}>
                      <Icon name="calendar" size={12} color="var(--jv-cyan)" />{m.name}{m.cadence ? <span style={{ color: "var(--jv-text-muted)" }}> · {m.cadence}</span> : null}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {access.length > 0 && (
              <div>
                {eyebrowLbl("Access checklist")}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {access.map((a, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                      <span style={{ width: 7, height: 7, flex: "0 0 7px", borderRadius: "50%", background: sColor(a.status), boxShadow: `0 0 6px ${sColor(a.status)}` }} />
                      <span style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{a.item}</span>
                      {a.note && <span style={{ flex: 1, minWidth: 0, font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.note}</span>}
                      <span style={{ flex: "0 0 auto", marginLeft: "auto", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: sColor(a.status) }}>{sLabel(a.status)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        );
      })()}

      {(agent?.evidence?.length ?? 0) > 0 && (
        <Panel title="Evidence gallery" eyebrow action={<Badge status="info" dot={false}>Few-shot grounding</Badge>} bodyStyle={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(agent?.evidence ?? []).map((ev, i) => (
            <div key={i} style={{ padding: "12px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: ev.instruction ? 4 : 8 }}>
                <Icon name="sparkles" size={14} color="var(--jv-cyan)" />
                <span style={{ flex: 1, minWidth: 0, font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{ev.behavior}</span>
                {ev.assetType && <Badge status="info" dot={false}>{ev.assetType}</Badge>}
              </div>
              {ev.instruction && <p style={{ ...proseStyle, marginBottom: 8 }}>{ev.instruction}</p>}
              {ev.examples.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {ev.examples.filter((ex) => ex.kind === "text").map((ex, j) => (
                    <div key={`t${j}`} style={{ paddingLeft: 10, borderLeft: "2px solid var(--jv-border-cyan)", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-soft)", fontStyle: "italic", whiteSpace: "pre-wrap" }}>
                      “{ex.text ?? ex.caption ?? ""}”
                    </div>
                  ))}
                  {ev.examples.some((ex) => ex.kind === "screenshot") && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {ev.examples.filter((ex) => ex.kind === "screenshot" && ex.fileId).map((ex, j) => (
                        <a key={`s${j}`} href={`/api/files/${ex.fileId}`} target="_blank" rel="noopener noreferrer" title={ex.caption} style={{ display: "flex", flexDirection: "column", gap: 4, textDecoration: "none", width: 140 }}>
                          <img src={`/api/files/${ex.fileId}`} alt={ex.caption ?? "evidence screenshot"} style={{ width: 140, height: 90, objectFit: "cover", borderRadius: "var(--r-xs)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", display: "block" }} />
                          {ex.caption && <span style={{ font: "var(--fw-regular) 10.5px var(--font-body)", color: "var(--jv-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.caption}</span>}
                        </a>
                      ))}
                    </div>
                  )}
                  {ev.examples.filter((ex) => ex.kind === "file" || ex.kind === "link").map((ex, j) => (
                    <a key={`f${j}`} href={ex.kind === "link" ? ex.url : `/api/files/${ex.fileId}`} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 7, textDecoration: "none", color: ex.kind === "link" ? "var(--jv-cyan-300)" : "var(--jv-text-soft)", paddingLeft: 10, borderLeft: "2px solid var(--jv-border-cyan)" }}>
                      <Icon name={ex.kind === "link" ? "link" : "file-text"} size={13} />
                      <span style={{ font: "var(--fw-medium) 12px var(--font-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.kind === "link" ? (ex.url ?? "link") : (ex.fileName ?? ex.caption ?? "file")}</span>
                    </a>
                  ))}
                </div>
              )}
              {ev.antiExample && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 8, padding: "8px 10px", borderRadius: "var(--r-xs)", color: "var(--jv-red)", background: "color-mix(in srgb, var(--jv-red) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-red) 30%, transparent)", font: "var(--fw-medium) 12px/1.5 var(--font-body)" }}>
                  <Icon name="octagon-x" size={13} />
                  <span style={{ flex: 1 }}><span style={{ font: "var(--fw-semibold) 12px var(--font-body)" }}>Avoid:</span> {ev.antiExample}</span>
                </div>
              )}
            </div>
          ))}
        </Panel>
      )}

      <PerformanceBox agentId={agentId} />
      <CommsBox agentId={agentId} />
      </div>

      {/* ---- Edit modals ---- */}
      {editing === "plan" && (
        <EditModal title="Define the plan" icon="list-checks" onCancel={cancel} onSave={() => commit({ plan })}>
          <div style={{ font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)", marginBottom: 10 }}>What is this agent trying to achieve? What does "done" look like?</div>
          <textarea value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="e.g. Keep spend under budget across all teams and flag overruns within the hour." style={{ ...fieldStyle, height: 140, resize: "vertical", font: "var(--fw-regular) 13px/1.5 var(--font-body)" }} />
        </EditModal>
      )}
      {editing === "routine" && (
        <EditModal title="Define the routine" icon="repeat" onCancel={cancel} onSave={() => commit({ routine })}>
          <div style={{ font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)", marginBottom: 10 }}>The recurring steps it follows, one per line.</div>
          <textarea value={routine} onChange={(e) => setRoutine(e.target.value)} placeholder={"1. Pull yesterday's spend\n2. Compare against caps\n3. Draft alerts for anything over 90%"} style={{ ...fieldStyle, height: 140, resize: "vertical", font: "var(--fw-regular) 13px/1.5 var(--font-body)" }} />
        </EditModal>
      )}
      {editing === "schedule" && (
        <EditModal title="Set the calendar" icon="calendar" onCancel={cancel} onSave={() => commit({ schedule })}>
          <div style={{ font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)", marginBottom: 10 }}>When (and how often) should this agent run?</div>
          <input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="e.g. Every weekday · 9:00 am" style={fieldStyle} />
        </EditModal>
      )}
      {editing === "budget" && (
        <EditModal title="Set the budget" icon="wallet" onCancel={cancel} onSave={() => commit({ budget })}>
          <div style={{ font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)", marginBottom: 10 }}>A spend cap for this agent.</div>
          <input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. $500/mo" style={fieldStyle} />
        </EditModal>
      )}
      {editing === "permissions" && (
        <EditModal title="Grant permissions" icon="shield" onCancel={cancel} onSave={() => commit({ permissions: perms })}>
          <div style={{ font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)", marginBottom: 12 }}>Capabilities this agent may use. Toggle Allow/Deny, or remove.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {perms.length === 0 && <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-faint)" }}>None yet — add one below.</div>}
            {perms.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-medium) 12px var(--font-body)" }}>
                <span style={{ flex: 1, color: "var(--jv-text-soft)" }}>{p.label}</span>
                <button onClick={() => togglePerm(i)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: "var(--r-pill)", cursor: "pointer", border: `1px solid ${p.allowed ? "color-mix(in srgb, var(--jv-green) 40%, transparent)" : "color-mix(in srgb, var(--jv-red) 40%, transparent)"}`, background: p.allowed ? "color-mix(in srgb, var(--jv-green) 12%, transparent)" : "color-mix(in srgb, var(--jv-red) 12%, transparent)", color: p.allowed ? "var(--jv-green)" : "var(--jv-red)", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  <Icon name={p.allowed ? "check" : "x"} size={11} />{p.allowed ? "Allow" : "Deny"}
                </button>
                <IconButton icon="trash-2" tone="danger" title="Remove" size={26} onClick={() => removePerm(i)} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={newPerm} onChange={(e) => setNewPerm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPerm()} placeholder="e.g. Send email" style={{ ...fieldStyle, height: 36, padding: "0 12px" }} />
            <Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />} onClick={addPerm}>Add</Button>
          </div>
        </EditModal>
      )}
      {editing === "tools" && (
        <EditModal title="Skills & tools" icon="wrench" onCancel={cancel} onSave={() => commit({ tools })}>
          <div style={{ font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)", marginBottom: 12 }}>Select what this agent is allowed to call.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {TOOL_CHOICES.map((t) => <Chip key={t} active={tools.includes(t)} onClick={() => toggleTool(t)}>{t}</Chip>)}
          </div>
        </EditModal>
      )}
    </div>
  );
}
