// AgentCockpit — the control panel for ONE agent. Everything here edits and
// persists on that agent: its plan, schedule (calendar), budget, permissions,
// and skills & tools. Center shows the live session (empty until it runs).
import { useEffect, useState } from "react";
import { Panel, Badge, Button, Icon, EmptyState, IconButton } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { Agent, AgentPermission } from "@jarvis/shared";

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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 11px",
        borderRadius: "var(--r-pill)",
        border: `1px solid ${active ? "var(--jv-border-cyan)" : "var(--jv-border)"}`,
        background: active ? "var(--grad-cyan-soft)" : "var(--jv-void)",
        color: active ? "var(--jv-cyan-300)" : "var(--jv-text-muted)",
        font: `${active ? "var(--fw-semibold)" : "var(--fw-medium)"} 11.5px var(--font-mono)`,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export default function AgentCockpit({ agentId, onExit }: { agentId: string; onExit: () => void }) {
  const { data, reload } = useApi<Agent[]>("/api/agents");
  const agent = (data ?? []).find((a) => a.id === agentId);

  const [controlled, setControlled] = useState(false);
  const [paused, setPaused] = useState(false);

  // Editable buffers, seeded from the agent when it loads.
  const [plan, setPlan] = useState("");
  const [routine, setRoutine] = useState("");
  const [budget, setBudget] = useState("");
  const [schedule, setSchedule] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [perms, setPerms] = useState<AgentPermission[]>([]);
  const [newPerm, setNewPerm] = useState("");

  useEffect(() => {
    if (!agent) return;
    setPlan(agent.plan ?? "");
    setRoutine(agent.routine ?? "");
    setBudget(agent.budget ?? "");
    setSchedule(agent.schedule ?? "");
    setTools(agent.tools ?? []);
    setPerms(agent.permissions ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id]);

  const save = async (patch: Partial<Agent>) => {
    await api.patch(`/api/agents/${agentId}`, patch).catch(() => {});
    reload();
  };

  // Tools + permissions persist immediately on toggle.
  const toggleTool = (t: string) => {
    const next = tools.includes(t) ? tools.filter((x) => x !== t) : [...tools, t];
    setTools(next);
    save({ tools: next });
  };
  const togglePerm = (i: number) => {
    const next = perms.map((p, j) => (j === i ? { ...p, allowed: !p.allowed } : p));
    setPerms(next);
    save({ permissions: next });
  };
  const addPerm = () => {
    const label = newPerm.trim();
    if (!label) return;
    const next = [...perms, { label, allowed: true }];
    setPerms(next);
    setNewPerm("");
    save({ permissions: next });
  };
  const removePerm = (i: number) => {
    const next = perms.filter((_, j) => j !== i);
    setPerms(next);
    save({ permissions: next });
  };

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
        <Badge status={paused ? "warn" : controlled ? "info" : agent?.status === "optimal" ? "live" : "standby"} solid>{paused ? "Paused" : controlled ? "Operator" : agent?.status === "optimal" ? "Running" : "Standby"}</Badge>
        <button onClick={() => { setPaused(false); save({ status: "optimal", statusLabel: "Active" }); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 13px", height: 34, borderRadius: "var(--r-sm)", border: "1px solid var(--jv-border)", background: "transparent", color: "var(--jv-text-soft)", font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="play" size={14} />Activate</button>
        <button onClick={() => { setPaused(true); save({ status: "standby", statusLabel: "Standby" }); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 13px", height: 34, borderRadius: "var(--r-sm)", border: "1px solid color-mix(in srgb, var(--jv-red) 40%, transparent)", background: "color-mix(in srgb, var(--jv-red) 12%, transparent)", color: "var(--jv-red)", font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="octagon-x" size={14} />Stop</button>
      </div>

      {/* body */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "300px 1fr 300px", gap: 14, minHeight: 0, overflowY: "auto" }}>
        {/* LEFT — plan + routine + schedule */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
          <Panel title="Plan · its job" eyebrow>
            <textarea value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="What is this agent trying to achieve? What does done look like?" style={{ ...fieldStyle, height: 90, resize: "vertical", font: "var(--fw-regular) 12.5px/1.5 var(--font-body)" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <Button size="sm" variant="secondary" icon={<Icon name="save" size={13} />} onClick={() => save({ plan })}>Save plan</Button>
            </div>
          </Panel>
          <Panel title="Routine · how it works" eyebrow>
            <textarea value={routine} onChange={(e) => setRoutine(e.target.value)} placeholder={"Recurring steps, one per line:\n1. …\n2. …"} style={{ ...fieldStyle, height: 90, resize: "vertical", font: "var(--fw-regular) 12.5px/1.5 var(--font-body)" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <Button size="sm" variant="secondary" icon={<Icon name="save" size={13} />} onClick={() => save({ routine })}>Save routine</Button>
            </div>
          </Panel>
          <Panel title="Calendar · schedule" eyebrow>
            <input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="e.g. Every weekday · 9:00 am" style={fieldStyle} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <Button size="sm" variant="secondary" icon={<Icon name="save" size={13} />} onClick={() => save({ schedule })}>Save schedule</Button>
            </div>
          </Panel>
        </div>

        {/* CENTER — live session */}
        <div style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--jv-void)", border: `1px solid ${controlled ? "var(--jv-border-cyan)" : "var(--jv-border)"}`, overflow: "hidden", boxShadow: controlled ? "0 0 24px rgba(41,211,245,0.15)" : "var(--panel-shadow)", minHeight: 360 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 13px", borderBottom: "1px solid var(--jv-hairline)", background: "rgba(10,22,38,0.6)" }}>
            <div style={{ display: "flex", gap: 5 }}>{["#fb5b6e", "#fbbf24", "#34d399"].map((cc) => <span key={cc} style={{ width: 9, height: 9, borderRadius: "50%", background: cc }} />)}</div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: "var(--r-pill)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", font: "11px var(--font-mono)", color: "var(--jv-text-faint)" }}><Icon name="lock" size={11} color="var(--jv-text-faint)" />about:blank</div>
            <span style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: controlled ? "var(--jv-cyan-300)" : "var(--jv-text-faint)" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", boxShadow: "0 0 6px currentColor" }} />{controlled ? "You" : "Agent"} driving</span>
          </div>
          <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 16 }}>
            <EmptyState icon="monitor" title="No agent session running" hint="When this agent starts a task, its live session streams here." />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderTop: "1px solid var(--jv-hairline)", background: "rgba(10,22,38,0.6)" }}>
            <span style={{ flex: 1, font: "11px var(--font-mono)", color: "var(--jv-text-muted)" }}>{controlled ? "You have control — the agent is watching." : "Streaming the agent's session live."}</span>
            {controlled
              ? <Button size="sm" variant="secondary" icon={<Icon name="corner-up-left" size={13} />} onClick={() => setControlled(false)}>Hand back</Button>
              : <Button size="sm" variant="primary" icon={<Icon name="hand" size={13} />} onClick={() => setControlled(true)}>Take control</Button>}
          </div>
        </div>

        {/* RIGHT — budget, permissions, skills & tools */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
          <Panel title="Budget" eyebrow>
            <input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. $500/mo" style={fieldStyle} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <Button size="sm" variant="secondary" icon={<Icon name="save" size={13} />} onClick={() => save({ budget })}>Set budget</Button>
            </div>
          </Panel>

          <Panel title="Permissions" eyebrow bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {perms.length === 0 && <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-faint)" }}>No permissions granted yet — add capabilities this agent may use.</div>}
            {perms.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-medium) 12px var(--font-body)" }}>
                <span style={{ flex: 1, color: "var(--jv-text-soft)" }}>{p.label}</span>
                <button onClick={() => togglePerm(i)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: "var(--r-pill)", cursor: "pointer", border: `1px solid ${p.allowed ? "color-mix(in srgb, var(--jv-green) 40%, transparent)" : "color-mix(in srgb, var(--jv-red) 40%, transparent)"}`, background: p.allowed ? "color-mix(in srgb, var(--jv-green) 12%, transparent)" : "color-mix(in srgb, var(--jv-red) 12%, transparent)", color: p.allowed ? "var(--jv-green)" : "var(--jv-red)", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  <Icon name={p.allowed ? "check" : "x"} size={11} />{p.allowed ? "Allow" : "Deny"}
                </button>
                <IconButton icon="trash-2" tone="danger" title="Remove" size={26} onClick={() => removePerm(i)} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
              <input value={newPerm} onChange={(e) => setNewPerm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPerm()} placeholder="e.g. Send email" style={{ ...fieldStyle, height: 34, padding: "0 10px" }} />
              <Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />} onClick={addPerm}>Add</Button>
            </div>
          </Panel>

          <Panel title="Skills & tools" eyebrow>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {TOOL_CHOICES.map((t) => <Chip key={t} active={tools.includes(t)} onClick={() => toggleTool(t)}>{t}</Chip>)}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
