// Spend — cost per agent and per OUTCOME (the hero metric, not per-token).
// Company total at top, budgets + caps per agent with usage bars, overage as
// cost-plus. Per-token detail is demoted to a footnote.
import { useState } from "react";
import { Panel, Badge, Button, Icon, EmptyState, ConfirmDialog } from "../ds";
import { usePersistentState } from "../api/hooks";

type Outcome = [string, string, number, string, string];
type Budget = [string, string, number, number, string];
type SpendState = { outcomes: Outcome[]; budgets: Budget[] };

function BudgetBar({ name, ic, spent, cap }: { name: string; ic: string; spent: number; cap: number; tone: string }) {
  const pct = Math.min(100, (spent / cap) * 100);
  const over = spent > cap;
  const overage = spent - cap;
  const c = over ? "var(--jv-red)" : pct > 80 ? "var(--jv-amber)" : "var(--jv-green)";
  return (
    <div style={{ padding: "12px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: `1px solid ${over ? "color-mix(in srgb, var(--jv-red) 34%, transparent)" : "var(--jv-border-soft)"}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
        <span style={{ width: 30, height: 30, flex: "0 0 30px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}><Icon name={ic} size={15} /></span>
        <span style={{ flex: 1, font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{name}</span>
        <span style={{ font: "var(--fw-bold) 14px var(--font-mono)", color: c }}>${spent.toLocaleString()}</span>
        <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-faint)" }}>/ ${cap.toLocaleString()}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "var(--jv-void)", overflow: "hidden", border: "1px solid var(--jv-border-soft)" }}>
        <div style={{ width: pct + "%", height: "100%", background: c, boxShadow: `0 0 8px color-mix(in srgb, ${c} 60%, transparent)` }} />
      </div>
      {over && <div style={{ marginTop: 7, font: "var(--fw-medium) 11px var(--font-mono)", color: "var(--jv-red)" }}>Over cap · cost-plus +${overage.toLocaleString()} (billed as overage)</div>}
    </div>
  );
}

export default function Spend() {
  const [spend, setSpend] = usePersistentState<SpendState>("spend", { outcomes: [], budgets: [] });
  const [clearing, setClearing] = useState<null | "outcomes" | "budgets">(null);
  const total = spend.budgets.reduce((s, b) => s + b[2], 0);
  const budgetTotal = spend.budgets.reduce((s, b) => s + b[3], 0);
  const overage = Math.max(0, total - budgetTotal);
  const outcomeCount = spend.outcomes.reduce((s, o) => s + o[2], 0);
  const blended = outcomeCount > 0 ? total / outcomeCount : 0;
  const overCap = spend.budgets.filter((b) => b[2] > b[3]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* company total */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 16 }}>
        <Panel brackets>
          <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 8 }}>Company spend · June</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ font: "var(--fw-bold) 44px/1 var(--font-display)", color: "var(--jv-text)", textShadow: "var(--glow-cyan)" }}>${total.toLocaleString()}</span>
            {overage > 0 && <span style={{ font: "var(--fw-medium) 13px var(--font-mono)", color: "var(--jv-red)" }}>+${overage.toLocaleString()} overage</span>}
          </div>
          <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 6 }}>Across {spend.budgets.length} agent{spend.budgets.length === 1 ? "" : "s"} · budget ${budgetTotal.toLocaleString()} · {outcomeCount.toLocaleString()} outcomes delivered</div>
        </Panel>
        <Panel>
          <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 8 }}>Blended cost / outcome</div>
          <div style={{ font: "var(--fw-bold) 34px/1 var(--font-display)", color: "var(--jv-green)", textShadow: "var(--glow-green)" }}>${blended.toFixed(2)}</div>
          <div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 6 }}>{outcomeCount.toLocaleString()} outcomes · ${total.toLocaleString()} spend</div>
        </Panel>
        <Panel>
          <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 8 }}>Agents over cap</div>
          <div style={{ font: "var(--fw-bold) 34px/1 var(--font-display)", color: overCap.length ? "var(--jv-red)" : "var(--jv-green)" }}>{overCap.length}</div>
          <div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 6 }}>{overCap.length ? overCap.map((b) => b[0]).join(" · ") : "All within budget"}</div>
        </Panel>
      </div>

      {/* cost per outcome — the hero table */}
      <Panel title="Cost per outcome" eyebrow action={<div style={{ display: "flex", alignItems: "center", gap: 10 }}><Badge status="optimal" dot={false}>Hero metric</Badge>{spend.outcomes.length > 0 && <Button size="sm" variant="danger" icon={<Icon name="trash-2" size={13} />} onClick={() => setClearing("outcomes")}>Clear all</Button>}</div>}>
        {spend.outcomes.length === 0 ? (
          <EmptyState icon="target" title="No outcomes recorded yet" hint="Once agents start delivering work, the cost of each outcome — the hero metric — shows up here." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 200px 90px 110px", gap: 12, padding: "0 6px 10px", borderBottom: "1px solid var(--jv-hairline)", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-faint)" }}>
              <span>Outcome</span><span>Agent</span><span style={{ textAlign: "right" }}>Count</span><span style={{ textAlign: "right" }}>Cost / each</span>
            </div>
            {spend.outcomes.map((o, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 200px 90px 110px", gap: 12, padding: "12px 6px", borderBottom: i < spend.outcomes.length - 1 ? "1px solid var(--jv-hairline)" : "none", alignItems: "center" }}>
                <span style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{o[0]}</span>
                <span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-cyan-300)" }}>{o[1]}</span>
                <span style={{ textAlign: "right", font: "13px var(--font-mono)", color: "var(--jv-text-soft)" }}>{o[2]}</span>
                <span style={{ textAlign: "right", font: "var(--fw-bold) 14px var(--font-mono)", color: "var(--jv-green)" }}>{o[3]}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* budgets + caps */}
      <Panel title="Budgets & caps per agent" eyebrow action={spend.budgets.length > 0 ? <Button size="sm" variant="danger" icon={<Icon name="trash-2" size={13} />} onClick={() => setClearing("budgets")}>Clear all</Button> : undefined}>
        {spend.budgets.length === 0 ? (
          <EmptyState icon="gauge" title="No budgets set yet" hint="Assign a monthly spend cap per agent and usage bars will track each one against its budget here." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {spend.budgets.map((b, i) => <BudgetBar key={i} name={b[0]} ic={b[1]} spent={b[2]} cap={b[3]} tone={b[4]} />)}
          </div>
        )}
      </Panel>

      <ConfirmDialog open={clearing !== null} danger title={clearing === "budgets" ? "Clear all budgets?" : "Clear all outcomes?"} message="This permanently removes these records from the spend ledger." confirmLabel="Clear all" onCancel={() => setClearing(null)} onConfirm={() => { setSpend((prev) => clearing === "budgets" ? { ...prev, budgets: [] } : { ...prev, outcomes: [] }); setClearing(null); }} />
    </div>
  );
}
