import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Badge, Button, Icon, Panel, Tag, ProgressRing, IconButton, ConfirmDialog } from "../ds";
import { api } from "../api/client";
import {
  WIREFRAME_ARCHETYPES,
  type CallPlaybook,
  type CallSource,
  type CallStage,
  type CloneCallsJobStatus,
  type WireframeArchetype,
} from "@jarvis/shared";

// ============================================================
// CloneFromCalls — the Apprenticeship step for AE/CS clone agents.
// Collect >=4 call transcripts -> analyze -> review a wireframe storyboard
// (per stage: what the VOICE does + what the SCREEN does) -> approve.
// State is owned by the parent wizard (so draft autosave works); this
// component drives the analysis job and renders the editors.
// ============================================================

const MIN_SOURCES = 4;
const READY_CHARS = 500;

const inputStyle: CSSProperties = {
  width: "100%",
  background: "rgba(4,12,22,0.6)",
  border: "1px solid var(--jv-border)",
  borderRadius: "var(--r-sm)",
  color: "var(--text-primary)",
  font: "var(--fw-regular) 13px/1.5 var(--font-body)",
  padding: "8px 12px",
  outline: "none",
  boxSizing: "border-box",
};
const labelStyle: CSSProperties = {
  font: "var(--fw-semibold) 10px/1 var(--font-hud)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--jv-cyan-300)",
  marginBottom: 6,
  display: "block",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

function TextInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; style?: CSSProperties }) {
  return (
    <input
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      style={{ ...inputStyle, height: 36, ...props.style }}
    />
  );
}

function TextArea(props: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={props.value}
      placeholder={props.placeholder}
      rows={props.rows ?? 3}
      onChange={(e) => props.onChange(e.target.value)}
      style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
    />
  );
}

// ---- editable string list (moves, actions, example lines, listen-for) -----
function EditList({
  items,
  onChange,
  placeholder,
  ordered = false,
  tone = "muted",
}: {
  items: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  ordered?: boolean;
  tone?: "muted" | "cyan";
}) {
  const set = (i: number, v: string) => onChange(items.map((x, k) => (k === i ? v : x)));
  const del = (i: number) => onChange(items.filter((_, k) => k !== i));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {ordered && <span style={{ color: "var(--text-muted)", font: "var(--fw-bold) 11px/1 var(--font-hud)", width: 14 }}>{i + 1}</span>}
          <input value={it} onChange={(e) => set(i, e.target.value)} style={{ ...inputStyle, height: 32 }} />
          {ordered && (
            <>
              <IconButton icon="arrow-up" title="Move up" size={26} onClick={() => move(i, -1)} />
              <IconButton icon="arrow-down" title="Move down" size={26} onClick={() => move(i, 1)} />
            </>
          )}
          <IconButton icon="x" title="Remove" tone="danger" size={26} onClick={() => del(i)} />
        </div>
      ))}
      <button
        onClick={() => onChange([...items, ""])}
        style={{
          alignSelf: "flex-start",
          background: "transparent",
          border: "1px dashed var(--jv-border)",
          borderRadius: "var(--r-sm)",
          color: tone === "cyan" ? "var(--jv-cyan)" : "var(--text-muted)",
          font: "var(--fw-semibold) 11px/1 var(--font-hud)",
          letterSpacing: "0.08em",
          padding: "5px 10px",
          cursor: "pointer",
        }}
      >
        + {placeholder}
      </button>
    </div>
  );
}

// ---- product-agnostic wireframe sketches (pure CSS grey boxes) -------------
const box = (style: CSSProperties): CSSProperties => ({
  background: "var(--jv-surface-3)",
  border: "1px solid var(--jv-border-soft)",
  borderRadius: 3,
  ...style,
});

function ArchetypeSketch({ archetype }: { archetype: WireframeArchetype }) {
  const frame: CSSProperties = {
    width: 132,
    height: 84,
    background: "var(--jv-void)",
    border: "1px solid var(--jv-border)",
    borderRadius: 5,
    padding: 6,
    display: "flex",
    gap: 4,
    flex: "0 0 auto",
  };
  switch (archetype) {
    case "dashboard":
      return (
        <div style={frame}>
          <div style={box({ width: 20 })} />
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 4 }}>
            {[0, 1, 2, 3].map((k) => <div key={k} style={box({})} />)}
          </div>
        </div>
      );
    case "list":
      return (
        <div style={{ ...frame, flexDirection: "column" }}>
          <div style={box({ height: 12 })} />
          {[0, 1, 2, 3].map((k) => <div key={k} style={box({ height: 10 })} />)}
        </div>
      );
    case "record-detail":
      return (
        <div style={frame}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={box({ height: 14 })} />
            <div style={box({ flex: 1 })} />
          </div>
          <div style={box({ width: 40 })} />
        </div>
      );
    case "form-wizard":
      return (
        <div style={{ ...frame, flexDirection: "column", justifyContent: "center", gap: 6 }}>
          {[0, 1, 2].map((k) => (
            <div key={k} style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <div style={box({ width: 28, height: 8 })} />
              <div style={box({ flex: 1, height: 10 })} />
            </div>
          ))}
          <div style={box({ width: 40, height: 12, alignSelf: "flex-end", background: "var(--grad-cyan-soft)", borderColor: "var(--jv-border-cyan)" })} />
        </div>
      );
    case "chat-assistant":
      return (
        <div style={{ ...frame, flexDirection: "column", justifyContent: "flex-end", gap: 5 }}>
          <div style={box({ width: "70%", height: 12, borderRadius: 8 })} />
          <div style={box({ width: "55%", height: 12, borderRadius: 8, alignSelf: "flex-end", background: "var(--grad-cyan-soft)", borderColor: "var(--jv-border-cyan)" })} />
          <div style={box({ height: 14, borderRadius: 8 })} />
        </div>
      );
    case "progress":
      return (
        <div style={{ ...frame, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6 }}>
          <ProgressRing value={64} size={34} stroke={4} />
          <div style={box({ width: "70%", height: 6 })} />
        </div>
      );
    case "compose":
      return (
        <div style={{ ...frame, flexDirection: "column", gap: 5 }}>
          <div style={box({ height: 10 })} />
          <div style={box({ flex: 1 })} />
          <div style={box({ width: 34, height: 12, alignSelf: "flex-end", background: "var(--grad-cyan-soft)", borderColor: "var(--jv-border-cyan)" })} />
        </div>
      );
    case "settings":
      return (
        <div style={{ ...frame, flexDirection: "column", gap: 6, justifyContent: "center" }}>
          {[0, 1, 2].map((k) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
              <div style={box({ flex: 1, height: 9 })} />
              <div style={box({ width: 18, height: 10, borderRadius: 6 })} />
            </div>
          ))}
        </div>
      );
    case "talk-only":
    default:
      return (
        <div style={{ ...frame, alignItems: "center", justifyContent: "center", borderStyle: "dashed" }}>
          <Icon name="mic" size={22} color="var(--text-muted)" />
        </div>
      );
  }
}

function WireframeSketch({ spec }: { spec: CallStage["wireframe"] }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <ArchetypeSketch archetype={spec.archetype} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "var(--text-primary)", font: "var(--fw-semibold) 12px/1.3 var(--font-body)", marginBottom: 4 }}>
          {spec.screenTitle || (spec.archetype === "talk-only" ? "Conversation — no screen" : "Untitled screen")}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {spec.regions.map((r, i) => (
            <Tag key={i}>{r}</Tag>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- one stage card --------------------------------------------------------
function StageCard({
  stage,
  index,
  onChange,
  onMove,
  onDelete,
}: {
  stage: CallStage;
  index: number;
  onChange: (s: CallStage) => void;
  onMove: (d: number) => void;
  onDelete: () => void;
}) {
  const patch = (p: Partial<CallStage>) => onChange({ ...stage, ...p });
  const patchWire = (p: Partial<CallStage["wireframe"]>) => onChange({ ...stage, wireframe: { ...stage.wireframe, ...p } });
  const patchVoice = (p: Partial<CallStage["voice"]>) => onChange({ ...stage, voice: { ...stage.voice, ...p } });
  const patchScreen = (p: Partial<CallStage["screen"]>) => onChange({ ...stage, screen: { ...stage.screen, ...p } });

  return (
    <Panel
      title={`${index + 1} · ${stage.name || "Stage"}`}
      action={
        <div style={{ display: "flex", gap: 4 }}>
          <IconButton icon="arrow-up" title="Move up" size={28} onClick={() => onMove(-1)} />
          <IconButton icon="arrow-down" title="Move down" size={28} onClick={() => onMove(1)} />
          <IconButton icon="trash-2" title="Delete stage" tone="danger" size={28} onClick={onDelete} />
        </div>
      }
      style={{ marginBottom: 14 }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Field label="Stage name"><TextInput value={stage.name} onChange={(v) => patch({ name: v })} /></Field>
        <Field label="Goal"><TextInput value={stage.goal} onChange={(v) => patch({ goal: v })} placeholder="What this stage achieves" /></Field>
      </div>

      {/* wireframe strip */}
      <div style={{ background: "rgba(4,12,22,0.4)", border: "1px solid var(--jv-border-soft)", borderRadius: "var(--r-sm)", padding: 12, marginBottom: 12 }}>
        <div style={{ marginBottom: 10 }}><WireframeSketch spec={stage.wireframe} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10 }}>
          <Field label="Screen type">
            <select
              value={stage.wireframe.archetype}
              onChange={(e) => patchWire({ archetype: e.target.value as WireframeArchetype })}
              style={{ ...inputStyle, height: 36 }}
            >
              {WIREFRAME_ARCHETYPES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Screen title"><TextInput value={stage.wireframe.screenTitle} onChange={(v) => patchWire({ screenTitle: v })} placeholder="e.g. Candidate pipeline" /></Field>
        </div>
        <Field label="Regions on screen">
          <EditList items={stage.wireframe.regions} onChange={(v) => patchWire({ regions: v.slice(0, 5) })} placeholder="add region" />
        </Field>
      </div>

      {/* voice | screen columns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Icon name="mic" size={14} color="var(--jv-cyan)" />
            <span style={{ font: "var(--fw-semibold) 11px/1 var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan)" }}>Voice</span>
          </div>
          <Field label="Objective"><TextArea value={stage.voice.objective} onChange={(v) => patchVoice({ objective: v })} rows={2} /></Field>
          <Field label="Moves"><EditList items={stage.voice.moves} onChange={(v) => patchVoice({ moves: v })} placeholder="add move" /></Field>
          <Field label="Example lines"><EditList items={stage.voice.exampleLines} onChange={(v) => patchVoice({ exampleLines: v })} placeholder="add line" /></Field>
          <Field label="Listen for"><EditList items={stage.voice.listenFor} onChange={(v) => patchVoice({ listenFor: v })} placeholder="add cue" /></Field>
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Icon name="monitor" size={14} color="var(--jv-violet)" />
            <span style={{ font: "var(--fw-semibold) 11px/1 var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-violet)" }}>Screen control</span>
          </div>
          <Field label="Actions (in order)"><EditList items={stage.screen.actions} onChange={(v) => patchScreen({ actions: v })} placeholder="add action" ordered /></Field>
          <Field label="While the screen works"><TextArea value={stage.screen.waitBehavior} onChange={(v) => patchScreen({ waitBehavior: v })} rows={2} placeholder="What the voice does during loaders / processing" /></Field>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <Field label="Move on when"><TextInput value={stage.exitCriteria ?? ""} onChange={(v) => patch({ exitCriteria: v })} placeholder="Exit criteria" /></Field>
      </div>
    </Panel>
  );
}

// ---- pair list (objections / closes) --------------------------------------
function PairList({
  items,
  onChange,
  aLabel,
  bLabel,
  addLabel,
}: {
  items: { a: string; b: string }[];
  onChange: (v: { a: string; b: string }[]) => void;
  aLabel: string;
  bLabel: string;
  addLabel: string;
}) {
  const set = (i: number, k: "a" | "b", v: string) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const del = (i: number) => onChange(items.filter((_, j) => j !== i));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "start" }}>
          <div><span style={labelStyle}>{aLabel}</span><TextArea value={it.a} onChange={(v) => set(i, "a", v)} rows={2} /></div>
          <div><span style={labelStyle}>{bLabel}</span><TextArea value={it.b} onChange={(v) => set(i, "b", v)} rows={2} /></div>
          <div style={{ paddingTop: 22 }}><IconButton icon="x" title="Remove" tone="danger" size={28} onClick={() => del(i)} /></div>
        </div>
      ))}
      <button
        onClick={() => onChange([...items, { a: "", b: "" }])}
        style={{ alignSelf: "flex-start", background: "transparent", border: "1px dashed var(--jv-border)", borderRadius: "var(--r-sm)", color: "var(--text-muted)", font: "var(--fw-semibold) 11px/1 var(--font-hud)", padding: "6px 12px", cursor: "pointer" }}
      >
        + {addLabel}
      </button>
    </div>
  );
}

// ============================================================
// Main step component
// ============================================================
export function CloneFromCallsStep({
  sources,
  onSources,
  playbook,
  onPlaybook,
  jobId,
  onJobId,
  agentName,
  role,
  mentorName,
}: {
  sources: CallSource[];
  onSources: (s: CallSource[]) => void;
  playbook: CallPlaybook | null;
  onPlaybook: (p: CallPlaybook | null) => void;
  jobId: string | null;
  onJobId: (id: string | null) => void;
  agentName: string;
  role: string;
  mentorName?: string;
}) {
  const [status, setStatus] = useState<CloneCallsJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ensure at least MIN_SOURCES empty cards exist to fill in
  useEffect(() => {
    if (!playbook && sources.length < MIN_SOURCES) {
      const add = MIN_SOURCES - sources.length;
      onSources([
        ...sources,
        ...Array.from({ length: add }, (_, i) => ({ id: `src_${Date.now()}_${sources.length + i}`, url: "", title: "", transcript: "", status: "empty" as const })),
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readyCount = sources.filter((s) => (s.transcript ?? "").trim().length > READY_CHARS).length;
  const analyzing = !!jobId && !playbook && (!status || (status.phase !== "done" && status.phase !== "error"));

  // poll the job
  useEffect(() => {
    if (!jobId || playbook) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api.get<CloneCallsJobStatus>(`/api/agents/clone-calls/analyze/${jobId}`);
        if (stop) return;
        setStatus(s);
        if (s.phase === "done" && s.playbook) { onPlaybook(s.playbook); onJobId(null); }
        else if (s.phase === "error") { setError(s.error ?? "Analysis failed."); onJobId(null); }
      } catch {
        /* transient — keep polling */
      }
    };
    void tick();
    pollRef.current = setInterval(tick, 2500);
    return () => { stop = true; if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, playbook]);

  const setSource = (i: number, p: Partial<CallSource>) => {
    onSources(sources.map((s, k) => {
      if (k !== i) return s;
      const next = { ...s, ...p };
      next.status = (next.transcript ?? "").trim().length > READY_CHARS ? "ready" : "empty";
      return next;
    }));
  };

  const analyze = async () => {
    setError(null);
    setStatus(null);
    try {
      const { jobId: id } = await api.post<{ jobId: string }>("/api/agents/clone-calls/analyze", { sources, role, agentName });
      onJobId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start analysis.");
    }
  };

  const patchPlaybook = (p: Partial<CallPlaybook>) => { if (playbook) onPlaybook({ ...playbook, ...p, approved: false }); };
  const setStage = (i: number, s: CallStage) => patchPlaybook({ stages: playbook!.stages.map((x, k) => (k === i ? s : x)) });
  const moveStage = (i: number, d: number) => {
    const j = i + d; if (!playbook || j < 0 || j >= playbook.stages.length) return;
    const next = playbook.stages.slice(); [next[i], next[j]] = [next[j], next[i]]; patchPlaybook({ stages: next });
  };
  const deleteStage = (i: number) => patchPlaybook({ stages: playbook!.stages.filter((_, k) => k !== i) });
  const addStage = () => patchPlaybook({
    stages: [...playbook!.stages, { id: `stage_${Date.now()}`, name: "New stage", goal: "", wireframe: { archetype: "talk-only", screenTitle: "", regions: [] }, voice: { objective: "", moves: [], exampleLines: [], listenFor: [] }, screen: { actions: [], waitBehavior: "" } }],
  });

  // ---------- RENDER ----------

  // 3. approved (read-mostly) or review
  if (playbook) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={{ margin: 0, color: "var(--text-primary)", font: "var(--fw-semibold) 18px/1.2 var(--font-body)" }}>Call playbook</h3>
              {playbook.approved
                ? <Badge status="optimal">Approved</Badge>
                : <Badge status="warn">Review &amp; approve</Badge>}
              <Tag>{playbook.stages.length} stages</Tag>
              <Tag>from {playbook.sources.length} calls</Tag>
            </div>
            <div style={{ color: "var(--text-muted)", font: "12px/1.5 var(--font-body)", marginTop: 4 }}>
              This becomes {agentName || "the agent"}'s live-call script — edit anything, then approve.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" icon={<Icon name="rotate-ccw" size={14} />} onClick={() => { onPlaybook(null); setStatus(null); }}>
              Re-analyze
            </Button>
            {!playbook.approved && (
              <Button variant="primary" icon={<Icon name="check" size={14} />} onClick={() => setConfirmApprove(true)}>
                Approve playbook
              </Button>
            )}
            {playbook.approved && (
              <Button variant="secondary" icon={<Icon name="pencil" size={14} />} onClick={() => patchPlaybook({})}>
                Edit
              </Button>
            )}
          </div>
        </div>

        {playbook.stages.map((s, i) => (
          <StageCard key={s.id} stage={s} index={i} onChange={(x) => setStage(i, x)} onMove={(d) => moveStage(i, d)} onDelete={() => deleteStage(i)} />
        ))}
        <div style={{ marginBottom: 16 }}>
          <Button variant="ghost" icon={<Icon name="plus" size={14} />} onClick={addStage}>Add stage</Button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Panel title="Facts the agent may state">
            <EditList items={playbook.facts} onChange={(v) => patchPlaybook({ facts: v })} placeholder="add fact" />
          </Panel>
          <Panel title="Pricing story">
            <TextArea value={playbook.pricing ?? ""} onChange={(v) => patchPlaybook({ pricing: v })} rows={5} placeholder="How pricing is told on the call" />
          </Panel>
          <Panel title="Objections → responses">
            <PairList
              items={playbook.objections.map((o) => ({ a: o.objection, b: o.response }))}
              onChange={(v) => patchPlaybook({ objections: v.map((x) => ({ objection: x.a, response: x.b })) })}
              aLabel="Objection" bLabel="Response" addLabel="add objection"
            />
          </Panel>
          <Panel title="Closes by buyer type">
            <PairList
              items={playbook.closes.map((c) => ({ a: c.buyerType, b: c.close }))}
              onChange={(v) => patchPlaybook({ closes: v.map((x) => ({ buyerType: x.a, close: x.b })) })}
              aLabel="Buyer type" bLabel="Close" addLabel="add close"
            />
          </Panel>
        </div>

        <ConfirmDialog
          open={confirmApprove}
          title="Approve this call playbook?"
          message="This becomes the agent's live-call script — it's compiled into the voice instructions on deploy. You can re-open and edit it later."
          confirmLabel="Approve"
          onConfirm={() => { setConfirmApprove(false); onPlaybook({ ...playbook, approved: true }); }}
          onCancel={() => setConfirmApprove(false)}
        />
      </div>
    );
  }

  // 2. analyzing
  if (analyzing) {
    const phaseCopy = status?.phase === "unifying" ? "Building the unified playbook…" : "Reading the calls…";
    const done = status?.perSource.filter((s) => s.state === "done").length ?? 0;
    const tot = status?.perSource.length ?? readyCount;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "32px 0" }}>
        <ProgressRing value={status?.pct ?? 5} size={110} label={`${status?.pct ?? 5}%`} sublabel={status?.phase === "unifying" ? "unifying" : "extracting"} />
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "var(--text-primary)", font: "var(--fw-semibold) 15px/1.3 var(--font-body)" }}>{phaseCopy}</div>
          <div style={{ color: "var(--text-muted)", font: "12px/1.5 var(--font-body)", marginTop: 4 }}>
            {status?.phase === "unifying" ? "Separating the reusable flow from call-specific examples." : `Analyzed ${done} of ${tot} calls.`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {(status?.perSource ?? []).map((s) => (
            <Tag key={s.id} priority={s.state === "done" ? "low" : s.state === "error" ? "critical" : null}>
              {s.title || "call"} · {s.state}
            </Tag>
          ))}
        </div>
      </div>
    );
  }

  // 1. collecting
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h3 style={{ margin: 0, color: "var(--text-primary)", font: "var(--fw-semibold) 18px/1.2 var(--font-body)" }}>Clone from real calls</h3>
          <Badge status={readyCount >= MIN_SOURCES ? "optimal" : "info"}>{readyCount} / {MIN_SOURCES} transcripts</Badge>
        </div>
        <div style={{ color: "var(--text-muted)", font: "13px/1.6 var(--font-body)" }}>
          Paste at least {MIN_SOURCES} call transcripts{mentorName ? ` from ${mentorName}'s calls` : ""} (Fathom, Fireflies, Otter, Gong…).
          The link is kept as a label; the pasted text is what gets analyzed. We distill a generic call flow — stage by stage,
          what the voice does and what the screen shows — that you can edit before deploying.
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "color-mix(in srgb, var(--jv-red) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-red) 40%, transparent)", color: "var(--jv-red-300, var(--jv-red))", font: "12px/1.5 var(--font-body)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sources.map((s, i) => {
          const len = (s.transcript ?? "").trim().length;
          const ready = len > READY_CHARS;
          return (
            <Panel key={s.id} title={`Call ${i + 1}`} action={
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {ready ? <Tag priority="low">ready</Tag> : <span style={{ color: "var(--text-muted)", font: "11px/1 var(--font-hud)" }}>{len}/{READY_CHARS}</span>}
                {sources.length > MIN_SOURCES && <IconButton icon="x" title="Remove call" tone="danger" size={26} onClick={() => onSources(sources.filter((_, k) => k !== i))} />}
              </div>
            }>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Fathom link (label)"><TextInput value={s.url} onChange={(v) => setSource(i, { url: v })} placeholder="https://fathom.video/share/…" /></Field>
                <Field label="Title (optional)"><TextInput value={s.title ?? ""} onChange={(v) => setSource(i, { title: v })} placeholder="e.g. Discovery — mid-market" /></Field>
              </div>
              <Field label="Transcript">
                <TextArea value={s.transcript ?? ""} onChange={(v) => setSource(i, { transcript: v })} rows={5} placeholder="Paste the full call transcript here…" />
              </Field>
            </Panel>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <Button variant="ghost" icon={<Icon name="plus" size={14} />} onClick={() => onSources([...sources, { id: `src_${Date.now()}`, url: "", title: "", transcript: "", status: "empty" }])}>
          Add another call
        </Button>
        <div style={{ flex: 1 }} />
        <Button variant="primary" disabled={readyCount < MIN_SOURCES} icon={<Icon name="sparkles" size={14} />} onClick={analyze}>
          Analyze {readyCount >= MIN_SOURCES ? `${readyCount} calls` : `calls (${readyCount}/${MIN_SOURCES})`}
        </Button>
      </div>
      <div style={{ color: "var(--text-muted)", font: "11px/1.5 var(--font-body)", marginTop: 8 }}>
        Note: pasted transcripts aren't saved in the draft — if you leave and come back before analyzing, re-paste them. The generated playbook is saved.
      </div>
    </div>
  );
}
