// SystemMonitor — telemetry: gauges, Live Action Ledger, slow turns, and the
// live log tail with level/module filters and a runtime override row.
import { useState } from "react";
import { Panel, Badge, ProgressRing, Button, Icon, Switch, EmptyState } from "../ds";
import { useApi, usePoll } from "../api/hooks";
import type { Gauges, LedgerEntry, SlowTurn as SlowTurnData, LogEntry } from "@jarvis/shared";
import AdminReset from "../components/AdminReset";

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
  const [modFilter, setModFilter] = useState("");
  const [nonce, setNonce] = useState(0);

  const gauges = usePoll<Gauges>("/api/system/gauges", 4000);
  const { data: ledgerData } = useApi<LedgerEntry[]>("/api/system/ledger");
  const { data: slowData } = useApi<{ floor: string; turns: SlowTurnData[] }>("/api/system/slow-turns");
  // range + nonce feed the query so the range buttons filter the server window
  // and Refresh forces a re-fetch; live tail pauses polling when off.
  const logsData = usePoll<LogEntry[]>(`/api/system/logs?range=${range}&_=${nonce}`, live ? 5000 : 3_600_000);

  const cpu = gauges?.cpu ?? 0;
  const ram = gauges?.ram ?? 0;
  const disk = gauges?.disk ?? 0;
  const ledger = ledgerData ?? [];
  const slow = slowData ?? { floor: "", turns: [] };
  const logs = logsData ?? [];

  const prefix = modFilter.trim();
  // The server ignores ?range, so filter the visible window client-side too.
  const windowMs: Record<string, number> = { "5m": 5 * 60_000, "1h": 3_600_000, "24h": 86_400_000 };
  const cutoff = Date.now() - (windowMs[range] ?? Infinity);
  const shown = logs.filter((l) => {
    if (lvl !== "All" && l.level !== lvl) return false;
    if (prefix !== "" && !l.module.startsWith(prefix)) return false;
    const ts = Date.parse(l.ts);
    if (!Number.isNaN(ts) && ts < cutoff) return false; // keep unparseable timestamps
    return true;
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16, alignItems: "start" }}>
        <Panel title="System Monitor" eyebrow brackets>
          <div style={{ display: "flex", justifyContent: "space-around" }}>
            <ProgressRing value={cpu} label="CPU" />
            <ProgressRing value={ram} label="RAM" tone="warn" />
            <ProgressRing value={disk} label="Disk" />
          </div>
        </Panel>
        <Panel title="Slow Turns (last 24 h)" eyebrow>
          {slow.floor && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "color-mix(in srgb, var(--jv-amber) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-amber) 30%, transparent)", marginBottom: 6 }}>
              <Icon name="alert-triangle" size={16} color="var(--jv-amber)" />
              <div><div style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)" }}>Slow-turn floor</div><div style={{ font: "11px var(--font-mono)", color: "var(--jv-text-muted)" }}>{slow.floor}</div></div>
            </div>
          )}
          {slow.turns.length === 0 ? (
            <EmptyState compact icon="zap" title="No slow turns" hint="Turns that exceed the latency floor will be listed here." />
          ) : (
            slow.turns.map((s, i) => (
              <SlowTurn key={i} q={s.query} meta={s.meta} t={s.duration} />
            ))
          )}
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
          ledger.length === 0 ? (
            <div style={{ marginTop: 10 }}>
              <EmptyState compact icon="wrench" title="No tool calls yet" hint="Every tool call this session will appear here with its status." />
            </div>
          ) : (
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
          )
        )}
      </Panel>

      <Panel title="Recent Logs" eyebrow action={<div style={{ display: "flex", gap: 10, alignItems: "center" }}><span style={{ display: "flex", alignItems: "center", gap: 7, font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>Live tail<Switch checked={live} onChange={setLive} /></span><Button size="sm" variant="ghost" icon={<Icon name="refresh-cw" size={13} />} onClick={() => setNonce((n) => n + 1)}>Refresh</Button></div>}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {["All", "DEBUG", "INFO", "WARN", "ERROR"].map((r) => (
              <button key={r} onClick={() => setLvl(r)} style={{ padding: "6px 11px", borderRadius: "var(--r-sm)", border: `1px solid ${lvl === r ? "var(--jv-border-cyan)" : "var(--jv-border)"}`, background: lvl === r ? "var(--grad-cyan-soft)" : "transparent", color: lvl === r ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", font: "var(--fw-medium) 11px var(--font-mono)", cursor: "pointer" }}>{r}</button>
            ))}
          </div>
          <input value={modFilter} onChange={(e) => setModFilter(e.target.value)} placeholder="module prefix (e.g. jarvis.tools)" style={{ flex: 1, minWidth: 160, height: 32, padding: "0 12px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", color: "var(--jv-text)", font: "12px var(--font-mono)", outline: "none" }} />
          <div style={{ display: "flex", gap: 4 }}>
            {["5m", "1h", "24h"].map((r) => (
              <button key={r} onClick={() => setRange(r)} style={{ padding: "6px 11px", borderRadius: "var(--r-sm)", border: `1px solid ${range === r ? "var(--jv-border-cyan)" : "var(--jv-border)"}`, background: range === r ? "var(--grad-cyan-soft)" : "transparent", color: range === r ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", font: "var(--fw-medium) 11px var(--font-mono)", cursor: "pointer" }}>{r}</button>
            ))}
          </div>
        </div>
        <div style={{ borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", overflow: "hidden" }}>
          {shown.length === 0 && (
            <EmptyState compact icon="file-text" title="No logs" hint={logs.length === 0 ? "Log output appears here as JARVIS runs." : "No logs match the current filters."} />
          )}
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
