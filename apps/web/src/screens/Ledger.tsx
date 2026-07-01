// Ledger — append-only, timestamped record of every action every agent took:
// what it saw, did, decided, and what it cost. Filter by agent, scrub the day's
// timeline, expand "Why did you do this?" (reasoning + grant used + tokens), export.
import { useState } from "react";
import { Panel, Badge, Button, Icon } from "../ds";

const AGENTS = ["All agents", "SDR Agent", "AR Clerk", "Recruiting Sourcer", "QA Tester", "System Agent"];

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

const ENTRIES: LedgerEntry[] = [
  { t: "07:41:22 pm", agent: "SDR Agent", ic: "send", verb: "Drafted", what: "Outreach email to 42 warm-enterprise prospects", cost: "$0.42", grant: "may draft email", status: "ok",
    saw: "Warm-Enterprise list (42 rows) + last-quarter reply rates", decided: "Personalized on company + recent funding; queued for approval (no send grant)", tokens: "3,140 in / 1,020 out" },
  { t: "07:38:05 pm", agent: "AR Clerk", ic: "credit-card", verb: "Blocked", what: "Attempted to pay invoice #4821 ($2,480) — exceeded cap", cost: "$0.01", grant: "spend ≤ $2,000/mo", status: "blocked",
    saw: "Invoice #4821 from Northwind + June spend to date ($2,000)", decided: "Payment would breach monthly cap; escalated to Approvals Inbox", tokens: "890 in / 210 out" },
  { t: "07:31:48 pm", agent: "Recruiting Sourcer", ic: "database", verb: "Requested", what: "Read access to the compensation column (data wall)", cost: "$0.00", grant: "candidate read only", status: "blocked",
    saw: "Candidates.xlsx schema — column K flagged as HR-finance", decided: "Hit data wall; asked operator for a temporary, auto-revoking grant", tokens: "420 in / 90 out" },
  { t: "07:22:10 pm", agent: "QA Tester", ic: "clipboard-check", verb: "Filed", what: "Reproduced bug JV-482 and opened a GitHub issue", cost: "$1.90", grant: "sandbox + github", status: "ok",
    saw: "Failing test log + last 3 commits touching loop.py", decided: "Isolated the regression to commit 8f3a; attached repro steps", tokens: "12,400 in / 2,110 out" },
  { t: "07:05:55 pm", agent: "System Agent", ic: "shield-check", verb: "Verified", what: "Nightly backup integrity check passed", cost: "$0.08", grant: "read prod (verify only)", status: "ok",
    saw: "Postgres dump checksum + vector snapshot manifest", decided: "All checksums matched; no action needed", tokens: "1,050 in / 180 out" },
];

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
  const [agent, setAgent] = useState("All agents");
  const [scrub, setScrub] = useState(100);
  const shown = ENTRIES.filter((e) => agent === "All agents" || e.agent === agent);
  return (
    <Panel title="Ledger" eyebrow action={<div style={{ display: "flex", gap: 8, alignItems: "center" }}><Badge status="info" dot={false}>Append-only</Badge><Button size="sm" variant="secondary" icon={<Icon name="download" size={13} />}>Export audit</Button></div>}>
      <p style={{ margin: "0 0 14px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>Every action every agent took — what it saw, did, decided, and what it cost. Timestamped and immutable.</p>

      {/* controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {AGENTS.map((a) => (
            <button key={a} onClick={() => setAgent(a)} style={{ padding: "6px 12px", borderRadius: "var(--r-pill)", border: `1px solid ${agent === a ? "var(--jv-border-cyan)" : "var(--jv-border)"}`, background: agent === a ? "var(--grad-cyan-soft)" : "transparent", color: agent === a ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", font: "var(--fw-medium) 11.5px var(--font-body)", cursor: "pointer" }}>{a}</button>
          ))}
        </div>
      </div>
      {/* scrub / replay */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", marginBottom: 14 }}>
        <Icon name="history" size={15} color="var(--jv-cyan-300)" />
        <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", whiteSpace: "nowrap" }}>Replay day</span>
        <input type="range" min="0" max="100" value={scrub} onChange={(e) => setScrub(+e.target.value)} style={{ flex: 1, accentColor: "var(--jv-cyan)" }} />
        <span style={{ font: "12px var(--font-mono)", color: "var(--jv-cyan-300)", whiteSpace: "nowrap" }}>{scrub === 100 ? "now · 07:41 pm" : Math.round(6 + (scrub / 100) * 13.7) + ":00 " + (scrub < 44 ? "am" : "pm")}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shown.map((e, i) => <Entry key={i} e={e} />)}
      </div>
    </Panel>
  );
}
