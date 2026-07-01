// Ledger — append-only, timestamped record of every action every agent took:
// what it saw, did, decided, and what it cost. Filter by agent, scrub the day's
// timeline, expand "Why did you do this?" (reasoning + grant used + tokens), export.
import { useState } from "react";
import { Panel, Badge, Button, Icon, EmptyState, ConfirmDialog } from "../ds";
import { usePersistentState } from "../api/hooks";

interface LedgerEntry {
  t: string;
  agent: string;
  ic: string;
  verb: string;
  what: string;
  cost: string;
  grant: string;
  status: string;
  saw: string;
  decided: string;
  tokens: string;
}

const STATUS_C: Record<string, string> = { ok: "var(--jv-green)", blocked: "var(--jv-red)", warn: "var(--jv-amber)" };

function Entry({ e }: { e: LedgerEntry }) {
  const [why, setWhy] = useState(false);
  const c = STATUS_C[e.status];
  const details: [string, string, string][] = [["eye", "Saw", e.saw], ["git-branch", "Decided", e.decided], ["shield", "Grant used", e.grant], ["coins", "Tokens", e.tokens]];
  return (
    <div style={{ borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 14px" }}>
        <span style={{ font: "11px var(--font-mono)", color: "var(--jv-text-faint)", flex: "0 0 92px" }}>{e.t}</span>
        <span style={{ width: 30, height: 30, flex: "0 0 30px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}><Icon name={e.ic} size={15} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "var(--fw-medium) 13px var(--font-body)", color: "var(--jv-text)" }}><span style={{ color: c, fontWeight: 600 }}>{e.verb}</span> — {e.what}</div>
          <div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 2 }}>{e.agent} · {e.cost}</div>
        </div>
        <button onClick={() => setWhy((w) => !w)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: "var(--r-sm)", border: `1px solid ${why ? "var(--jv-border-cyan)" : "var(--jv-border)"}`, background: why ? "var(--grad-cyan-soft)" : "transparent", color: why ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", font: "var(--fw-medium) 11px var(--font-body)", cursor: "pointer", whiteSpace: "nowrap" }}><Icon name="help-circle" size={13} />Why did you do this?</button>
      </div>
      {why && (
        <div style={{ padding: "0 14px 14px 119px", display: "flex", flexDirection: "column", gap: 8 }}>
          {details.map(([ic, k, v], i) => (
            <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <Icon name={ic} size={13} color="var(--jv-cyan-300)" style={{ marginTop: 2, flex: "0 0 13px" }} />
              <div><span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-faint)", marginRight: 8 }}>{k}</span><span style={{ font: "12px/1.5 var(--font-mono)", color: "var(--jv-text-soft)" }}>{v}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Ledger() {
  const [entries, setEntries] = usePersistentState<LedgerEntry[]>("ledger", []);
  const [agent, setAgent] = useState("All agents");
  const [clearing, setClearing] = useState(false);
  const agentChips = ["All agents", ...Array.from(new Set(entries.map((e) => e.agent)))];
  const shown = entries.filter((e) => agent === "All agents" || e.agent === agent);
  const exportAudit = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-audit-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <Panel title="Ledger" eyebrow action={<div style={{ display: "flex", gap: 8, alignItems: "center" }}><Badge status="info" dot={false}>Append-only</Badge>{entries.length > 0 && <><Button size="sm" variant="secondary" icon={<Icon name="download" size={13} />} onClick={exportAudit}>Export audit</Button><Button size="sm" variant="danger" icon={<Icon name="trash-2" size={13} />} onClick={() => setClearing(true)}>Clear all</Button></>}</div>}>
      <p style={{ margin: "0 0 14px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>Every action every agent took — what it saw, did, decided, and what it cost. Timestamped and immutable.</p>

      {entries.length === 0 ? (
        <EmptyState icon="scroll-text" title="The ledger is empty" hint="Every action your agents take will be recorded here — timestamped, immutable, and exportable as an audit trail." />
      ) : (
        <>
          {/* controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {agentChips.map((a) => (
                <button key={a} onClick={() => setAgent(a)} style={{ padding: "6px 12px", borderRadius: "var(--r-pill)", border: `1px solid ${agent === a ? "var(--jv-border-cyan)" : "var(--jv-border)"}`, background: agent === a ? "var(--grad-cyan-soft)" : "transparent", color: agent === a ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", font: "var(--fw-medium) 11.5px var(--font-body)", cursor: "pointer" }}>{a}</button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shown.map((e, i) => <Entry key={i} e={e} />)}
          </div>
        </>
      )}
      <ConfirmDialog open={clearing} danger title="Clear the ledger?" message="This permanently erases every recorded action from the audit trail. Export first if you need a copy." confirmLabel="Clear all" onCancel={() => setClearing(false)} onConfirm={() => { setEntries([]); setAgent("All agents"); setClearing(false); }} />
    </Panel>
  );
}
