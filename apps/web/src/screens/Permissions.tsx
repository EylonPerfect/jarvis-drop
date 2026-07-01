import { useState } from "react";
import { Panel, Icon, EmptyState, IconButton, ConfirmDialog, Button } from "../ds";
import { usePersistentState } from "../api/hooks";

type Grant = [string, string];

type AgentT = {
  ic: string;
  name: string;
  role: string;
  tone: string;
  grants: Grant[];
};

function GrantRow({ label, state, onToggle }: { label: string; state: string; onToggle: () => void }) {
  const isLimit = state !== "allow" && state !== "deny";
  const allow = state === "allow";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--jv-hairline)" }}>
      <span style={{ font: "var(--fw-medium) 12.5px var(--font-body)", color: "var(--jv-text-soft)" }}>{label}</span>
      {isLimit ? (
        <span style={{ font: "var(--fw-semibold) 12px var(--font-mono)", color: "var(--jv-cyan-300)" }}>{state}</span>
      ) : (
        <button onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px 3px 8px", borderRadius: "var(--r-pill)", cursor: "pointer", border: `1px solid ${allow ? "color-mix(in srgb, var(--jv-green) 40%, transparent)" : "color-mix(in srgb, var(--jv-red) 38%, transparent)"}`, background: allow ? "color-mix(in srgb, var(--jv-green) 12%, transparent)" : "color-mix(in srgb, var(--jv-red) 10%, transparent)", color: allow ? "var(--jv-green)" : "var(--jv-red)", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          <Icon name={allow ? "check" : "x"} size={12} />{allow ? "May" : "May not"}
        </button>
      )}
    </div>
  );
}

function AgentFence({ agent, onToggle, onRevokeAll, onRemove }: { agent: AgentT; onToggle: (name: string, gi: number) => void; onRevokeAll: (name: string) => void; onRemove: (name: string) => void }) {
  const c = agent.tone === "optimal" ? "var(--jv-green)" : "var(--jv-violet)";
  return (
    <div style={{ borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid var(--jv-hairline)" }}>
        <span style={{ width: 36, height: 36, flex: "0 0 36px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 32%, transparent)` }}><Icon name={agent.ic} size={17} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ font: "var(--fw-bold) 13.5px var(--font-body)", color: "var(--jv-text)" }}>{agent.name}</div>
          <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>{agent.role}</div>
        </div>
        <button onClick={() => onRevokeAll(agent.name)} title="Revoke all grants" style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: "var(--r-sm)", border: "1px solid color-mix(in srgb, var(--jv-red) 34%, transparent)", background: "transparent", color: "var(--jv-red)", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="shield-off" size={12} />Revoke all</button>
        <IconButton icon="trash-2" title={`Remove ${agent.name}`} tone="danger" onClick={() => onRemove(agent.name)} />
      </div>
      {agent.grants.map((g, i) => <GrantRow key={i} label={g[0]} state={g[1]} onToggle={() => onToggle(agent.name, i)} />)}
    </div>
  );
}

export default function Permissions() {
  const [agents, setAgents] = usePersistentState<AgentT[]>("permissions", []);
  const [clearing, setClearing] = useState(false);
  const toggle = (name: string, gi: number) => setAgents(agents.map((a) => {
    if (a.name !== name) return a;
    const grants = a.grants.map((g, i): Grant => (i === gi && (g[1] === "allow" || g[1] === "deny")) ? [g[0], g[1] === "allow" ? "deny" : "allow"] : g);
    return { ...a, grants };
  }));
  const revokeAll = (name: string) => setAgents(agents.map((a) => {
    if (a.name !== name) return a;
    const grants = a.grants.map((g): Grant => (g[1] === "allow" || g[1] === "deny") ? [g[0], "deny"] : g);
    return { ...a, grants };
  }));
  const remove = (name: string) => setAgents(agents.filter((a) => a.name !== name));
  return (
    <Panel title="The Fence — Per-agent grants" eyebrow action={agents.length > 0 ? (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ font: "var(--fw-medium) 11.5px var(--font-body)", color: "var(--jv-text-muted)" }}>Every grant revocable in one tap</span>
        <Button size="sm" variant="danger" icon={<Icon name="trash-2" size={13} />} onClick={() => setClearing(true)}>Clear all</Button>
      </div>
    ) : undefined}>
      {agents.length === 0 ? (
        <EmptyState icon="shield" title="No agents to govern yet" hint="Grant permissions once agents are hired. Each agent gets its own fence — a set of revocable grants for what it may and may not do." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {agents.map((a) => <AgentFence key={a.name} agent={a} onToggle={toggle} onRevokeAll={revokeAll} onRemove={remove} />)}
        </div>
      )}
      <ConfirmDialog open={clearing} danger title="Remove all agents?" message="This clears every agent and its grants from the fence. This cannot be undone." confirmLabel="Clear all" onCancel={() => setClearing(false)} onConfirm={() => { setAgents([]); setClearing(false); }} />
    </Panel>
  );
}
