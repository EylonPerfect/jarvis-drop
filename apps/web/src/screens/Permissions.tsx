import { useState } from "react";
import { Panel, Icon, EmptyState, IconButton, ConfirmDialog, Button } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { Agent, AgentPermission } from "@jarvis/shared";

// Default grants shown for an agent that has no permissions set yet. The list is
// denied by default — nothing is open until the operator explicitly allows it.
const DEFAULT_GRANTS: AgentPermission[] = [
  { label: "Read knowledge base", allowed: false },
  { label: "Send messages", allowed: false },
  { label: "Execute tools", allowed: false },
  { label: "Spend budget", allowed: false },
];

function GrantRow({ label, allowed, onToggle }: { label: string; allowed: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--jv-hairline)" }}>
      <span style={{ font: "var(--fw-medium) 12.5px var(--font-body)", color: "var(--jv-text-soft)" }}>{label}</span>
      <button onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px 3px 8px", borderRadius: "var(--r-pill)", cursor: "pointer", border: `1px solid ${allowed ? "color-mix(in srgb, var(--jv-green) 40%, transparent)" : "color-mix(in srgb, var(--jv-red) 38%, transparent)"}`, background: allowed ? "color-mix(in srgb, var(--jv-green) 12%, transparent)" : "color-mix(in srgb, var(--jv-red) 10%, transparent)", color: allowed ? "var(--jv-green)" : "var(--jv-red)", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        <Icon name={allowed ? "check" : "x"} size={12} />{allowed ? "May" : "May not"}
      </button>
    </div>
  );
}

function AgentFence({ agent, grants, onToggle, onRevokeAll, onRemove }: { agent: Agent; grants: AgentPermission[]; onToggle: (id: string, gi: number) => void; onRevokeAll: (id: string) => void; onRemove: (id: string) => void }) {
  const c = agent.status === "optimal" ? "var(--jv-green)" : "var(--jv-violet)";
  return (
    <div style={{ borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid var(--jv-hairline)" }}>
        <span style={{ width: 36, height: 36, flex: "0 0 36px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 32%, transparent)` }}><Icon name={agent.icon} size={17} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ font: "var(--fw-bold) 13.5px var(--font-body)", color: "var(--jv-text)" }}>{agent.name}</div>
          <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>{agent.role}</div>
        </div>
        <button onClick={() => onRevokeAll(agent.id)} title="Revoke all grants" style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: "var(--r-sm)", border: "1px solid color-mix(in srgb, var(--jv-red) 34%, transparent)", background: "transparent", color: "var(--jv-red)", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="shield-off" size={12} />Revoke all</button>
        <IconButton icon="trash-2" title={`Remove ${agent.name}`} tone="danger" onClick={() => onRemove(agent.id)} />
      </div>
      {grants.map((g, i) => <GrantRow key={i} label={g.label} allowed={g.allowed} onToggle={() => onToggle(agent.id, i)} />)}
    </div>
  );
}

export default function Permissions() {
  const { data, reload } = useApi<Agent[]>("/api/agents");
  const agents = data ?? [];
  const [clearing, setClearing] = useState(false);

  // An agent with no stored permissions falls back to the denied default set,
  // so every card always renders a governable grant list.
  const grantsFor = (a: Agent): AgentPermission[] => (a.permissions && a.permissions.length > 0 ? a.permissions : DEFAULT_GRANTS);

  const patchPermissions = async (id: string, permissions: AgentPermission[]) => {
    try {
      await api.patch(`/api/agents/${id}`, { permissions });
      reload();
    } catch {
      /* gateway may be offline */
    }
  };

  const toggle = (id: string, gi: number) => {
    const a = agents.find((x) => x.id === id);
    if (!a) return;
    const grants = grantsFor(a).map((g, i) => (i === gi ? { ...g, allowed: !g.allowed } : g));
    patchPermissions(id, grants);
  };

  const revokeAll = (id: string) => {
    const a = agents.find((x) => x.id === id);
    if (!a) return;
    const grants = grantsFor(a).map((g) => ({ ...g, allowed: false }));
    patchPermissions(id, grants);
  };

  const remove = async (id: string) => {
    try {
      await api.del(`/api/agents/${id}`);
      reload();
    } catch {
      /* ignore */
    }
  };

  // Safer than destroying the roster: revoke every grant across every agent.
  const revokeEveryone = async () => {
    try {
      await Promise.all(agents.map((a) => api.patch(`/api/agents/${a.id}`, { permissions: grantsFor(a).map((g) => ({ ...g, allowed: false })) })));
      reload();
    } catch {
      /* ignore */
    } finally {
      setClearing(false);
    }
  };

  return (
    <Panel title="The Fence — Per-agent grants" eyebrow action={agents.length > 0 ? (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ font: "var(--fw-medium) 11.5px var(--font-body)", color: "var(--jv-text-muted)" }}>Every grant revocable in one tap</span>
        <Button size="sm" variant="danger" icon={<Icon name="shield-off" size={13} />} onClick={() => setClearing(true)}>Revoke all</Button>
      </div>
    ) : undefined}>
      {agents.length === 0 ? (
        <EmptyState icon="shield" title="No agents to govern yet" hint="Grant permissions once agents are hired. Each agent gets its own fence — a set of revocable grants for what it may and may not do." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {agents.map((a) => <AgentFence key={a.id} agent={a} grants={grantsFor(a)} onToggle={toggle} onRevokeAll={revokeAll} onRemove={remove} />)}
        </div>
      )}
      <ConfirmDialog open={clearing} danger title="Revoke all grants?" message="This denies every grant for every agent in the fence. Agents stay on the roster, but nothing is allowed until you re-grant it." confirmLabel="Revoke all" onCancel={() => setClearing(false)} onConfirm={revokeEveryone} />
    </Panel>
  );
}
