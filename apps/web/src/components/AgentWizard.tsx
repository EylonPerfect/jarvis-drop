import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Button, Icon, Switch } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type {
  AiProvider,
  Agent,
  NewAgent,
  AgentPermission,
  AgentPlaybook,
  WeeklyPlan,
  WeekdayKey,
  CalendarPlaybook,
  BudgetConfig,
  ConnectionCatalogItem,
} from "@jarvis/shared";

// ============================================================
// AgentWizard — a 5-step "Hire an Agent" flow. Drop-in for AgentForm:
// exposes the SAME props (submitLabel / onSubmit / onCancel / resetOnSubmit)
// so the Roster modal and Hire screen barely change. Reuses AgentForm's
// field / chip / icon-picker / model-select patterns and ✨ Suggest logic,
// then layers on playbook, weekly plan, calendar scenarios, access and budget.
// ============================================================

interface SuggestResult { plan: string; routine: string; instructions: string; source: "ai" | "template" }
interface SuggestOverview extends SuggestResult { overview: string }
interface PlaybookSuggest { name: string; trigger: string; steps: string[]; source: "ai" | "template" }
interface KnowledgeSourceRef { id: string; title?: string }

const ICON_CHOICES = ["bot", "code", "search", "database", "globe", "list-checks", "shield-check", "mail", "calendar", "pen-tool", "bar-chart-3", "terminal"];
const TOOL_CHOICES = ["web_search", "code_interpreter", "filesystem", "github", "memory.query", "calendar", "gmail", "whatsapp", "shell", "vision"];
const AUTONOMY_CHOICES = ["Ask before acting", "Act, then report", "Fully autonomous"];
const PERMISSION_LABELS = ["Read knowledge base", "Send messages", "Control browser", "Send email", "Execute tools", "Spend budget", "Make payments"];
const WEEKDAYS: { key: WeekdayKey; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];
const STEP_TITLES = ["Role & overview", "Playbook", "Plan & calendar", "Access", "Budget & review"];

const inputStyle: CSSProperties = {
  width: "100%",
  height: 40,
  padding: "0 14px",
  borderRadius: "var(--r-sm)",
  background: "var(--jv-void)",
  border: "1px solid var(--jv-border)",
  color: "var(--jv-text)",
  font: "var(--fw-medium) 13px var(--font-body)",
  outline: "none",
  boxSizing: "border-box",
};
const areaStyle: CSSProperties = { ...inputStyle, height: 80, padding: "10px 14px", resize: "vertical", font: "var(--fw-regular) 13px/1.5 var(--font-body)" };

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 8 }}>{label}</div>
      {children}
      {hint && <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: "var(--r-pill)",
        border: `1px solid ${active ? "var(--jv-border-cyan)" : "var(--jv-border)"}`,
        background: active ? "var(--grad-cyan-soft)" : "var(--jv-void)",
        color: active ? "var(--jv-cyan-300)" : "var(--jv-text-muted)",
        font: `${active ? "var(--fw-semibold)" : "var(--fw-medium)"} 12px var(--font-mono)`,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// A small removable list built from an add-input. Reused for weekly-day tasks,
// daily tasks and calendar-playbook steps.
function TaskList({ items, onAdd, onRemove, placeholder }: { items: string[]; onAdd: (v: string) => void; onRemove: (i: number) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onAdd(v);
    setDraft("");
  };
  return (
    <div>
      {items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
          {items.map((t, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <span style={{ flex: 1, minWidth: 0, font: "var(--fw-regular) 12px/1.4 var(--font-body)", color: "var(--jv-text-soft)" }}>{t}</span>
              <button onClick={() => onRemove(i)} title="Remove" style={{ background: "none", border: "none", color: "var(--jv-text-faint)", cursor: "pointer", display: "grid", placeItems: "center" }}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder={placeholder}
          style={{ ...inputStyle, height: 34 }}
        />
        <Button variant="ghost" size="sm" icon={<Icon name="plus" size={13} />} disabled={!draft.trim()} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

export function AgentWizard({
  submitLabel = "Deploy Agent",
  onSubmit,
  onCancel,
  resetOnSubmit = false,
}: {
  submitLabel?: string;
  onSubmit: (a: NewAgent) => void;
  onCancel?: () => void;
  resetOnSubmit?: boolean;
}) {
  const { data: provData } = useApi<AiProvider[]>("/api/aicore/providers");
  const providers = provData ?? [];
  const models = Array.from(new Set(providers.map((p) => p.model)));
  const activeModel = providers.find((p) => p.active)?.model ?? models[0] ?? "";

  const { data: catalogData } = useApi<ConnectionCatalogItem[]>("/api/agents/connection-catalog");
  const catalog = catalogData ?? [];

  // ---- Step 1: role & overview ----
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [icon, setIcon] = useState("bot");
  const [model, setModel] = useState("");
  const [autonomy, setAutonomy] = useState(AUTONOMY_CHOICES[0]);
  const [overview, setOverview] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  // Stashed from ✨ Suggest — used at submit + as defaults elsewhere.
  const [stashPlan, setStashPlan] = useState("");
  const [stashRoutine, setStashRoutine] = useState("");
  const [stashInstr, setStashInstr] = useState("");

  // ---- Step 2: playbook ----
  const [pbMode, setPbMode] = useState<"notion" | "file" | "text">("notion");
  const [pbUrl, setPbUrl] = useState("");
  const [pbTitle, setPbTitle] = useState("");
  const [pbText, setPbText] = useState("");
  const [pbBusy, setPbBusy] = useState(false);
  const [pbError, setPbError] = useState<string | null>(null);
  const [playbook, setPlaybook] = useState<AgentPlaybook | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- Step 3: plan, routine & calendar ----
  const [days, setDays] = useState<Partial<Record<WeekdayKey, string[]>>>({});
  const [daily, setDaily] = useState<string[]>([]);
  const [calendarPlaybooks, setCalendarPlaybooks] = useState<CalendarPlaybook[]>([]);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scScenario, setScScenario] = useState("");
  const [scName, setScName] = useState("");
  const [scTrigger, setScTrigger] = useState("");
  const [scSteps, setScSteps] = useState("");
  const [scBusy, setScBusy] = useState(false);
  const [scNote, setScNote] = useState<string | null>(null);

  // ---- Step 4: access ----
  const [permissions, setPermissions] = useState<AgentPermission[]>(
    PERMISSION_LABELS.map((label) => ({ label, allowed: label === "Read knowledge base" })),
  );
  const [connections, setConnections] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>(["web_search"]);

  // ---- Step 5: budget ----
  const [budget, setBudget] = useState<BudgetConfig>({ currency: "USD", allowPayments: false });

  useEffect(() => {
    if (!model && activeModel) setModel(activeModel);
  }, [activeModel, model]);

  // ---- Step 1 · ✨ Suggest: fills overview + stashes plan/routine/instructions ----
  const suggest = async () => {
    if (!role.trim() || suggesting) return;
    setSuggesting(true);
    setSuggestNote(null);
    try {
      const r = await api.post<SuggestOverview>("/api/agents/suggest", { name: name.trim(), role: role.trim() });
      setOverview(r.overview ?? r.plan ?? "");
      setStashPlan(r.plan ?? "");
      setStashRoutine(r.routine ?? "");
      setStashInstr(r.instructions ?? "");
      setSuggestNote(r.source === "ai" ? "Drafted by your AI Core model — edit as needed." : "Drafted from a template (connect a model in AI Core for tailored drafts).");
    } catch {
      setSuggestNote("Couldn't generate a suggestion — try again.");
    } finally {
      setSuggesting(false);
    }
  };

  // ---- Step 2 · attach playbook ----
  const connectNotion = async () => {
    if (!pbUrl.trim() || pbBusy) return;
    setPbBusy(true);
    setPbError(null);
    try {
      const src = await api.post<KnowledgeSourceRef>("/api/knowledge/notion", { url: pbUrl.trim() });
      setPlaybook({ kind: "notion", name: src.title ?? pbUrl.trim(), url: pbUrl.trim(), sourceId: src.id });
      setPbUrl("");
    } catch {
      setPbError("Couldn't attach that Notion page — check the URL.");
    } finally {
      setPbBusy(false);
    }
  };

  const uploadFile = async (file: File) => {
    setPbBusy(true);
    setPbError(null);
    try {
      const content = await file.text();
      const src = await api.post<KnowledgeSourceRef>("/api/knowledge/sources", { title: file.name, content });
      setPlaybook({ kind: "file", name: file.name, sourceId: src.id });
    } catch {
      setPbError("Couldn't upload that file — try again.");
    } finally {
      setPbBusy(false);
    }
  };

  const pasteText = async () => {
    if (!pbText.trim() || pbBusy) return;
    setPbBusy(true);
    setPbError(null);
    try {
      const title = pbTitle.trim() || "Playbook";
      const src = await api.post<KnowledgeSourceRef>("/api/knowledge/sources", { title, content: pbText.trim() });
      setPlaybook({ kind: "text", name: title, sourceId: src.id });
      setPbTitle("");
      setPbText("");
    } catch {
      setPbError("Couldn't save that text — try again.");
    } finally {
      setPbBusy(false);
    }
  };

  // ---- Step 3 · calendar playbooks ----
  const resetScenario = () => {
    setScenarioOpen(false);
    setEditingId(null);
    setScScenario("");
    setScName("");
    setScTrigger("");
    setScSteps("");
    setScNote(null);
  };

  const suggestScenario = async () => {
    if (!scScenario.trim() || scBusy) return;
    setScBusy(true);
    setScNote(null);
    try {
      const r = await api.post<PlaybookSuggest>("/api/agents/suggest-playbook", { role: role.trim(), scenario: scScenario.trim() });
      setScName(r.name ?? "");
      setScTrigger(r.trigger ?? "");
      setScSteps((r.steps ?? []).join("\n"));
      setScNote(r.source === "ai" ? "Drafted by your AI Core model — edit as needed." : "Drafted from a template — edit as needed.");
    } catch {
      setScNote("Couldn't generate that scenario — try again.");
    } finally {
      setScBusy(false);
    }
  };

  const saveScenario = () => {
    const steps = scSteps.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!scName.trim()) return;
    const entry: CalendarPlaybook = { id: editingId ?? `pb_${Date.now()}`, name: scName.trim(), trigger: scTrigger.trim(), steps };
    setCalendarPlaybooks((prev) => (editingId ? prev.map((p) => (p.id === editingId ? entry : p)) : [...prev, entry]));
    resetScenario();
  };

  const editScenario = (pb: CalendarPlaybook) => {
    setEditingId(pb.id);
    setScenarioOpen(true);
    setScScenario("");
    setScName(pb.name);
    setScTrigger(pb.trigger);
    setScSteps(pb.steps.join("\n"));
    setScNote(null);
  };

  // ---- helpers ----
  const toggleTool = (v: string) => setTools((arr) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]));
  const togglePermission = (label: string) => setPermissions((prev) => prev.map((p) => (p.label === label ? { ...p, allowed: !p.allowed } : p)));
  const toggleConnection = (id: string) => setConnections((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));
  const addDayTask = (key: WeekdayKey, v: string) => setDays((d) => ({ ...d, [key]: [...(d[key] ?? []), v] }));
  const removeDayTask = (key: WeekdayKey, i: number) => setDays((d) => ({ ...d, [key]: (d[key] ?? []).filter((_, j) => j !== i) }));
  const numOf = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));

  const step1Valid = name.trim() !== "" && role.trim() !== "";
  const canNext = step === 0 ? step1Valid : true;

  const reset = () => {
    setStep(0);
    setName("");
    setRole("");
    setIcon("bot");
    setAutonomy(AUTONOMY_CHOICES[0]);
    setOverview("");
    setSuggestNote(null);
    setStashPlan("");
    setStashRoutine("");
    setStashInstr("");
    setPbMode("notion");
    setPbUrl("");
    setPbTitle("");
    setPbText("");
    setPbError(null);
    setPlaybook(null);
    setDays({});
    setDaily([]);
    setCalendarPlaybooks([]);
    resetScenario();
    setPermissions(PERMISSION_LABELS.map((label) => ({ label, allowed: label === "Read knowledge base" })));
    setConnections([]);
    setTools(["web_search"]);
    setBudget({ currency: "USD", allowPayments: false });
  };

  const submit = () => {
    if (!step1Valid) return;
    const weeklyPlan: WeeklyPlan = { days, daily };
    // Legacy text fields so existing screens (AgentCockpit) keep rendering.
    const scheduleStr = WEEKDAYS.filter((d) => (days[d.key] ?? []).length > 0)
      .map((d) => `${d.label}: ${(days[d.key] ?? []).join(", ")}`)
      .join("; ");
    const routineLines = [
      ...daily,
      ...calendarPlaybooks.map((pb) => `On ${pb.trigger || "trigger"} → ${pb.name} (${pb.steps.length} step${pb.steps.length === 1 ? "" : "s"})`),
    ];
    const routineStr = routineLines.length ? routineLines.join("\n") : stashRoutine.trim();
    const budgetStr = budget.monthlyCap != null ? `${budget.currency} ${budget.monthlyCap}/mo` : undefined;

    const agent: NewAgent = {
      icon,
      name: name.trim(),
      role: role.trim(),
      model: model || undefined,
      tools,
      collaborators: [],
      autonomy,
      overview: overview.trim() || undefined,
      playbook: playbook ?? undefined,
      weeklyPlan,
      calendarPlaybooks,
      connections,
      budgetConfig: budget,
      permissions,
      plan: stashPlan.trim() || overview.trim() || undefined,
      routine: routineStr || undefined,
      budget: budgetStr,
      schedule: scheduleStr || undefined,
      instructions: stashInstr.trim() || undefined,
    };
    onSubmit(agent);
    if (resetOnSubmit) reset();
  };

  const grantedCount = permissions.filter((p) => p.allowed).length;
  const weeklyTaskCount = WEEKDAYS.reduce((n, d) => n + (days[d.key] ?? []).length, 0) + daily.length;
  const liveCount = connections.filter((id) => catalog.find((c) => c.id === id)?.live).length;
  const pendingCount = connections.length - liveCount;

  // ---- render ----
  return (
    <div>
      {/* Progress header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          {STEP_TITLES.map((_, i) => (
            <button
              key={i}
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              title={STEP_TITLES[i]}
              style={{
                flex: 1,
                height: 6,
                borderRadius: "var(--r-pill)",
                border: "none",
                padding: 0,
                cursor: i < step ? "pointer" : "default",
                background: i <= step ? "var(--jv-cyan)" : "var(--jv-border)",
                boxShadow: i === step ? "0 0 8px var(--jv-glow-cyan)" : "none",
                transition: "all var(--t)",
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)" }}>{STEP_TITLES[step]}</div>
          <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>
            Step {step + 1} of {STEP_TITLES.length}
          </div>
        </div>
      </div>

      {/* ---- STEP 1 ---- */}
      {step === 0 && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Field label="Agent name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Finance Agent" style={inputStyle} />
            </Field>
            <Field label="Role">
              <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Tracks spend & budgets" style={inputStyle} />
            </Field>
          </div>

          <Field label="Icon">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ICON_CHOICES.map((ic) => (
                <button
                  key={ic}
                  onClick={() => setIcon(ic)}
                  title={ic}
                  style={{
                    width: 38,
                    height: 38,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "var(--r-sm)",
                    cursor: "pointer",
                    color: icon === ic ? "var(--jv-cyan-300)" : "var(--jv-text-muted)",
                    background: icon === ic ? "var(--grad-cyan-soft)" : "var(--jv-void)",
                    border: `1px solid ${icon === ic ? "var(--jv-border-cyan)" : "var(--jv-border)"}`,
                  }}
                >
                  <Icon name={ic} size={17} />
                </button>
              ))}
            </div>
          </Field>

          <Field label="Autonomy">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {AUTONOMY_CHOICES.map((a) => (
                <Chip key={a} active={autonomy === a} onClick={() => setAutonomy(a)}>
                  {a}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Reasoning model" hint="Comes from the providers you connected in AI Core.">
            {models.length ? (
              <select value={model} onChange={(e) => setModel(e.target.value)} style={{ ...inputStyle, appearance: "none", cursor: "pointer", maxWidth: 360 }}>
                {models.map((m) => {
                  const p = providers.find((pr) => pr.model === m);
                  return (
                    <option key={m} value={m}>
                      {m}{p ? ` · ${p.name}` : ""}{p?.active ? " (active)" : ""}
                    </option>
                  );
                })}
              </select>
            ) : (
              <div style={{ ...inputStyle, maxWidth: 360, display: "flex", alignItems: "center", gap: 7, color: "var(--jv-text-muted)", font: "var(--fw-regular) 12px var(--font-body)" }}>
                <Icon name="plug" size={13} /> No model connected — add one in AI Core
              </div>
            )}
          </Field>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              margin: "4px 0 14px",
              padding: "10px 12px",
              borderRadius: "var(--r-sm)",
              background: "var(--jv-surface-2)",
              border: "1px dashed var(--jv-border-cyan)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)" }}>Autofill from role</div>
              <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: suggestNote ? "var(--jv-cyan-300)" : "var(--jv-text-faint)", marginTop: 2 }}>
                {suggestNote ?? "Draft the overview (and plan / routine / instructions) from this agent's role."}
              </div>
            </div>
            <Button variant="ghost" icon={<Icon name={suggesting ? "loader" : "sparkles"} size={14} />} disabled={!role.trim() || suggesting} onClick={suggest}>
              {suggesting ? "Generating…" : "Suggest"}
            </Button>
          </div>

          <Field label="Overview · what is this role about?" hint="A plain-language explainer of what this teammate is responsible for.">
            <textarea
              value={overview}
              onChange={(e) => setOverview(e.target.value)}
              placeholder="e.g. Owns spend visibility across every team — tracks budgets, flags overruns and keeps finance in the loop."
              style={{ ...areaStyle, height: 90 }}
            />
          </Field>
        </div>
      )}

      {/* ---- STEP 2 ---- */}
      {step === 1 && (
        <div>
          <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>
            Give this agent a reference playbook — the doc it works from. Optional, but it makes for a far sharper hire.
          </p>

          {playbook ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)" }}>
              <span style={{ width: 36, height: 36, flex: "0 0 36px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
                <Icon name={playbook.kind === "notion" ? "link" : playbook.kind === "file" ? "upload" : "list-checks"} size={17} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{playbook.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-green)" }}>
                  <Icon name="check" size={12} /> Connected · {playbook.kind}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPlaybook(null)}>
                Change
              </Button>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {(["notion", "file", "text"] as const).map((m) => (
                  <Chip key={m} active={pbMode === m} onClick={() => { setPbMode(m); setPbError(null); }}>
                    {m === "notion" ? "Connect Notion" : m === "file" ? "Upload file" : "Paste text"}
                  </Chip>
                ))}
              </div>

              {pbMode === "notion" && (
                <Field label="Notion page URL">
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={pbUrl} onChange={(e) => setPbUrl(e.target.value)} placeholder="https://notion.so/…" style={inputStyle} />
                    <Button variant="secondary" icon={<Icon name={pbBusy ? "loader" : "link"} size={14} />} disabled={!pbUrl.trim() || pbBusy} onClick={connectNotion}>
                      {pbBusy ? "Connecting…" : "Connect"}
                    </Button>
                  </div>
                </Field>
              )}

              {pbMode === "file" && (
                <Field label="Upload a playbook doc" hint="Text, Markdown or similar — read locally and attached to the knowledge base.">
                  <input
                    ref={fileRef}
                    type="file"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadFile(f);
                      e.target.value = "";
                    }}
                  />
                  <Button variant="secondary" icon={<Icon name={pbBusy ? "loader" : "upload"} size={14} />} disabled={pbBusy} onClick={() => fileRef.current?.click()}>
                    {pbBusy ? "Uploading…" : "Choose file"}
                  </Button>
                </Field>
              )}

              {pbMode === "text" && (
                <div>
                  <Field label="Title">
                    <input value={pbTitle} onChange={(e) => setPbTitle(e.target.value)} placeholder="e.g. Outreach playbook" style={inputStyle} />
                  </Field>
                  <Field label="Playbook text">
                    <textarea value={pbText} onChange={(e) => setPbText(e.target.value)} placeholder="Paste the playbook this agent should follow…" style={{ ...areaStyle, height: 120 }} />
                  </Field>
                  <Button variant="secondary" icon={<Icon name={pbBusy ? "loader" : "check"} size={14} />} disabled={!pbText.trim() || pbBusy} onClick={pasteText}>
                    {pbBusy ? "Saving…" : "Save playbook"}
                  </Button>
                </div>
              )}

              {pbError && <div style={{ marginTop: 12, font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-red)" }}>{pbError}</div>}
            </div>
          )}
        </div>
      )}

      {/* ---- STEP 3 ---- */}
      {step === 2 && (
        <div>
          <Field label="Weekly plan" hint="What this agent focuses on each day of the week.">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {WEEKDAYS.map((d) => (
                <div key={d.key} style={{ padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)" }}>
                  <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 8 }}>{d.label}</div>
                  <TaskList
                    items={days[d.key] ?? []}
                    onAdd={(v) => addDayTask(d.key, v)}
                    onRemove={(i) => removeDayTask(d.key, i)}
                    placeholder={`Add a ${d.label} task…`}
                  />
                </div>
              ))}
            </div>
          </Field>

          <Field label="Daily repeatable tasks" hint="Runs every day, regardless of weekday.">
            <TaskList items={daily} onAdd={(v) => setDaily((arr) => [...arr, v])} onRemove={(i) => setDaily((arr) => arr.filter((_, j) => j !== i))} placeholder="Add a daily task…" />
          </Field>

          <Field label="Calendar playbooks" hint="Scenarios triggered off your calendar — e.g. meeting → present product → screen-share → send Stripe link.">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {calendarPlaybooks.map((pb) => (
                <div key={pb.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                  <Icon name="calendar" size={15} color="var(--jv-cyan)" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{pb.name}</div>
                    <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 1 }}>
                      {pb.trigger || "no trigger"} · {pb.steps.length} step{pb.steps.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <button onClick={() => editScenario(pb)} title="Edit" style={{ background: "none", border: "none", color: "var(--jv-text-faint)", cursor: "pointer", display: "grid", placeItems: "center" }}>
                    <Icon name="pen-tool" size={13} />
                  </button>
                  <button onClick={() => setCalendarPlaybooks((prev) => prev.filter((p) => p.id !== pb.id))} title="Remove" style={{ background: "none", border: "none", color: "var(--jv-text-faint)", cursor: "pointer", display: "grid", placeItems: "center" }}>
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}

              {scenarioOpen ? (
                <div style={{ padding: "14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-2)", border: "1px dashed var(--jv-border-cyan)" }}>
                  {!editingId && (
                    <Field label="Describe the scenario" hint="We'll draft a name, trigger and steps you can edit.">
                      <div style={{ display: "flex", gap: 8 }}>
                        <input value={scScenario} onChange={(e) => setScScenario(e.target.value)} placeholder="e.g. product demo call with a prospect" style={inputStyle} />
                        <Button variant="ghost" icon={<Icon name={scBusy ? "loader" : "sparkles"} size={14} />} disabled={!scScenario.trim() || scBusy} onClick={suggestScenario}>
                          {scBusy ? "…" : "Suggest"}
                        </Button>
                      </div>
                    </Field>
                  )}
                  {scNote && <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-cyan-300)", margin: "-6px 0 12px" }}>{scNote}</div>}
                  <Field label="Name">
                    <input value={scName} onChange={(e) => setScName(e.target.value)} placeholder="e.g. Product demo call" style={inputStyle} />
                  </Field>
                  <Field label="Trigger" hint="A keyword matched against calendar events, e.g. 'meeting' or 'demo'.">
                    <input value={scTrigger} onChange={(e) => setScTrigger(e.target.value)} placeholder="e.g. meeting" style={inputStyle} />
                  </Field>
                  <Field label="Steps · one per line">
                    <textarea
                      value={scSteps}
                      onChange={(e) => setScSteps(e.target.value)}
                      placeholder={"Present the product\nShare screen\nSend Stripe link from back office"}
                      style={{ ...areaStyle, height: 100 }}
                    />
                  </Field>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <Button variant="ghost" size="sm" onClick={resetScenario}>
                      Cancel
                    </Button>
                    <Button variant="secondary" size="sm" icon={<Icon name="check" size={13} />} disabled={!scName.trim()} onClick={saveScenario}>
                      {editingId ? "Save changes" : "Add scenario"}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" size="sm" icon={<Icon name="plus" size={13} />} onClick={() => { resetScenario(); setScenarioOpen(true); }}>
                  Add scenario
                </Button>
              )}
            </div>
          </Field>
        </div>
      )}

      {/* ---- STEP 4 ---- */}
      {step === 3 && (
        <div>
          <Field label="Permissions" hint="What this agent is allowed to do. Denied by default — grant only what it needs.">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {permissions.map((p) => (
                <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                  <Icon name="shield-check" size={15} color={p.allowed ? "var(--jv-green)" : "var(--jv-text-faint)"} />
                  <span style={{ flex: 1, font: "var(--fw-medium) 12.5px var(--font-body)", color: "var(--jv-text-soft)" }}>{p.label}</span>
                  <span style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: p.allowed ? "var(--jv-green)" : "var(--jv-text-faint)" }}>
                    {p.allowed ? "Allowed" : "Denied"}
                  </span>
                  <Switch checked={p.allowed} onChange={() => togglePermission(p.label)} />
                </div>
              ))}
            </div>
          </Field>

          <Field label="Connections" hint="Systems this agent can reach. Live are wired now; pending are configured but not yet active.">
            {catalog.length === 0 ? (
              <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-faint)" }}>No connections available.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {Array.from(new Set(catalog.map((c) => c.category))).map((cat) => (
                  <div key={cat}>
                    <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>{cat}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {catalog.filter((c) => c.category === cat).map((c) => (
                        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                          <Icon name="plug" size={14} color="var(--jv-cyan)" />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ font: "var(--fw-medium) 12.5px var(--font-body)", color: "var(--jv-text-soft)" }}>{c.label}</div>
                            {c.note && <div style={{ font: "var(--fw-regular) 10.5px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 1 }}>{c.note}</div>}
                          </div>
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: "var(--r-pill)",
                              font: "var(--fw-semibold) 9px var(--font-hud)",
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: c.live ? "var(--jv-green)" : "var(--jv-text-muted)",
                              background: c.live ? "color-mix(in srgb, var(--jv-green) 14%, transparent)" : "var(--jv-void)",
                              border: `1px solid ${c.live ? "color-mix(in srgb, var(--jv-green) 40%, transparent)" : "var(--jv-border-soft)"}`,
                            }}
                          >
                            {c.live ? "Live" : "Configured — pending"}
                          </span>
                          <Switch checked={connections.includes(c.id)} onChange={() => toggleConnection(c.id)} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Field>

          <Field label="Skills & tools" hint={`${tools.length} selected — what this agent is allowed to call.`}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {TOOL_CHOICES.map((t) => (
                <Chip key={t} active={tools.includes(t)} onClick={() => toggleTool(t)}>
                  {t}
                </Chip>
              ))}
            </div>
          </Field>
        </div>
      )}

      {/* ---- STEP 5 ---- */}
      {step === 4 && (
        <div>
          <Field label="Budget & authority" hint="Hard limits on what this agent may spend and do.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ font: "var(--fw-regular) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Currency</div>
                <input value={budget.currency} onChange={(e) => setBudget((b) => ({ ...b, currency: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ font: "var(--fw-regular) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Monthly cap</div>
                <input type="number" value={budget.monthlyCap ?? ""} onChange={(e) => setBudget((b) => ({ ...b, monthlyCap: numOf(e.target.value) }))} placeholder="e.g. 500" style={inputStyle} />
              </div>
              <div>
                <div style={{ font: "var(--fw-regular) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Per-action limit</div>
                <input type="number" value={budget.perActionLimit ?? ""} onChange={(e) => setBudget((b) => ({ ...b, perActionLimit: numOf(e.target.value) }))} placeholder="e.g. 50" style={inputStyle} />
              </div>
              <div>
                <div style={{ font: "var(--fw-regular) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Approval threshold</div>
                <input type="number" value={budget.approvalThreshold ?? ""} onChange={(e) => setBudget((b) => ({ ...b, approvalThreshold: numOf(e.target.value) }))} placeholder="e.g. 100" style={inputStyle} />
                <div style={{ font: "var(--fw-regular) 10.5px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 4 }}>Spend above this needs approval in the inbox.</div>
              </div>
              <div>
                <div style={{ font: "var(--fw-regular) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Token budget (USD)</div>
                <input type="number" value={budget.tokenBudgetUsd ?? ""} onChange={(e) => setBudget((b) => ({ ...b, tokenBudgetUsd: numOf(e.target.value) }))} placeholder="e.g. 20" style={inputStyle} />
              </div>
              <div>
                <div style={{ font: "var(--fw-regular) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Max messages / day</div>
                <input type="number" value={budget.maxMessagesPerDay ?? ""} onChange={(e) => setBudget((b) => ({ ...b, maxMessagesPerDay: numOf(e.target.value) }))} placeholder="e.g. 50" style={inputStyle} />
              </div>
              <div>
                <div style={{ font: "var(--fw-regular) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Max browser sessions / day</div>
                <input type="number" value={budget.maxBrowserSessionsPerDay ?? ""} onChange={(e) => setBudget((b) => ({ ...b, maxBrowserSessionsPerDay: numOf(e.target.value) }))} placeholder="e.g. 10" style={inputStyle} />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, padding: "11px 13px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-2)", border: `1px solid ${budget.allowPayments ? "color-mix(in srgb, var(--jv-amber) 45%, transparent)" : "var(--jv-border-soft)"}` }}>
              <Icon name="wallet" size={16} color={budget.allowPayments ? "var(--jv-amber)" : "var(--jv-text-muted)"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>Allow payments</div>
                <div style={{ font: "var(--fw-regular) 10.5px var(--font-body)", color: budget.allowPayments ? "var(--jv-amber)" : "var(--jv-text-faint)", marginTop: 2 }}>
                  {budget.allowPayments ? "Caution: this agent can move money (Stripe / back office)." : "Off — this agent cannot move money."}
                </div>
              </div>
              <Switch checked={budget.allowPayments} onChange={(v) => setBudget((b) => ({ ...b, allowPayments: v }))} />
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ font: "var(--fw-regular) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Notes</div>
              <textarea value={budget.notes ?? ""} onChange={(e) => setBudget((b) => ({ ...b, notes: e.target.value }))} placeholder="Free-text authority summary…" style={{ ...areaStyle, height: 60 }} />
            </div>
          </Field>

          <Field label="Review">
            <div style={{ padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-cyan)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
                  <Icon name={icon} size={17} />
                </span>
                <div>
                  <div style={{ font: "var(--fw-bold) 14px var(--font-body)", color: "var(--jv-text)" }}>{name || "Unnamed agent"}</div>
                  <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>{role || "—"}</div>
                </div>
              </div>
              {[
                ["Overview", overview.trim() ? overview.trim() : "—"],
                ["Playbook", playbook ? `${playbook.name} (${playbook.kind})` : "None"],
                ["Weekly tasks", String(weeklyTaskCount)],
                ["Calendar playbooks", String(calendarPlaybooks.length)],
                ["Granted permissions", `${grantedCount} of ${permissions.length}`],
                ["Connections", `${liveCount} live · ${pendingCount} pending`],
                ["Budget", budget.monthlyCap != null ? `${budget.currency} ${budget.monthlyCap}/mo${budget.allowPayments ? " · payments on" : ""}` : "No cap set"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 12, padding: "6px 0", borderTop: "1px solid var(--jv-hairline)" }}>
                  <span style={{ flex: "0 0 150px", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>{k}</span>
                  <span style={{ flex: 1, minWidth: 0, font: "var(--fw-regular) 12px/1.5 var(--font-body)", color: "var(--jv-text-soft)" }}>{v}</span>
                </div>
              ))}
            </div>
          </Field>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--jv-hairline)" }}>
        <div>
          {step === 0 && onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : step > 0 ? (
            <Button variant="ghost" icon={<Icon name="chevron-left" size={14} />} onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {step < STEP_TITLES.length - 1 ? (
            <Button variant="primary" iconRight={<Icon name="chevron-right" size={14} />} disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              Next
            </Button>
          ) : (
            <Button variant="primary" icon={<Icon name="rocket" size={14} />} disabled={!step1Valid} onClick={submit}>
              {submitLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
