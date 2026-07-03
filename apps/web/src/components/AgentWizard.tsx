import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Button, Icon, Switch } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type {
  AiProvider,
  NewAgent,
  AgentPermission,
  BudgetConfig,
  ConnectionCatalogItem,
  BuildTrack,
  CloneSource,
  AgentGoal,
  EvidenceItem,
  EvidenceExample,
  Onboarding,
  Manager,
  AccessStatus,
  DiscoverResult,
  DiscoverProfile,
} from "@jarvis/shared";

// ============================================================
// AgentWizard — a SINGLE unified "Hire an Agent" flow. Drop-in for AgentForm:
// exposes the SAME props (submitLabel / onSubmit / onCancel / resetOnSubmit)
// so the Roster modal and Hire screen never change.
//
// The AI interview (BreathingDiscovery) is the DEFAULT, open entry point.
// Optional accelerators — a role template or a "clone an existing employee"
// toggle — seed the interview so it CONFIRMS what's known and only asks the
// company-specific gaps. The build track is INFERRED: "clone" when the clone
// toggle was used, else "scratch". onSubmit compiles one NewAgent (see submit()).
//
// Steps: 1 Define with AI · 2 Access & onboarding · 3 Examples (optional) ·
//        4 Guardrails & budget · 5 Review & deploy.
// ============================================================

interface FileUploadResult { id: string; url: string; mime: string; size: number }

// Company profile the AI researches to tailor its recommendations. Not exported
// from @jarvis/shared, so mirror the /api/company shape locally.
interface CompanyProfile {
  name: string;
  domain: string;
  industry: string;
  size: string;
  coreBusiness: string;
  notes?: string;
}

const ICON_CHOICES = ["bot", "code", "search", "database", "globe", "list-checks", "shield-check", "mail", "calendar", "pen-tool", "bar-chart-3", "terminal", "phone", "heart-handshake", "user-search", "life-buoy", "settings-2"];
const TOOL_CHOICES = ["web_search", "code_interpreter", "filesystem", "github", "memory.query", "calendar", "gmail", "whatsapp", "shell", "vision"];
const AUTONOMY_CHOICES = ["Ask before acting", "Act, then report", "Fully autonomous"];
const PERMISSION_LABELS = ["Read knowledge base", "Send messages", "Control browser", "Send email", "Execute tools", "Spend budget", "Make payments"];

// Single unified flow — the AI interview is the default, open entry point.
// The old Clone-vs-Scratch chooser and manual self-define form are gone; the
// build track is inferred (clone if the clone toggle was used, else scratch).
const WIZARD_STEPS = ["Define with AI", "Access & onboarding", "Examples", "Guardrails & budget", "Review & deploy"];

// What each connection teaches a clone (used to compile clone instructions).
const LEARNS: Record<string, string> = {
  calendar: "cadence & availability",
  email: "writing style & contacts",
  slack: "team tone",
  notetaker: "how they run calls",
  policies: "guardrails",
  crm: "pipeline & accounts",
  drive: "docs & references",
};

// ---- Role templates for the from-scratch track ----
interface RoleTemplate {
  key: string;
  label: string;
  icon: string;
  behaviors: { behavior: string; instruction: string }[];
  tools: string[];
  connections: string[];
}
const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "sales-dev",
    label: "Sales Development Rep",
    icon: "phone",
    behaviors: [
      { behavior: "Qualify an inbound lead", instruction: "Score fit, ask discovery Qs, decide next step" },
      { behavior: "Write a cold outreach email", instruction: "Personalized, short, clear CTA" },
      { behavior: "Book a demo", instruction: "Propose times, send an invite" },
      { behavior: "Handle a common objection", instruction: "Acknowledge, reframe, give evidence" },
    ],
    tools: ["web_search", "gmail", "calendar"],
    connections: ["email", "calendar", "crm"],
  },
  {
    key: "csm",
    label: "Customer Success Manager",
    icon: "heart-handshake",
    behaviors: [
      { behavior: "Answer a customer question", instruction: "Accurate, empathetic, on-brand" },
      { behavior: "Run a check-in / QBR", instruction: "Summarize usage, risks, next steps" },
      { behavior: "Flag churn risk", instruction: "Detect signals and escalate" },
    ],
    tools: ["web_search", "gmail", "memory.query"],
    connections: ["email", "slack", "crm", "notetaker"],
  },
  {
    key: "recruiter",
    label: "Recruiter",
    icon: "user-search",
    behaviors: [
      { behavior: "Screen a resume", instruction: "Match to role, score, shortlist" },
      { behavior: "Write candidate outreach", instruction: "Personalized, role-specific" },
      { behavior: "Schedule an interview", instruction: "Coordinate times, send invites" },
    ],
    tools: ["web_search", "gmail", "calendar"],
    connections: ["email", "calendar", "notetaker"],
  },
  {
    key: "support",
    label: "Support Agent",
    icon: "life-buoy",
    behaviors: [
      { behavior: "Answer a how-to question", instruction: "Cite docs, step-by-step" },
      { behavior: "Triage a bug report", instruction: "Reproduce, categorize, route" },
      { behavior: "Escalate to a human", instruction: "Know when and how" },
    ],
    tools: ["web_search", "memory.query"],
    connections: ["email", "slack"],
  },
  {
    key: "ops",
    label: "Operations",
    icon: "settings-2",
    behaviors: [
      { behavior: "Run a recurring report", instruction: "Pull data, summarize, distribute" },
      { behavior: "Reconcile data", instruction: "Compare sources, flag mismatches" },
    ],
    tools: ["web_search", "code_interpreter", "filesystem"],
    connections: ["drive", "slack"],
  },
  {
    key: "blank",
    label: "Blank — define your own",
    icon: "bot",
    behaviors: [],
    tools: ["web_search"],
    connections: [],
  },
];

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

// Goals editor: a list of {objective, metric} rows.
function GoalsEditor({ goals, setGoals }: { goals: AgentGoal[]; setGoals: (fn: (prev: AgentGoal[]) => AgentGoal[]) => void }) {
  const [objective, setObjective] = useState("");
  const [metric, setMetric] = useState("");
  const add = () => {
    const o = objective.trim();
    if (!o) return;
    setGoals((prev) => [...prev, { objective: o, metric: metric.trim() || undefined }]);
    setObjective("");
    setMetric("");
  };
  return (
    <div>
      {goals.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {goals.map((g, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <Icon name="target" size={15} color="var(--jv-cyan)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{g.objective}</div>
                {g.metric && <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 1 }}>Metric: {g.metric}</div>}
              </div>
              <button onClick={() => setGoals((prev) => prev.filter((_, j) => j !== i))} title="Remove" style={{ background: "none", border: "none", color: "var(--jv-text-faint)", cursor: "pointer", display: "grid", placeItems: "center" }}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr auto", gap: 8, alignItems: "center" }}>
        <input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Objective — e.g. Book 20 demos / month" style={{ ...inputStyle, height: 34 }} />
        <input value={metric} onChange={(e) => setMetric(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} placeholder="Metric (optional)" style={{ ...inputStyle, height: 34 }} />
        <Button variant="ghost" size="sm" icon={<Icon name="plus" size={13} />} disabled={!objective.trim()} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

// Compact reusable budget form (both tracks). Mirrors the original step-5 grid.
function BudgetForm({ budget, setBudget }: { budget: BudgetConfig; setBudget: (fn: (prev: BudgetConfig) => BudgetConfig) => void }) {
  const numOf = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));
  const cell = (label: string, node: React.ReactNode) => (
    <div>
      <div style={{ font: "var(--fw-regular) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>{label}</div>
      {node}
    </div>
  );
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {cell("Currency", <input value={budget.currency} onChange={(e) => setBudget((b) => ({ ...b, currency: e.target.value }))} style={inputStyle} />)}
        {cell("Monthly cap", <input type="number" value={budget.monthlyCap ?? ""} onChange={(e) => setBudget((b) => ({ ...b, monthlyCap: numOf(e.target.value) }))} placeholder="e.g. 500" style={inputStyle} />)}
        {cell("Per-action limit", <input type="number" value={budget.perActionLimit ?? ""} onChange={(e) => setBudget((b) => ({ ...b, perActionLimit: numOf(e.target.value) }))} placeholder="e.g. 50" style={inputStyle} />)}
        {cell("Approval threshold", <input type="number" value={budget.approvalThreshold ?? ""} onChange={(e) => setBudget((b) => ({ ...b, approvalThreshold: numOf(e.target.value) }))} placeholder="e.g. 100" style={inputStyle} />)}
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
    </div>
  );
}

// Downscale an image File to a webp dataURL (max 1600px). Non-images pass through
// as their raw dataURL. Used by the evidence screenshot uploader.
function fileToDataUrl(file: File): Promise<{ dataUrl: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      if (!file.type.startsWith("image/")) {
        resolve({ dataUrl: raw, mime: file.type || "application/octet-stream" });
        return;
      }
      const img = new Image();
      img.onerror = () => resolve({ dataUrl: raw, mime: file.type });
      img.onload = () => {
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve({ dataUrl: raw, mime: file.type });
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve({ dataUrl: canvas.toDataURL("image/webp", 0.85), mime: "image/webp" });
        } catch {
          resolve({ dataUrl: raw, mime: file.type });
        }
      };
      img.src = raw;
    };
    reader.readAsDataURL(file);
  });
}

// ============================================================
// BreathingDiscovery — the "breathing artifact". A living AI discovery
// interview that grows a DiscoverProfile one question at a time. A pulsing
// core shows Understanding %; a side panel fills in with the forming access
// checklist, manager, meetings and goals as they're discovered.
// ============================================================
type DiscoverTurn = { role: "assistant" | "user"; content: string };

const ACCESS_TONE: Record<AccessStatus, { color: string; label: string }> = {
  needed: { color: "var(--jv-amber)", label: "Needed" },
  pending: { color: "var(--jv-cyan)", label: "Pending" },
  granted: { color: "var(--jv-green)", label: "Granted" },
};

function BreathingDiscovery({
  name,
  title,
  track,
  seed,
  companyName,
  onApply,
  onSkip,
}: {
  name: string;
  title: string;
  track: BuildTrack;
  // Optional synthetic first turn: when a template/clone accelerator is picked
  // we prime the transcript so the interviewer CONFIRMS what's known and only
  // asks the company-specific gaps — starting understanding higher.
  seed?: string;
  // The company the AI is tailoring to — used to label the rationale/recommendations.
  companyName?: string;
  onApply: (profile: DiscoverProfile) => void;
  onSkip: () => void;
}) {
  const [transcript, setTranscript] = useState<DiscoverTurn[]>([]);
  const [question, setQuestion] = useState<string>("");
  const [answer, setAnswer] = useState("");
  const [understanding, setUnderstanding] = useState(0);
  const [done, setDone] = useState(false);
  const [profile, setProfile] = useState<DiscoverProfile>({});
  const [summary, setSummary] = useState<string | undefined>(undefined);
  const [source, setSource] = useState<"ai" | "template" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  // User's per-item exclusions for the access checklist, keyed by item label.
  // Kept separate from `profile` so the periodic /discover refreshes (which
  // replace `profile`) never clobber the user's choices — we re-apply the
  // excluded set by label after each refresh. Default = every item included.
  const [excludedAccess, setExcludedAccess] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ask = async (nextTranscript: DiscoverTurn[]) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<DiscoverResult>("/api/agents/discover", {
        name: name.trim(),
        title: title.trim(),
        track,
        transcript: nextTranscript,
      });
      setUnderstanding(Math.max(0, Math.min(100, Math.round(r.understanding))));
      setDone(r.done);
      setQuestion(r.nextQuestion ?? "");
      setProfile(r.profile ?? {});
      setSummary(r.summary);
      setSource(r.source);
    } catch {
      setError("The interview stalled — try answering again, or skip to fill it in yourself.");
    } finally {
      setBusy(false);
    }
  };

  // On mount: kick off the interview. If a template/clone accelerator seeded a
  // starting point, prepend it as a synthetic first turn so understanding starts
  // higher and the interviewer only asks the company-specific gaps.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const initial: DiscoverTurn[] = seed?.trim() ? [{ role: "user", content: seed.trim() }] : [];
    if (initial.length) setTranscript(initial);
    void ask(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear the "Copied" confirmation timer on unmount.
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const send = () => {
    const a = answer.trim();
    if (!a || busy || !question) return;
    const next: DiscoverTurn[] = [
      ...transcript,
      { role: "assistant", content: question },
      { role: "user", content: a },
    ];
    setTranscript(next);
    setAnswer("");
    void ask(next);
  };

  const ready = done || understanding >= 80;
  const access = profile.access ?? [];
  const meetings = profile.meetings ?? [];
  const goalsList = profile.goals ?? [];
  const conns = profile.connections ?? [];
  const reportsTo = profile.reportsTo;

  const isIncluded = (label: string) => !excludedAccess.has(label);
  const toggleAccess = (label: string) =>
    setExcludedAccess((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  // The profile that flows out on "Build from this" — only the access items the
  // user kept selected. Everything else is passed through unchanged.
  const selectedProfile = (): DiscoverProfile => ({
    ...profile,
    access: access.filter((a) => isIncluded(a.item)),
  });

  // Copy the recommendation as clean, readable plain text.
  const buildCopyText = (): string => {
    const lines: string[] = [];
    lines.push(`Recommended setup${companyName ? ` for ${companyName}` : ""}`);
    lines.push("");
    if (profile.overview) {
      lines.push("ROLE");
      lines.push(profile.overview);
      lines.push("");
    }
    if (summary) {
      lines.push("WHY THIS FITS");
      lines.push(summary);
      lines.push("");
    }
    if (goalsList.length) {
      lines.push("GOALS");
      for (const g of goalsList) lines.push(`- ${g.objective}${g.metric ? ` (metric: ${g.metric})` : ""}`);
      lines.push("");
    }
    const selectedAccess = access.filter((a) => isIncluded(a.item));
    if (selectedAccess.length) {
      lines.push("ACCESS CHECKLIST");
      for (const a of selectedAccess) lines.push(`- ${a.item} [${ACCESS_TONE[a.status].label}]${a.note ? ` — ${a.note}` : ""}`);
      lines.push("");
    }
    if (conns.length) {
      lines.push("CONNECTIONS");
      lines.push(conns.join(", "));
      lines.push("");
    }
    if (meetings.length) {
      lines.push("MEETINGS");
      for (const m of meetings) lines.push(`- ${m.name}${m.cadence ? ` (${m.cadence})` : ""}`);
      lines.push("");
    }
    if (reportsTo?.name || reportsTo?.email) {
      lines.push("REPORTS TO");
      lines.push(`${reportsTo.name || ""}${reportsTo.name && reportsTo.email ? " · " : ""}${reportsTo.email || ""}`.trim());
      lines.push("");
    }
    return lines.join("\n").trim() + "\n";
  };

  const copyRecommendation = () => {
    void navigator.clipboard.writeText(buildCopyText()).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      /* clipboard blocked — stay quiet to match DS tone */
    });
  };

  // Concentric breathing core. Everything animates while alive; the busy state
  // ("thinking") speeds the pulse to feel like active reasoning.
  const alive = true;
  const pulseDur = busy ? "1.2s" : "2.6s";
  const breatheDur = busy ? "1.6s" : "3.2s";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
      {/* ---- Left: the breathing core + interview ---- */}
      <div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0 4px" }}>
          <div style={{ position: "relative", width: 168, height: 168, display: "grid", placeItems: "center" }}>
            {/* Outer breathing ring */}
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid var(--jv-border-cyan)", animation: alive ? `jv-glow-breathe ${breatheDur} var(--ease-out) infinite` : "none" }} />
            {/* Mid pulsing ring */}
            <span style={{ position: "absolute", inset: 22, borderRadius: "50%", border: "1px solid rgba(41,211,245,0.45)", animation: alive ? `jv-pulse ${pulseDur} var(--ease-out) infinite` : "none" }} />
            {/* Soft glow core that breathes */}
            <span style={{ position: "absolute", inset: 40, borderRadius: "50%", background: "radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--jv-cyan) 34%, transparent), transparent 72%)", boxShadow: "0 0 40px var(--jv-glow-cyan)", animation: alive ? `jv-pulse ${pulseDur} var(--ease-out) infinite` : "none" }} />
            {/* Progress arc — conic fill to understanding % */}
            <span style={{ position: "absolute", inset: 14, borderRadius: "50%", background: `conic-gradient(var(--jv-cyan) ${understanding * 3.6}deg, color-mix(in srgb, var(--jv-cyan) 8%, transparent) 0deg)`, WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px))", mask: "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px))", transition: "background var(--t)" }} />
            {/* Center readout */}
            <div style={{ position: "relative", textAlign: "center" }}>
              <div style={{ font: "var(--fw-bold) 40px var(--font-mono)", color: "var(--jv-text)", lineHeight: 1 }}>{understanding}<span style={{ font: "var(--fw-semibold) 16px var(--font-mono)", color: "var(--jv-cyan-300)" }}>%</span></div>
              <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: busy ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", marginTop: 4 }}>
                {busy ? "Thinking…" : "Understanding"}
              </div>
            </div>
          </div>
          <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 8 }}>
            {source === "ai" ? "Source: your AI Core model" : source === "template" ? "Source: template (connect a model in AI Core)" : "Source: —"}
          </div>
        </div>

        {/* Current question */}
        <div style={{ marginTop: 8, padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-cyan)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Icon name="sparkles" size={14} color="var(--jv-cyan)" />
            <span style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>Discovery interview</span>
          </div>
          <div style={{ font: "var(--fw-medium) 13.5px/1.5 var(--font-body)", color: "var(--jv-text)", minHeight: 20 }}>
            {busy && !question ? "Waking up — reading the room…" : question || (ready ? "That's enough to build from — apply below or keep going." : "…")}
          </div>
        </div>

        {/* Company-tailored rationale — the AI's "why this fits" recommendation */}
        {summary && (
          <div style={{ marginTop: 10, padding: "12px 14px", borderRadius: "var(--r-md)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <Icon name="sparkles" size={13} color="var(--jv-cyan)" />
              <span style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>
                {companyName ? `Recommended for ${companyName}` : "Why this fits"}
              </span>
            </div>
            <div style={{ font: "var(--fw-regular) 11.5px/1.55 var(--font-body)", color: "var(--jv-text-soft)" }}>{summary}</div>
          </div>
        )}

        {/* Answer box — multi-line. Enter sends; Shift+Enter inserts a newline. */}
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }}>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={3}
            placeholder={done ? "Add anything else…  (Enter to send, Shift+Enter for a new line)" : "Type your answer…  (Enter to send, Shift+Enter for a new line)"}
            disabled={busy && !question}
            style={{ ...areaStyle, minHeight: 74, resize: "vertical" }}
          />
          <Button variant="secondary" icon={<Icon name={busy ? "loader" : "send"} size={14} />} disabled={!answer.trim() || busy} onClick={send}>
            {busy ? "…" : "Send"}
          </Button>
        </div>
        {error && <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-amber)", marginTop: 8 }}>{error}</div>}

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
          <Button variant="primary" iconRight={<Icon name="arrow-right" size={14} />} disabled={!ready} onClick={() => onApply(selectedProfile())}>
            Build from this
          </Button>
          <Button variant="ghost" onClick={onSkip}>Skip — I'll fill it in</Button>
        </div>
      </div>

      {/* ---- Right: live "what I've learned" panel ---- */}
      <div style={{ padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Icon name="scan-line" size={14} color="var(--jv-cyan)" />
          <span style={{ flex: 1, minWidth: 0, font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>
            {companyName ? `Recommended setup for ${companyName}` : "Recommended setup"}
          </span>
          <button
            onClick={copyRecommendation}
            title="Copy recommendation as text"
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: "var(--r-pill)", cursor: "pointer", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: copied ? "var(--jv-green)" : "var(--jv-cyan-300)", background: "var(--jv-void)", border: `1px solid ${copied ? "color-mix(in srgb, var(--jv-green) 45%, transparent)" : "var(--jv-border-cyan)"}` }}
          >
            <Icon name={copied ? "check" : "copy"} size={12} color={copied ? "var(--jv-green)" : "var(--jv-cyan-300)"} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {profile.overview && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 5 }}>Role</div>
            <div style={{ font: "var(--fw-regular) 12px/1.5 var(--font-body)", color: "var(--jv-text-soft)" }}>{profile.overview}</div>
          </div>
        )}

        {/* Access checklist forming — each item is individually selectable.
            Excluded items dim/strike and are dropped from the applied profile. */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Access checklist</div>
          {access.length === 0 ? (
            <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>Discovering what they need access to…</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {access.map((a, i) => {
                const included = isIncluded(a.item);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", opacity: included ? 1 : 0.5 }}>
                    <button
                      onClick={() => toggleAccess(a.item)}
                      title={included ? "Included — click to exclude" : "Excluded — click to include"}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "grid", placeItems: "center" }}
                    >
                      <Icon name={included ? "check-square" : "square"} size={14} color={included ? "var(--jv-cyan)" : "var(--jv-text-faint)"} />
                    </button>
                    <Icon name="key-round" size={13} color={ACCESS_TONE[a.status].color} />
                    <span style={{ flex: 1, minWidth: 0, font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-soft)", textDecoration: included ? "none" : "line-through" }}>{a.item}</span>
                    <span style={{ padding: "1px 7px", borderRadius: "var(--r-pill)", font: "var(--fw-semibold) 8px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: ACCESS_TONE[a.status].color, border: `1px solid color-mix(in srgb, ${ACCESS_TONE[a.status].color} 40%, transparent)` }}>{ACCESS_TONE[a.status].label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Reports to */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Reports to</div>
          {reportsTo?.name || reportsTo?.email ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <Icon name="user-round" size={13} color="var(--jv-cyan)" />
              <span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-soft)" }}>{reportsTo.name || reportsTo.email}{reportsTo.name && reportsTo.email ? ` · ${reportsTo.email}` : ""}</span>
            </div>
          ) : (
            <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>Not yet known…</div>
          )}
        </div>

        {/* Meetings to join */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Meetings to join</div>
          {meetings.length === 0 ? (
            <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>None discovered yet…</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {meetings.map((m, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                  <Icon name="calendar" size={13} color="var(--jv-cyan)" />
                  <span style={{ flex: 1, minWidth: 0, font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-soft)" }}>{m.name}</span>
                  {m.cadence && <span style={{ font: "var(--fw-regular) 10.5px var(--font-body)", color: "var(--jv-text-faint)" }}>{m.cadence}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Goals */}
        <div style={{ marginBottom: goalsList.length || conns.length ? 14 : 0 }}>
          <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Goals</div>
          {goalsList.length === 0 ? (
            <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>Forming…</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {goalsList.map((g, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="target" size={13} color="var(--jv-cyan)" />
                  <span style={{ font: "var(--fw-regular) 12px/1.4 var(--font-body)", color: "var(--jv-text-soft)" }}>{g.objective}{g.metric ? ` — ${g.metric}` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Connections discovered */}
        {conns.length > 0 && (
          <div>
            <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Systems</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {conns.map((c) => (
                <span key={c} style={{ padding: "3px 9px", borderRadius: "var(--r-pill)", font: "var(--fw-medium) 11px var(--font-mono)", color: "var(--jv-cyan-300)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>{c}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Onboarding review editor (clone track) — access checklist, manager, meetings ----
function OnboardingEditor({ onboarding, setOnboarding }: { onboarding: Onboarding; setOnboarding: (fn: (prev: Onboarding) => Onboarding) => void }) {
  const access = onboarding.access ?? [];
  const meetings = onboarding.meetings ?? [];
  const manager: Manager = onboarding.reportsTo ?? {};
  const [accessDraft, setAccessDraft] = useState("");
  const [mtgName, setMtgName] = useState("");
  const [mtgCadence, setMtgCadence] = useState("");

  const STATUSES: AccessStatus[] = ["needed", "pending", "granted"];

  const addAccess = () => {
    const v = accessDraft.trim();
    if (!v) return;
    setOnboarding((o) => ({ ...o, access: [...(o.access ?? []), { item: v, status: "needed" }] }));
    setAccessDraft("");
  };
  const cycleStatus = (i: number) =>
    setOnboarding((o) => ({
      ...o,
      access: (o.access ?? []).map((a, j) => {
        if (j !== i) return a;
        const next = STATUSES[(STATUSES.indexOf(a.status) + 1) % STATUSES.length];
        return { ...a, status: next };
      }),
    }));
  const patchAccessNote = (i: number, note: string) =>
    setOnboarding((o) => ({ ...o, access: (o.access ?? []).map((a, j) => (j === i ? { ...a, note: note || undefined } : a)) }));
  const removeAccess = (i: number) =>
    setOnboarding((o) => ({ ...o, access: (o.access ?? []).filter((_, j) => j !== i) }));

  const addMeeting = () => {
    const n = mtgName.trim();
    if (!n) return;
    setOnboarding((o) => ({ ...o, meetings: [...(o.meetings ?? []), { name: n, cadence: mtgCadence.trim() || undefined }] }));
    setMtgName("");
    setMtgCadence("");
  };
  const removeMeeting = (i: number) =>
    setOnboarding((o) => ({ ...o, meetings: (o.meetings ?? []).filter((_, j) => j !== i) }));

  const setManager = (patch: Partial<Manager>) =>
    setOnboarding((o) => {
      const m = { ...(o.reportsTo ?? {}), ...patch };
      const empty = !m.name?.trim() && !m.email?.trim();
      return { ...o, reportsTo: empty ? undefined : m };
    });

  return (
    <div>
      <Field label="Access checklist" hint="What this clone needs on day one. Click a status pill to cycle needed → pending → granted.">
        {access.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {access.map((a, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <Icon name="key-round" size={14} color={ACCESS_TONE[a.status].color} />
                <span style={{ flex: "0 0 130px", font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)" }}>{a.item}</span>
                <input value={a.note ?? ""} onChange={(e) => patchAccessNote(i, e.target.value)} placeholder="Note (optional)" style={{ ...inputStyle, height: 30, flex: 1 }} />
                <button onClick={() => cycleStatus(i)} title="Cycle status" style={{ padding: "3px 9px", borderRadius: "var(--r-pill)", cursor: "pointer", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: ACCESS_TONE[a.status].color, background: "var(--jv-void)", border: `1px solid color-mix(in srgb, ${ACCESS_TONE[a.status].color} 45%, transparent)` }}>{ACCESS_TONE[a.status].label}</button>
                <button onClick={() => removeAccess(i)} title="Remove" style={{ background: "none", border: "none", color: "var(--jv-text-faint)", cursor: "pointer", display: "grid", placeItems: "center" }}><Icon name="x" size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input value={accessDraft} onChange={(e) => setAccessDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAccess())} placeholder="Add access item — e.g. Slack, Demo environment…" style={{ ...inputStyle, height: 34 }} />
          <Button variant="ghost" size="sm" icon={<Icon name="plus" size={13} />} disabled={!accessDraft.trim()} onClick={addAccess}>Add</Button>
        </div>
      </Field>

      <Field label="Reports to" hint="Which manager this agent reports to.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input value={manager.name ?? ""} onChange={(e) => setManager({ name: e.target.value })} placeholder="Manager name" style={inputStyle} />
          <input value={manager.email ?? ""} onChange={(e) => setManager({ email: e.target.value })} placeholder="Manager email" style={inputStyle} />
        </div>
      </Field>

      <Field label="Meetings to join" hint="Company meetings this agent should attend.">
        {meetings.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {meetings.map((m, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <Icon name="calendar" size={15} color="var(--jv-cyan)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{m.name}</div>
                  {m.cadence && <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 1 }}>{m.cadence}</div>}
                </div>
                <button onClick={() => removeMeeting(i)} title="Remove" style={{ background: "none", border: "none", color: "var(--jv-text-faint)", cursor: "pointer", display: "grid", placeItems: "center" }}><Icon name="x" size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr auto", gap: 8, alignItems: "center" }}>
          <input value={mtgName} onChange={(e) => setMtgName(e.target.value)} placeholder="Meeting — e.g. Monday standup" style={{ ...inputStyle, height: 34 }} />
          <input value={mtgCadence} onChange={(e) => setMtgCadence(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addMeeting())} placeholder="Cadence (optional)" style={{ ...inputStyle, height: 34 }} />
          <Button variant="ghost" size="sm" icon={<Icon name="plus" size={13} />} disabled={!mtgName.trim()} onClick={addMeeting}>Add</Button>
        </div>
      </Field>
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

  // ---- Company context — the AI researches this to tailor its recommendations ----
  const { data: companyData, reload: reloadCompany } = useApi<CompanyProfile>("/api/company");
  const company = companyData ?? undefined;
  const companyName = company?.name?.trim() || undefined;
  const [companyEditing, setCompanyEditing] = useState(false);
  const [companyForm, setCompanyForm] = useState<CompanyProfile>({ name: "", domain: "", industry: "", size: "", coreBusiness: "" });
  const [companySaving, setCompanySaving] = useState(false);

  const openCompanyEdit = () => {
    setCompanyForm({
      name: company?.name ?? "",
      domain: company?.domain ?? "",
      industry: company?.industry ?? "",
      size: company?.size ?? "",
      coreBusiness: company?.coreBusiness ?? "",
      notes: company?.notes,
    });
    setCompanyEditing(true);
  };
  const saveCompany = async () => {
    setCompanySaving(true);
    try {
      await api.put("/api/company", companyForm);
      reloadCompany();
      setCompanyEditing(false);
    } catch {
      /* keep the form open so the user can retry; DS stays quiet like siblings */
    } finally {
      setCompanySaving(false);
    }
  };

  // ---- Single unified flow ----
  // No chooser. The build track is inferred: "clone" once the clone toggle is
  // used, else "scratch" (the default).
  const [step, setStep] = useState(0);
  const stepTitles = WIZARD_STEPS;
  const [cloneMode, setCloneMode] = useState(false); // the "Clone an existing employee" toggle
  const track: BuildTrack = cloneMode ? "clone" : "scratch";

  // ---- Common identity ----
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [icon, setIcon] = useState("bot");
  const [model, setModel] = useState("");
  const [autonomy, setAutonomy] = useState(AUTONOMY_CHOICES[0]);
  const [overview, setOverview] = useState("");

  // ---- Common: goals / permissions / connections / tools / budget ----
  const [goals, setGoals] = useState<AgentGoal[]>([]);
  const [permissions, setPermissions] = useState<AgentPermission[]>(
    PERMISSION_LABELS.map((label) => ({ label, allowed: label === "Read knowledge base" })),
  );
  const [connections, setConnections] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>(["web_search"]);
  const [budget, setBudget] = useState<BudgetConfig>({ currency: "USD", allowPayments: false });

  // ---- Clone track ----
  const [clone, setClone] = useState<CloneSource>({});

  // ---- Onboarding (living artifact: manager, meetings, access checklist) ----
  const [onboarding, setOnboarding] = useState<Onboarding>({});

  // ---- Discovery ("breathing artifact") — the DEFAULT, open entry point ----
  // interviewStarted flips true once the user advances past the interview (via
  // "Build from this" or "Skip"), so we can re-show it on going Back.
  const [profileApplied, setProfileApplied] = useState(false);
  // A stable session key so remounting the interview only happens when the
  // starting point (template/clone) meaningfully changes.
  const [interviewSeq, setInterviewSeq] = useState(0);

  // ---- Template + evidence + stash (compiled instructions/plan/routine) ----
  const [templateKey, setTemplateKey] = useState<string>("");
  const [stashPlan, setStashPlan] = useState("");
  const [stashRoutine, setStashRoutine] = useState("");
  const [stashInstr, setStashInstr] = useState("");
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!model && activeModel) setModel(activeModel);
  }, [activeModel, model]);

  // ---- Template picker — seeds evidence behaviors + tools/connections + icon/role,
  // then re-primes the interview so it confirms what's known and asks the gaps. ----
  const pickTemplate = (t: RoleTemplate) => {
    // Selecting a template turns clone mode off (they're mutually-exclusive accelerators).
    setCloneMode(false);
    setTemplateKey(t.key);
    setIcon(t.icon);
    if (t.key !== "blank") setRole(t.label);
    // scratch: keep template-seeded evidence behaviors.
    setEvidence(t.behaviors.map((b) => ({ behavior: b.behavior, instruction: b.instruction, examples: [] })));
    // Pre-check recommended tools + connections.
    setTools((prev) => Array.from(new Set([...prev, ...t.tools])));
    setConnections((prev) => Array.from(new Set([...prev, ...t.connections])));
    // Re-run the interview from a higher starting point.
    setProfileApplied(false);
    setInterviewSeq((n) => n + 1);
  };

  // ---- Clone toggle — turns clone mode on/off; clearing it drops back to blank scratch ----
  const setClonePatch = (patch: Partial<CloneSource>) => {
    setClone((c) => ({ ...c, ...patch }));
  };
  const toggleCloneMode = (on: boolean) => {
    setCloneMode(on);
    if (on) {
      // Picking clone clears any template accelerator; keep the interview honest.
      setTemplateKey("");
      setEvidence([]);
    } else {
      setClone({});
    }
    setProfileApplied(false);
    setInterviewSeq((n) => n + 1);
  };

  // Build the synthetic first turn that primes the interview to CONFIRM the known
  // starting point and only ask the company-specific gaps. Empty when nothing picked.
  const buildSeed = (): string | undefined => {
    if (cloneMode) {
      const cn = clone.name?.trim();
      const ct = clone.title?.trim();
      if (!cn && !ct) return undefined;
      return `Starting point: cloning ${cn || "an existing employee"}${ct ? `, ${ct}` : ""}. Confirm these and ask only the company-specific gaps.`;
    }
    const t = ROLE_TEMPLATES.find((x) => x.key === templateKey);
    if (!t || t.key === "blank") return undefined;
    const responsibilities = t.behaviors.map((b) => b.behavior).join(", ");
    return `Starting point: ${t.label}. Typical responsibilities: ${responsibilities || "define from scratch"}. Confirm these and ask only the company-specific gaps.`;
  };

  // ---- Evidence editing (scratch B2) ----
  const addBehavior = () => setEvidence((prev) => [...prev, { behavior: "", instruction: "", examples: [] }]);
  const removeBehavior = (i: number) => setEvidence((prev) => prev.filter((_, j) => j !== i));
  const patchBehavior = (i: number, patch: Partial<EvidenceItem>) =>
    setEvidence((prev) => prev.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const addExample = (i: number, ex: EvidenceExample) =>
    setEvidence((prev) => prev.map((e, j) => (j === i ? { ...e, examples: [...e.examples, ex] } : e)));
  const removeExample = (i: number, k: number) =>
    setEvidence((prev) => prev.map((e, j) => (j === i ? { ...e, examples: e.examples.filter((_, x) => x !== k) } : e)));

  const uploadScreenshot = async (idx: number, file: File, caption: string) => {
    setUploadingIdx(idx);
    try {
      const { dataUrl, mime } = await fileToDataUrl(file);
      const res = await api.post<FileUploadResult>("/api/files", { filename: file.name, mime, dataBase64: dataUrl });
      addExample(idx, { kind: "screenshot", fileId: res.id, caption: caption.trim() || undefined });
    } catch {
      /* surfaced by the disabled state resetting; keep silent to match DS tone */
    } finally {
      setUploadingIdx(null);
    }
  };

  // Readiness = # behaviors with ≥1 example / # behaviors.
  const behaviorCount = evidence.length;
  const groundedCount = evidence.filter((e) => e.examples.length > 0).length;
  const readiness = behaviorCount === 0 ? 0 : Math.round((groundedCount / behaviorCount) * 100);

  // ---- Discovery → wizard-state mapping ----
  // Maps the interview profile onto wizard state, then advances into the
  // pre-filled remaining steps. Runs for both tracks; for scratch we KEEP any
  // template-seeded evidence (grounding is refined on the Examples step).
  const applyProfile = (profile: DiscoverProfile) => {
    if (profile.overview) setOverview(profile.overview);
    if (profile.goals?.length) setGoals(() => profile.goals ?? []);
    if (profile.connections?.length) setConnections((prev) => Array.from(new Set([...prev, ...(profile.connections ?? [])])));
    if (profile.tools?.length) setTools((prev) => Array.from(new Set([...prev, ...(profile.tools ?? [])])));
    setOnboarding((prev) => ({
      reportsTo: profile.reportsTo ?? prev.reportsTo,
      meetings: profile.meetings?.length ? profile.meetings : prev.meetings ?? [],
      access: profile.access?.length ? profile.access : prev.access ?? [],
    }));
    // Adopt the agent name from the interview overview if we still lack one
    // (scratch only — clone derives its name from cloneSource).
    if (!cloneMode && !name.trim() && profile.overview) {
      // Best-effort: use the first clause of the overview as a working name.
      const guess = profile.overview.split(/[—.:]/)[0]?.trim();
      if (guess && guess.length <= 48) setName(guess);
    }
    setProfileApplied(true);
    setStep(1); // advance into the pre-filled remainder (Access & onboarding)
  };

  // Advance with whatever's captured, without applying a completed profile.
  const skipInterview = () => {
    setProfileApplied(true);
    setStep(1);
  };

  // ---- helpers ----
  const toggleTool = (v: string) => setTools((arr) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]));
  const togglePermission = (label: string) => setPermissions((prev) => prev.map((p) => (p.label === label ? { ...p, allowed: !p.allowed } : p)));
  const toggleConnection = (id: string) => setConnections((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));

  const liveCount = connections.filter((id) => catalog.find((c) => c.id === id)?.live).length;
  const pendingCount = connections.length - liveCount;
  const grantedCount = permissions.filter((p) => p.allowed).length;

  // ---- name / validity ----
  // Deploy requires a name + role. Clone derives them from cloneSource; scratch
  // captures the name on the review step (or from the interview).
  const deployName = cloneMode
    ? (clone.name?.trim() ? `${clone.name.trim()} (AI clone)` : "")
    : name.trim();
  const deployRoleOk = cloneMode ? (clone.title?.trim() || role.trim()) : role.trim();
  const isValid = deployName !== "" && !!deployRoleOk;

  const reset = () => {
    setStep(0);
    setCloneMode(false);
    setName("");
    setRole("");
    setIcon("bot");
    setModel(activeModel);
    setAutonomy(AUTONOMY_CHOICES[0]);
    setOverview("");
    setGoals([]);
    setPermissions(PERMISSION_LABELS.map((label) => ({ label, allowed: label === "Read knowledge base" })));
    setConnections([]);
    setTools(["web_search"]);
    setBudget({ currency: "USD", allowPayments: false });
    setClone({});
    setOnboarding({});
    setProfileApplied(false);
    setTemplateKey("");
    setStashPlan("");
    setStashRoutine("");
    setStashInstr("");
    setEvidence([]);
    setUploadingIdx(null);
    setInterviewSeq((n) => n + 1);
  };

  // ---- submit: compile the flow into one NewAgent (track inferred) ----
  const submit = () => {
    if (!isValid) return;

    const budgetStr = budget.monthlyCap != null ? `${budget.currency} ${budget.monthlyCap}/mo` : undefined;

    let finalName = name.trim();
    let finalRole = role.trim();
    let finalOverview = overview.trim();
    let finalInstructions = "";
    let finalPlan = "";
    let finalRoutine = "";

    if (track === "clone") {
      const cn = (clone.name ?? "").trim();
      const ct = (clone.title ?? "").trim();
      // Identity derives from the cloned person.
      finalName = cn ? `${cn} (AI clone)` : "AI clone";
      finalRole = ct || finalRole || "Cloned employee";
      const connectedLabels = connections.map((id) => catalog.find((c) => c.id === id)?.label ?? id);
      const connectedList = connectedLabels.length ? connectedLabels.join(", ") : "their connected systems";
      finalOverview = `An AI clone of ${cn || "this employee"}${ct ? `, ${ct}` : ""}. Mirrors their systems: ${connectedList}.`;
      const learnLines = connections
        .map((id) => (LEARNS[id] ? `- ${catalog.find((c) => c.id === id)?.label ?? id}: learn ${LEARNS[id]}` : null))
        .filter((x): x is string => x != null);
      finalInstructions = [
        `You are an AI clone of ${cn || "this employee"}${ct ? `, who works as ${ct}` : ""}${clone.email ? ` (${clone.email.trim()})` : ""}.`,
        `Mirror how this person works. Learn from the systems they've connected and act in their voice, cadence and judgment.`,
        learnLines.length ? `From their connected systems:\n${learnLines.join("\n")}` : "",
        goals.length ? `Objectives:\n${goals.map((g) => `- ${g.objective}${g.metric ? ` (measured by: ${g.metric})` : ""}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");
      finalPlan = goals.length ? goals.map((g) => `• ${g.objective}${g.metric ? ` — ${g.metric}` : ""}`).join("\n") : finalOverview;
    } else {
      // scratch — compile a few-shot system prompt from the evidence.
      finalOverview = finalOverview || stashPlan.trim();
      const blocks = evidence
        .filter((e) => e.behavior.trim())
        .map((e) => {
          const parts: string[] = [`## ${e.behavior.trim()}`];
          if (e.instruction?.trim()) parts.push(e.instruction.trim());
          e.examples.forEach((ex) => {
            if (ex.kind === "text" && ex.text?.trim()) parts.push(`Good example:\n${ex.text.trim()}`);
            else if (ex.kind === "screenshot") parts.push(`Good example: [screenshot: ${ex.caption?.trim() || "reference"}]`);
          });
          if (e.antiExample?.trim()) parts.push(`Avoid: ${e.antiExample.trim()}`);
          return parts.join("\n");
        });
      const compiled = [
        finalRole ? `You are ${finalName}, a ${finalRole}.` : `You are ${finalName}.`,
        finalOverview,
        blocks.length ? `Follow these behaviors, grounded in concrete examples:\n\n${blocks.join("\n\n")}` : "",
        goals.length ? `Objectives:\n${goals.map((g) => `- ${g.objective}${g.metric ? ` (measured by: ${g.metric})` : ""}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");
      finalInstructions = compiled || stashInstr.trim();
      finalPlan = stashPlan.trim() || finalOverview;
      finalRoutine = stashRoutine.trim();
    }

    const agent: NewAgent = {
      icon,
      name: finalName || "Unnamed agent",
      role: finalRole || "—",
      model: model || undefined,
      tools,
      collaborators: [],
      autonomy,
      connections,
      permissions,
      budgetConfig: budget,
      goals: goals.length ? goals : undefined,
      buildTrack: track,
      cloneSource: track === "clone" ? clone : undefined,
      onboarding: (onboarding.reportsTo || onboarding.meetings?.length || onboarding.access?.length) ? onboarding : undefined,
      evidence: track === "scratch" && evidence.length ? evidence : undefined,
      overview: finalOverview || undefined,
      instructions: finalInstructions || undefined,
      plan: finalPlan || undefined,
      routine: finalRoutine || undefined,
      budget: budgetStr,
    };
    onSubmit(agent);
    if (resetOnSubmit) reset();
  };

  // ============================================================
  // RENDER — single unified flow. The AI interview is step 1 (default + open).
  // ============================================================
  return (
    <div>
      {/* Progress header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          {stepTitles.map((_, i) => (
            <button
              key={i}
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              title={stepTitles[i]}
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
          <div style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)" }}>{stepTitles[step]}</div>
          <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>
            {cloneMode ? "Clone" : "From scratch"} · Step {step + 1} of {stepTitles.length}
          </div>
        </div>
      </div>

      {/* ================= STEP 1 · DEFINE WITH AI ================= */}
      {step === 0 && (
        <div>
          <p style={{ margin: "0 0 14px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>
            Let the AI interview you — it's already running below. It forms the access checklist, manager, meetings and goals as you answer, then pre-fills the rest. Optionally start from a template or clone an existing employee to jump ahead.
          </p>

          {/* Company context banner — the AI researches this company to tailor its setup */}
          <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-cyan)" }}>
            {!companyEditing ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", flex: "0 0 auto" }}>
                  <Icon name="building-2" size={17} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "var(--fw-bold) 13px var(--font-body)", color: "var(--jv-text)" }}>Tailoring to {companyName ?? "your company"}</div>
                  <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 1 }}>
                    {[company?.industry?.trim(), company?.size?.trim()].filter(Boolean).join(" · ") || "Set your company so the AI can research it"}
                  </div>
                  <div style={{ font: "var(--fw-regular) 10.5px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 3 }}>
                    The AI researches this company — its website and business — to recommend a company-tailored setup below.
                  </div>
                </div>
                <Button variant="ghost" size="sm" icon={<Icon name="pencil" size={13} />} onClick={openCompanyEdit}>Edit</Button>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <Icon name="building-2" size={14} color="var(--jv-cyan)" />
                  <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>Company context</span>
                  <span style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>the AI researches this to tailor recommendations</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <input value={companyForm.name} onChange={(e) => setCompanyForm((f) => ({ ...f, name: e.target.value }))} placeholder="Company name" style={inputStyle} />
                  <input value={companyForm.domain} onChange={(e) => setCompanyForm((f) => ({ ...f, domain: e.target.value }))} placeholder="Domain — e.g. goperfectmatch.com" style={inputStyle} />
                  <input value={companyForm.industry} onChange={(e) => setCompanyForm((f) => ({ ...f, industry: e.target.value }))} placeholder="Industry" style={inputStyle} />
                  <input value={companyForm.size} onChange={(e) => setCompanyForm((f) => ({ ...f, size: e.target.value }))} placeholder="Size — e.g. 11–50" style={inputStyle} />
                </div>
                <textarea value={companyForm.coreBusiness} onChange={(e) => setCompanyForm((f) => ({ ...f, coreBusiness: e.target.value }))} placeholder="Core business — what the company does" style={{ ...areaStyle, marginBottom: 10 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="primary" size="sm" icon={<Icon name={companySaving ? "loader" : "check"} size={13} />} disabled={companySaving || !companyForm.name.trim()} onClick={saveCompany}>
                    {companySaving ? "Saving…" : "Save"}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={companySaving} onClick={() => setCompanyEditing(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          {/* Start from… — optional accelerators */}
          <div style={{ marginBottom: 16, padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Icon name="rocket" size={14} color="var(--jv-cyan)" />
              <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>Start from…</span>
              <span style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>optional — the interview runs either way</span>
            </div>

            {/* Template chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, opacity: cloneMode ? 0.5 : 1, pointerEvents: cloneMode ? "none" : "auto" }}>
              {ROLE_TEMPLATES.map((t) => {
                const on = !cloneMode && templateKey === t.key;
                return (
                  <button key={t.key} onClick={() => pickTemplate(t)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: "var(--r-pill)", cursor: "pointer", background: on ? "var(--grad-cyan-soft)" : "var(--jv-void)", border: `1px solid ${on ? "var(--jv-border-cyan)" : "var(--jv-border)"}` }}>
                    <Icon name={t.icon} size={14} color={on ? "var(--jv-cyan)" : "var(--jv-text-muted)"} />
                    <span style={{ font: `${on ? "var(--fw-semibold)" : "var(--fw-medium)"} 12px var(--font-body)`, color: on ? "var(--jv-cyan-300)" : "var(--jv-text-soft)" }}>{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Clone toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: `1px solid ${cloneMode ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}` }}>
              <Icon name="user-round" size={15} color={cloneMode ? "var(--jv-cyan)" : "var(--jv-text-muted)"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>Clone an existing employee</div>
                <div style={{ font: "var(--fw-regular) 10.5px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 1 }}>Mirror a real person — the agent takes their name, role and systems.</div>
              </div>
              <Switch checked={cloneMode} onChange={toggleCloneMode} />
            </div>

            {cloneMode && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
                <input value={clone.name ?? ""} onChange={(e) => setClonePatch({ name: e.target.value })} placeholder="Full name — e.g. Dana Rivera" style={inputStyle} />
                <input value={clone.title ?? ""} onChange={(e) => { const v = e.target.value; setClonePatch({ title: v }); if (!role.trim()) setRole(v); }} placeholder="Title — e.g. Senior AE" style={inputStyle} />
                <input value={clone.email ?? ""} onChange={(e) => setClonePatch({ email: e.target.value })} placeholder="Work email" style={inputStyle} />
              </div>
            )}
          </div>

          {/* The breathing interview — DEFAULT, always mounted/open */}
          <BreathingDiscovery
            key={`iv-${interviewSeq}`}
            name={cloneMode ? (clone.name?.trim() || "") : (name.trim() || role.trim())}
            title={cloneMode ? (clone.title?.trim() || role.trim()) : role.trim()}
            track={track}
            seed={buildSeed()}
            companyName={companyName}
            onApply={applyProfile}
            onSkip={skipInterview}
          />
        </div>
      )}

      {/* ================= STEP 2 · ACCESS & ONBOARDING ================= */}
      {step === 1 && (
        <div>
          <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>
            Pre-filled from the interview — refine as needed. Connect the systems this agent should reach, then set who they report to, the access checklist and which meetings to join.
          </p>

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
                          <span style={{ padding: "2px 8px", borderRadius: "var(--r-pill)", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: c.live ? "var(--jv-green)" : "var(--jv-text-muted)", background: c.live ? "color-mix(in srgb, var(--jv-green) 14%, transparent)" : "var(--jv-void)", border: `1px solid ${c.live ? "color-mix(in srgb, var(--jv-green) 40%, transparent)" : "var(--jv-border-soft)"}` }}>
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

          <div style={{ marginTop: 4 }}>
            <OnboardingEditor onboarding={onboarding} setOnboarding={setOnboarding} />
          </div>
        </div>
      )}

      {/* ================= STEP 3 · EXAMPLES (optional grounding) ================= */}
      {step === 2 && (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "0 0 6px" }}>
            <span style={{ font: "var(--fw-bold) 13px var(--font-body)", color: "var(--jv-text)" }}>Strengthen with examples</span>
            <span style={{ padding: "1px 8px", borderRadius: "var(--r-pill)", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-text-muted)", border: "1px solid var(--jv-border-soft)" }}>Optional</span>
          </div>
          <p style={{ margin: "0 0 14px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>
            Ground each behavior with good examples (a screenshot or text) and, optionally, what to avoid. This sharpens the agent — you can skip it and deploy without any.
          </p>

          {/* Readiness score */}
          <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>Readiness score</span>
              <span style={{ font: "var(--fw-bold) 13px var(--font-mono)", color: readiness >= 60 ? "var(--jv-green)" : "var(--jv-amber)" }}>{readiness}%</span>
            </div>
            <div style={{ height: 8, borderRadius: "var(--r-pill)", background: "var(--jv-void)", overflow: "hidden", border: "1px solid var(--jv-border-soft)" }}>
              <div style={{ width: `${readiness}%`, height: "100%", background: readiness >= 60 ? "var(--jv-green)" : "var(--grad-cyan)", transition: "width var(--t)" }} />
            </div>
            <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 6 }}>
              {behaviorCount === 0
                ? "No behaviors yet — add one to teach by example, or skip this step."
                : `${groundedCount} of ${behaviorCount} behaviors have at least one example.${readiness < 60 ? " Add more for a sharper agent — you can still deploy." : ""}`}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {evidence.map((e, i) => (
              <EvidenceCard
                key={i}
                idx={i}
                item={e}
                uploading={uploadingIdx === i}
                fileRef={(el) => { fileRefs.current[i] = el; }}
                onPickFile={() => fileRefs.current[i]?.click()}
                onPatch={(patch) => patchBehavior(i, patch)}
                onAddExample={(ex) => addExample(i, ex)}
                onRemoveExample={(k) => removeExample(i, k)}
                onRemove={() => removeBehavior(i)}
                onUpload={(file, caption) => uploadScreenshot(i, file, caption)}
              />
            ))}
            <Button variant="ghost" size="sm" icon={<Icon name="plus" size={13} />} onClick={addBehavior}>Add behavior</Button>
          </div>
        </div>
      )}

      {/* ================= STEP 4 · GUARDRAILS & BUDGET ================= */}
      {step === 3 && (
        <div>
          <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>
            Set the operating guardrails. Sensible defaults are applied — grant only the permissions this agent needs and cap what it may spend.
          </p>

          <Field label="Permissions" hint="What this agent is allowed to do. Denied by default — grant only what it needs.">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {permissions.map((p) => (
                <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                  <Icon name="shield-check" size={15} color={p.allowed ? "var(--jv-green)" : "var(--jv-text-faint)"} />
                  <span style={{ flex: 1, font: "var(--fw-medium) 12.5px var(--font-body)", color: "var(--jv-text-soft)" }}>{p.label}</span>
                  <span style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: p.allowed ? "var(--jv-green)" : "var(--jv-text-faint)" }}>{p.allowed ? "Allowed" : "Denied"}</span>
                  <Switch checked={p.allowed} onChange={() => togglePermission(p.label)} />
                </div>
              ))}
            </div>
          </Field>

          <Field label="Budget & authority" hint="Hard limits on what this agent may spend and do.">
            <BudgetForm budget={budget} setBudget={setBudget} />
          </Field>

          {/* Operational settings — model + autonomy (defaults applied, edit if needed) */}
          <Field label="Reasoning model" hint="Defaults to your active AI Core provider. Comes from the providers you connected.">
            {models.length ? (
              <select value={model} onChange={(e) => setModel(e.target.value)} style={{ ...inputStyle, appearance: "none", cursor: "pointer", maxWidth: 360 }}>
                {models.map((m) => {
                  const p = providers.find((pr) => pr.model === m);
                  return <option key={m} value={m}>{m}{p ? ` · ${p.name}` : ""}{p?.active ? " (active)" : ""}</option>;
                })}
              </select>
            ) : (
              <div style={{ ...inputStyle, maxWidth: 360, display: "flex", alignItems: "center", gap: 7, color: "var(--jv-text-muted)", font: "var(--fw-regular) 12px var(--font-body)" }}>
                <Icon name="plug" size={13} /> No model connected — add one in AI Core
              </div>
            )}
          </Field>

          <Field label="Autonomy" hint="How much this agent may do on its own. Defaults to Ask before acting.">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {AUTONOMY_CHOICES.map((a) => (
                <Chip key={a} active={autonomy === a} onClick={() => setAutonomy(a)}>{a}</Chip>
              ))}
            </div>
          </Field>
        </div>
      )}

      {/* ================= STEP 5 · REVIEW & DEPLOY ================= */}
      {step === 4 && (
        <div>
          {!cloneMode && (
            <Field label="Agent name" hint="Give this teammate a name — required before you can deploy.">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Finance Agent" style={inputStyle} />
                <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role — e.g. Tracks spend & budgets" style={inputStyle} />
              </div>
            </Field>
          )}

          <Field label="Review & deploy">
            <div style={{ padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-cyan)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
                  <Icon name={icon} size={17} />
                </span>
                <div>
                  <div style={{ font: "var(--fw-bold) 14px var(--font-body)", color: "var(--jv-text)" }}>{deployName || "Unnamed agent"}</div>
                  <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>{(cloneMode ? clone.title?.trim() : role.trim()) || role || "—"}</div>
                </div>
              </div>
              {[
                cloneMode
                  ? ["Cloning", clone.name?.trim() ? `${clone.name.trim()}${clone.email?.trim() ? ` · ${clone.email.trim()}` : ""}` : "—"]
                  : ["Template", ROLE_TEMPLATES.find((t) => t.key === templateKey)?.label ?? "—"],
                ["Overview", overview.trim() ? overview.trim() : "—"],
                ["Connected systems", `${liveCount} live · ${pendingCount} pending`],
                ["Reports to", onboarding.reportsTo?.name || onboarding.reportsTo?.email || "—"],
                ["Access checklist", onboarding.access?.length ? `${onboarding.access.length} item${onboarding.access.length === 1 ? "" : "s"}` : "—"],
                ["Meetings to join", onboarding.meetings?.length ? String(onboarding.meetings.length) : "—"],
                ["Readiness", cloneMode ? "—" : `${readiness}% · ${groundedCount}/${behaviorCount || 0} behaviors grounded`],
                ["Goals", goals.length ? goals.map((g) => g.objective).join("; ") : "—"],
                ["Granted permissions", `${grantedCount} of ${permissions.length}`],
                ["Budget", budget.monthlyCap != null ? `${budget.currency} ${budget.monthlyCap}/mo${budget.allowPayments ? " · payments on" : ""}` : "No cap set"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 12, padding: "6px 0", borderTop: "1px solid var(--jv-hairline)" }}>
                  <span style={{ flex: "0 0 150px", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>{k}</span>
                  <span style={{ flex: 1, minWidth: 0, font: "var(--fw-regular) 12px/1.5 var(--font-body)", color: "var(--jv-text-soft)" }}>{v}</span>
                </div>
              ))}
            </div>
            {!isValid && (
              <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-amber)", marginTop: 8 }}>
                {cloneMode ? "Add the employee's name to deploy." : "Add a name and role to deploy."}
              </div>
            )}
          </Field>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--jv-hairline)" }}>
        <div>
          {step === 0 ? (
            onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          ) : (
            <Button variant="ghost" icon={<Icon name="chevron-left" size={14} />} onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {step === 0 ? (
            // The interview drives step 1 via its own "Build from this" / "Skip"
            // controls; expose a plain Continue too for when it's already applied.
            <Button variant="secondary" iconRight={<Icon name="chevron-right" size={14} />} onClick={skipInterview}>
              {profileApplied ? "Continue" : "Skip interview"}
            </Button>
          ) : step < stepTitles.length - 1 ? (
            <Button variant="primary" iconRight={<Icon name="chevron-right" size={14} />} onClick={() => setStep((s) => s + 1)}>
              Next
            </Button>
          ) : (
            <Button variant="primary" icon={<Icon name="rocket" size={14} />} disabled={!isValid} onClick={submit}>
              {submitLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Evidence card (scratch B2) — one behavior + its examples ----
function EvidenceCard({
  idx,
  item,
  uploading,
  fileRef,
  onPickFile,
  onPatch,
  onAddExample,
  onRemoveExample,
  onRemove,
  onUpload,
}: {
  idx: number;
  item: EvidenceItem;
  uploading: boolean;
  fileRef: (el: HTMLInputElement | null) => void;
  onPickFile: () => void;
  onPatch: (patch: Partial<EvidenceItem>) => void;
  onAddExample: (ex: EvidenceExample) => void;
  onRemoveExample: (k: number) => void;
  onRemove: () => void;
  onUpload: (file: File, caption: string) => void;
}) {
  const [caption, setCaption] = useState("");
  const [text, setText] = useState("");
  const addText = () => {
    const v = text.trim();
    if (!v) return;
    onAddExample({ kind: "text", text: v });
    setText("");
  };
  return (
    <div style={{ padding: "14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-2)", border: `1px solid ${item.examples.length ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ font: "var(--fw-bold) 12px var(--font-mono)", color: "var(--jv-cyan)" }}>#{idx + 1}</span>
        <input value={item.behavior} onChange={(e) => onPatch({ behavior: e.target.value })} placeholder="Behavior — e.g. Qualify an inbound lead" style={{ ...inputStyle, height: 34 }} />
        <button onClick={onRemove} title="Remove behavior" style={{ background: "none", border: "none", color: "var(--jv-text-faint)", cursor: "pointer", display: "grid", placeItems: "center" }}><Icon name="x" size={15} /></button>
      </div>

      <Field label="Instruction">
        <textarea value={item.instruction ?? ""} onChange={(e) => onPatch({ instruction: e.target.value })} placeholder="How to do this well…" style={{ ...areaStyle, height: 56 }} />
      </Field>

      <Field label={`Good examples · ${item.examples.length}`}>
        {item.examples.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {item.examples.map((ex, k) => (
              <div key={k} style={{ position: "relative", width: ex.kind === "screenshot" ? 110 : 200, padding: ex.kind === "text" ? "8px 10px" : 0, borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", overflow: "hidden" }}>
                {ex.kind === "screenshot" && ex.fileId ? (
                  <>
                    <img src={`/api/files/${ex.fileId}`} alt={ex.caption ?? "screenshot"} style={{ width: "100%", height: 72, objectFit: "cover", display: "block" }} />
                    {ex.caption && <div style={{ padding: "4px 6px", font: "var(--fw-regular) 10px var(--font-body)", color: "var(--jv-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ex.caption}</div>}
                  </>
                ) : (
                  <div style={{ font: "var(--fw-regular) 11px/1.4 var(--font-body)", color: "var(--jv-text-soft)", maxHeight: 72, overflow: "hidden" }}>{ex.text}</div>
                )}
                <button onClick={() => onRemoveExample(k)} title="Remove" style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", color: "var(--jv-text-muted)", cursor: "pointer" }}><Icon name="x" size={12} /></button>
              </div>
            ))}
          </div>
        )}

        {/* Add text example */}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addText())} placeholder="Add a text example…" style={{ ...inputStyle, height: 34 }} />
          <Button variant="ghost" size="sm" icon={<Icon name="plus" size={13} />} disabled={!text.trim()} onClick={addText}>Text</Button>
        </div>

        {/* Add screenshot example */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Screenshot caption (optional)" style={{ ...inputStyle, height: 34 }} />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { onUpload(f, caption); setCaption(""); }
              e.target.value = "";
            }}
          />
          <Button variant="secondary" size="sm" icon={<Icon name={uploading ? "loader" : "image"} size={13} />} disabled={uploading} onClick={onPickFile}>
            {uploading ? "Uploading…" : "Screenshot"}
          </Button>
        </div>
      </Field>

      <Field label="Anti-example (optional)">
        <input value={item.antiExample ?? ""} onChange={(e) => onPatch({ antiExample: e.target.value })} placeholder="What NOT to do…" style={{ ...inputStyle, height: 34 }} />
      </Field>
    </div>
  );
}
