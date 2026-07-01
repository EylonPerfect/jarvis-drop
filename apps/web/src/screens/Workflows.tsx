// Workflows — saved multi-step automations. Each has a trigger, an ordered set
// of steps (agent/tool nodes), a status and a run control. Ported from the
// prototype screen and wired to the /api/workflows backend endpoints.
import { Fragment } from "react";
import { Panel, Badge, Button, Icon, StatTile } from "../ds";
import type { Workflow, WorkflowRun } from "@jarvis/shared";
import { useApi } from "../api/hooks";
import { api } from "../api/client";

const WORKFLOWS_SEED: Workflow[] = [
  { id: "wf1", name: "Morning Briefing", trigger: "Every day · 8:00 am", status: "Enabled", steps: [
    { icon: "calendar", label: "Pull today's calendar" }, { icon: "mail", label: "Summarize unread mail" }, { icon: "list-checks", label: "List overdue tasks" }, { icon: "mic", label: "Speak the briefing" },
  ] },
  { id: "wf2", name: "Release Notes", trigger: "On git tag push", status: "Enabled", steps: [
    { icon: "github", label: "Collect merged PRs" }, { icon: "code", label: "Diff since last tag" }, { icon: "file-text", label: "Draft notes" }, { icon: "message-square", label: "Post to Slack" },
  ] },
  { id: "wf3", name: "Inbox Triage", trigger: "Every 2 hours", status: "Paused", steps: [
    { icon: "mail", label: "Fetch new mail" }, { icon: "sparkles", label: "Classify + prioritize" }, { icon: "list-checks", label: "Create tasks" },
  ] },
  { id: "wf4", name: "Nightly Backup", trigger: "Every day · 2:00 am", status: "Enabled", steps: [
    { icon: "database", label: "Dump Postgres" }, { icon: "hard-drive", label: "Snapshot vectors" }, { icon: "shield-check", label: "Verify integrity" },
  ] },
];

const RUNS_SEED: WorkflowRun[] = [
  { id: "run1", name: "Morning Briefing", when: "8:00 am", tone: "optimal" },
  { id: "run2", name: "Nightly Backup", when: "2:00 am", tone: "optimal" },
  { id: "run3", name: "Release Notes", when: "yesterday", tone: "optimal" },
  { id: "run4", name: "Inbox Triage", when: "paused", tone: "standby" },
];

interface WorkflowStats { workflows: number; enabled: number; paused: number; runsPerWeek: number; }

const STATS_SEED: WorkflowStats = { workflows: 4, enabled: 3, paused: 1, runsPerWeek: 28 };

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

function FlowCard({ wf }: { wf: Workflow }) {
  const { name, trigger, status, steps } = wf;
  const paused = status === "Paused";
  const run = async () => {
    const jobId = wf.jobId ?? wf.id;
    if (!jobId) return;
    try {
      await api.post(`/api/workflows/${wf.id}/run`);
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
          <Button size="sm" variant="ghost" icon={<Icon name="settings" size={13} />}>Edit</Button>
          <Button size="sm" variant={paused ? "secondary" : "primary"} icon={<Icon name={paused ? "play" : "play"} size={13} />} onClick={run}>Run</Button>
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
  const { data: runs } = useApi<WorkflowRun[]>("/api/workflows/runs");
  const { data: stats } = useApi<WorkflowStats>("/api/workflows/stats");

  const flows = workflows ?? WORKFLOWS_SEED;
  const recentRuns = runs ?? RUNS_SEED;
  const s = stats ?? STATS_SEED;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
      <Panel title="Workflows" action={<Button size="sm" variant="secondary" icon={<Icon name="plus" size={13} />}>New Workflow</Button>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {flows.map((f, i) => <FlowCard key={f.id ?? i} wf={f} />)}
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
          {recentRuns.map((r, i) => (
            <div key={r.id ?? i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 11px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-medium) 12.5px var(--font-body)", color: "var(--jv-text-soft)" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--jv-${r.tone === "optimal" ? "green" : "violet"})`, boxShadow: `0 0 6px var(--jv-${r.tone === "optimal" ? "green" : "violet"})` }} />{r.name}</span>
              <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{r.when}</span>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
