// Workflows — saved multi-step automations. Each has a trigger, an ordered set
// of steps (agent/tool nodes), a status and a run control. Wired to the
// /api/workflows backend endpoints; renders empty states on a clean database.
import { Fragment } from "react";
import { Panel, Badge, Button, Icon, StatTile, EmptyState } from "../ds";
import type { Workflow, WorkflowRun } from "@jarvis/shared";
import { useApi } from "../api/hooks";
import { api } from "../api/client";

interface WorkflowStats { workflows: number; enabled: number; paused: number; runsPerWeek: number; }
const ZERO_STATS: WorkflowStats = { workflows: 0, enabled: 0, paused: 0, runsPerWeek: 0 };

function StepNode({ ic, label, last }: { ic: string; label: string; last: boolean }) {
  return (
    <Fragment>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", whiteSpace: "nowrap" }}>
        <Icon name={ic} size={14} color="var(--jv-cyan)" />
        <span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-soft)" }}>{label}</span>
      </div>
      {!last && <Icon name="chevron-right" size={15} color="var(--jv-text-faint)" />}
    </Fragment>
  );
}

function FlowCard({ wf, onRan }: { wf: Workflow; onRan: () => void }) {
  const { name, trigger, status, steps } = wf;
  const paused = status === "Paused";
  const run = async () => {
    try {
      await api.post(`/api/workflows/${wf.id}/run`);
      onRan();
    } catch {
      /* gateway may be offline — ignore */
    }
  };
  return (
    <div style={{ padding: 16, borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)" }}>{name}</span>
            <Badge status={paused ? "standby" : "optimal"}>{status}</Badge>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--fw-medium) 11.5px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 4 }}><Icon name="clock" size={12} />{trigger}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant={paused ? "secondary" : "primary"} icon={<Icon name="play" size={13} />} onClick={run}>Run</Button>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {steps.map((s, i) => <StepNode key={i} ic={s.icon} label={s.label} last={i === steps.length - 1} />)}
      </div>
    </div>
  );
}

export default function Workflows() {
  const { data: workflows } = useApi<Workflow[]>("/api/workflows");
  const { data: runs, reload: reloadRuns } = useApi<WorkflowRun[]>("/api/workflows/runs");
  const { data: stats } = useApi<WorkflowStats>("/api/workflows/stats");

  const flows = workflows ?? [];
  const recentRuns = runs ?? [];
  const s = stats ?? ZERO_STATS;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
      <Panel title="Workflows">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {flows.length === 0 ? (
            <EmptyState
              icon="workflow"
              title="No workflows yet"
              hint="Automations that chain agents and tools on a trigger will appear here once they're configured."
            />
          ) : (
            flows.map((f, i) => <FlowCard key={f.id ?? i} wf={f} onRan={reloadRuns} />)
          )}
        </div>
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel title="Automation" eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <StatTile value={s.workflows} label="Workflows" tone="info" />
            <StatTile value={s.enabled} label="Enabled" tone="optimal" />
            <StatTile value={s.paused} label="Paused" tone="standby" />
            <StatTile value={s.runsPerWeek} label="Runs / week" tone="info" />
          </div>
        </Panel>
        <Panel title="Recent runs" eyebrow bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {recentRuns.length === 0 ? (
            <EmptyState icon="history" compact title="No runs yet" hint="Workflow runs will show up here once a workflow executes." />
          ) : (
            recentRuns.map((r, i) => (
              <div key={r.id ?? i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 11px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-medium) 12.5px var(--font-body)", color: "var(--jv-text-soft)" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--jv-${r.tone === "optimal" ? "green" : "violet"})`, boxShadow: `0 0 6px var(--jv-${r.tone === "optimal" ? "green" : "violet"})` }} />{r.name}</span>
                <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{r.when}</span>
              </div>
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}
