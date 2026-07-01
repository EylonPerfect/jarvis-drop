import { useState } from "react";
import { Panel, Icon } from "../ds";

type Grant = [string, string];

type AgentT = {
  ic: string;
  name: string;
  role: string;
  tone: string;
  grants: Grant[];
};

// grant: [label, state]  state: "allow" | "deny" | limit string
const AGENTS: AgentT[] = [
  { ic: "send", name: "SDR Agent", role: "Sales Development", tone: "optimal",
    grants: [["Draft email", "allow"], ["Send email", "deny"], ["Read CRM contacts", "allow"], ["Share data externally", "deny"], ["Monthly spend", "$500 / mo"], ["Autonomy", "Ask before acting"]] },
  { ic: "credit-card", name: "AR Clerk", role: "Accounts Receivable", tone: "optimal",
    grants: [["Read finance", "allow"], ["Draft invoice", "allow"], ["Pay invoice", "deny"], ["Share externally", "deny"], ["Monthly spend", "$2,000 / mo"], ["Autonomy", "Act, then report"]] },
  { ic: "database", name: "Recruiting Sourcer", role: "Talent Sourcing", tone: "standby",
    grants: [["Read candidate data", "allow"], ["Read compensation", "deny"], ["Message candidates", "allow"], ["Share externally", "deny"], ["Monthly spend", "$300 / mo"], ["Autonomy", "Ask before acting"]] },
];

const ROLE_TEMPLATES: [string, string, string][] = [
  ["send", "SDR", "Draft only · no send · $500/mo · CRM read"],
  ["credit-card", "AR Clerk", "Finance read · draft pay · no send · $2k/mo"],
  ["users", "Recruiting Sourcer", "Candidate read · no comp · $300/mo"],
  ["clipboard-check", "QA Tester", "Sandbox only · no prod · $150/mo"],
  ["table", "Data-Entry Clerk", "Sheet write · backup on delete · $100/mo"],
];

const DATA_WALLS: [string, string, string][] = [
  ["HR finance", "Recruiting", "blocked"],
  ["Customer PII", "External share", "blocked"],
  ["Prod database", "QA Tester", "blocked"],
  ["Bank credentials", "All except AR Clerk", "blocked"],
];

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

function AgentFence({ agent, onToggle }: { agent: AgentT; onToggle: (name: string, gi: number) => void }) {
  const c = agent.tone === "optimal" ? "var(--jv-green)" : "var(--jv-violet)";
  return (
    <div style={{ borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid var(--jv-hairline)" }}>
        <span style={{ width: 36, height: 36, flex: "0 0 36px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 32%, transparent)` }}><Icon name={agent.ic} size={17} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ font: "var(--fw-bold) 13.5px var(--font-body)", color: "var(--jv-text)" }}>{agent.name}</div>
          <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>{agent.role}</div>
        </div>
        <button title="Revoke all grants" style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: "var(--r-sm)", border: "1px solid color-mix(in srgb, var(--jv-red) 34%, transparent)", background: "transparent", color: "var(--jv-red)", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="shield-off" size={12} />Revoke all</button>
      </div>
      {agent.grants.map((g, i) => <GrantRow key={i} label={g[0]} state={g[1]} onToggle={() => onToggle(agent.name, i)} />)}
    </div>
  );
}

export default function Permissions() {
  const [agents, setAgents] = useState(AGENTS);
  const toggle = (name: string, gi: number) => setAgents((prev) => prev.map((a) => {
    if (a.name !== name) return a;
    const grants = a.grants.map((g, i): Grant => (i === gi && (g[1] === "allow" || g[1] === "deny")) ? [g[0], g[1] === "allow" ? "deny" : "allow"] : g);
    return { ...a, grants };
  }));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
      <Panel title="The Fence — Per-agent grants" eyebrow action={<span style={{ font: "var(--fw-medium) 11.5px var(--font-body)", color: "var(--jv-text-muted)" }}>Every grant revocable in one tap</span>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {agents.map((a) => <AgentFence key={a.name} agent={a} onToggle={toggle} />)}
        </div>
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel title="Role templates" eyebrow bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {ROLE_TEMPLATES.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <span style={{ width: 32, height: 32, flex: "0 0 32px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}><Icon name={r[0]} size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{r[1]}</div>
                <div style={{ font: "10.5px/1.4 var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 2 }}>{r[2]}</div>
              </div>
            </div>
          ))}
        </Panel>
        <Panel title="Data walls" eyebrow action={<Icon name="shield" size={15} color="var(--jv-red)" />} bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {DATA_WALLS.map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid color-mix(in srgb, var(--jv-red) 22%, transparent)" }}>
              <Icon name="ban" size={14} color="var(--jv-red)" />
              <div style={{ flex: 1, font: "12px var(--font-mono)", color: "var(--jv-text-soft)" }}>{w[0]} <span style={{ color: "var(--jv-text-faint)" }}>↛</span> {w[1]}</div>
              <span style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-red)" }}>Blocked</span>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
