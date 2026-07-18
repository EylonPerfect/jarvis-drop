// Agent Workstation — each agent gets its own virtual computer (E2B desktop) it
// operates like a person. Start it, watch the live desktop, give it a task, and
// it drives the browser via computer-use. This is the Manus-style surface.
import { useEffect, useRef, useState } from "react";
import { Panel, Button, Icon, Badge, EmptyState } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { Agent } from "@jarvis/shared";

interface RunState { running: boolean; task: string; log: LogEntry[]; error?: string }
type LogEntry = { seed?: string; opened?: boolean; step?: number; action?: string; text?: string; done?: boolean; error?: string };

function logLine(e: LogEntry): string {
  if (e.seed) return `↗ opened ${e.seed}${e.opened ? "" : " (failed)"}`;
  if (e.text) return `💬 ${e.text}`;
  if (e.done) return "✓ finished";
  if (e.error) return `⚠ ${e.error}`;
  if (e.action) return `• ${e.action}${e.step !== undefined ? ` (step ${e.step + 1})` : ""}`;
  return JSON.stringify(e);
}

export default function Workstation() {
  const { data: agentsData } = useApi<Agent[]>("/api/agents");
  const agents = agentsData ?? [];
  const [agentId, setAgentId] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [starting, setStarting] = useState(false);
  const [task, setTask] = useState("");
  const [run, setRun] = useState<RunState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // Default to the first agent.
  useEffect(() => { if (!agentId && agents.length) setAgentId(agents[0].id); }, [agents, agentId]);

  const start = async () => {
    if (!agentId) return;
    setStarting(true); setErr(null);
    try {
      const r = await api.post<{ streamUrl?: string; error?: string }>(`/api/workstation/${agentId}/start`);
      if (r.streamUrl) setStreamUrl(r.streamUrl); else setErr(r.error || "Could not start the workstation.");
    } catch { setErr("Could not start the workstation (is E2B connected in AI Core?)."); }
    finally { setStarting(false); }
  };

  const stop = async () => {
    if (!agentId) return;
    try { await api.post(`/api/workstation/${agentId}/stop`); } catch { /* ignore */ }
    setStreamUrl(""); setRun(null);
  };

  const send = async () => {
    const t = task.trim();
    if (!t || !agentId) return;
    setErr(null);
    try {
      await api.post(`/api/workstation/${agentId}/run`, { task: t });
      setTask("");
      setRun({ running: true, task: t, log: [] });
    } catch { setErr("Couldn't start the task (one may already be running)."); }
  };

  // Poll the run state while a task is active.
  useEffect(() => {
    if (!agentId || !run?.running) { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } return; }
    const tick = async () => {
      try { const s = await api.get<RunState>(`/api/workstation/${agentId}/run-state`); setRun(s); } catch { /* ignore */ }
    };
    pollRef.current = window.setInterval(tick, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [agentId, run?.running]);

  const agent = agents.find((a) => a.id === agentId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel eyebrow>
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <Badge status={streamUrl ? "optimal" : "standby"} dot={!!streamUrl}>{streamUrl ? "Desktop live" : "Not started"}</Badge>
          <Badge status="info" dot={false}><Icon name="cpu" size={11} style={{ marginRight: 4 }} />E2B virtual computer</Badge>
        </div>
        <div style={{ font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 8 }}>Agent Workstation</div>
        <p style={{ margin: "0 0 16px", maxWidth: 640, font: "var(--fw-regular) 13.5px/1.6 var(--font-body)", color: "var(--jv-text-soft)" }}>
          Give an agent its own computer. Start its desktop, watch it live, and hand it a task — it drives a real browser (navigate, scroll, click, and once you log it in, Gmail / Calendar / any web app) via computer-use.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <span style={{ position: "absolute", left: 12, pointerEvents: "none", color: "var(--jv-cyan)" }}><Icon name="bot" size={15} /></span>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={!!streamUrl}
              style={{ appearance: "none", padding: "10px 34px 10px 36px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", color: "var(--jv-text)", font: "var(--fw-medium) 13px var(--font-body)", cursor: "pointer" }}>
              {agents.length === 0 && <option value="">No agents yet</option>}
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role ? ` — ${a.role}` : ""}</option>)}
            </select>
            <span style={{ position: "absolute", right: 12, pointerEvents: "none", color: "var(--jv-text-muted)" }}><Icon name="chevron-down" size={15} /></span>
          </div>
          {!streamUrl ? (
            <Button variant="primary" icon={<Icon name={starting ? "loader" : "monitor"} size={14} />} disabled={starting || !agentId} onClick={start}>{starting ? "Starting desktop…" : "Start workstation"}</Button>
          ) : (
            <Button variant="danger" icon={<Icon name="power" size={14} />} onClick={stop}>Shut down</Button>
          )}
        </div>
        {err && <div style={{ marginTop: 12, font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-red-400)" }}>{err}</div>}
      </Panel>

      {streamUrl ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.7fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
          {/* Live desktop */}
          <Panel title={`${agent?.name || "Agent"}'s desktop`} eyebrow bodyStyle={{ padding: 0 }}>
            <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", background: "#05070d", borderRadius: "0 0 var(--r-md) var(--r-md)", overflow: "hidden" }}>
              <iframe src={streamUrl} title="desktop" allow="autoplay; clipboard-read; clipboard-write" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} />
            </div>
            <div style={{ padding: "10px 14px", font: "var(--fw-regular) 11.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)" }}>
              You can click into this desktop to take control — e.g. log it into Google or Zoom once, and the agent keeps that session.
            </div>
          </Panel>

          {/* Task + activity */}
          <Panel title="Give it a task" eyebrow bodyStyle={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. Go to goperfect.com and walk through the product · Check my calendar for today · Summarize my latest emails"
              rows={3}
              style={{ width: "100%", resize: "vertical", padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", color: "var(--jv-text)", font: "var(--fw-regular) 13px/1.5 var(--font-body)", outline: "none", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="primary" icon={<Icon name={run?.running ? "loader" : "play"} size={14} />} disabled={run?.running || !task.trim()} onClick={send}>{run?.running ? "Working…" : "Run task"}</Button>
            </div>
            {run && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", padding: "10px 12px" }}>
                <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>{run.running ? "Working on" : "Done"}: {run.task}</div>
                {run.log.map((e, i) => (
                  <div key={i} style={{ font: "var(--fw-regular) 12px/1.5 var(--font-mono)", color: e.text ? "var(--jv-cyan-300)" : e.error ? "var(--jv-red-400)" : "var(--jv-text-soft)" }}>{logLine(e)}</div>
                ))}
                {run.error && <div style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-red-400)" }}>{run.error}</div>}
              </div>
            )}
          </Panel>
        </div>
      ) : (
        <EmptyState icon="monitor" title="No workstation running" hint="Pick an agent and start its workstation to give it a live computer it can operate." />
      )}
    </div>
  );
}
