// AgentCockpit — the live drill-down for one agent. Left: current plan + step
// list. Center: a live view of the browser/app it is driving (mock streaming
// frame) with Take control / Hand back. Right: its permissions, budget, and
// recent ledger. Pause and Kill controls in the header.
import { useState } from "react";
import { Panel, Badge, Button, Icon, EmptyState } from "../ds";
import { usePersistentState } from "../api/hooks";

type PlanState = "done" | "active" | "pending";

interface CockpitState {
  plan: [PlanState, string][];
  ledger: [string, string, string][];
  grants: [string, string][];
}

const EMPTY_COCKPIT: CockpitState = { plan: [], ledger: [], grants: [] };
const STATE_C: Record<PlanState, string> = { done: "var(--jv-green)", active: "var(--jv-cyan)", pending: "var(--jv-text-faint)" };

export default function AgentCockpit({ agentName = "SDR Agent", onExit }: { agentName: string; onExit: () => void }) {
  const [cp, setCp] = usePersistentState<CockpitState>("cockpit", EMPTY_COCKPIT);
  const [controlled, setControlled] = useState(false);
  const [paused, setPaused] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 16px", borderRadius: "var(--r-md)", background: "var(--grad-panel)", border: "1px solid var(--jv-border)", boxShadow: "var(--panel-shadow)" }}>
        <button onClick={onExit} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "var(--jv-text-muted)", cursor: "pointer", font: "var(--fw-medium) 12px var(--font-body)" }}><Icon name="chevron-left" size={16} />Roster</button>
        <span style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-green)", background: "color-mix(in srgb, var(--jv-green) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-green) 32%, transparent)" }}><Icon name="send" size={16} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)" }}>{agentName}</div>
          <div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)" }}>Cockpit · live drill-down</div>
        </div>
        <Badge status={paused ? "warn" : controlled ? "info" : "live"} solid>{paused ? "Paused" : controlled ? "Operator" : "Running"}</Badge>
        <button onClick={() => setPaused((p) => !p)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 13px", height: 34, borderRadius: "var(--r-sm)", border: "1px solid var(--jv-border)", background: "transparent", color: "var(--jv-text-soft)", font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name={paused ? "play" : "pause"} size={14} />{paused ? "Resume" : "Pause"}</button>
        <button onClick={() => { setCp(EMPTY_COCKPIT); setPaused(false); setControlled(false); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 13px", height: 34, borderRadius: "var(--r-sm)", border: "1px solid color-mix(in srgb, var(--jv-red) 40%, transparent)", background: "color-mix(in srgb, var(--jv-red) 12%, transparent)", color: "var(--jv-red)", font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="octagon-x" size={14} />Kill</button>
      </div>

      {/* body */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "280px 1fr 280px", gap: 14, minHeight: 0 }}>
        {/* plan */}
        <Panel title="Plan" eyebrow style={{ height: "100%" }} bodyStyle={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {cp.plan.length === 0 && <EmptyState compact icon="list-checks" title="No plan yet" hint="The agent's steps appear here once it starts a task." />}
          {cp.plan.map(([st, text], i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 8px", borderBottom: i < cp.plan.length - 1 ? "1px solid var(--jv-hairline)" : "none" }}>
              <span style={{ flex: "0 0 18px", marginTop: 1 }}>
                {st === "done" ? <Icon name="check-circle" size={16} color={STATE_C.done} />
                  : st === "active" ? <span style={{ display: "block", width: 14, height: 14, margin: 1, borderRadius: "50%", border: "2px solid var(--jv-cyan)", boxShadow: "0 0 8px var(--jv-glow-cyan)", animation: "jv-pulse 1.6s ease-out infinite" }} />
                  : <span style={{ display: "block", width: 13, height: 13, margin: 1, borderRadius: "50%", border: "2px solid var(--jv-text-faint)" }} />}
              </span>
              <span style={{ font: `var(--fw-${st === "active" ? "semibold" : "regular"}) 12.5px/1.45 var(--font-body)`, color: st === "pending" ? "var(--jv-text-muted)" : "var(--jv-text-soft)" }}>{text}</span>
            </div>
          ))}
        </Panel>

        {/* live browser frame */}
        <div style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--jv-void)", border: `1px solid ${controlled ? "var(--jv-border-cyan)" : "var(--jv-border)"}`, overflow: "hidden", boxShadow: controlled ? "0 0 24px rgba(41,211,245,0.15)" : "var(--panel-shadow)" }}>
          {/* browser chrome */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 13px", borderBottom: "1px solid var(--jv-hairline)", background: "rgba(10,22,38,0.6)" }}>
            <div style={{ display: "flex", gap: 5 }}>{["#fb5b6e", "#fbbf24", "#34d399"].map((c) => <span key={c} style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />)}</div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: "var(--r-pill)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", font: "11px var(--font-mono)", color: "var(--jv-text-faint)" }}><Icon name="lock" size={11} color="var(--jv-text-faint)" />about:blank</div>
            <span style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: controlled ? "var(--jv-cyan-300)" : "var(--jv-text-faint)" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", boxShadow: "0 0 6px currentColor" }} />{controlled ? "You" : "Agent"} driving</span>
          </div>
          {/* live session viewport */}
          <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 16, overflow: "hidden" }}>
            <EmptyState icon="monitor" title="No agent session running" hint="When an agent starts a task, its live session streams here." />
          </div>
          {/* control bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderTop: "1px solid var(--jv-hairline)", background: "rgba(10,22,38,0.6)" }}>
            <span style={{ flex: 1, font: "11px var(--font-mono)", color: "var(--jv-text-muted)" }}>{controlled ? "You have control — the agent is watching." : "Streaming the agent's session live."}</span>
            {controlled
              ? <Button size="sm" variant="secondary" icon={<Icon name="corner-up-left" size={13} />} onClick={() => setControlled(false)}>Hand back</Button>
              : <Button size="sm" variant="primary" icon={<Icon name="hand" size={13} />} onClick={() => setControlled(true)}>Take control</Button>}
          </div>
        </div>

        {/* right rail: permissions, budget, ledger */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
          <Panel title="Budget" eyebrow>
            <EmptyState compact icon="wallet" title="No budget set" hint="Set a spend cap when this agent runs a task." />
          </Panel>
          <Panel title="Permissions" eyebrow bodyStyle={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {cp.grants.length === 0 && <EmptyState compact icon="shield" title="No permissions granted" hint="Grant capabilities before this agent acts." />}
            {cp.grants.map(([l, s], i) => {
              const allow = s === "may";
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", font: "var(--fw-medium) 12px var(--font-body)" }}>
                  <span style={{ color: "var(--jv-text-soft)" }}>{l}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, color: allow ? "var(--jv-green)" : "var(--jv-red)", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase" }}><Icon name={allow ? "check" : "x"} size={12} />{s}</span>
                </div>
              );
            })}
          </Panel>
          <Panel title="Recent ledger" eyebrow style={{ flex: 1, minHeight: 0 }} bodyStyle={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
            {cp.ledger.length === 0 && <EmptyState compact icon="receipt" title="No activity yet" hint="The agent's actions and costs will be logged here." />}
            {cp.ledger.map((e, i) => (
              <div key={i} style={{ padding: "8px 10px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)" }}>
                <div style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-soft)" }}>{e[1]}</div>
                <div style={{ display: "flex", justifyContent: "space-between", font: "10.5px var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 2 }}><span>{e[0]}</span><span>{e[2]}</span></div>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}
