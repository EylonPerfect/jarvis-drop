// Workflows — saved multi-step automations. Each has a trigger, an ordered set
// of steps (agent/tool nodes), a status and a run control. Wired to the
// /api/workflows backend endpoints; renders empty states on a clean database.
import { Fragment, useState } from "react";
import { Panel, Badge, Button, Icon, Input, StatTile, EmptyState, IconButton, ConfirmDialog } from "../ds";
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

function FlowCard({ wf, onRan, onChanged }: { wf: Workflow; onRan: () => void; onChanged: () => void }) {
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
  const toggleStatus = async () => {
    try {
      await api.patch(`/api/workflows/${wf.id}`, { status: paused ? "Enabled" : "Paused" });
      onChanged();
    } catch {
      /* ignore */
    }
  };
  const remove = async () => {
    try {
      await api.del(`/api/workflows/${wf.id}`);
      onChanged();
    } catch {
      /* ignore */
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button size="sm" variant={paused ? "secondary" : "primary"} icon={<Icon name="play" size={13} />} onClick={run}>Run</Button>
          <Button size="sm" variant="secondary" icon={<Icon name={paused ? "play" : "pause"} size={13} />} onClick={toggleStatus}>{paused ? "Resume" : "Pause"}</Button>
          <IconButton icon="trash-2" tone="danger" title="Delete" onClick={remove} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {steps.map((s, i) => <StepNode key={i} ic={s.icon} label={s.label} last={i === steps.length - 1} />)}
      </div>
    </div>
  );
}

export default function Workflows() {
  const { data: workflows, reload: reloadWorkflows } = useApi<Workflow[]>("/api/workflows");
  const { data: runs, reload: reloadRuns } = useApi<WorkflowRun[]>("/api/workflows/runs");
  const { data: stats, reload: reloadStats } = useApi<WorkflowStats>("/api/workflows/stats");

  const flows = workflows ?? [];
  const recentRuns = runs ?? [];
  const s = stats ?? ZERO_STATS;

  const reload = () => {
    reloadWorkflows();
    reloadStats();
  };

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");
  const [stepsText, setStepsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const submitAdd = async () => {
    const n = name.trim();
    if (!n || saving) return;
    setSaving(true);
    try {
      const steps = stepsText
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((label) => ({ icon: "workflow", label }));
      await api.post("/api/workflows", { name: n, trigger: trigger.trim() || undefined, steps });
      setName("");
      setTrigger("");
      setStepsText("");
      setAdding(false);
      reload();
    } catch {
      /* gateway may be offline — leave the form open */
    } finally {
      setSaving(false);
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      await api.del("/api/workflows");
      reload();
    } catch {
      /* ignore */
    } finally {
      setClearing(false);
      setClearOpen(false);
    }
  };

  const headerAction = (
    <div style={{ display: "flex", gap: 8 }}>
      <Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />} onClick={() => setAdding((v) => !v)}>New Workflow</Button>
      {flows.length > 0 && (
        <Button size="sm" variant="danger" icon={<Icon name="trash-2" size={13} />} onClick={() => setClearOpen(true)}>Clear all</Button>
      )}
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
      <Panel title="Workflows" action={headerAction}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {adding && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)" }}>
              <Input placeholder="Workflow name" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitAdd()} />
              <Input placeholder="Every day · 8:00 am — or Manual" value={trigger} onChange={(e) => setTrigger(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitAdd()} />
              <Input placeholder="Steps (comma-separated labels)" value={stepsText} onChange={(e) => setStepsText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitAdd()} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
                <Button size="sm" variant="primary" disabled={!name.trim() || saving} onClick={submitAdd}>Create</Button>
              </div>
            </div>
          )}
          {flows.length === 0 && !adding ? (
            <EmptyState
              icon="workflow"
              title="No workflows yet"
              hint="Automations that chain agents and tools on a trigger will appear here once they're configured."
              action={<Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />} onClick={() => setAdding(true)}>New Workflow</Button>}
            />
          ) : (
            flows.map((f, i) => <FlowCard key={f.id ?? i} wf={f} onRan={reloadRuns} onChanged={reload} />)
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

      <ConfirmDialog
        open={clearOpen}
        danger
        title="Clear all workflows?"
        message="This permanently removes every workflow. This cannot be undone."
        confirmLabel="Clear all"
        busy={clearing}
        onConfirm={clearAll}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  );
}
