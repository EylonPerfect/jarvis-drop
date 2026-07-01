import { Fragment, useState } from "react";
import { Panel, Badge, Button, Icon, StatTile } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { Agent, AgentRun, RuntimeStats, NewAgent } from "@jarvis/shared";
import AgentCockpit from "./AgentCockpit";

const ROSTER_SEED: Agent[] = [
  { id: "ag_coding", icon: "code", name: "Coding Agent", role: "Writing code", status: "optimal", statusLabel: "Active" },
  { id: "ag_research", icon: "search", name: "Research Agent", role: "Deep analysis", status: "optimal", statusLabel: "Active" },
  { id: "ag_memory", icon: "database", name: "Memory Agent", role: "Idle", status: "standby", statusLabel: "Standby" },
  { id: "ag_browser", icon: "globe", name: "Browser Agent", role: "Idle", status: "standby", statusLabel: "Standby" },
  { id: "ag_task", icon: "list-checks", name: "Task Agent", role: "Idle", status: "standby", statusLabel: "Standby" },
  { id: "ag_system", icon: "shield-check", name: "System Agent", role: "Monitoring", status: "optimal", statusLabel: "Active" },
];

const RUNS_SEED: AgentRun[] = [
  { id: "run1", query: "Research the top 3 STT engines and benchmark latency on my hardware", ts: "13 jun, 1:42 pm", okCount: 3, errCount: 0, steps: [] },
  { id: "run2", query: "Draft and validate the Alembic migration to add a due_date column to jarvis_tasks", ts: "12 jun, 8:20 pm", okCount: 2, errCount: 1, steps: [] },
  { id: "run3", query: "Summarize this week's admin error reports and propose the top fix", ts: "12 jun, 12:05 am", okCount: 2, errCount: 0, steps: [] },
  { id: "run4", query: "Generate release notes for the 2026.6 desktop build and check the MSIX version", ts: "10 jun, 4:48 pm", okCount: 2, errCount: 0, steps: [] },
];

function AgentCard({ a, onClick }: { a: Agent; onClick?: () => void }) {
  const c = a.status === "optimal" ? "var(--jv-green)" : "var(--jv-violet)";
  return (
    <div
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", cursor: onClick ? "pointer" : "default" }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          flex: "0 0 38px",
          borderRadius: "var(--r-sm)",
          display: "grid",
          placeItems: "center",
          color: c,
          background: `color-mix(in srgb, ${c} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${c} 32%, transparent)`,
        }}
      >
        <Icon name={a.icon} size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{a.name}</div>
        <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 1 }}>{a.role}</div>
      </div>
      <span style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: c }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />
        {a.statusLabel}
      </span>
      {onClick && <Icon name="chevron-right" size={15} color="var(--jv-text-faint)" />}
    </div>
  );
}

// Delegation — parent agents spawning permission-narrowed sub-agents.
const DELEGATIONS: { parent: string; ic: string; task: string; subs: [string, string, string, string][] }[] = [
  {
    parent: "Research Agent",
    ic: "search",
    task: "Benchmark the top 3 STT engines",
    subs: [
      ["globe", "Browser sub-agent", "read-only web", "fetched 3 vendor docs → parent"],
      ["code", "Coding sub-agent", "sandbox only", "ran latency harness → parent"],
    ],
  },
  {
    parent: "AR Clerk",
    ic: "credit-card",
    task: "Close the June books",
    subs: [["table", "Data sub-agent", "sheet read", "pulled 92 invoices → parent"]],
  },
];

function Delegation() {
  return (
    <Panel title="Delegation" eyebrow action={<span style={{ font: "var(--fw-medium) 11.5px var(--font-body)", color: "var(--jv-text-muted)" }}>Sub-agents inherit narrower rights</span>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {DELEGATIONS.map((d, i) => (
          <div key={i}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)", border: "1px solid var(--jv-border-cyan)" }}>
                <Icon name={d.ic} size={16} />
              </span>
              <div>
                <span style={{ font: "var(--fw-bold) 13px var(--font-body)", color: "var(--jv-text)" }}>{d.parent}</span>
                <span style={{ font: "12px var(--font-body)", color: "var(--jv-text-muted)", marginLeft: 8 }}>
                  spawned {d.subs.length} sub-agent{d.subs.length > 1 ? "s" : ""} · {d.task}
                </span>
              </div>
            </div>
            <div style={{ marginLeft: 15, borderLeft: "1px dashed var(--jv-border)", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
              {d.subs.map((s, j) => (
                <div key={j} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)" }}>
                  <Icon name={s[0]} size={14} color="var(--jv-violet)" />
                  <span style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text-soft)" }}>{s[1]}</span>
                  <span style={{ padding: "2px 7px", borderRadius: 3, font: "var(--fw-medium) 9px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-violet)", background: "color-mix(in srgb, var(--jv-violet) 13%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-violet) 30%, transparent)" }}>{s[2]}</span>
                  <span style={{ flex: 1, textAlign: "right", font: "11px var(--font-mono)", color: "var(--jv-text-muted)" }}>{s[3]}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const [open, setOpen] = useState(false);
  const err = run.errCount;
  const steps =
    run.steps && run.steps.length
      ? run.steps
      : [
          { agent: "Research Agent", detail: "web_search · 4 results", tone: "green" as const },
          { agent: "Coding Agent", detail: "wrote migration.py · 62 lines", tone: "green" as const },
          err > 0 ? { agent: "System Agent", detail: "verification failed · retrying", tone: "red" as const } : { agent: "Task Agent", detail: "created follow-up task", tone: "green" as const },
        ];
  return (
    <div style={{ borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={15} color="var(--jv-cyan-300)" />
        <span style={{ flex: 1, font: "var(--fw-medium) 13px var(--font-mono)", color: "var(--jv-text-soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.query}</span>
        <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{run.ts}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, font: "12px var(--font-mono)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--jv-green)" }}>
            <Icon name="check-circle" size={13} />
            {run.okCount}
          </span>
          {err > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--jv-red)" }}>
              <Icon name="x-circle" size={13} />
              {err}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 14px 43px", display: "flex", flexDirection: "column", gap: 6 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, font: "12px/1.5 var(--font-mono)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--jv-${s.tone})`, boxShadow: `0 0 6px var(--jv-${s.tone})` }} />
              <span style={{ color: "var(--jv-cyan-300)" }}>{s.agent}</span>
              <span style={{ color: "var(--jv-text-muted)" }}>{s.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ICON_CHOICES = ["bot", "code", "search", "database", "globe", "list-checks", "shield-check", "mail", "calendar", "pen-tool", "bar-chart-3", "terminal"];
const TOOL_CHOICES = ["web_search", "code_interpreter", "filesystem", "github", "memory.query", "calendar", "gmail", "whatsapp", "shell", "vision"];
const MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "groq/llama-3.3-70b", "gemini-2.0-flash"];
const TEAMMATES = ["Coding Agent", "Research Agent", "Memory Agent", "Browser Agent", "Task Agent", "System Agent"];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 8 }}>{label}</div>
      {children}
      {hint && <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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

function AgentBuilder({ onClose, onCreate }: { onClose: () => void; onCreate: (a: NewAgent) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [icon, setIcon] = useState("bot");
  const [model, setModel] = useState(MODELS[0]);
  const [tools, setTools] = useState<string[]>(["web_search"]);
  const [collabs, setCollabs] = useState<string[]>([]);
  const [autonomy, setAutonomy] = useState("Ask before acting");
  const [instr, setInstr] = useState("");
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const ready = name.trim() && role.trim();
  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 40,
    padding: "0 14px",
    borderRadius: "var(--r-sm)",
    background: "var(--jv-void)",
    border: "1px solid var(--jv-border)",
    color: "var(--jv-text)",
    font: "var(--fw-medium) 13px var(--font-body)",
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        display: "grid",
        placeItems: "start center",
        paddingTop: 40,
        paddingBottom: 40,
        overflowY: "auto",
        background: "rgba(3,8,16,0.6)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 620, maxWidth: "92%", borderRadius: "var(--r-lg)", background: "var(--grad-panel)", border: "1px solid var(--jv-border-cyan)", boxShadow: "var(--panel-shadow-active)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--jv-hairline)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 40, height: 40, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
              <Icon name={icon} size={20} />
            </span>
            <div>
              <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Orchestrate a teammate</div>
              <div style={{ font: "var(--fw-bold) 17px var(--font-body)", color: "var(--jv-text)", marginTop: 2 }}>{name.trim() || "New Agent"}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--jv-text-muted)", cursor: "pointer", display: "grid", placeItems: "center" }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ padding: "20px 20px 4px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Field label="Agent name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Finance Agent" style={inputStyle} />
            </Field>
            <Field label="Role">
              <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Tracks spend & budgets" style={inputStyle} />
            </Field>
          </div>
          <Field label="Icon">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ICON_CHOICES.map((ic) => (
                <button
                  key={ic}
                  onClick={() => setIcon(ic)}
                  style={{
                    width: 38,
                    height: 38,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "var(--r-sm)",
                    cursor: "pointer",
                    color: icon === ic ? "var(--jv-cyan-300)" : "var(--jv-text-muted)",
                    background: icon === ic ? "var(--grad-cyan-soft)" : "var(--jv-void)",
                    border: `1px solid ${icon === ic ? "var(--jv-border-cyan)" : "var(--jv-border)"}`,
                  }}
                >
                  <Icon name={ic} size={17} />
                </button>
              ))}
            </div>
          </Field>
          <Field label="Reasoning model">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {MODELS.map((m) => (
                <Chip key={m} active={model === m} onClick={() => setModel(m)}>
                  {m}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Tools & skills" hint={`${tools.length} selected — what this agent is allowed to call.`}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {TOOL_CHOICES.map((t) => (
                <Chip key={t} active={tools.includes(t)} onClick={() => toggle(tools, setTools, t)}>
                  {t}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Collaborates with" hint="Teammates this agent may hand off to in a multi-agent run.">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {TEAMMATES.map((t) => (
                <Chip key={t} active={collabs.includes(t)} onClick={() => toggle(collabs, setCollabs, t)}>
                  {t}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Autonomy">
            <div style={{ display: "flex", gap: 8 }}>
              {["Ask before acting", "Act, then report", "Fully autonomous"].map((a) => (
                <Chip key={a} active={autonomy === a} onClick={() => setAutonomy(a)}>
                  {a}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="System instructions">
            <textarea
              value={instr}
              onChange={(e) => setInstr(e.target.value)}
              placeholder="Describe how this teammate should think and behave…"
              style={{ ...inputStyle, height: 80, padding: "10px 14px", resize: "vertical", font: "var(--fw-regular) 13px/1.5 var(--font-body)" }}
            />
          </Field>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px", borderTop: "1px solid var(--jv-hairline)" }}>
          <span style={{ font: "11px var(--font-mono)", color: "var(--jv-text-faint)" }}>{ready ? "Ready to deploy" : "Name and role required"}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Icon name="rocket" size={14} />}
              onClick={() => ready && onCreate({ icon, name: name.trim(), role: role.trim(), model, tools, collaborators: collabs, autonomy, instructions: instr })}
            >
              Deploy Agent
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Agents() {
  const [building, setBuilding] = useState(false);
  const [cockpit, setCockpit] = useState<string | null>(null);
  const { data: rosterData, reload } = useApi<Agent[]>("/api/agents");
  const { data: runsData } = useApi<AgentRun[]>("/api/agents/runs");
  const { data: runtime } = useApi<RuntimeStats>("/api/agents/runtime");
  const roster = rosterData ?? ROSTER_SEED;
  const runs = runsData ?? RUNS_SEED;
  const stats = runtime ?? { active: 3, recentRuns: 4, stepsToday: 11, errors: 1 };

  const create = async (a: NewAgent) => {
    try {
      await api.post<Agent>("/api/agents", a);
      reload();
    } catch {
      /* offline — ignore */
    }
    setBuilding(false);
  };

  if (cockpit) return <AgentCockpit agentName={cockpit} onExit={() => setCockpit(null)} />;

  return (
    <Fragment>
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Panel
            title="Agent Roster"
            eyebrow
            action={
              <button
                onClick={() => setBuilding(true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 10px",
                  borderRadius: "var(--r-sm)",
                  border: "1px solid var(--jv-border-cyan)",
                  background: "var(--grad-cyan-soft)",
                  color: "var(--jv-cyan-300)",
                  font: "var(--fw-semibold) 10px var(--font-hud)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                <Icon name="plus" size={13} />
                New Agent
              </button>
            }
            bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            {roster.map((a) => (
              <AgentCard key={a.id} a={a} onClick={() => setCockpit(a.name)} />
            ))}
          </Panel>
          <Panel title="Runtime" eyebrow>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <StatTile value={stats.active} label="Active" tone="optimal" />
              <StatTile value={stats.recentRuns} label="Recent runs" tone="info" />
              <StatTile value={stats.stepsToday} label="Steps today" tone="info" />
              <StatTile value={stats.errors} label="Errors" tone="critical" />
            </div>
          </Panel>
        </div>

        <Panel title="Multi-agent Executions" action={<span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>{runs.length} recent</span>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </div>
        </Panel>
      </div>
      <div style={{ marginTop: 16 }}>
        <Delegation />
      </div>
      {building && <AgentBuilder onClose={() => setBuilding(false)} onCreate={create} />}
    </Fragment>
  );
}
