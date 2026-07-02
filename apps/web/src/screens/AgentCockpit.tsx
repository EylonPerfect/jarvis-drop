// AgentCockpit — the control panel for ONE agent. Each block keeps its
// placeholder empty-state and has an Edit (pencil) button at its top-right that
// opens a full modal to define that block. Everything persists on the agent
// (plan, routine, calendar/schedule, budget, permissions, skills & tools).
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Panel, Badge, Button, Icon, EmptyState, IconButton, StatTile } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { Agent, AgentPermission, AgentPerformance, AgentComm, LedgerEntry } from "@jarvis/shared";

const TOOL_CHOICES = ["web_search", "code_interpreter", "filesystem", "github", "memory.query", "calendar", "gmail", "whatsapp", "shell", "vision"];

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
        <Badge status={agent?.status === "optimal" ? "live" : "standby"} solid>{agent?.status === "optimal" ? "Running" : "Standby"}</Badge>
        <button onClick={() => save({ status: "optimal", statusLabel: "Active" })} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 13px", height: 34, borderRadius: "var(--r-sm)", border: "1px solid var(--jv-border)", background: "transparent", color: "var(--jv-text-soft)", font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="play" size={14} />Activate</button>
        <button onClick={() => save({ status: "standby", statusLabel: "Standby" })} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 13px", height: 34, borderRadius: "var(--r-sm)", border: "1px solid color-mix(in srgb, var(--jv-red) 40%, transparent)", background: "color-mix(in srgb, var(--jv-red) 12%, transparent)", color: "var(--jv-red)", font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="octagon-x" size={14} />Stop</button>
      </div>

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
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
        </div>

        {/* CENTER — live session. No backend session stream exists yet, so we show
            an honest empty state rather than a fake browser chrome that implies a
            live remote session. */}
        <div style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", overflow: "hidden", boxShadow: "var(--panel-shadow)", minHeight: 360 }}>
          <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 16 }}>
            <EmptyState icon="monitor" title="No agent session running" hint="When this agent starts a task, its live session streams here." />
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
          <Panel title="Budget" eyebrow action={<EditBtn k="budget" />}>
            {agent?.budget ? <div style={{ font: "var(--fw-bold) 20px var(--font-body)", color: "var(--jv-text)" }}>{agent.budget}</div> : <EmptyState compact icon="wallet" title="No budget set" hint="Set a spend cap when this agent runs a task." />}
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
