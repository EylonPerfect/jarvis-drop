// SystemMonitor — telemetry: gauges, Live Action Ledger, slow turns, and the
// live log tail with level/module filters and a runtime override row.
(function () {
const { Panel, Badge, ProgressRing, Button, Icon, Switch } = window.JARVISDesignSystem_547efc;

const LOGS = [
  ["07:32:01.482 pm", "INFO", "jarvis.agent.loop", "turn.completed conversation=c_8821 duration_ms=2841", "req_7f3a"],
  ["07:31:59.140 pm", "INFO", "jarvis.tools.dispatch", "tool_completed name=web_search duration_ms=412 success=true", "req_7f3a"],
  ["07:31:52.003 pm", "INFO", "jarvis.llm.router", "llm.response provider=anthropic model=claude-opus-4-8 tokens_out=612", "req_7f3a"],
  ["07:31:48.771 pm", "DEBUG", "jarvis.memory.vector", "query.embedded dim=768 matches=12 latency_ms=37", "req_7f3a"],
  ["07:31:40.218 pm", "WARN", "jarvis.tools.whatsapp", "rate_limit approaching window=60s used=54", "req_66b1"],
  ["07:31:31.905 pm", "ERROR", "jarvis.tools.email", "smtp.timeout retrying attempt=2 host=smtp.gmail.com", "req_66b1"],
];
const LVL = { INFO: "var(--jv-green)", DEBUG: "var(--jv-cyan-300)", WARN: "var(--jv-amber)", ERROR: "var(--jv-red)" };
const LEDGER = [["web_search", "verified", "412ms", "green"], ["fs.read", "verified", "8ms", "green"], ["email.send", "fallback \u2192 retry", "1.2s", "amber"], ["github.pr.list", "verified", "301ms", "green"], ["memory.query", "verified", "37ms", "green"]];

function SlowTurn({ q, meta, t }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--jv-hairline)" }}>
      <div><div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{q}</div>
        <div style={{ font: "var(--fw-regular) 11px var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 3 }}>{meta}</div></div>
      <span style={{ font: "var(--fw-bold) 14px var(--font-display)", color: "var(--jv-amber)" }}>{t}</span>
    </div>
  );
}

function SystemMonitor() {
  const [live, setLive] = React.useState(true);
  const [range, setRange] = React.useState("5m");
  const [ledgerOpen, setLedgerOpen] = React.useState(true);
  const [lvl, setLvl] = React.useState("All");
  const shown = LOGS.filter((l) => lvl === "All" || l[1] === lvl);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16, alignItems: "start" }}>
        <Panel title="System Monitor" eyebrow brackets>
          <div style={{ display: "flex", justifyContent: "space-around" }}>
            <ProgressRing value={15} label="CPU" />
            <ProgressRing value={54} label="RAM" tone="warn" />
            <ProgressRing value={40} label="Disk" />
          </div>
        </Panel>
        <Panel title="Slow Turns (last 24 h)" eyebrow>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "color-mix(in srgb, var(--jv-amber) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-amber) 30%, transparent)", marginBottom: 6 }}>
            <Icon name="alert-triangle" size={16} color="var(--jv-amber)" />
            <div><div style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)" }}>Slow-turn floor</div><div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)" }}>p95 7.20s + 2σ 700ms = 8.60s</div></div>
          </div>
          <SlowTurn q="Summarise my unread email and draft replies to the urgent ones" meta="claude-opus-4-8 · 6 tools · 4 llm · req_d41c" t="14.82s" />
          <SlowTurn q="Cross-reference my Jira board with this week's calendar" meta="claude-opus-4-8 · 5 tools · 1 err · req_8810" t="11.23s" />
          <SlowTurn q="Research pgvector vs Qdrant and recommend one" meta="claude-sonnet-4-6 · 4 tools · 5 llm · req_44a0" t="9.87s" />
        </Panel>
      </div>

      <Panel title="Live Action Ledger" eyebrow action={<Badge status="live" solid>Live</Badge>}>
        <button onClick={() => setLedgerOpen((o) => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", cursor: "pointer", textAlign: "left" }}>
          <span style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}><Icon name="wrench" size={16} /></span>
          <div style={{ flex: 1 }}><div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>Every tool call this session</div>
            <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2 }}>Retry, fallback and verification status per call.</div></div>
          <Icon name={ledgerOpen ? "chevron-down" : "chevron-right"} size={16} color="var(--jv-text-muted)" />
        </button>
        {ledgerOpen && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {LEDGER.map((l, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", font: "12px var(--font-mono)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--jv-${l[3]})`, boxShadow: `0 0 6px var(--jv-${l[3]})` }} />
                <span style={{ color: "var(--jv-cyan-300)", flex: "0 0 130px" }}>{l[0]}</span>
                <span style={{ flex: 1, color: "var(--jv-text-soft)" }}>{l[1]}</span>
                <span style={{ color: "var(--jv-text-muted)" }}>{l[2]}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Recent Logs" eyebrow action={<div style={{ display: "flex", gap: 10, alignItems: "center" }}><span style={{ display: "flex", alignItems: "center", gap: 7, font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>Live tail<Switch checked={live} onChange={setLive} /></span><Button size="sm" variant="ghost" icon={<Icon name="refresh-cw" size={13} />}>Refresh</Button></div>}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", marginBottom: 10, font: "12px var(--font-mono)" }}>
          <Icon name="sliders" size={14} color="var(--jv-cyan-300)" />
          <span style={{ color: "var(--jv-text-soft)" }}>jarvis.tools.whatsapp</span><span style={{ color: "var(--jv-amber)" }}>= DEBUG</span>
          <span style={{ color: "var(--jv-text-muted)" }}>· override expires in 9m</span><span style={{ flex: 1 }} />
          <button style={{ background: "none", border: "none", color: "var(--jv-text-muted)", cursor: "pointer", display: "grid", placeItems: "center" }}><Icon name="x" size={14} /></button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {["All", "INFO", "WARN", "ERROR"].map((r) => (
              <button key={r} onClick={() => setLvl(r)} style={{ padding: "6px 11px", borderRadius: "var(--r-sm)", border: `1px solid ${lvl === r ? "var(--jv-border-cyan)" : "var(--jv-border)"}`, background: lvl === r ? "var(--grad-cyan-soft)" : "transparent", color: lvl === r ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", font: "var(--fw-medium) 11px var(--font-mono)", cursor: "pointer" }}>{r}</button>
            ))}
          </div>
          <input placeholder="module prefix (e.g. jarvis.tools)" style={{ flex: 1, minWidth: 160, height: 32, padding: "0 12px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", color: "var(--jv-text)", font: "12px var(--font-mono)", outline: "none" }} />
          <div style={{ display: "flex", gap: 4 }}>
            {["5m", "1h", "24h"].map((r) => (
              <button key={r} onClick={() => setRange(r)} style={{ padding: "6px 11px", borderRadius: "var(--r-sm)", border: `1px solid ${range === r ? "var(--jv-border-cyan)" : "var(--jv-border)"}`, background: range === r ? "var(--grad-cyan-soft)" : "transparent", color: range === r ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", font: "var(--fw-medium) 11px var(--font-mono)", cursor: "pointer" }}>{r}</button>
            ))}
          </div>
        </div>
        <div style={{ borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", overflow: "hidden" }}>
          {shown.map((l, i) => (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "8px 14px", borderBottom: i < shown.length - 1 ? "1px solid var(--jv-hairline)" : "none", font: "12px/1.4 var(--font-mono)" }}>
              <span style={{ color: "var(--jv-text-faint)", flex: "0 0 118px" }}>{l[0]}</span>
              <span style={{ flex: "0 0 52px", color: LVL[l[1]], fontWeight: "var(--fw-semibold)" }}>{l[1]}</span>
              <span style={{ flex: "0 0 168px", color: "var(--jv-cyan-300)" }}>{l[2]}</span>
              <span style={{ flex: 1, color: "var(--jv-text-soft)" }}>{l[3]}</span>
              <span style={{ color: "var(--jv-text-faint)" }}>{l[4]}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

Object.assign(window, { SystemMonitor });
})();
