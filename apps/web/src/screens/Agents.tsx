import { Fragment, useState } from "react";
import { Panel, Button, Icon, StatTile, EmptyState, IconButton, ConfirmDialog } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { Agent, AgentRun, RuntimeStats, NewAgent } from "@jarvis/shared";
import { AgentWizard } from "../components/AgentWizard";
import AgentCockpit from "./AgentCockpit";

// The in-progress wizard draft (subset of the snapshot the wizard persists).
interface WizardDraft {
  step?: number;
  cloneMode?: boolean;
  name?: string;
  role?: string;
  icon?: string;
  templateKey?: string;
  clone?: { name?: string; title?: string; email?: string };
}

const WIZARD_STEP_COUNT = 5;

// A resumable draft agent — shown in the roster above completed agents so an
// unfinished build can be picked back up (or discarded).
function DraftCard({ draft, onResume, onDiscard }: { draft: WizardDraft; onResume: () => void; onDiscard: () => void }) {
  const name = draft.cloneMode
    ? (draft.clone?.name?.trim() ? `${draft.clone.name.trim()} (AI clone)` : "AI clone")
    : (draft.name?.trim() || "Untitled agent");
  const role = draft.cloneMode ? (draft.clone?.title?.trim() || "Clone in progress") : (draft.role?.trim() || "Draft in progress");
  const step = Math.min(WIZARD_STEP_COUNT, (draft.step ?? 0) + 1);
  const c = "var(--jv-amber)";
  return (
    <div
      onClick={onResume}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px dashed color-mix(in srgb, var(--jv-amber) 55%, var(--jv-border))", cursor: "pointer" }}
    >
      <span style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: "var(--r-sm)", display: "grid", placeItems: "center", color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 32%, transparent)` }}>
        <Icon name={draft.icon || "bot"} size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
        <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{role} · step {step} of {WIZARD_STEP_COUNT}</div>
      </div>
      <span style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: c }}>
        <Icon name="pencil-ruler" size={12} color={c} />
        Draft
      </span>
      <IconButton
        icon="trash-2"
        tone="danger"
        title="Discard draft"
        size={28}
        onClick={(e) => { e.stopPropagation(); onDiscard(); }}
      />
      <Icon name="chevron-right" size={15} color="var(--jv-text-faint)" />
    </div>
  );
}

function AgentCard({ a, onClick, onDelete }: { a: Agent; onClick?: () => void; onDelete?: () => void }) {
  const c = a.status === "optimal" ? "var(--jv-green)" : "var(--jv-violet)";
  return (
    <div
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", cursor: onClick ? "pointer" : "default" }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          flex: "0 0 38px",
          borderRadius: "var(--r-sm)",
          display: "grid",
          placeItems: "center",
          color: c,
          background: `color-mix(in srgb, ${c} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${c} 32%, transparent)`,
        }}
      >
        <Icon name={a.icon} size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{a.name}</div>
        <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 1 }}>{a.role}</div>
      </div>
      <span style={{ display: "flex", alignItems: "center", gap: 5, font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: c }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />
        {a.statusLabel}
      </span>
      {onDelete && (
        <IconButton
          icon="trash-2"
          tone="danger"
          title="Delete"
          size={28}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        />
      )}
      {onClick && <Icon name="chevron-right" size={15} color="var(--jv-text-faint)" />}
    </div>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const [open, setOpen] = useState(false);
  const err = run.errCount;
  const steps = run.steps ?? [];
  return (
    <div style={{ borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={15} color="var(--jv-cyan-300)" />
        <span style={{ flex: 1, font: "var(--fw-medium) 13px var(--font-mono)", color: "var(--jv-text-soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.query}</span>
        <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-muted)" }}>{run.ts}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, font: "12px var(--font-mono)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--jv-green)" }}>
            <Icon name="check-circle" size={13} />
            {run.okCount}
          </span>
          {err > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--jv-red)" }}>
              <Icon name="x-circle" size={13} />
              {err}
            </span>
          )}
        </span>
      </button>
      {open && steps.length > 0 && (
        <div style={{ padding: "0 16px 14px 43px", display: "flex", flexDirection: "column", gap: 6 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, font: "12px/1.5 var(--font-mono)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--jv-${s.tone})`, boxShadow: `0 0 6px var(--jv-${s.tone})` }} />
              <span style={{ color: "var(--jv-cyan-300)" }}>{s.agent}</span>
              <span style={{ color: "var(--jv-text-muted)" }}>{s.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentBuilder({ onClose, onCreate }: { onClose: () => void; onCreate: (a: NewAgent) => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        display: "grid",
        placeItems: "start center",
        paddingTop: 40,
        paddingBottom: 40,
        overflowY: "auto",
        background: "rgba(3,8,16,0.6)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 1120, maxWidth: "94%", borderRadius: "var(--r-lg)", background: "var(--grad-panel)", border: "1px solid var(--jv-border-cyan)", boxShadow: "var(--panel-shadow-active)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--jv-hairline)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 40, height: 40, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
              <Icon name="bot" size={20} />
            </span>
            <div>
              <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Orchestrate a teammate</div>
              <div style={{ font: "var(--fw-bold) 17px var(--font-body)", color: "var(--jv-text)", marginTop: 2 }}>New Agent</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--jv-text-muted)", cursor: "pointer", display: "grid", placeItems: "center" }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ padding: "20px" }}>
          <AgentWizard submitLabel="Deploy Agent" onCancel={onClose} onSubmit={onCreate} />
        </div>
      </div>
    </div>
  );
}

export default function Agents() {
  const [building, setBuilding] = useState(false);
  const [cockpit, setCockpit] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const { data: rosterData, reload } = useApi<Agent[]>("/api/agents");
  const { data: runsData } = useApi<AgentRun[]>("/api/agents/runs");
  const { data: runtime } = useApi<RuntimeStats>("/api/agents/runtime");
  const { data: draftResp, reload: reloadDraft } = useApi<{ draft: WizardDraft | null }>("/api/agents/draft");
  const roster = rosterData ?? [];
  const runs = runsData ?? [];
  const stats = runtime ?? { active: 0, recentRuns: 0, stepsToday: 0, errors: 0 };
  const draft = draftResp?.draft ?? null;

  const create = async (a: NewAgent) => {
    try {
      await api.post<Agent>("/api/agents", a);
      reload();
    } catch {
      /* offline — ignore */
    }
    setBuilding(false);
    reloadDraft(); // the wizard clears the draft on deploy
  };

  const closeBuilder = () => {
    setBuilding(false);
    reloadDraft(); // reflect any progress saved while the wizard was open
  };

  const discardDraft = async () => {
    try {
      await api.del("/api/agents/draft");
    } catch {
      /* offline — ignore */
    }
    reloadDraft();
  };

  const removeAgent = async (id: string) => {
    try {
      await api.del(`/api/agents/${id}`);
      reload();
    } catch {
      /* offline — ignore */
    }
  };

  const clearRoster = async () => {
    try {
      await api.del("/api/agents");
      reload();
    } catch {
      /* offline — ignore */
    }
    setConfirmClear(false);
  };

  const newAgentButton = (
    <button
      onClick={() => setBuilding(true)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 10px",
        borderRadius: "var(--r-sm)",
        border: "1px solid var(--jv-border-cyan)",
        background: "var(--grad-cyan-soft)",
        color: "var(--jv-cyan-300)",
        font: "var(--fw-semibold) 10px var(--font-hud)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      <Icon name="plus" size={13} />
      New Agent
    </button>
  );

  if (cockpit) return <AgentCockpit agentId={cockpit} onExit={() => setCockpit(null)} />;

  return (
    <Fragment>
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Panel
            title="Agent Roster"
            eyebrow
            action={
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {roster.length > 0 && (
                  <Button variant="danger" size="sm" glow={false} icon={<Icon name="trash-2" size={13} />} onClick={() => setConfirmClear(true)}>
                    Clear all
                  </Button>
                )}
                {newAgentButton}
              </div>
            }
            bodyStyle={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            {draft && (
              <DraftCard draft={draft} onResume={() => setBuilding(true)} onDiscard={discardDraft} />
            )}
            {roster.length === 0 ? (
              draft ? null : (
                <EmptyState
                  icon="bot"
                  title="No agents yet"
                  hint="Your roster is empty. Hire an agent to start orchestrating multi-agent work."
                  action={
                    <Button variant="primary" size="sm" icon={<Icon name="plus" size={14} />} onClick={() => setBuilding(true)}>
                      Hire an Agent
                    </Button>
                  }
                />
              )
            ) : (
              roster.map((a) => (
                <AgentCard key={a.id} a={a} onClick={() => setCockpit(a.id)} onDelete={() => removeAgent(a.id)} />
              ))
            )}
          </Panel>
          <Panel title="Runtime" eyebrow>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <StatTile value={stats.active} label="Active" tone="optimal" />
              <StatTile value={stats.recentRuns} label="Recent runs" tone="info" />
              <StatTile value={stats.stepsToday} label="Steps today" tone="info" />
              <StatTile value={stats.errors} label="Errors" tone="critical" />
            </div>
          </Panel>
        </div>

        <Panel title="Multi-agent Executions" action={<span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>{runs.length} recent</span>}>
          {runs.length === 0 ? (
            <EmptyState
              icon="git-branch"
              title="No executions yet"
              hint="Multi-agent runs will appear here once your agents start working."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {runs.map((r) => (
                <RunRow key={r.id} run={r} />
              ))}
            </div>
          )}
        </Panel>
      </div>
      {building && <AgentBuilder onClose={closeBuilder} onCreate={create} />}
      <ConfirmDialog
        open={confirmClear}
        danger
        title="Clear agent roster?"
        message="This permanently removes every agent from your roster. This cannot be undone."
        confirmLabel="Clear all"
        onConfirm={clearRoster}
        onCancel={() => setConfirmClear(false)}
      />
    </Fragment>
  );
}
