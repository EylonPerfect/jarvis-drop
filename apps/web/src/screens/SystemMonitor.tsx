// SystemMonitor — telemetry: gauges, Live Action Ledger, slow turns, and the
// live log tail with level/module filters and a runtime override row.
import { useState } from "react";
import { Panel, Badge, ProgressRing, Button, Icon, Switch } from "../ds";
import { useApi, usePoll } from "../api/hooks";
import type { Gauges, LedgerEntry, SlowTurn as SlowTurnData, LogEntry } from "@jarvis/shared";
import AdminReset from "../components/AdminReset";

const LEDGER_SEED: LedgerEntry[] = [
  { tool: "web_search", status: "verified", duration: "412ms", tone: "green" },
  { tool: "fs.read", status: "verified", duration: "8ms", tone: "green" },
  { tool: "email.send", status: "fallback → retry", duration: "1.2s", tone: "amber" },
  { tool: "github.pr.list", status: "verified", duration: "301ms", tone: "green" },
  { tool: "memory.query", status: "verified", duration: "37ms", tone: "green" },
];

const SLOW_SEED: { floor: string; turns: SlowTurnData[] } = {
  floor: "p95 7.20s + 2σ 700ms = 8.60s",
  turns: [
    { query: "Summarise my unread email and draft replies to the urgent ones", meta: "claude-opus-4-8 · 6 tools · 4 llm · req_d41c", duration: "14.82s" },
    { query: "Cross-reference my Jira board with this week's calendar", meta: "claude-opus-4-8 · 5 tools · 1 err · req_8810", duration: "11.23s" },
    { query: "Research pgvector vs Qdrant and recommend one", meta: "claude-sonnet-4-6 · 4 tools · 5 llm · req_44a0", duration: "9.87s" },
  ],
};

const LOGS_SEED: LogEntry[] = [
  { ts: "07:32:01.482 pm", level: "INFO", module: "jarvis.agent.loop", message: "turn.completed conversation=c_8821 duration_ms=2841", req: "req_7f3a" },
  { ts: "07:31:59.140 pm", level: "INFO", module: "jarvis.tools.dispatch", message: "tool_completed name=web_search duration_ms=412 success=true", req: "req_7f3a" },
  { ts: "07:31:52.003 pm", level: "INFO", module: "jarvis.llm.router", message: "llm.response provider=anthropic model=claude-opus-4-8 tokens_out=612", req: "req_7f3a" },
  { ts: "07:31:48.771 pm", level: "DEBUG", module: "jarvis.memory.vector", message: "query.embedded dim=768 matches=12 latency_ms=37", req: "req_7f3a" },
  { ts: "07:31:40.218 pm", level: "WARN", module: "jarvis.tools.whatsapp", message: "rate_limit approaching window=60s used=54", req: "req_66b1" },
  { ts: "07:31:31.905 pm", level: "ERROR", module: "jarvis.tools.email", message: "smtp.timeout retrying attempt=2 host=smtp.gmail.com", req: "req_66b1" },
];

const LVL: Record<string, string> = { INFO: "var(--jv-green)", DEBUG: "var(--jv-cyan-300)", WARN: "var(--jv-amber)", ERROR: "var(--jv-red)" };

function SlowTurn({ q, meta, t }: { q: string; meta: string; t: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--jv-hairline)" }}>
      <div><div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{q}</div>
        <div style={{ font: "var(--fw-regular) 11px var(--font-mono)", color: "var(--jv-text-muted)", marginTop: 3 }}>{meta}</div></div>
      <span style={{ font: "var(--fw-bold) 14px var(--font-display)", color: "var(--jv-amber)" }}>{t}</span>
    </div>
  );
}

export default function SystemMonitor() {
  const [live, setLive] = useState(true);
  const [range, setRange] = useState("5m");
  const [ledgerOpen, setLedgerOpen] = useState(true);
  const [lvl, setLvl] = useState("All");

  const gauges = usePoll<Gauges>("/api/system/gauges", 4000) ?? { cpu: 15, ram: 54, disk: 40 };
  const { data: ledgerData } = useApi<LedgerEntry[]>("/api/system/ledger");
  const { data: slowData } = useApi<{ floor: string; turns: SlowTurnData[] }>("/api/system/slow-turns");
  const logsData = usePoll<LogEntry[]>("/api/system/logs", 5000);

  const ledger = ledgerData ?? LEDGER_SEED;
  const slow = slowData ?? SLOW_SEED;
  const logs = logsData ?? LOGS_SEED;

  const shown = logs.filter((l) => lvl === "All" || l.level === lvl);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16, alignItems: "start" }}>
        <Panel title="System Monitor" eyebrow brackets>
          <div style={{ display: "flex", justifyContent: "space-around" }}>
            <ProgressRing value={gauges.cpu} label="CPU" />
            <ProgressRing value={gauges.ram} label="RAM" tone="warn" />
            <ProgressRing value={gauges.disk} label="Disk" />
          </div>
        </Panel>
        <Panel title="Slow Turns (last 24 h)" eyebrow>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "color-mix(in srgb, var(--jv-amber) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-amber) 30%, transparent)", marginBottom: 6 }}>
            <Icon name="alert-triangle" size={16} color="var(--jv-amber)" />
            <div><div style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)" }}>Slow-turn floor</div><div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)" }}>{slow.floor}</div></div>
          </div>
          {slow.turns.map((s, i) => (
            <SlowTurn key={i} q={s.query} meta={s.meta} t={s.duration} />
          ))}
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
            {ledger.map((l, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", font: "12px var(--font-mono)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--jv-${l.tone})`, boxShadow: `0 0 6px var(--jv-${l.tone})` }} />
                <span style={{ color: "var(--jv-cyan-300)", flex: "0 0 130px" }}>{l.tool}</span>
                <span style={{ flex: 1, color: "var(--jv-text-soft)" }}>{l.status}</span>
                <span style={{ color: "var(--jv-text-muted)" }}>{l.duration}</span>
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
              <span style={{ color: "var(--jv-text-faint)", flex: "0 0 118px" }}>{l.ts}</span>
              <span style={{ flex: "0 0 52px", color: LVL[l.level], fontWeight: "var(--fw-semibold)" }}>{l.level}</span>
              <span style={{ flex: "0 0 168px", color: "var(--jv-cyan-300)" }}>{l.module}</span>
              <span style={{ flex: 1, color: "var(--jv-text-soft)" }}>{l.message}</span>
              <span style={{ color: "var(--jv-text-faint)" }}>{l.req}</span>
            </div>
          ))}
        </div>
      </Panel>

      <AdminReset />
    </div>
  );
}
