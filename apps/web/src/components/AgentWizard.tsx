import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Button, Icon, Switch } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import { CloneFromCallsStep } from "./CloneFromCalls";
import { roleCategoryOf } from "@jarvis/shared";
import { useVoiceOutput } from "../hooks/useSpeech";
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
  EvidenceRequest,
  EvidenceAssetType,
  Onboarding,
  Manager,
  AccessStatus,
  DiscoverResult,
  DiscoverProfile,
  AutonomyTier,
  DutyCycle,
  AgentIdentity,
  EscalationConfig,
  ReviewCadence,
  Person,
  DisclosurePolicy,
  AgentKpi,
  Apprenticeship,
  Grant,
  RuntimeCapabilities,
  CallSource,
  CallPlaybook,
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

// Trust is a tier, not a pile of toggles — you promote an agent through these the
// way a new hire earns autonomy. Permissions are DERIVED from the chosen tier;
// the raw toggles become an advanced override.
const TRUST_TIERS: { tier: AutonomyTier; name: string; tagline: string; detail: string; autonomy: string }[] = [
  { tier: 1, name: "Shadow", tagline: "Observes & drafts. Sends nothing.", detail: "Reads everything it's granted and prepares drafts for review — but delivers nothing on its own. Like reading support threads before you take them.", autonomy: "Ask before acting" },
  { tier: 2, name: "Supervised", tagline: "Acts, but every outbound needs approval.", detail: "Can write and send, but each email, message, or update waits in its manager's approval queue. Nothing leaves without a yes.", autonomy: "Act, then report" },
  { tier: 3, name: "Autonomous", tagline: "Acts freely within scope.", detail: "Works on its own inside its grants. Irreversible actions (delete, refund, send contract) still verify before committing.", autonomy: "Fully autonomous" },
];

// Duty cycle drives cost + whether the agent gets a "body": front-stage wires to
// the real E2B workstation + live-call voice runtime.
const DUTY_CYCLES: { key: DutyCycle; name: string; cost: string; detail: string }[] = [
  { key: "backstage", name: "Backstage only", cost: "$", detail: "No calls. Runs on API workers only — email, CRM, docs, back-office." },
  { key: "balanced", name: "Balanced", cost: "$$", detail: "Calls plus back office — the everyday hybrid." },
  { key: "frontstage", name: "Front-stage heavy", cost: "$$$", detail: "Joins calls & demos — provisions a live computer (VM body) + realtime voice." },
];

// Review cadence — a new hire is watched closely, then trusted. Default mirrors
// a real probation: daily for the first two weeks, then weekly.
const REVIEW_CADENCES: { key: ReviewCadence; name: string; detail: string }[] = [
  { key: "daily_2w_then_weekly", name: "Daily for 2 weeks, then weekly", detail: "Close supervision through probation, then ease off — the default for a new unit." },
  { key: "weekly", name: "Weekly", detail: "A standing weekly review of the agent's work." },
  { key: "biweekly", name: "Every two weeks", detail: "Lighter-touch check-ins for an agent you already trust." },
];

// Rules of engagement — the moments an agent must stop and hand off to a human.
const ESCALATION_TRIGGERS: { key: keyof EscalationConfig; label: string; hint: string }[] = [
  { key: "discountOrContract", label: "Discounts or contracts", hint: "Anything touching price or a signed agreement" },
  { key: "churnOrLegalRisk", label: "Churn or legal risk", hint: "A customer at risk, or anything legal" },
  { key: "askedIfAI", label: "Asked if it's an AI", hint: "Someone asks directly whether they're talking to a bot" },
  { key: "irreversibleAction", label: "Irreversible actions", hint: "Deletes, refunds, sends that can't be undone" },
  { key: "sentimentDrop", label: "Sentiment drops", hint: "The person gets frustrated or upset" },
  { key: "lowConfidence", label: "Low confidence", hint: "The agent isn't sure it's right" },
];

// Departments a unit can belong to (spec Step 1). Free-text is allowed too.
const DEPARTMENTS = ["CS", "Sales", "R&D", "Support", "Ops", "Marketing", "Finance", "Other"];

// Default start date = next Monday (a new hire's typical first day).
function nextMondayISO(): string {
  const d = new Date();
  const day = d.getDay(); // 0 Sun … 6 Sat
  const add = ((8 - day) % 7) || 7; // days until the next Monday (never today)
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

// Step 2 apprenticeship — default exclusions offered as one-click chips.
const DEFAULT_EXCLUSIONS = ["HR 1:1s", "Compensation threads", "Personal DMs", "Legal / board matters"];
// Demo Slack channels for the source picker (real workspace sync is out of scope).
const DEMO_SLACK_CHANNELS = ["#cs-team", "#support", "#sales", "#product", "#general", "#deals", "#eng"];

// Step 5 KPI presets by role/template key — one-click starters (spec).
const KPI_PRESETS: Record<string, AgentKpi[]> = {
  csm: [{ name: "CSAT", target: "≥ 4.5" }, { name: "Onboarding completion", target: "≤ 30 days" }, { name: "Response SLA", target: "< 2h" }, { name: "NRR of book", target: "≥ 100%" }],
  "sales-dev": [{ name: "Qualified meetings", target: "20 / month" }, { name: "Reply rate", target: "≥ 8%" }, { name: "Pipeline created", target: "$250k / quarter" }],
  recruiter: [{ name: "Qualified candidates", target: "15 / role" }, { name: "Time to shortlist", target: "≤ 5 days" }, { name: "Offer-accept rate", target: "≥ 80%" }],
  support: [{ name: "First-response time", target: "< 15m" }, { name: "CSAT", target: "≥ 4.6" }, { name: "Resolution rate", target: "≥ 90%" }],
  ops: [{ name: "Report on-time rate", target: "100%" }, { name: "Data accuracy", target: "≥ 99%" }],
  swe: [{ name: "PRs merged", target: "10 / week" }, { name: "Review turnaround", target: "< 4h" }, { name: "Escaped bugs", target: "0 P0" }],
};

// Step 3 default runtime capabilities.
const DEFAULT_CAPS: RuntimeCapabilities = { webSearch: true, browserControl: false, terminal: false, longTermMemory: true, scheduling: false, codeExecution: false };
const CAP_LABELS: { key: keyof RuntimeCapabilities; label: string; hint: string }[] = [
  { key: "webSearch", label: "Web search", hint: "Look things up on the open web" },
  { key: "browserControl", label: "Browser control", hint: "Per-agent headless browser via Hermes" },
  { key: "terminal", label: "Terminal / shell", hint: "Run shell commands in its sandbox" },
  { key: "longTermMemory", label: "Long-term memory", hint: "Remember across sessions" },
  { key: "scheduling", label: "Scheduling (cron)", hint: "Run itself on a schedule" },
  { key: "codeExecution", label: "Code execution", hint: "Execute code to compute / transform" },
];

// Step 4 disclosure policy options (required when the agent takes calls).
const DISCLOSURE_OPTIONS: { key: DisclosurePolicy; label: string; detail: string }[] = [
  { key: "always", label: "Always disclose", detail: "States it's an AI up front, every time." },
  { key: "when_asked", label: "Disclose when asked", detail: "Confirms it's an AI only if someone asks." },
  { key: "per_customer", label: "Per-customer setting", detail: "Follows each customer's disclosure preference." },
];

// Map a tier onto the coarse permission toggles (payments always off — finance
// is never grantable in this wizard).
function tierPermissions(tier: AutonomyTier): AgentPermission[] {
  const allowAll = tier >= 2;
  return PERMISSION_LABELS.map((label) => {
    if (label === "Make payments") return { label, allowed: false };
    if (label === "Read knowledge base") return { label, allowed: true };
    if (label === "Spend budget") return { label, allowed: false }; // governed by the budget block
    return { label, allowed: allowAll };
  });
}

// Single unified flow — the AI interview is the default, open entry point.
// The old Clone-vs-Scratch chooser and manual self-define form are gone; the
// build track is inferred (clone if the clone toggle was used, else scratch).
// Six-step onboarding journey (spec v2) — bring a new unit onto the team.
const WIZARD_STEPS = ["Identity", "Apprenticeship", "Access & grants", "Trust & guardrails", "Performance contract", "Review & deploy"];

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

// ---- Evidence asset types — what to ask for so the agent LEARNS the job. ----
// Each maps to an icon, a label, and the connection that supplies it in clone
// mode (so a clone just connects the tool instead of uploading).
const ASSET_TYPES: Record<EvidenceAssetType, { label: string; icon: string; hint: string; connection?: string }> = {
  output: { label: "Ideal output", icon: "check-circle", hint: "An example of the finished result done right" },
  notetaker: { label: "Notetaker", icon: "mic", hint: "A call transcript or recording (Fathom / Otter / Gong)", connection: "notetaker" },
  policy: { label: "Policy", icon: "shield-check", hint: "The rules / guardrails this role must follow", connection: "drive" },
  notion: { label: "Notion / SOP", icon: "book-open", hint: "The written process or playbook", connection: "notion" },
  calendar: { label: "Calendar", icon: "calendar", hint: "The meeting cadence — a screenshot works", connection: "calendar" },
  email: { label: "Email", icon: "mail", hint: "An example email / outreach in the right voice", connection: "email" },
  crm: { label: "CRM record", icon: "database", hint: "A well-kept account / deal record", connection: "crm" },
  doc: { label: "Document", icon: "file-text", hint: "A deck, spec, or reference doc", connection: "drive" },
  other: { label: "Example", icon: "paperclip", hint: "Any reference that shows what good looks like" },
};
const ASSET_ORDER: EvidenceAssetType[] = ["output", "notetaker", "policy", "notion", "calendar", "email", "crm", "doc", "other"];
function assetMeta(t?: EvidenceAssetType) { return ASSET_TYPES[t ?? "output"] ?? ASSET_TYPES.output; }

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
      { behavior: "Run a live product demo", instruction: "Open the demo env, walk the customer through it, and narrate with voice" },
      { behavior: "Answer a customer question", instruction: "Accurate, empathetic, on-brand" },
      { behavior: "Run a check-in / QBR", instruction: "Summarize usage, risks, next steps" },
      { behavior: "Follow up in Slack", instruction: "Post recap & next steps to the right channel" },
      { behavior: "Flag churn risk", instruction: "Detect signals and escalate" },
    ],
    tools: ["web_search", "gmail", "calendar", "memory.query", "vision"],
    connections: ["email", "slack", "calendar", "notetaker", "crm", "browser", "voice", "demo"],
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
    key: "swe",
    label: "Full Stack Engineer",
    icon: "code",
    behaviors: [
      { behavior: "Implement a feature from a ticket", instruction: "Read the ticket, write code + tests, open a PR" },
      { behavior: "Fix a bug", instruction: "Reproduce, diagnose, patch, add a regression test" },
      { behavior: "Review a pull request", instruction: "Check correctness, style, security; leave actionable comments" },
      { behavior: "Investigate an incident", instruction: "Read logs/errors, find root cause, propose a fix" },
    ],
    tools: ["web_search", "code_interpreter", "filesystem", "github", "shell"],
    connections: ["code", "terminal", "browser", "web", "memory", "notion"],
  },
  {
    key: "ae",
    label: "Account Executive",
    icon: "briefcase",
    behaviors: [
      { behavior: "Run a discovery call", instruction: "Qualify (MEDDIC/BANT), uncover pain, set next steps" },
      { behavior: "Send a follow-up + proposal", instruction: "Recap value, attach pricing, one clear CTA" },
      { behavior: "Advance a deal in the pipeline", instruction: "Update CRM, multi-thread, drive to close" },
      { behavior: "Handle pricing / objections", instruction: "Reframe on value, offer options, protect margin" },
    ],
    tools: ["web_search", "gmail", "calendar", "memory.query"],
    connections: ["email", "calendar", "slack", "crm", "notetaker", "voice", "browser"],
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

// Person picker — choose an accountable human (reports-to) or clone mentor from
// the Company-screen people. Falls back to manual name/email when the directory
// is empty or the person isn't listed.
function PersonPicker({ people, name, email, onChange, placeholder }: {
  people: Person[];
  name?: string;
  email?: string;
  onChange: (v: { name?: string; email?: string }) => void;
  placeholder?: string;
}) {
  const matched = people.find((p) => (email && p.email === email) || (name && p.name === name));
  const [manual, setManual] = useState(!matched && (!!name || !!email));
  if (people.length === 0 || manual) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "center" }}>
        <input value={name ?? ""} onChange={(e) => onChange({ name: e.target.value, email })} placeholder={placeholder ?? "Name"} style={inputStyle} />
        <input value={email ?? ""} onChange={(e) => onChange({ name, email: e.target.value })} placeholder="Email" style={inputStyle} />
        {people.length > 0 && <Button variant="ghost" size="sm" onClick={() => setManual(false)}>From team</Button>}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <select value={matched?.id ?? ""} onChange={(e) => { const p = people.find((x) => x.id === e.target.value); onChange(p ? { name: p.name, email: p.email } : {}); }} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
        <option value="">{placeholder ?? "Select a person…"}</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? ` · ${p.title}` : ""}</option>)}
      </select>
      <Button variant="ghost" size="sm" onClick={() => setManual(true)}>Not listed</Button>
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
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 14, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px dashed var(--jv-border)", font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>
        <Icon name="ban" size={13} /> Payments are off by design — this agent can never move money. Financial systems need a separate finance requisition.
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

// ---- Connect guidance — tailored, admin-aware steps per access system --------
// Matched case-insensitively against the access item label with a sensible
// generic fallback. Live OAuth for these connectors is coming soon, so the
// popup captures INTENT (mark pending/granted) rather than performing OAuth.
interface ConnectGuide { icon: string; steps: string }
const CONNECT_GUIDES: { match: RegExp; icon: string; steps: string }[] = [
  { match: /slack/i, icon: "message-square", steps: "Install the After Human Slack app in your workspace; a workspace admin may need to approve it. Then authorize the channels the agent should post in." },
  { match: /calendar|cal\b/i, icon: "calendar", steps: "Connect the agent's calendar (Google/Microsoft) so it can read availability and send invites." },
  { match: /e-?mail|mailbox|gmail|outlook|inbox/i, icon: "mail", steps: "Authorize the agent's mailbox (Google Workspace / Microsoft 365). An admin may need to grant delegated access." },
  { match: /hubspot|salesforce|crm|pipeline/i, icon: "database", steps: "Connect via your CRM admin settings and grant API access for the objects the agent needs." },
  { match: /demo|product access|back ?office|admin console|environment|staging|sandbox/i, icon: "terminal", steps: "Create a login for the agent in the back office / demo environment and share credentials via your password manager." },
  { match: /fathom|otter|gong|notetaker|call recording|transcript|recording/i, icon: "phone", steps: "Connect Fathom/Otter/Gong and allow the agent to access recordings & transcripts." },
  { match: /knowledge|drive|notion|docs|documents|wiki|confluence/i, icon: "book-open", steps: "Share the relevant Drive/Notion folders with the agent's account." },
  { match: /analytics|dashboard|metrics|reporting|looker|amplitude|mixpanel/i, icon: "bar-chart-3", steps: "Grant the agent a viewer seat on the analytics/admin dashboard." },
];
function connectGuideFor(label: string): ConnectGuide {
  const hit = CONNECT_GUIDES.find((g) => g.match.test(label));
  if (hit) return { icon: hit.icon, steps: hit.steps };
  return { icon: "plug", steps: "Connect this system for the agent, granting the least-privilege access it needs. If it requires an administrator, share these steps with them." };
}

// Modal giving step-by-step guidance to connect ONE access item, with actions to
// capture intent (mark pending/granted) since live OAuth is coming soon.
function ConnectGuidanceModal({
  item,
  status,
  onSetStatus,
  onClose,
}: {
  item: string;
  status: AccessStatus;
  onSetStatus: (s: AccessStatus) => void;
  onClose: () => void;
}) {
  const guide = connectGuideFor(item);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: 20, background: "color-mix(in srgb, var(--jv-void) 72%, transparent)", backdropFilter: "blur(3px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(460px, 100%)", padding: "18px 20px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-cyan)", boxShadow: "0 0 40px var(--jv-glow-cyan)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", flex: "0 0 auto" }}>
            <Icon name={guide.icon} size={16} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>Connect</div>
            <div style={{ font: "var(--fw-bold) 14px var(--font-body)", color: "var(--jv-text)" }}>{item}</div>
          </div>
          <button onClick={onClose} title="Close" style={{ background: "none", border: "none", color: "var(--jv-text-faint)", cursor: "pointer", display: "grid", placeItems: "center" }}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div style={{ font: "var(--fw-regular) 12.5px/1.6 var(--font-body)", color: "var(--jv-text-soft)", marginBottom: 12 }}>{guide.steps}</div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "9px 11px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", marginBottom: 16 }}>
          <Icon name="info" size={13} color="var(--jv-amber)" />
          <div style={{ font: "var(--fw-regular) 11px/1.5 var(--font-body)", color: "var(--jv-text-muted)" }}>
            Live one-click OAuth for this connector is coming soon. For now, complete the steps above and mark this item so your onboarding stays accurate.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" size="sm" icon={<Icon name="check" size={13} />} disabled={status === "granted"} onClick={() => { onSetStatus("granted"); onClose(); }}>
            Mark as granted
          </Button>
          <Button variant="secondary" size="sm" icon={<Icon name="clock" size={13} />} disabled={status === "pending"} onClick={() => { onSetStatus("pending"); onClose(); }}>
            Mark as pending
          </Button>
          <div style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

function BreathingDiscovery({
  name,
  title,
  track,
  seed,
  companyName,
  onApply,
  onSkip,
  onAttach,
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
  // Attach an uploaded example (a file/screenshot) as evidence for the agent.
  onAttach: (ex: EvidenceExample) => void;
}) {
  const [transcript, setTranscript] = useState<DiscoverTurn[]>([]);
  const [question, setQuestion] = useState<string>("");
  const [understanding, setUnderstanding] = useState(0);
  const [done, setDone] = useState(false);
  const [profile, setProfile] = useState<DiscoverProfile>({});
  const [summary, setSummary] = useState<string | undefined>(undefined);
  // A recommended ANSWER to the CURRENT question (question-specific), shown in the
  // editable box under the question. overrideSummary holds the operator's edit.
  const [suggestion, setSuggestion] = useState<string>("");
  // When the current question requests a concrete artifact, this is the imperative
  // describing exactly what file to attach (drives the evidence upload block).
  const [evidenceAsk, setEvidenceAsk] = useState<string>("");
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

  // ---- Inline edits to the AI recommendation (overview + goals). Kept separate
  // from `profile` (which the periodic /discover refresh replaces) so the operator's
  // edits survive. Once the operator touches a field we prefer their value. ----
  const [overrideOverview, setOverrideOverview] = useState<string | null>(null);
  const [overrideGoals, setOverrideGoals] = useState<AgentGoal[] | null>(null);
  const [editingOverview, setEditingOverview] = useState(false);
  // Inline edit of the left "Recommended for {company}" rationale.
  const [overrideSummary, setOverrideSummary] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);

  // ---- Reasoning while thinking — so it never looks stuck. Rotates a line
  // describing what the AI is working out behind the scenes while `busy`. ----
  const THINKING_LINES = [
    `Researching ${companyName || "the company"} and what this role needs…`,
    "Mapping the core responsibilities…",
    "Working out the systems & access they'll need…",
    "Drafting goals and what “great” looks like…",
    "Deciding who they report to and which meetings to join…",
    "Lining up the evidence it should learn from…",
  ];
  const [thinkIdx, setThinkIdx] = useState(0);
  useEffect(() => {
    if (!busy) return;
    setThinkIdx(0);
    const id = setInterval(() => setThinkIdx((i) => (i + 1) % THINKING_LINES.length), 1500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // ---- Voice narration of the interview (TTS). Muteable + persisted. ----
  const voice = useVoiceOutput();
  const [voiceOn, setVoiceOn] = useState<boolean>(() => {
    try { return localStorage.getItem("jv.interviewVoice") !== "off"; } catch { return true; }
  });
  const toggleVoice = () => {
    setVoiceOn((on) => {
      const next = !on;
      try { localStorage.setItem("jv.interviewVoice", next ? "on" : "off"); } catch { /* ignore */ }
      if (!next) voice.cancel();
      return next;
    });
  };
  // Track what we last spoke so we don't repeat on unrelated re-renders.
  const lastSpokenQ = useRef<string>("");
  const spokeReady = useRef(false);

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
      setSuggestion(r.suggestion ?? "");
      setEvidenceAsk(r.evidenceAsk ?? "");
      setSource(r.source);
      // Each turn the AI proposes a fresh, question-specific suggested answer —
      // clear any prior inline edit so the new suggestion shows (the operator's
      // edit was already sent to the AI as input by acceptAndContinue).
      setOverrideSummary(null);
      setEditingSummary(false);
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

  // Narrate the interview aloud. Speak each NEW question (cancelling prior
  // speech), and once ready, speak a one-time "enough to build" line. Only when
  // supported (secure context) and not muted. Cancel on unmount.
  useEffect(() => {
    if (!voice.supported || !voiceOn) return;
    const q = question.trim();
    if (q && q !== lastSpokenQ.current) {
      lastSpokenQ.current = q;
      voice.speak(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, voice.supported, voiceOn]);

  useEffect(() => {
    if (!voice.supported || !voiceOn) return;
    if ((done || understanding >= 85) && !spokeReady.current) {
      spokeReady.current = true;
      voice.speak("I have enough to build this.");
    }
    if (!done && understanding < 85) spokeReady.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, understanding, voice.supported, voiceOn]);

  // Cancel any speech when the component unmounts.
  const voiceCancel = voice.cancel;
  useEffect(() => () => { voiceCancel(); }, [voiceCancel]);

  // No answer box: the AI gives its full recommendation and you refine it inline
  // or accept as-is. "Regenerate" re-runs the discovery (with reasoning shown) so
  // the operator can ask for a fresh take.
  const regenerate = () => {
    if (busy) return;
    voice.cancel();
    void ask(transcript);
  };

  // Accept the current recommendation/understanding and ADVANCE THE INTERVIEW to
  // the next question — this does NOT move to the next wizard step. Understanding
  // climbs with each accept; when it's high enough, "Build the agent" appears.
  const acceptAndContinue = () => {
    if (busy) return;
    voice.cancel();
    // If the operator edited the "What I understand" text, treat that as their
    // answer/correction and send it to the AI so it's folded in. Otherwise just
    // confirm and move to the next question.
    // The box holds a question-specific suggested answer. Accept sends it (edited
    // or as-is) as the operator's answer to THIS question, so it's folded in.
    const answerText = (overrideSummary ?? suggestion ?? "").trim();
    const edited = overrideSummary != null && overrideSummary.trim() !== (suggestion ?? "").trim();
    const userMsg = answerText
      ? `${edited ? "My answer (edited)" : "Yes — use this suggested answer"}: ${answerText}. Fold it in, then ask the next most important question.`
      : "Looks good — I accept this. Ask the next most important question to deepen your understanding of this role.";
    const next: DiscoverTurn[] = [
      ...transcript,
      ...(question ? [{ role: "assistant" as const, content: question }] : []),
      { role: "user" as const, content: userMsg },
    ];
    setTranscript(next);
    void ask(next);
  };

  // ---- Attach an example file right from the interview (when the AI asks for
  // one). Uploads to the file store, records it as evidence, and tells the AI. ----
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<{ fileId: string; name: string; isImage: boolean }[]>([]);
  const [attaching, setAttaching] = useState(false);
  const attachFile = async (file: File) => {
    setAttaching(true);
    try {
      const { dataUrl, mime } = await fileToDataUrl(file);
      const res = await api.post<{ id: string }>("/api/files", { filename: file.name, mime, dataBase64: dataUrl });
      const isImage = mime.startsWith("image/");
      onAttach({ kind: isImage ? "screenshot" : "file", assetType: "output", fileId: res.id, fileName: isImage ? undefined : file.name, caption: file.name });
      setAttachments((a) => [...a, { fileId: res.id, name: file.name, isImage }]);
      // Advance the interview: acknowledge the example and ask the next question.
      voice.cancel();
      const msg = `I've attached an example file: "${file.name}". Treat it as evidence of what "great" looks like, fold it into your understanding, then ask the next most important question.`;
      const next: DiscoverTurn[] = [
        ...transcript,
        ...(question ? [{ role: "assistant" as const, content: question }] : []),
        { role: "user" as const, content: msg },
      ];
      setTranscript(next);
      void ask(next);
    } catch {
      setError("That file couldn't be uploaded — try again, or attach it later in the Examples step.");
    } finally {
      setAttaching(false);
    }
  };

  const access = profile.access ?? [];
  const meetings = profile.meetings ?? [];
  // Effective (possibly operator-edited) overview + goals + summary.
  const effOverview = overrideOverview ?? profile.overview ?? "";
  const goalsList = overrideGoals ?? profile.goals ?? [];
  // The editable box under the question shows the question-specific SUGGESTION
  // (overrideSummary holds the operator's inline edit of it).
  const effSummary = overrideSummary ?? suggestion ?? "";
  const conns = profile.connections ?? [];
  const reportsTo = profile.reportsTo;

  // The interview is a loop: Accept confirms the current understanding and asks
  // the next question, so understanding climbs. "Build the agent" only appears
  // once understanding is high enough (or the model says done) — Accept before
  // then keeps deepening the interview rather than jumping to setup.
  const hasRecommendation = !!(effOverview.trim() || access.length || goalsList.length);
  const readyToBuild = done || understanding >= 70;
  const ready = readyToBuild && !busy;

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
    overview: effOverview.trim() || profile.overview,
    goals: goalsList,
    access: access.filter((a) => isIncluded(a.item)),
  });

  // ---- Inline goal editing helpers (operate on the effective goals list) ----
  const beginGoalEdit = () => { if (overrideGoals == null) setOverrideGoals(goalsList); };
  const patchGoal = (i: number, patch: Partial<AgentGoal>) => {
    beginGoalEdit();
    setOverrideGoals((prev) => (prev ?? goalsList).map((g, j) => (j === i ? { ...g, ...patch } : g)));
  };
  const removeGoal = (i: number) => {
    beginGoalEdit();
    setOverrideGoals((prev) => (prev ?? goalsList).filter((_, j) => j !== i));
  };
  const addGoal = () => {
    beginGoalEdit();
    setOverrideGoals((prev) => [...(prev ?? goalsList), { objective: "" }]);
  };

  // Copy the recommendation as clean, readable plain text.
  const buildCopyText = (): string => {
    const lines: string[] = [];
    lines.push(`Recommended setup${companyName ? ` for ${companyName}` : ""}`);
    lines.push("");
    if (effOverview.trim()) {
      lines.push("ROLE");
      lines.push(effOverview.trim());
      lines.push("");
    }
    if ((summary ?? "").trim()) {
      lines.push("WHAT I UNDERSTAND");
      lines.push((summary ?? "").trim());
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
              <div style={{ font: "var(--fw-bold) 40px var(--font-mono)", color: readyToBuild ? "var(--jv-green)" : "var(--jv-text)", lineHeight: 1 }}>{understanding}<span style={{ font: "var(--fw-semibold) 16px var(--font-mono)", color: readyToBuild ? "var(--jv-green)" : "var(--jv-cyan-300)" }}>%</span></div>
              <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: readyToBuild ? "var(--jv-green)" : busy ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", marginTop: 4 }}>
                {readyToBuild ? "Ready" : busy ? "Thinking…" : "Understanding"}
              </div>
            </div>

            {/* Voice mute/unmute toggle — only when TTS is supported (secure context) */}
            {voice.supported && (
              <button
                onClick={toggleVoice}
                title={voiceOn ? "Mute interview voice" : "Unmute interview voice"}
                style={{ position: "absolute", top: -2, right: -2, width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: "50%", cursor: "pointer", background: "var(--jv-void)", border: `1px solid ${voiceOn ? "var(--jv-border-cyan)" : "var(--jv-border)"}`, color: voiceOn ? "var(--jv-cyan-300)" : "var(--jv-text-faint)" }}
              >
                <Icon name={voiceOn ? (voice.speaking ? "volume-2" : "volume-1") : "volume-x"} size={14} color={voiceOn ? "var(--jv-cyan-300)" : "var(--jv-text-faint)"} />
              </button>
            )}
          </div>
          {/* Ready-to-build banner under the ring — clearly finishable */}
          {readyToBuild ? (
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, padding: "5px 12px", borderRadius: "var(--r-pill)", background: "color-mix(in srgb, var(--jv-green) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-green) 45%, transparent)" }}>
              <Icon name="check-circle" size={13} color="var(--jv-green)" />
              <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-green)" }}>Ready — enough to build</span>
            </div>
          ) : (
            <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 8 }}>
              {source === "ai" ? "Source: your AI Core model" : source === "template" ? "Source: template (connect a model in AI Core)" : "Source: —"}
            </div>
          )}
        </div>

        {/* What the AI is doing — the current question, or its reasoning while it
            thinks (so it never looks stuck). */}
        <div style={{ marginTop: 8, padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-cyan)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Icon name={busy ? "loader" : "sparkles"} size={14} color="var(--jv-cyan)" />
            <span style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>
              {busy ? "Thinking it through" : "Discovery interview"}
            </span>
          </div>
          <div style={{ font: "var(--fw-medium) 13.5px/1.5 var(--font-body)", color: busy ? "var(--jv-cyan-300)" : "var(--jv-text)", minHeight: 20 }}>
            {busy
              ? THINKING_LINES[thinkIdx]
              : question || (ready ? "Here's my recommendation — edit anything inline, or accept it as-is." : "…")}
          </div>
          {busy && (
            <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
              {[0, 1, 2].map((d) => (
                <span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--jv-cyan)", opacity: 0.4, animation: `jv-pulse 1s ${d * 0.18}s var(--ease-out) infinite` }} />
              ))}
            </div>
          )}
        </div>

        {/* A recommended ANSWER to the question above — question-specific.
            Edit it or accept as-is; Accept sends it as your answer. */}
        {(effSummary || question) && (
          <div style={{ marginTop: 10, padding: "12px 14px", borderRadius: "var(--r-md)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <Icon name="sparkles" size={13} color="var(--jv-cyan)" />
              <span style={{ flex: 1, font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>
                My suggested answer
              </span>
              {!editingSummary && (
                <button onClick={() => { if (overrideSummary == null) setOverrideSummary(suggestion ?? ""); setEditingSummary(true); }} title="Edit" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--jv-cyan-300)", display: "grid", placeItems: "center" }}>
                  <Icon name="pencil" size={12} color="var(--jv-cyan-300)" />
                </button>
              )}
            </div>
            {editingSummary ? (
              <textarea
                value={effSummary}
                autoFocus
                onChange={(e) => setOverrideSummary(e.target.value)}
                onBlur={() => setEditingSummary(false)}
                placeholder="Edit the answer to this question — Accept sends it…"
                style={{ ...areaStyle, height: 96, font: "var(--fw-regular) 11.5px/1.55 var(--font-body)" }}
              />
            ) : (
              <div
                onClick={() => { if (overrideSummary == null) setOverrideSummary(suggestion ?? ""); setEditingSummary(true); }}
                title="Click to edit this answer — Accept sends it"
                style={{ font: "var(--fw-regular) 11.5px/1.55 var(--font-body)", color: "var(--jv-text-soft)", cursor: "text", whiteSpace: "pre-wrap" }}
              >
                {effSummary || (busy ? "Drafting an answer to this question…" : "Click to answer this question…")}
              </div>
            )}
            <div style={{ font: "var(--fw-regular) 10px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 8 }}>
              My recommended answer to the question above. Edit it or leave it — <b style={{ color: "var(--jv-text-muted)" }}>Accept</b> sends it and asks the next question.
            </div>
          </div>
        )}
        {error && <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-amber)", marginTop: 8 }}>{error}</div>}

        {/* hidden picker for interview attachments */}
        <input
          ref={attachInputRef}
          type="file"
          accept="image/*,application/pdf,.txt,.md,.doc,.docx,.csv,.vtt,.ppt,.pptx,.xls,.xlsx"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachFile(f); e.target.value = ""; }}
        />

        {/* Evidence block — a descriptive upload prompt tailored to the question.
            Prominent (cyan) when the AI is actively asking for an artifact. */}
        <div
          onClick={() => !attaching && attachInputRef.current?.click()}
          role="button"
          style={{ marginTop: 12, padding: "12px 14px", borderRadius: "var(--r-md)", cursor: attaching ? "default" : "pointer", background: evidenceAsk ? "var(--grad-cyan-soft)" : "var(--jv-surface-2)", border: `1px dashed ${evidenceAsk ? "var(--jv-border-cyan)" : "var(--jv-border)"}` }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Icon name={attaching ? "loader" : "upload"} size={14} color="var(--jv-cyan)" />
            <span style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>
              {evidenceAsk ? "Evidence requested" : "Have an example?"}
            </span>
          </div>
          <div style={{ font: "var(--fw-regular) 12px/1.5 var(--font-body)", color: "var(--jv-text-soft)" }}>
            {attaching ? "Uploading…" : (evidenceAsk || "If you have a relevant example — a doc, screenshot, recording, or transcript — attach it and the agent learns from it.")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-cyan)", color: "var(--jv-cyan-300)", font: "var(--fw-semibold) 11px var(--font-body)" }}>
              <Icon name="paperclip" size={13} color="var(--jv-cyan-300)" /> {attaching ? "Uploading…" : "Choose a file to upload"}
            </span>
            <span style={{ font: "var(--fw-regular) 10px var(--font-body)", color: "var(--jv-text-faint)" }}>image · PDF · doc · sheet · slides · transcript</span>
          </div>
          {attachments.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
              {attachments.map((f, i) => (
                <a key={i} href={`/api/files/${f.fileId}`} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 9px", borderRadius: "var(--r-pill)", textDecoration: "none", background: "color-mix(in srgb, var(--jv-green) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-green) 40%, transparent)", color: "var(--jv-green)" }}>
                  <Icon name={f.isImage ? "image" : "file-text"} size={12} color="var(--jv-green)" />
                  <span style={{ font: "var(--fw-medium) 11px var(--font-body)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Controls. ACCEPT confirms this understanding and moves to the NEXT
            QUESTION — it does not leave the interview. BUILD THE AGENT (green,
            only once ready) is the deliberate step that proceeds to setup. */}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
          <Button
            variant="primary"
            icon={<Icon name={busy ? "loader" : "check"} size={14} />}
            disabled={busy || !question}
            onClick={acceptAndContinue}
            style={{ background: "var(--grad-cyan)", boxShadow: "0 0 14px var(--jv-glow-cyan)" }}
          >
            {busy ? "…" : "Accept"}
          </Button>
          <Button variant="secondary" icon={<Icon name={busy ? "loader" : "refresh-cw"} size={14} />} disabled={busy} onClick={regenerate}>
            {busy ? "…" : "Regenerate"}
          </Button>
          <Button variant="ghost" onClick={onSkip}>Skip — I'll fill it in</Button>
          {readyToBuild && (
            <>
              <div style={{ flex: 1 }} />
              <Button
                variant="primary"
                iconRight={<Icon name="arrow-right" size={14} />}
                disabled={!ready}
                onClick={() => onApply(selectedProfile())}
                style={{ background: "linear-gradient(180deg, var(--jv-green), color-mix(in srgb, var(--jv-green) 78%, black))", boxShadow: "0 0 20px color-mix(in srgb, var(--jv-green) 55%, transparent)", color: "#04140b" }}
              >
                Build the agent
              </Button>
            </>
          )}
        </div>
        <div style={{ font: "var(--fw-regular) 10px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 8 }}>
          Accept keeps the interview going — I'll ask the next question. Edit anything inline. “Build the agent” moves on to setup.
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

        {/* Helper: accept as-is or edit any field here */}
        <div style={{ font: "var(--fw-regular) 11px/1.5 var(--font-body)", color: "var(--jv-text-faint)", marginBottom: 12 }}>
          Accept as-is, or edit any field here — then continue.
        </div>

        {(effOverview || editingOverview) && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <span style={{ flex: 1, font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>Role / overview</span>
              {!editingOverview && (
                <button onClick={() => { if (overrideOverview == null) setOverrideOverview(profile.overview ?? ""); setEditingOverview(true); }} title="Edit" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--jv-cyan-300)", display: "grid", placeItems: "center" }}>
                  <Icon name="pencil" size={12} color="var(--jv-cyan-300)" />
                </button>
              )}
            </div>
            {editingOverview ? (
              <textarea
                value={effOverview}
                autoFocus
                onChange={(e) => setOverrideOverview(e.target.value)}
                onBlur={() => setEditingOverview(false)}
                placeholder="What this role is about…"
                style={{ ...areaStyle, height: 76, font: "var(--fw-regular) 12px/1.5 var(--font-body)" }}
              />
            ) : (
              <div
                onClick={() => { if (overrideOverview == null) setOverrideOverview(profile.overview ?? ""); setEditingOverview(true); }}
                title="Click to edit"
                style={{ font: "var(--fw-regular) 12px/1.5 var(--font-body)", color: "var(--jv-text-soft)", cursor: "text" }}
              >
                {effOverview}
              </div>
            )}
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

        {/* Goals — inline editable lines with add/remove */}
        <div style={{ marginBottom: goalsList.length || conns.length ? 14 : 0 }}>
          <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Goals</div>
          {goalsList.length === 0 && overrideGoals == null ? (
            <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)", marginBottom: 6 }}>Forming…</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 6 }}>
              {goalsList.map((g, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name="target" size={13} color="var(--jv-cyan)" />
                  <input
                    value={g.objective}
                    onChange={(e) => patchGoal(i, { objective: e.target.value })}
                    placeholder="Objective"
                    style={{ ...inputStyle, height: 30, flex: 1.4 }}
                  />
                  <input
                    value={g.metric ?? ""}
                    onChange={(e) => patchGoal(i, { metric: e.target.value || undefined })}
                    placeholder="Metric"
                    style={{ ...inputStyle, height: 30, flex: 1 }}
                  />
                  <button onClick={() => removeGoal(i)} title="Remove goal" style={{ background: "none", border: "none", color: "var(--jv-text-faint)", cursor: "pointer", display: "grid", placeItems: "center" }}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Button variant="ghost" size="sm" icon={<Icon name="plus" size={12} />} onClick={addGoal}>Add goal</Button>
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

        {/* Deliberate proceed — this is the ONLY control that leaves the
            interview for the setup step. Green once the interview is ready. */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--jv-hairline)" }}>
          <Button
            variant="primary"
            iconRight={<Icon name="arrow-right" size={14} />}
            disabled={!ready}
            onClick={() => onApply(selectedProfile())}
            style={{ width: "100%", ...(readyToBuild ? { background: "linear-gradient(180deg, var(--jv-green), color-mix(in srgb, var(--jv-green) 78%, black))", boxShadow: "0 0 20px color-mix(in srgb, var(--jv-green) 55%, transparent)", color: "#04140b" } : {}) }}
          >
            Build the agent
          </Button>
          <div style={{ font: "var(--fw-regular) 10px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 6, textAlign: "center" }}>
            Proceeds to setup — everything above carries over.
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Onboarding review editor (clone track) — access checklist, manager, meetings ----
// ---- Chain of command: who the agent reports to ----
function ReportingLine({ onboarding, setOnboarding }: { onboarding: Onboarding; setOnboarding: (fn: (prev: Onboarding) => Onboarding) => void }) {
  const manager: Manager = onboarding.reportsTo ?? {};
  const setManager = (patch: Partial<Manager>) =>
    setOnboarding((o) => {
      const m = { ...(o.reportsTo ?? {}), ...patch };
      const empty = !m.name?.trim() && !m.email?.trim();
      return { ...o, reportsTo: empty ? undefined : m };
    });
  return (
    <Field label="Reports to" hint="The human who owns this agent's work, reviews it, and takes its handoffs. Every unit answers to someone.">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input value={manager.name ?? ""} onChange={(e) => setManager({ name: e.target.value })} placeholder="Manager name" style={inputStyle} />
        <input value={manager.email ?? ""} onChange={(e) => setManager({ email: e.target.value })} placeholder="Manager email" style={inputStyle} />
      </div>
    </Field>
  );
}

// ---- Rules of engagement: when the agent must stop and hand off to a human ----
function EscalationEditor({ escalation, setEscalation }: { escalation: EscalationConfig; setEscalation: (fn: (prev: EscalationConfig) => EscalationConfig) => void }) {
  const toggle = (k: keyof EscalationConfig) => setEscalation((e) => ({ ...e, [k]: !e[k] }));
  return (
    <>
      <Field label="Rules of engagement" hint="The moments this agent must stop and hand off to its manager instead of acting alone — the lines it should never cross by itself.">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ESCALATION_TRIGGERS.map((t) => {
            const on = !!escalation[t.key];
            return (
              <div key={String(t.key)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: `1px solid ${on ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}` }}>
                <Icon name="flag" size={15} color={on ? "var(--jv-cyan)" : "var(--jv-text-faint)"} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{t.label}</div>
                  <div style={{ font: "var(--fw-regular) 10.5px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 1 }}>{t.hint}</div>
                </div>
                <Switch checked={on} onChange={() => toggle(t.key)} />
              </div>
            );
          })}
        </div>
      </Field>
      <Field label="Escalate to" hint="Where a handoff lands — a person's email or a Slack channel. Set this before the agent takes real actions.">
        <input value={escalation.contact ?? ""} onChange={(e) => setEscalation((c) => ({ ...c, contact: e.target.value || undefined }))} placeholder="e.g. maya@company.com or #cs-escalations" style={inputStyle} />
      </Field>
    </>
  );
}

// ---- Identity & access: connections + day-one access checklist + meetings ----
function AccessAndMeetings({ onboarding, setOnboarding }: { onboarding: Onboarding; setOnboarding: (fn: (prev: Onboarding) => Onboarding) => void }) {
  const access = onboarding.access ?? [];
  const meetings = onboarding.meetings ?? [];
  const [accessDraft, setAccessDraft] = useState("");
  const [mtgName, setMtgName] = useState("");
  const [mtgCadence, setMtgCadence] = useState("");
  // Index of the access item whose Connect guidance popup is open (null = closed).
  const [connectIdx, setConnectIdx] = useState<number | null>(null);

  const STATUSES: AccessStatus[] = ["needed", "pending", "granted"];

  const setAccessStatus = (i: number, status: AccessStatus) =>
    setOnboarding((o) => ({ ...o, access: (o.access ?? []).map((a, j) => (j === i ? { ...a, status } : a)) }));

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

  return (
    <div>
      <Field label="Access checklist" hint="What this agent needs on day one. Hit Connect for step-by-step guidance, or click a status pill to cycle needed → pending → granted.">
        {access.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {access.map((a, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <Icon name="key-round" size={14} color={ACCESS_TONE[a.status].color} />
                <span style={{ flex: "0 0 130px", font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)" }}>{a.item}</span>
                <input value={a.note ?? ""} onChange={(e) => patchAccessNote(i, e.target.value)} placeholder="Note (optional)" style={{ ...inputStyle, height: 30, flex: 1 }} />
                <button onClick={() => setConnectIdx(i)} title="How to connect this system" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: "var(--r-pill)", cursor: "pointer", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-cyan-300)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
                  <Icon name="plug" size={11} color="var(--jv-cyan-300)" /> Connect
                </button>
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

      {connectIdx != null && access[connectIdx] && (
        <ConnectGuidanceModal
          item={access[connectIdx].item}
          status={access[connectIdx].status}
          onSetStatus={(s) => setAccessStatus(connectIdx, s)}
          onClose={() => setConnectIdx(null)}
        />
      )}
    </div>
  );
}

// ---- Step 5: meetings this agent joins (as itself) ----
function MeetingsEditor({ onboarding, setOnboarding }: { onboarding: Onboarding; setOnboarding: (fn: (prev: Onboarding) => Onboarding) => void }) {
  const meetings = onboarding.meetings ?? [];
  const [mName, setMName] = useState("");
  const [mCad, setMCad] = useState("");
  const add = () => { const n = mName.trim(); if (!n) return; setOnboarding((o) => ({ ...o, meetings: [...(o.meetings ?? []), { name: n, cadence: mCad.trim() || undefined }] })); setMName(""); setMCad(""); };
  const remove = (i: number) => setOnboarding((o) => ({ ...o, meetings: (o.meetings ?? []).filter((_, j) => j !== i) }));
  return (
    <Field label="Meetings to join" hint="Standups, QBRs and reviews this agent attends — as itself.">
      {meetings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {meetings.map((m, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <Icon name="calendar" size={15} color="var(--jv-cyan)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{m.name}</div>
                {m.cadence && <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>{m.cadence}</div>}
              </div>
              <button onClick={() => remove(i)} title="Remove" style={{ background: "none", border: "none", color: "var(--jv-text-faint)", cursor: "pointer", display: "grid", placeItems: "center" }}><Icon name="x" size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr auto", gap: 8, alignItems: "center" }}>
        <input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Meeting — e.g. CS weekly pipeline review" style={{ ...inputStyle, height: 34 }} />
        <input value={mCad} onChange={(e) => setMCad(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} placeholder="Cadence — e.g. Tue 10:00" style={{ ...inputStyle, height: 34 }} />
        <Button variant="ghost" size="sm" icon={<Icon name="plus" size={13} />} disabled={!mName.trim()} onClick={add}>Add</Button>
      </div>
    </Field>
  );
}

// ---- Step 2 (clone path): consent-gated apprenticeship ----
function ApprenticeshipEditor({ apprenticeship, setApprenticeship, mentorName }: {
  apprenticeship: Apprenticeship;
  setApprenticeship: (fn: (p: Apprenticeship) => Apprenticeship) => void;
  mentorName: string;
}) {
  const a = apprenticeship;
  const approved = a.consentStatus === "approved";
  const [exDraft, setExDraft] = useState("");
  const mentor = mentorName || "this employee";
  const setSrc = (patch: Partial<Apprenticeship["sources"]>) => setApprenticeship((p) => ({ ...p, sources: { ...p.sources, ...patch } }));
  const toggleChannel = (ch: string) => setApprenticeship((p) => ({ ...p, sources: { ...p.sources, slackChannels: p.sources.slackChannels.includes(ch) ? p.sources.slackChannels.filter((c) => c !== ch) : [...p.sources.slackChannels, ch] } }));
  const addExclusion = (v: string) => { const t = v.trim(); if (!t) return; setApprenticeship((p) => (p.exclusions.includes(t) ? p : { ...p, exclusions: [...p.exclusions, t] })); setExDraft(""); };
  const removeExclusion = (t: string) => setApprenticeship((p) => ({ ...p, exclusions: p.exclusions.filter((x) => x !== t) }));
  const statusTone = a.consentStatus === "approved" ? "var(--jv-green)" : a.consentStatus === "pending" ? "var(--jv-amber)" : "var(--jv-text-muted)";
  const statusLabel = { not_sent: "Not sent", pending: "Pending", approved: "Approved", declined: "Declined" }[a.consentStatus];
  const disabledStyle: CSSProperties = approved ? {} : { opacity: 0.55, pointerEvents: "none", filter: "grayscale(0.3)" };

  const SOURCES: { key: keyof Apprenticeship["sources"]; label: string }[] = [
    { key: "meetings", label: "Meetings / notetaker recordings" },
    { key: "email", label: "Email threads" },
    { key: "calendar", label: "Calendar" },
    { key: "crmHistory", label: "CRM activity history" },
    { key: "supportConvos", label: "Support conversations" },
  ];
  return (
    <div>
      {/* Consent card — blocking until approved */}
      <div style={{ marginBottom: 16, padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: `1px solid ${approved ? "color-mix(in srgb, var(--jv-green) 40%, transparent)" : "var(--jv-border-cyan)"}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Icon name={approved ? "shield-check" : "lock"} size={16} color={approved ? "var(--jv-green)" : "var(--jv-cyan)"} />
          <span style={{ flex: 1, font: "var(--fw-bold) 13px var(--font-body)", color: "var(--jv-text)" }}>Mentor consent</span>
          <span style={{ padding: "2px 9px", borderRadius: "var(--r-pill)", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: statusTone, border: `1px solid color-mix(in srgb, ${statusTone} 45%, transparent)` }}>{statusLabel}</span>
        </div>
        <p style={{ margin: "0 0 10px", font: "var(--fw-regular) 12px/1.5 var(--font-body)", color: "var(--jv-text-muted)" }}>
          Training an agent on {mentor}'s work requires their written consent. We'll send a Slack DM + email with the exact scope below.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {a.consentStatus === "not_sent" && (
            <Button variant="primary" size="sm" icon={<Icon name="send" size={13} />} onClick={() => setApprenticeship((p) => ({ ...p, consentStatus: "pending" }))}>Send consent request</Button>
          )}
          {a.consentStatus === "pending" && (
            <>
              <span style={{ font: "var(--fw-medium) 11.5px var(--font-body)", color: "var(--jv-amber)" }}>Awaiting {mentor}'s approval…</span>
              <button onClick={() => setApprenticeship((p) => ({ ...p, consentStatus: "approved" }))} title="Demo only — simulate the mentor approving" style={{ background: "none", border: "1px dashed var(--jv-border)", borderRadius: "var(--r-pill)", padding: "3px 10px", cursor: "pointer", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-text-faint)" }}>Simulate approval</button>
            </>
          )}
          {approved && <span style={{ font: "var(--fw-medium) 11.5px var(--font-body)", color: "var(--jv-green)" }}>Consent granted — ingest can run.</span>}
          {a.consentStatus === "declined" && (
            <Button variant="ghost" size="sm" onClick={() => setApprenticeship((p) => ({ ...p, consentStatus: "not_sent" }))}>Re-send</Button>
          )}
        </div>
      </div>

      <div style={disabledStyle}>
        <Field label="Training sources" hint="What the agent learns from. Slack is an explicit channel picker — never 'all channels'.">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {SOURCES.map((s) => (
              <div key={String(s.key)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                <Icon name="graduation-cap" size={15} color="var(--jv-cyan)" />
                <span style={{ flex: 1, font: "var(--fw-medium) 12.5px var(--font-body)", color: "var(--jv-text-soft)" }}>{s.label}</span>
                <Switch checked={!!a.sources[s.key]} onChange={() => setSrc({ [s.key]: !a.sources[s.key] } as Partial<Apprenticeship["sources"]>)} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-text-muted)", marginBottom: 6 }}>Slack channels</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {DEMO_SLACK_CHANNELS.map((ch) => {
                const on = a.sources.slackChannels.includes(ch);
                return (
                  <button key={ch} onClick={() => toggleChannel(ch)} style={{ padding: "5px 10px", borderRadius: "var(--r-pill)", cursor: "pointer", font: "var(--fw-semibold) 11px var(--font-mono)", color: on ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", background: on ? "var(--grad-cyan-soft)" : "var(--jv-surface-3)", border: `1px solid ${on ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}` }}>{ch}</button>
                );
              })}
            </div>
          </div>
        </Field>

        <Field label="Exclusions" hint="Never learn from these. Defaults are one-click; add your own.">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {a.exclusions.map((x) => (
              <span key={x} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: "var(--r-pill)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-soft)" }}>
                {x}<button onClick={() => removeExclusion(x)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--jv-text-faint)", display: "grid", placeItems: "center" }}><Icon name="x" size={11} /></button>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {DEFAULT_EXCLUSIONS.filter((d) => !a.exclusions.includes(d)).map((d) => (
              <button key={d} onClick={() => addExclusion(d)} style={{ padding: "4px 10px", borderRadius: "var(--r-pill)", cursor: "pointer", font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-muted)", background: "var(--jv-void)", border: "1px dashed var(--jv-border)" }}>+ {d}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={exDraft} onChange={(e) => setExDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExclusion(exDraft))} placeholder="Add an exclusion…" style={{ ...inputStyle, height: 34 }} />
            <Button variant="ghost" size="sm" icon={<Icon name="plus" size={13} />} disabled={!exDraft.trim()} onClick={() => addExclusion(exDraft)}>Add</Button>
          </div>
        </Field>

        <Field label="Observation window" hint="How long the agent shadows before it's ready to be reviewed for promotion.">
          <div style={{ display: "flex", gap: 8 }}>
            {[2, 4, 6].map((w) => {
              const on = a.observationWeeks === w;
              return (
                <button key={w} onClick={() => setApprenticeship((p) => ({ ...p, observationWeeks: w as 2 | 4 | 6 }))} style={{ flex: 1, padding: "9px 0", borderRadius: "var(--r-sm)", cursor: "pointer", font: `${on ? "var(--fw-bold)" : "var(--fw-medium)"} 12.5px var(--font-body)`, color: on ? "var(--jv-cyan-300)" : "var(--jv-text-soft)", background: on ? "var(--grad-cyan-soft)" : "var(--jv-surface-3)", border: `1px solid ${on ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}` }}>{w} weeks</button>
              );
            })}
          </div>
        </Field>

        <Field label="Understanding" hint="Fills as the ingest pipeline reads the approved sources (your AI Core model).">
          <div style={{ padding: "12px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>{approved ? (a.understandingPct >= 100 ? "Ingest complete" : "Ingesting") : "Waiting for consent"}</span>
              <span style={{ font: "var(--fw-bold) 13px var(--font-mono)", color: a.understandingPct >= 100 ? "var(--jv-green)" : "var(--jv-amber)" }}>{a.understandingPct}%</span>
            </div>
            <div style={{ height: 8, borderRadius: "var(--r-pill)", background: "var(--jv-void)", overflow: "hidden", border: "1px solid var(--jv-border-soft)" }}>
              <div style={{ width: `${a.understandingPct}%`, height: "100%", background: a.understandingPct >= 100 ? "var(--jv-green)" : "var(--grad-cyan)", transition: "width var(--t)" }} />
            </div>
          </div>
        </Field>
      </div>
    </div>
  );
}

export function AgentWizard({
  submitLabel = "Deploy to Shadow",
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

  // Company people — powers the clone-mentor + reports-to pickers (Step 1).
  const { data: peopleData } = useApi<Person[]>("/api/company/people");
  const people = peopleData ?? [];

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
  const [autonomyTier, setAutonomyTier] = useState<AutonomyTier>(1);
  const [advancedPerms, setAdvancedPerms] = useState(false); // reveal the raw derived toggles
  const [dutyCycle, setDutyCycle] = useState<DutyCycle>("balanced");
  const [overview, setOverview] = useState("");
  // ---- Step 1 identity extras (spec v2) ----
  const [department, setDepartment] = useState("");
  const [startDate, setStartDate] = useState<string>(nextMondayISO());
  // ---- Chain of command + mission ----
  const [escalation, setEscalation] = useState<EscalationConfig>({});
  const [reviewCadence, setReviewCadence] = useState<ReviewCadence>("daily_2w_then_weekly");
  // ---- Step 2 apprenticeship (clone path) ----
  const [apprenticeship, setApprenticeship] = useState<Apprenticeship>({
    consentStatus: "not_sent",
    sources: { meetings: true, email: true, slackChannels: [], calendar: true, crmHistory: false, supportConvos: false },
    exclusions: [],
    observationWeeks: 4,
    understandingPct: 0,
  });
  // ---- Step 3 grants + runtime ----
  const [grantScope, setGrantScope] = useState<Record<string, string>>({});
  const [grantTransport, setGrantTransport] = useState<Record<string, "api" | "vm">>({});
  const [caps, setCaps] = useState<RuntimeCapabilities>(DEFAULT_CAPS);
  // ---- Step 4 trust extras ----
  const [promotionCriteria, setPromotionCriteria] = useState("");
  const [disclosurePolicy, setDisclosurePolicy] = useState<DisclosurePolicy>("always");
  const [showT3Confirm, setShowT3Confirm] = useState(false);
  // ---- Step 5/6 owners ----
  const [reviewOwner, setReviewOwner] = useState<Manager>({});
  const [killSwitchOwner, setKillSwitchOwner] = useState<Manager>({});
  // ---- Deploy confirmation moment ----
  const [deployed, setDeployed] = useState<null | { name: string; role: string; email: string; reportsTo?: string; channel: string; firstTask: string }>(null);

  // ---- Common: goals / permissions / connections / tools / budget ----
  const [goals, setGoals] = useState<AgentGoal[]>([]);
  const [permissions, setPermissions] = useState<AgentPermission[]>(
    PERMISSION_LABELS.map((label) => ({ label, allowed: label === "Read knowledge base" })),
  );
  const [connections, setConnections] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>(["web_search"]);
  const [budget, setBudget] = useState<BudgetConfig>({ currency: "USD", allowPayments: false });

  // Choosing a trust tier sets autonomy + derives the permission toggles.
  const applyTier = (tier: AutonomyTier) => {
    setAutonomyTier(tier);
    const t = TRUST_TIERS.find((x) => x.tier === tier);
    if (t) setAutonomy(t.autonomy);
    setPermissions(tierPermissions(tier));
    setAdvancedPerms(false);
  };

  // ---- Clone track ----
  const [clone, setClone] = useState<CloneSource>({});

  // ---- Clone-from-calls (AE/CS): the apprenticeship becomes "learn from >=4 real calls" ----
  const [callSources, setCallSources] = useState<CallSource[]>([]);
  const [callPlaybook, setCallPlaybook] = useState<CallPlaybook | null>(null);
  const [cloneJobId, setCloneJobId] = useState<string | null>(null);
  const [cloneCallsOptOut, setCloneCallsOptOut] = useState(false);
  const cloneRoleText = cloneMode ? (clone.title?.trim() || role.trim()) : role.trim();
  const cloneFromCalls = cloneMode && !cloneCallsOptOut && roleCategoryOf(cloneRoleText) !== "other";

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
  // Once a starting point (template/clone) is chosen the picker collapses to a
  // compact summary to reclaim wizard space; "Change" re-opens it.
  const [pickerForceOpen, setPickerForceOpen] = useState(false);
  const [stashPlan, setStashPlan] = useState("");
  const [stashRoutine, setStashRoutine] = useState("");
  const [stashInstr, setStashInstr] = useState("");
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!model && activeModel) setModel(activeModel);
  }, [activeModel, model]);

  // Simulate apprenticeship ingest once consent is approved (real ingest pipeline
  // is out of scope — this animates understanding so the flow is demoable).
  useEffect(() => {
    if (apprenticeship.consentStatus !== "approved" || apprenticeship.understandingPct >= 100) return;
    const t = setInterval(() => {
      setApprenticeship((a) => (a.understandingPct >= 100 ? a : { ...a, understandingPct: Math.min(100, a.understandingPct + 7) }));
    }, 350);
    return () => clearInterval(t);
  }, [apprenticeship.consentStatus, apprenticeship.understandingPct]);

  // ---- Draft persistence — every completed step is saved server-side so the
  // wizard survives a refresh / navigation and resumes exactly where you left off.
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved">("idle");
  const hydratedRef = useRef(false);
  const lastSavedRef = useRef<string>("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A snapshot is "empty" (a fresh, untouched wizard) — we never persist those,
  // and we clear any stored draft once the wizard is back to empty (post-deploy).
  const isEmptyDraft = (d: Record<string, unknown>): boolean =>
    (d.step ?? 0) === 0 && !d.cloneMode && !d.templateKey &&
    !(d.name as string)?.trim?.() && !(d.role as string)?.trim?.() && !(d.overview as string)?.trim?.() &&
    !((d.goals as unknown[])?.length) && !((d.evidence as unknown[])?.length) && !(d.profileApplied);

  // Hydrate from a saved draft on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.get<{ draft: Record<string, unknown> | null }>("/api/agents/draft");
        const d = r?.draft;
        if (!cancelled && d && typeof d === "object" && !isEmptyDraft(d)) {
          if (typeof d.cloneMode === "boolean") setCloneMode(d.cloneMode);
          if (typeof d.name === "string") setName(d.name);
          if (typeof d.role === "string") setRole(d.role);
          if (typeof d.icon === "string") setIcon(d.icon);
          if (typeof d.model === "string") setModel(d.model);
          if (typeof d.autonomy === "string") setAutonomy(d.autonomy);
          if (typeof d.autonomyTier === "number") setAutonomyTier(d.autonomyTier as AutonomyTier);
          if (typeof d.dutyCycle === "string") setDutyCycle(d.dutyCycle as DutyCycle);
          if (typeof d.department === "string") setDepartment(d.department);
          if (typeof d.startDate === "string") setStartDate(d.startDate);
          if (d.escalation && typeof d.escalation === "object") setEscalation(d.escalation as EscalationConfig);
          if (typeof d.reviewCadence === "string") setReviewCadence(d.reviewCadence as ReviewCadence);
          if (d.apprenticeship && typeof d.apprenticeship === "object") setApprenticeship(d.apprenticeship as Apprenticeship);
          if (Array.isArray(d.callSources)) setCallSources(d.callSources as CallSource[]);
          if (d.callPlaybook && typeof d.callPlaybook === "object") setCallPlaybook(d.callPlaybook as CallPlaybook);
          if (typeof d.cloneCallsOptOut === "boolean") setCloneCallsOptOut(d.cloneCallsOptOut);
          if (d.grantScope && typeof d.grantScope === "object") setGrantScope(d.grantScope as Record<string, string>);
          if (d.grantTransport && typeof d.grantTransport === "object") setGrantTransport(d.grantTransport as Record<string, "api" | "vm">);
          if (d.caps && typeof d.caps === "object") setCaps(d.caps as RuntimeCapabilities);
          if (typeof d.promotionCriteria === "string") setPromotionCriteria(d.promotionCriteria);
          if (typeof d.disclosurePolicy === "string") setDisclosurePolicy(d.disclosurePolicy as DisclosurePolicy);
          if (d.reviewOwner && typeof d.reviewOwner === "object") setReviewOwner(d.reviewOwner as Manager);
          if (d.killSwitchOwner && typeof d.killSwitchOwner === "object") setKillSwitchOwner(d.killSwitchOwner as Manager);
          if (typeof d.overview === "string") setOverview(d.overview);
          if (Array.isArray(d.goals)) setGoals(d.goals as AgentGoal[]);
          if (Array.isArray(d.permissions)) setPermissions(d.permissions as AgentPermission[]);
          if (Array.isArray(d.connections)) setConnections(d.connections as string[]);
          if (Array.isArray(d.tools)) setTools(d.tools as string[]);
          if (d.budget && typeof d.budget === "object") setBudget(d.budget as BudgetConfig);
          if (d.clone && typeof d.clone === "object") setClone(d.clone as CloneSource);
          if (d.onboarding && typeof d.onboarding === "object") setOnboarding(d.onboarding as Onboarding);
          if (typeof d.templateKey === "string") setTemplateKey(d.templateKey);
          if (Array.isArray(d.evidence)) setEvidence(d.evidence as EvidenceItem[]);
          if (typeof d.stashPlan === "string") setStashPlan(d.stashPlan);
          if (typeof d.stashRoutine === "string") setStashRoutine(d.stashRoutine);
          if (typeof d.stashInstr === "string") setStashInstr(d.stashInstr);
          if (typeof d.profileApplied === "boolean") setProfileApplied(d.profileApplied);
          if (typeof d.step === "number") setStep(Math.max(0, Math.min(stepTitles.length - 1, d.step)));
          setDraftStatus("saved");
        }
      } catch { /* no draft / offline — start fresh */ }
      finally { hydratedRef.current = true; }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave (debounced) whenever any captured field changes — so each completed
  // step is persisted. Empty snapshots delete the draft instead of storing blanks.
  useEffect(() => {
    if (!hydratedRef.current) return;
    // Call sources are persisted WITHOUT the pasted transcripts (keeps the draft
    // row small); the generated playbook + opt-out are kept.
    const callSourcesLite = callSources.map(({ transcript, ...rest }) => ({ ...rest, transcript: "", status: "empty" as const }));
    const snap: Record<string, unknown> = { v: 1, step, cloneMode, name, role, icon, model, autonomy, autonomyTier, dutyCycle, department, startDate, escalation, reviewCadence, apprenticeship, grantScope, grantTransport, caps, promotionCriteria, disclosurePolicy, reviewOwner, killSwitchOwner, overview, goals, permissions, connections, tools, budget, clone, onboarding, templateKey, evidence, stashPlan, stashRoutine, stashInstr, profileApplied, callSources: callSourcesLite, callPlaybook, cloneCallsOptOut };
    const s = JSON.stringify(snap);
    if (s === lastSavedRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const empty = isEmptyDraft(snap);
    if (!empty) setDraftStatus("saving");
    saveTimer.current = setTimeout(() => {
      void (async () => {
        try {
          if (empty) { await api.del("/api/agents/draft"); lastSavedRef.current = s; setDraftStatus("idle"); }
          else { await api.put("/api/agents/draft", { draft: snap }); lastSavedRef.current = s; setDraftStatus("saved"); }
        } catch { setDraftStatus("idle"); }
      })();
    }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, cloneMode, name, role, icon, model, autonomy, autonomyTier, dutyCycle, department, startDate, escalation, reviewCadence, apprenticeship, grantScope, grantTransport, caps, promotionCriteria, disclosurePolicy, reviewOwner, killSwitchOwner, overview, goals, permissions, connections, tools, budget, clone, onboarding, templateKey, evidence, stashPlan, stashRoutine, stashInstr, profileApplied, callSources, callPlaybook, cloneCallsOptOut]);

  // Explicitly discard the saved draft and reset the wizard to a clean slate.
  const discardDraft = () => {
    lastSavedRef.current = "";
    void api.del("/api/agents/draft").catch(() => { /* ignore */ });
    setDraftStatus("idle");
    reset();
  };

  // ---- Template picker — seeds evidence behaviors + tools/connections + icon/role,
  // then re-primes the interview so it confirms what's known and asks the gaps. ----
  const pickTemplate = (t: RoleTemplate) => {
    // Selecting a template turns clone mode off (they're mutually-exclusive accelerators).
    setCloneMode(false);
    setTemplateKey(t.key);
    setIcon(t.icon);
    if (t.key !== "blank") setRole(t.label);
    // scratch: keep template-seeded evidence behaviors.
    setEvidence(t.behaviors.map((b) => ({ behavior: b.behavior, assetType: "output" as EvidenceAssetType, instruction: b.instruction, examples: [] })));
    // Pre-check recommended tools + connections.
    setTools((prev) => Array.from(new Set([...prev, ...t.tools])));
    setConnections((prev) => Array.from(new Set([...prev, ...t.connections])));
    // Re-run the interview from a higher starting point.
    setProfileApplied(false);
    setPickerForceOpen(false); // collapse the picker now a role is chosen
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
      setPickerForceOpen(false); // collapse the picker now clone is chosen
    } else {
      setClone({});
      setPickerForceOpen(true); // reopen so they can pick again
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
  const addBehavior = () => setEvidence((prev) => [...prev, { behavior: "", assetType: "output", instruction: "", examples: [] }]);
  const removeBehavior = (i: number) => setEvidence((prev) => prev.filter((_, j) => j !== i));
  const patchBehavior = (i: number, patch: Partial<EvidenceItem>) =>
    setEvidence((prev) => prev.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const addExample = (i: number, ex: EvidenceExample) =>
    setEvidence((prev) => prev.map((e, j) => (j === i ? { ...e, examples: [...e.examples, ex] } : e)));
  const removeExample = (i: number, k: number) =>
    setEvidence((prev) => prev.map((e, j) => (j === i ? { ...e, examples: e.examples.filter((_, x) => x !== k) } : e)));

  const uploadScreenshot = async (idx: number, file: File, caption: string, assetType?: EvidenceAssetType) => {
    setUploadingIdx(idx);
    try {
      const { dataUrl, mime } = await fileToDataUrl(file);
      const res = await api.post<FileUploadResult>("/api/files", { filename: file.name, mime, dataBase64: dataUrl });
      const isImage = mime.startsWith("image/");
      addExample(idx, {
        kind: isImage ? "screenshot" : "file",
        assetType,
        fileId: res.id,
        fileName: isImage ? undefined : file.name,
        caption: caption.trim() || undefined,
      });
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
    // Seed the per-behavior evidence the agent should learn from. Merge with any
    // template-seeded behaviors (match on behavior text); keep examples already
    // provided. Clone mode wires the supplying connection instead of uploads.
    if (profile.evidenceRequests?.length) {
      setEvidence((prev) => {
        const byKey = new Map(prev.map((e) => [e.behavior.trim().toLowerCase(), e]));
        for (const r of profile.evidenceRequests ?? []) {
          const key = (r.behavior ?? "").trim().toLowerCase();
          if (!key) continue;
          const existing = byKey.get(key);
          if (existing) {
            byKey.set(key, { ...existing, assetType: existing.assetType ?? r.assetType, ask: existing.ask ?? r.ask, cloneConnection: existing.cloneConnection ?? r.connection });
          } else {
            byKey.set(key, { behavior: r.behavior, assetType: r.assetType, ask: r.ask, cloneConnection: r.connection, instruction: "", examples: [] });
          }
        }
        return Array.from(byKey.values());
      });
      // In clone mode, make sure the tools that supply this evidence are connected.
      if (cloneMode) {
        const conns = (profile.evidenceRequests ?? []).map((r) => r.connection).filter((c): c is string => !!c);
        if (conns.length) setConnections((prev) => Array.from(new Set([...prev, ...conns])));
      }
    }
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

  // A file uploaded during the interview → stored as evidence under a dedicated
  // behavior so it flows into the Examples step and the built agent.
  const attachInterviewExample = (ex: EvidenceExample) => {
    const label = "Reference examples (from interview)";
    setEvidence((prev) => {
      const idx = prev.findIndex((e) => e.behavior === label);
      if (idx >= 0) return prev.map((e, i) => (i === idx ? { ...e, examples: [...e.examples, ex] } : e));
      return [...prev, { behavior: label, assetType: "output" as EvidenceAssetType, instruction: "", examples: [ex] }];
    });
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
  // Step 1 (Identity) is complete when name + role + reports-to + duty cycle are set.
  const step0Ready = !!name.trim()
    && !!(cloneMode ? clone.name?.trim() : role.trim())
    && !!(onboarding.reportsTo?.name?.trim() || onboarding.reportsTo?.email?.trim());

  // Deploy gate (spec §6) — required before an agent can go to Shadow.
  const deployBlockers: string[] = [];
  if (!name.trim()) deployBlockers.push("Give the agent a name (Identity)");
  if (!deployRoleOk) deployBlockers.push("Set a role (Identity)");
  if (!(onboarding.reportsTo?.name?.trim() || onboarding.reportsTo?.email?.trim())) deployBlockers.push("Set who it reports to (Identity)");
  if (!escalation.contact?.trim()) deployBlockers.push("Set an escalation contact (Trust & guardrails)");
  if (dutyCycle !== "backstage" && !disclosurePolicy) deployBlockers.push("Choose a disclosure policy (Trust & guardrails)");
  if (cloneMode && apprenticeship.consentStatus !== "approved") deployBlockers.push("Get mentor consent approved (Apprenticeship)");
  if (cloneFromCalls && !callPlaybook?.approved) deployBlockers.push("Approve the call playbook (Apprenticeship)");
  const canDeploy = isValid && deployBlockers.length === 0;

  const reset = () => {
    setStep(0);
    setCloneMode(false);
    setName("");
    setRole("");
    setIcon("bot");
    setModel(activeModel);
    setAutonomy(AUTONOMY_CHOICES[0]);
    setAutonomyTier(1);
    setDutyCycle("balanced");
    setDepartment("");
    setStartDate(nextMondayISO());
    setEscalation({});
    setReviewCadence("daily_2w_then_weekly");
    setApprenticeship({ consentStatus: "not_sent", sources: { meetings: true, email: true, slackChannels: [], calendar: true, crmHistory: false, supportConvos: false }, exclusions: [], observationWeeks: 4, understandingPct: 0 });
    setCallSources([]);
    setCallPlaybook(null);
    setCloneJobId(null);
    setCloneCallsOptOut(false);
    setGrantScope({});
    setGrantTransport({});
    setCaps(DEFAULT_CAPS);
    setPromotionCriteria("");
    setDisclosurePolicy("always");
    setReviewOwner({});
    setKillSwitchOwner({});
    setShowT3Confirm(false);
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
    setPickerForceOpen(false);
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
            const lbl = assetMeta(ex.assetType).label;
            if (ex.kind === "text" && ex.text?.trim()) parts.push(`${lbl} example:\n${ex.text.trim()}`);
            else if (ex.kind === "link" && ex.url?.trim()) parts.push(`${lbl} reference: ${ex.url.trim()}`);
            else if (ex.kind === "file") parts.push(`${lbl} attachment: [${ex.fileName?.trim() || ex.caption?.trim() || "file"}]`);
            else if (ex.kind === "screenshot") parts.push(`${lbl} example: [screenshot: ${ex.caption?.trim() || "reference"}]`);
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
      autonomyTier,
      dutyCycle,
      escalation: Object.values(escalation).some(Boolean) ? escalation : undefined,
      reviewCadence,
      department: department.trim() || undefined,
      startDate: startDate || undefined,
      identity: name.trim() ? (() => {
        const dom = (company?.domain || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "company.com";
        const local = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
        return { email: `${local}-ai@${dom}`, slackHandle: `@${local}-ai`, zoomDisplayName: `${name.trim()} (After Human)`, reserved: true } as AgentIdentity;
      })() : undefined,
      connections,
      permissions,
      budgetConfig: budget,
      goals: goals.length ? goals : undefined,
      kpis: goals.length ? goals.map((g) => ({ name: g.objective, target: g.metric || "" })) : undefined,
      disclosurePolicy: dutyCycle !== "backstage" ? disclosurePolicy : undefined,
      promotionCriteria: promotionCriteria.trim() || undefined,
      reviewOwner: (reviewOwner.name || reviewOwner.email) ? reviewOwner : onboarding.reportsTo,
      killSwitchOwner: (killSwitchOwner.name || killSwitchOwner.email) ? killSwitchOwner : onboarding.reportsTo,
      apprenticeship: cloneMode ? apprenticeship : undefined,
      grants: connections.length ? connections.map((id) => ({ system: id, granted: true, scope: grantScope[id] || undefined, transport: grantTransport[id] ?? "api" as const })) : undefined,
      runtimeCapabilities: caps,
      buildTrack: track,
      cloneSource: track === "clone" ? clone : undefined,
      callPlaybook: cloneFromCalls && callPlaybook ? callPlaybook : undefined,
      onboarding: (onboarding.reportsTo || onboarding.meetings?.length || onboarding.access?.length) ? onboarding : undefined,
      evidence: track === "scratch" && evidence.length ? evidence : undefined,
      overview: finalOverview || undefined,
      instructions: finalInstructions || undefined,
      plan: finalPlan || undefined,
      routine: finalRoutine || undefined,
      budget: budgetStr,
    };
    onSubmit(agent);
    // The draft has been deployed — clear it so a fresh wizard starts clean.
    lastSavedRef.current = "";
    void api.del("/api/agents/draft").catch(() => { /* ignore */ });
    setDraftStatus("idle");
    // Show the full-screen confirmation moment (spec §6) instead of a toast.
    const dom = (company?.domain || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "company.com";
    const local = finalName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
    const firstMtg = onboarding.meetings?.[0];
    setDeployed({
      name: finalName || "Agent",
      role: finalRole || "—",
      email: `${local}-ai@${dom}`,
      reportsTo: onboarding.reportsTo?.name || onboarding.reportsTo?.email,
      channel: department.trim() ? `#${department.trim().toLowerCase()}-team` : "#team",
      firstTask: firstMtg?.name ? `Observing: ${firstMtg.name}${firstMtg.cadence ? ` — ${firstMtg.cadence}` : ""}` : "Observing team activity in Shadow",
    });
  };

  // ---- Start-from picker collapse state ----
  const hasStartSelection = !!templateKey || cloneMode;
  const showPicker = pickerForceOpen || !hasStartSelection;
  const startTemplate = ROLE_TEMPLATES.find((t) => t.key === templateKey);
  const startLabel = cloneMode
    ? `Clone${clone.name?.trim() ? ` — ${clone.name.trim()}` : " an employee"}`
    : (startTemplate?.label ?? "Custom");
  const startIcon = cloneMode ? "user-round" : (startTemplate?.icon ?? "rocket");

  // ============================================================
  // RENDER
  // ============================================================
  // Deploy confirmation — a full-screen moment, not a toast (spec §6).
  if (deployed) {
    return (
      <div style={{ padding: "24px 8px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
          <Icon name={icon} size={34} color="var(--jv-cyan)" />
        </div>
        <div>
          <div style={{ font: "var(--fw-bold) 20px var(--font-body)", color: "var(--jv-text)" }}>{deployed.name} has joined {deployed.channel}</div>
          <div style={{ font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)", marginTop: 4 }}>Deployed to Shadow — observing only. It can't send anything until {deployed.reportsTo || "its manager"} promotes it.</div>
        </div>
        <div style={{ width: "min(420px, 92%)", padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)", textAlign: "left", display: "flex", flexDirection: "column", gap: 7 }}>
          {[["user", deployed.name], ["briefcase", deployed.role], ["mail", deployed.email], ["shield-check", `Reports to ${deployed.reportsTo || "—"}`]].map(([ic, v]) => (
            <div key={String(v)} style={{ display: "flex", alignItems: "center", gap: 9, font: "var(--fw-medium) 12.5px var(--font-body)", color: "var(--jv-text-soft)" }}>
              <Icon name={ic} size={13} color="var(--jv-cyan)" />{v}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--jv-hairline)", font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>
            <Icon name="eye" size={13} color="var(--jv-amber)" />{deployed.firstTask}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <Button variant="primary" icon={<Icon name="arrow-right" size={14} />} onClick={() => { setDeployed(null); if (resetOnSubmit) reset(); onCancel?.(); }}>View agent</Button>
          <Button variant="ghost" icon={<Icon name="plus" size={14} />} onClick={() => { setDeployed(null); reset(); }}>Create another</Button>
        </div>
      </div>
    );
  }

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
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)" }}>{stepTitles[step]}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Draft save indicator — every completed step is saved automatically */}
            <span style={{ display: "flex", alignItems: "center", gap: 4, font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: draftStatus === "saved" ? "var(--jv-green)" : "var(--jv-text-faint)" }}>
              <Icon name={draftStatus === "saving" ? "loader" : draftStatus === "saved" ? "cloud-check" : "cloud"} size={12} color={draftStatus === "saved" ? "var(--jv-green)" : "var(--jv-text-faint)"} />
              {draftStatus === "saving" ? "Saving…" : draftStatus === "saved" ? "Draft saved" : "Draft"}
            </span>
            {draftStatus !== "idle" && (
              <button onClick={discardDraft} title="Discard this draft and start fresh" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-text-faint)" }}>
                Discard
              </button>
            )}
            <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>
              {cloneMode ? "Clone" : "From scratch"} · Step {step + 1} of {stepTitles.length}
            </div>
          </div>
        </div>
      </div>

      {/* Live draft summary — follows you through every step (spec Step 1 rail). */}
      {(name.trim() || role.trim() || cloneMode) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16, padding: "8px 10px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)" }}>
          {[
            name.trim() && ["user", name.trim()],
            (cloneMode ? clone.title?.trim() : role.trim()) && ["briefcase", (cloneMode ? clone.title?.trim() : role.trim())],
            department.trim() && ["building-2", department.trim()],
            (onboarding.reportsTo?.name || onboarding.reportsTo?.email) && ["shield-check", `↳ ${onboarding.reportsTo?.name || onboarding.reportsTo?.email}`],
            ["gauge", `T${autonomyTier} ${TRUST_TIERS.find((t) => t.tier === autonomyTier)?.name ?? ""}`],
            ["activity", DUTY_CYCLES.find((d) => d.key === dutyCycle)?.name ?? ""],
            goals.length > 0 && ["target", `${goals.length} KPI${goals.length === 1 ? "" : "s"}`],
            cloneMode && ["graduation-cap", `consent ${apprenticeship.consentStatus}`],
          ].filter(Boolean).map((c) => {
            const [ic, label] = c as [string, string];
            return (
              <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: "var(--r-pill)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", font: "var(--fw-medium) 10.5px var(--font-body)", color: "var(--jv-text-soft)" }}>
                <Icon name={ic} size={11} color="var(--jv-cyan)" />{label}
              </span>
            );
          })}
        </div>
      )}

      {/* ================= STEP 1 · IDENTITY ================= */}
      {step === 0 && (
        <div>
          <p style={{ margin: "0 0 14px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>
            This is where you bring a new unit onto the team. The AI researches {companyName || "your company"} and drafts the role below — mission, access, chain of command and goals — then walks you through onboarding, stage by stage, the way you'd onboard a person. Edit anything inline, or start from a template or clone an existing employee to jump ahead.
          </p>

          {/* Company context — slim strip when idle; expands to a form on Edit. */}
          <div style={{ marginBottom: 14, padding: companyEditing ? "12px 14px" : "7px 12px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-cyan)" }}>
            {!companyEditing ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="building-2" size={14} color="var(--jv-cyan)" />
                <span style={{ font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)", whiteSpace: "nowrap" }}>Tailoring to {companyName ?? "your company"}</span>
                <span style={{ flex: 1, minWidth: 0, font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[company?.industry?.trim(), company?.size?.trim()].filter(Boolean).join(" · ") || "set it so the AI can research your company"}
                </span>
                <button onClick={openCompanyEdit} title="Edit company profile" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: "var(--jv-cyan-300)", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  <Icon name="pencil" size={11} color="var(--jv-cyan-300)" /> Edit
                </button>
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

          {/* Start from… — full picker until a role/clone is chosen, then it
              collapses to a compact summary to reclaim space. */}
          {showPicker ? (
            <div style={{ marginBottom: 14, padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Icon name="rocket" size={14} color="var(--jv-cyan)" />
                <span style={{ flex: 1, font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>Start from…</span>
                <span style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>optional — the interview runs either way</span>
                {hasStartSelection && (
                  <button onClick={() => setPickerForceOpen(false)} title="Collapse" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--jv-text-faint)", display: "grid", placeItems: "center" }}>
                    <Icon name="chevron-up" size={14} />
                  </button>
                )}
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
            </div>
          ) : (
            <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-cyan)" }}>
              <Icon name={startIcon} size={15} color="var(--jv-cyan)" />
              <span style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>Starting from</span>
              <span style={{ flex: 1, minWidth: 0, font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{startLabel}</span>
              <button onClick={() => setPickerForceOpen(true)} title="Change the starting point" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: "var(--jv-cyan-300)", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                <Icon name="pencil" size={11} color="var(--jv-cyan-300)" /> Change
              </button>
            </div>
          )}

          {/* Who to clone — the mentor whose work the agent mirrors (Company people) */}
          {cloneMode && (
            <Field label="Clone which employee?" hint="Pick the mentor whose role, systems and style this agent mirrors. The interview then confirms what it inferred.">
              <PersonPicker
                people={people}
                name={clone.name}
                email={clone.email}
                placeholder="Full name — e.g. Dana Rivera"
                onChange={(v) => {
                  const picked = people.find((p) => (v.email && p.email === v.email) || (v.name && p.name === v.name));
                  setClonePatch({ name: v.name, email: v.email, title: picked?.title ?? clone.title });
                  if (picked?.title && !role.trim()) setRole(picked.title);
                  if (picked?.department && !department.trim()) setDepartment(picked.department);
                }}
              />
            </Field>
          )}

          {/* AE/CS clone -> the Apprenticeship step becomes "clone from real calls". */}
          {cloneMode && roleCategoryOf(cloneRoleText) !== "other" && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "0 0 16px", padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Icon name="phone-call" size={16} color="var(--jv-cyan)" />
                <div>
                  <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-cyan-100)" }}>
                    {roleCategoryOf(cloneRoleText) === "ae" ? "Account Executive" : "Customer Success"} role detected
                  </div>
                  <div style={{ font: "var(--fw-regular) 10.5px var(--font-body)", color: "var(--jv-text-soft)", marginTop: 1 }}>
                    The Apprenticeship step becomes “Clone from real calls” — paste 4+ call transcripts to learn the flow.
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
                <span style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-text-faint)" }}>Use calls</span>
                <Switch checked={!cloneCallsOptOut} onChange={(v) => setCloneCallsOptOut(!v)} />
              </div>
            </div>
          )}

          {/* ---- Identity fields (spec Step 1) ---- */}
          <Field label={cloneMode ? "Agent name" : "Name & role"} hint="Name this unit — its reserved accounts generate from this.">
            <div style={{ display: "grid", gridTemplateColumns: cloneMode ? "1fr" : "1fr 1fr", gap: 12 }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maya-2" style={inputStyle} />
              {!cloneMode && <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role — e.g. Customer Success Manager" style={inputStyle} />}
            </div>
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Field label="Department" hint="Which team this unit joins.">
              <select value={department} onChange={(e) => setDepartment(e.target.value)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
                <option value="">Select…</option>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Start date" hint="First day. Defaults to next Monday.">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <Field label="Reports to" hint="The accountable human. Reviews work, approves promotions, owns the kill switch by default.">
            <PersonPicker
              people={people}
              name={onboarding.reportsTo?.name}
              email={onboarding.reportsTo?.email}
              placeholder="Manager name"
              onChange={(v) => setOnboarding((o) => ({ ...o, reportsTo: (v.name || v.email) ? { name: v.name, email: v.email } : undefined }))}
            />
          </Field>

          <Field label="Duty cycle" hint="How present this teammate is. Front-stage gets a live computer + voice; backstage runs on API workers.">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {DUTY_CYCLES.map((dc) => {
                const on = dutyCycle === dc.key;
                return (
                  <button key={dc.key} type="button" onClick={() => setDutyCycle(dc.key)} style={{ textAlign: "left", padding: "11px 14px", borderRadius: "var(--r-md)", cursor: "pointer", background: on ? "var(--grad-cyan-soft)" : "var(--jv-surface-3)", border: `1px solid ${on ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <span style={{ font: "var(--fw-bold) 13px var(--font-body)", color: "var(--jv-text)" }}>{dc.name}</span>
                      <span style={{ font: "var(--fw-semibold) 11px var(--font-mono)", color: on ? "var(--jv-cyan-300)" : "var(--jv-text-muted)" }}>{dc.cost}</span>
                    </div>
                    <div style={{ font: "var(--fw-regular) 12px/1.5 var(--font-body)", color: "var(--jv-text-soft)" }}>{dc.detail}</div>
                  </button>
                );
              })}
            </div>
          </Field>

          {name.trim() && (() => {
            const dom = (company?.domain || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "company.com";
            const local = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
            const taken = people.some((p) => (p.email || "").toLowerCase() === `${local}-ai@${dom}`.toLowerCase());
            return (
              <Field label="Reserved identity" hint="Reserved now — the real Workspace / Slack / Zoom accounts are created only when you deploy.">
                <div style={{ padding: "12px 14px", borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)", display: "flex", flexDirection: "column", gap: 7 }}>
                  {[["mail", `${local}-ai@${dom}`], ["message-square", `@${local}-ai`], ["video", `${name.trim()} (After Human)`]].map(([ic, val]) => (
                    <div key={val} style={{ display: "flex", alignItems: "center", gap: 9, font: "var(--fw-medium) 12.5px var(--font-mono)", color: "var(--jv-text-soft)" }}>
                      <Icon name={ic} size={13} color="var(--jv-cyan)" />{val}
                    </div>
                  ))}
                  <span style={{ alignSelf: "flex-start", marginTop: 2, font: "var(--fw-semibold) 8.5px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-amber)", padding: "2px 7px", borderRadius: "var(--r-pill)", background: "color-mix(in srgb, var(--jv-amber) 12%, transparent)" }}>Reserved · created at deploy</span>
                  {taken && <span style={{ font: "var(--fw-medium) 10.5px var(--font-body)", color: "var(--jv-amber)" }}>That email is already taken — tweak the name.</span>}
                </div>
              </Field>
            );
          })()}

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
            onAttach={attachInterviewExample}
          />
        </div>
      )}

      {/* ================= STEP 3 · ACCESS & GRANTS ================= */}
      {step === 2 && (
        <div>
          <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>
            What this agent can touch. Grants are scoped to the agent's own identity — connect the systems it should reach, then set what it needs granted on day one. Financial systems require a separate finance requisition.
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

          {/* Grant scope + transport per selected system */}
          {connections.length > 0 && (
            <Field label="Grant scope & transport" hint="Scope each grant to the agent's own identity. API = direct integration; VM = runs through the agent's browser, every action logged.">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {connections.map((id) => {
                  const c = catalog.find((x) => x.id === id);
                  const transport = grantTransport[id] ?? "api";
                  return (
                    <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                      <Icon name="key-round" size={14} color="var(--jv-cyan)" />
                      <span style={{ flex: "0 0 120px", font: "var(--fw-semibold) 12px var(--font-body)", color: "var(--jv-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c?.label ?? id}</span>
                      <input value={grantScope[id] ?? ""} onChange={(e) => setGrantScope((m) => ({ ...m, [id]: e.target.value }))} placeholder="scope — e.g. own mailbox, #cs-team" style={{ ...inputStyle, height: 30, flex: 1 }} />
                      <button onClick={() => setGrantTransport((m) => ({ ...m, [id]: transport === "api" ? "vm" : "api" }))} title="Toggle transport" style={{ padding: "3px 10px", borderRadius: "var(--r-pill)", cursor: "pointer", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: transport === "api" ? "var(--jv-cyan-300)" : "var(--jv-amber)", background: "var(--jv-void)", border: `1px solid ${transport === "api" ? "var(--jv-border-cyan)" : "color-mix(in srgb, var(--jv-amber) 45%, transparent)"}` }}>{transport}</button>
                    </div>
                  );
                })}
              </div>
            </Field>
          )}

          {/* Runtime capabilities */}
          <Field label="Runtime capabilities" hint="What the agent's runtime can do. Defaults follow its duty cycle and department.">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {CAP_LABELS.map((cap) => (
                <div key={cap.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                  <Icon name="cpu" size={15} color={caps[cap.key] ? "var(--jv-cyan)" : "var(--jv-text-faint)"} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "var(--fw-medium) 12.5px var(--font-body)", color: "var(--jv-text-soft)" }}>{cap.label}</div>
                    <div style={{ font: "var(--fw-regular) 10.5px var(--font-body)", color: "var(--jv-text-faint)" }}>{cap.hint}</div>
                  </div>
                  <Switch checked={caps[cap.key]} onChange={() => setCaps((c) => ({ ...c, [cap.key]: !c[cap.key] }))} />
                </div>
              ))}
            </div>
          </Field>

          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px dashed var(--jv-border)", font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>
            <Icon name="ban" size={13} /> Financial systems (Stripe, payments, payroll) require a separate finance requisition — never granted here.
          </div>
        </div>
      )}

      {/* ================= STEP 2 · APPRENTICESHIP / TEACH BY EXAMPLE ================= */}
      {step === 1 && (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "0 0 6px" }}>
            <span style={{ font: "var(--fw-bold) 13px var(--font-body)", color: "var(--jv-text)" }}>
              {cloneFromCalls ? "Clone from real calls" : cloneMode ? "Apprenticeship" : "Teach it by example"}
            </span>
            {!cloneMode && <span style={{ padding: "1px 8px", borderRadius: "var(--r-pill)", font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-text-muted)", border: "1px solid var(--jv-border-soft)" }}>Optional</span>}
          </div>

          {cloneFromCalls ? (
            <CloneFromCallsStep
              sources={callSources}
              onSources={setCallSources}
              playbook={callPlaybook}
              onPlaybook={setCallPlaybook}
              jobId={cloneJobId}
              onJobId={setCloneJobId}
              agentName={clone.name?.trim() || name.trim()}
              role={cloneRoleText}
              mentorName={clone.name?.trim() || ""}
            />
          ) : cloneMode ? (
            <ApprenticeshipEditor apprenticeship={apprenticeship} setApprenticeship={setApprenticeship} mentorName={clone.name?.trim() || ""} />
          ) : (
            <>
              <p style={{ margin: "0 0 14px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>
                For the agent to actually learn the job, give it real evidence per behavior — a notetaker transcript, a policy, a Notion page, a calendar screenshot, an email, or an example of the ideal output. Paste text, upload a file/screenshot, or drop a link. You can skip and deploy without any.
              </p>

              {/* Grounding meter */}
              <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-cyan-300)" }}>Grounding</span>
                  <span style={{ font: "var(--fw-bold) 13px var(--font-mono)", color: readiness >= 60 ? "var(--jv-green)" : "var(--jv-amber)" }}>{readiness}%</span>
                </div>
                <div style={{ height: 8, borderRadius: "var(--r-pill)", background: "var(--jv-void)", overflow: "hidden", border: "1px solid var(--jv-border-soft)" }}>
                  <div style={{ width: `${readiness}%`, height: "100%", background: readiness >= 60 ? "var(--jv-green)" : "var(--grad-cyan)", transition: "width var(--t)" }} />
                </div>
                <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 6 }}>
                  {behaviorCount === 0
                    ? "No behaviors yet — add one to teach by example, or skip this step."
                    : `${groundedCount} of ${behaviorCount} behaviors have evidence.${readiness < 60 ? " More evidence = a sharper agent — you can still deploy." : ""}`}
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
                    onUpload={(file, caption, assetType) => uploadScreenshot(i, file, caption, assetType)}
                  />
                ))}
                <Button variant="ghost" size="sm" icon={<Icon name="plus" size={13} />} onClick={addBehavior}>Add behavior</Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================= STEP 4 · TRUST & GUARDRAILS ================= */}
      {step === 3 && (
        <div>
          <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>
            Set the operating guardrails. Sensible defaults are applied — grant only the permissions this agent needs and cap what it may spend.
          </p>

          {/* Trust tier — the primary control. Permissions DERIVE from it; you
              promote an agent up the tiers the way a hire earns autonomy. */}
          <Field label="Trust tier" hint="How much this agent may do on its own. It earns higher tiers through review — start in Shadow.">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {TRUST_TIERS.map((t) => {
                const on = autonomyTier === t.tier;
                return (
                  <button key={t.tier} type="button" onClick={() => { if (t.tier === 3 && autonomyTier !== 3) setShowT3Confirm(true); else applyTier(t.tier); }} style={{ textAlign: "left", padding: "12px 14px", borderRadius: "var(--r-md)", cursor: "pointer", background: on ? "var(--grad-cyan-soft)" : "var(--jv-surface-3)", border: `1px solid ${on ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                      <span style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", color: on ? "var(--jv-cyan-300)" : "var(--jv-text-muted)" }}>T{t.tier}</span>
                      <span style={{ font: "var(--fw-bold) 13.5px var(--font-body)", color: "var(--jv-text)" }}>{t.name}</span>
                      <span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-muted)" }}>— {t.tagline}</span>
                    </div>
                    <div style={{ font: "var(--fw-regular) 12px/1.5 var(--font-body)", color: "var(--jv-text-soft)" }}>{t.detail}</div>
                  </button>
                );
              })}
            </div>
            {autonomyTier === 3 && (
              <div style={{ marginTop: 8, display: "flex", gap: 7, alignItems: "flex-start", padding: "9px 12px", borderRadius: "var(--r-sm)", background: "color-mix(in srgb, var(--jv-amber) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-amber) 30%, transparent)", font: "var(--fw-medium) 11.5px/1.5 var(--font-body)", color: "var(--jv-amber)" }}>
                <Icon name="alert-triangle" size={13} /><span>Autonomous at creation is unusual — agents normally earn it through Shadow → Supervised review cycles. Irreversible actions still verify first.</span>
              </div>
            )}
          </Field>

          <Field label="Permissions" hint="Derived from the trust tier above. Edit only if you need a custom set.">
            <button type="button" onClick={() => setAdvancedPerms((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", color: "var(--jv-text-soft)", font: "var(--fw-medium) 11.5px var(--font-body)", cursor: "pointer" }}>
              <Icon name={advancedPerms ? "chevron-down" : "chevron-right"} size={13} /> Advanced: edit derived permissions
              <span style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", color: "var(--jv-text-muted)" }}>({permissions.filter((p) => p.allowed).length} allowed)</span>
            </button>
            {advancedPerms && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                {permissions.map((p) => (
                  <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
                    <Icon name="shield-check" size={15} color={p.allowed ? "var(--jv-green)" : "var(--jv-text-faint)"} />
                    <span style={{ flex: 1, font: "var(--fw-medium) 12.5px var(--font-body)", color: "var(--jv-text-soft)" }}>{p.label}</span>
                    <span style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: p.allowed ? "var(--jv-green)" : "var(--jv-text-faint)" }}>{p.allowed ? "Allowed" : "Denied"}</span>
                    <Switch checked={p.allowed} onChange={() => togglePermission(p.label)} />
                  </div>
                ))}
              </div>
            )}
          </Field>

          <Field label="Promotion criteria" hint="What earns a promotion out of Shadow — the bar its manager checks before granting more autonomy.">
            <input value={promotionCriteria} onChange={(e) => setPromotionCriteria(e.target.value)} placeholder="e.g. 20 approved drafts with <2 corrections" style={inputStyle} />
          </Field>

          <Field label="Review cadence" hint="How often its manager reviews the work — close at first, lighter as it earns trust.">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {REVIEW_CADENCES.map((rc) => {
                const on = reviewCadence === rc.key;
                return (
                  <button key={rc.key} type="button" onClick={() => setReviewCadence(rc.key)} style={{ textAlign: "left", padding: "10px 14px", borderRadius: "var(--r-md)", cursor: "pointer", background: on ? "var(--grad-cyan-soft)" : "var(--jv-surface-3)", border: `1px solid ${on ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}` }}>
                    <div style={{ font: "var(--fw-bold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{rc.name}</div>
                    <div style={{ font: "var(--fw-regular) 11.5px/1.45 var(--font-body)", color: "var(--jv-text-soft)" }}>{rc.detail}</div>
                  </button>
                );
              })}
            </div>
          </Field>

          <EscalationEditor escalation={escalation} setEscalation={setEscalation} />

          {dutyCycle !== "backstage" && (
            <Field label="Disclosure policy" hint="Required for an agent that takes calls — how it tells people it's an AI.">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {DISCLOSURE_OPTIONS.map((d) => {
                  const on = disclosurePolicy === d.key;
                  return (
                    <button key={d.key} type="button" onClick={() => setDisclosurePolicy(d.key)} style={{ textAlign: "left", padding: "10px 14px", borderRadius: "var(--r-md)", cursor: "pointer", background: on ? "var(--grad-cyan-soft)" : "var(--jv-surface-3)", border: `1px solid ${on ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}` }}>
                      <div style={{ font: "var(--fw-bold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{d.label}</div>
                      <div style={{ font: "var(--fw-regular) 11.5px/1.45 var(--font-body)", color: "var(--jv-text-soft)" }}>{d.detail}</div>
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {showT3Confirm && (
            <div onClick={() => setShowT3Confirm(false)} style={{ position: "fixed", inset: 0, background: "color-mix(in srgb, var(--jv-void) 72%, transparent)", display: "grid", placeItems: "center", zIndex: 60 }}>
              <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px, 92vw)", padding: 20, borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid color-mix(in srgb, var(--jv-amber) 45%, transparent)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <Icon name="alert-triangle" size={18} color="var(--jv-amber)" />
                  <span style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)" }}>Autonomous at creation?</span>
                </div>
                <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.6 var(--font-body)", color: "var(--jv-text-muted)" }}>
                  T3 at start is unusual — agents normally earn autonomy through T1→T2 review cycles. It requires org-admin sign-off and is logged. Irreversible actions still verify first.
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <Button variant="ghost" size="sm" onClick={() => setShowT3Confirm(false)}>Cancel</Button>
                  <Button variant="primary" size="sm" icon={<Icon name="shield-check" size={13} />} onClick={() => { applyTier(3); setShowT3Confirm(false); }}>Confirm T3</Button>
                </div>
              </div>
            </div>
          )}

          <Field label="Budget & authority" hint="Hard limits on what this agent may spend and do.">
            <BudgetForm budget={budget} setBudget={setBudget} />
          </Field>

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
        </div>
      )}

      {/* ================= STEP 5 · PERFORMANCE CONTRACT ================= */}
      {step === 4 && (
        <div>
          <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>
            The performance contract — what success looks like and how often its manager reviews it. Deploy never waits on this; it gates promotion out of Shadow.
          </p>

          <Field label="KPIs" hint="What this agent is measured on. Start from the role presets, then tune the targets.">
            {KPI_PRESETS[templateKey] && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {KPI_PRESETS[templateKey].map((k) => {
                  const present = goals.some((g) => g.objective === k.name);
                  return (
                    <button key={k.name} disabled={present} onClick={() => setGoals((prev) => [...prev, { objective: k.name, metric: k.target }])} style={{ padding: "5px 10px", borderRadius: "var(--r-pill)", cursor: present ? "default" : "pointer", opacity: present ? 0.45 : 1, font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-cyan-300)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>+ {k.name} {k.target}</button>
                  );
                })}
              </div>
            )}
            <GoalsEditor goals={goals} setGoals={setGoals} />
            {goals.length === 0 && (
              <div style={{ marginTop: 8, font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-amber)" }}>No KPIs means no promotion criteria — this agent stays in Shadow. (You can still deploy.)</div>
            )}
          </Field>

          <MeetingsEditor onboarding={onboarding} setOnboarding={setOnboarding} />

          <Field label="Review owner" hint="Who reviews the work and signs off on promotions. Defaults to the manager it reports to.">
            <PersonPicker
              people={people}
              name={reviewOwner.name ?? onboarding.reportsTo?.name}
              email={reviewOwner.email ?? onboarding.reportsTo?.email}
              placeholder="Review owner name"
              onChange={(v) => setReviewOwner({ name: v.name, email: v.email })}
            />
          </Field>
        </div>
      )}

      {/* ================= STEP 6 · REVIEW & DEPLOY TO SHADOW ================= */}
      {step === 5 && (
        <div>
          <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>
            Review the full picture, then deploy into Shadow. {deployName || "This agent"} starts observing — it can't send anything until {onboarding.reportsTo?.name || "its manager"} promotes it.
          </p>

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
                ["Reports to", onboarding.reportsTo?.name || onboarding.reportsTo?.email || "—"],
                ["Escalates to", escalation.contact || "—"],
                ["Rules of engagement", `${Object.entries(escalation).filter(([k2, v2]) => k2 !== "contact" && v2).length} trigger(s)`],
                ["Connected systems", `${liveCount} live · ${pendingCount} pending`],
                ["Access checklist", onboarding.access?.length ? `${onboarding.access.length} item${onboarding.access.length === 1 ? "" : "s"}` : "—"],
                ["Meetings to join", onboarding.meetings?.length ? String(onboarding.meetings.length) : "—"],
                ["Readiness", cloneMode ? "—" : `${readiness}% · ${groundedCount}/${behaviorCount || 0} behaviors grounded`],
                ["Trust tier", `T${autonomyTier} · ${TRUST_TIERS.find((t) => t.tier === autonomyTier)?.name ?? ""}`],
                ["Mission", goals.length ? goals.map((g) => g.objective).join("; ") : "—"],
                ["Review cadence", REVIEW_CADENCES.find((r) => r.key === reviewCadence)?.name ?? "—"],
                ["Duty cycle", DUTY_CYCLES.find((d) => d.key === dutyCycle)?.name ?? "—"],
                ...(dutyCycle !== "backstage" ? [["Disclosure", DISCLOSURE_OPTIONS.find((d) => d.key === disclosurePolicy)?.label ?? "—"]] : []),
                ...(cloneMode ? [["Apprenticeship", `Consent ${apprenticeship.consentStatus} · understanding ${apprenticeship.understandingPct}%`]] : []),
                ["Review owner", reviewOwner.name || reviewOwner.email || onboarding.reportsTo?.name || onboarding.reportsTo?.email || "—"],
                ["Kill switch", killSwitchOwner.name || killSwitchOwner.email || onboarding.reportsTo?.name || onboarding.reportsTo?.email || "—"],
                ["Granted permissions", `${grantedCount} of ${permissions.length}`],
                ["Budget", budget.monthlyCap != null ? `${budget.currency} ${budget.monthlyCap}/mo` : "No cap set"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 12, padding: "6px 0", borderTop: "1px solid var(--jv-hairline)" }}>
                  <span style={{ flex: "0 0 150px", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>{k}</span>
                  <span style={{ flex: 1, minWidth: 0, font: "var(--fw-regular) 12px/1.5 var(--font-body)", color: "var(--jv-text-soft)" }}>{v}</span>
                </div>
              ))}
            </div>
            {deployBlockers.length > 0 && (
              <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "color-mix(in srgb, var(--jv-amber) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-amber) 30%, transparent)" }}>
                <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-amber)", marginBottom: 6 }}>Before you can deploy</div>
                {deployBlockers.map((b) => (
                  <div key={b} style={{ display: "flex", alignItems: "center", gap: 7, font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-amber)", padding: "2px 0" }}>
                    <Icon name="alert-circle" size={12} /> {b}
                  </div>
                ))}
              </div>
            )}
          </Field>

          <Field label="Kill switch owner" hint="Can suspend the agent and revoke all its access instantly. Defaults to the manager it reports to.">
            <PersonPicker
              people={people}
              name={killSwitchOwner.name ?? onboarding.reportsTo?.name}
              email={killSwitchOwner.email ?? onboarding.reportsTo?.email}
              placeholder="Kill switch owner name"
              onChange={(v) => setKillSwitchOwner({ name: v.name, email: v.email })}
            />
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
            // Step 1 gate (spec): name + role + reports-to required before advancing.
            <Button variant="primary" iconRight={<Icon name="chevron-right" size={14} />} disabled={!step0Ready} onClick={skipInterview}>
              Continue
            </Button>
          ) : step < stepTitles.length - 1 ? (
            <Button variant="primary" iconRight={<Icon name="chevron-right" size={14} />} onClick={() => setStep((s) => s + 1)}>
              Next
            </Button>
          ) : (
            <Button variant="primary" icon={<Icon name="rocket" size={14} />} disabled={!canDeploy} onClick={submit}>
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
  onUpload: (file: File, caption: string, assetType?: EvidenceAssetType) => void;
}) {
  const [caption, setCaption] = useState("");
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const asset = assetMeta(item.assetType);
  const addText = () => {
    const v = text.trim();
    if (!v) return;
    onAddExample({ kind: "text", assetType: item.assetType, text: v });
    setText("");
  };
  const addLink = () => {
    const v = link.trim();
    if (!v) return;
    onAddExample({ kind: "link", assetType: item.assetType, url: v, text: v });
    setLink("");
  };
  return (
    <div style={{ padding: "14px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-2)", border: `1px solid ${item.examples.length ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ font: "var(--fw-bold) 12px var(--font-mono)", color: "var(--jv-cyan)" }}>#{idx + 1}</span>
        <input value={item.behavior} onChange={(e) => onPatch({ behavior: e.target.value })} placeholder="Behavior — e.g. Qualify an inbound lead" style={{ ...inputStyle, height: 34 }} />
        <button onClick={onRemove} title="Remove behavior" style={{ background: "none", border: "none", color: "var(--jv-text-faint)", cursor: "pointer", display: "grid", placeItems: "center" }}><Icon name="x" size={15} /></button>
      </div>

      {/* The interview's evidence ask for this behavior */}
      {item.ask && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10, padding: "8px 10px", borderRadius: "var(--r-sm)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>
          <Icon name="sparkles" size={13} color="var(--jv-cyan)" />
          <span style={{ font: "var(--fw-regular) 11.5px/1.45 var(--font-body)", color: "var(--jv-text-soft)" }}>{item.ask}</span>
        </div>
      )}

      {/* Artifact type picker — what kind of evidence best teaches this */}
      <Field label="Evidence type" hint={asset.hint}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {ASSET_ORDER.map((t) => {
            const m = ASSET_TYPES[t];
            const on = (item.assetType ?? "output") === t;
            return (
              <button
                key={t}
                onClick={() => onPatch({ assetType: t })}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 9px", borderRadius: "var(--r-pill)", cursor: "pointer", font: "var(--fw-semibold) 11px var(--font-body)", color: on ? "var(--jv-cyan-300)" : "var(--jv-text-muted)", background: on ? "var(--grad-cyan-soft)" : "var(--jv-surface-3)", border: `1px solid ${on ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}` }}
              >
                <Icon name={m.icon} size={12} /> {m.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Instruction">
        <textarea value={item.instruction ?? ""} onChange={(e) => onPatch({ instruction: e.target.value })} placeholder="How to do this well…" style={{ ...areaStyle, height: 56 }} />
      </Field>

      <Field label={`Evidence · ${item.examples.length}`}>
        {item.examples.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {item.examples.map((ex, k) => {
              const em = assetMeta(ex.assetType);
              const isImg = ex.kind === "screenshot" && ex.fileId;
              return (
                <div key={k} style={{ position: "relative", width: isImg ? 110 : 200, padding: isImg ? 0 : "8px 10px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", overflow: "hidden" }}>
                  {isImg ? (
                    <>
                      <img src={`/api/files/${ex.fileId}`} alt={ex.caption ?? "screenshot"} style={{ width: "100%", height: 72, objectFit: "cover", display: "block" }} />
                      {ex.caption && <div style={{ padding: "4px 6px", font: "var(--fw-regular) 10px var(--font-body)", color: "var(--jv-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ex.caption}</div>}
                    </>
                  ) : ex.kind === "file" ? (
                    <a href={`/api/files/${ex.fileId}`} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 7, textDecoration: "none", color: "var(--jv-text-soft)" }}>
                      <Icon name={em.icon} size={14} color="var(--jv-cyan)" />
                      <span style={{ font: "var(--fw-medium) 11px var(--font-body)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ex.fileName ?? ex.caption ?? "file"}</span>
                    </a>
                  ) : ex.kind === "link" ? (
                    <a href={ex.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 7, textDecoration: "none", color: "var(--jv-cyan-300)" }}>
                      <Icon name="link" size={13} />
                      <span style={{ font: "var(--fw-medium) 11px var(--font-body)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ex.url}</span>
                    </a>
                  ) : (
                    <div style={{ font: "var(--fw-regular) 11px/1.4 var(--font-body)", color: "var(--jv-text-soft)", maxHeight: 72, overflow: "hidden" }}>{ex.text}</div>
                  )}
                  <button onClick={() => onRemoveExample(k)} title="Remove" style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", color: "var(--jv-text-muted)", cursor: "pointer" }}><Icon name="x" size={12} /></button>
                </div>
              );
            })}
          </div>
        )}

        {/* Add text example */}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addText())} placeholder={`Paste a ${asset.label.toLowerCase()} example as text…`} style={{ ...inputStyle, height: 34 }} />
          <Button variant="ghost" size="sm" icon={<Icon name="plus" size={13} />} disabled={!text.trim()} onClick={addText}>Text</Button>
        </div>

        {/* Add link */}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLink())} placeholder="Link a source (Notion, Drive, recording…)" style={{ ...inputStyle, height: 34 }} />
          <Button variant="ghost" size="sm" icon={<Icon name="link" size={13} />} disabled={!link.trim()} onClick={addLink}>Link</Button>
        </div>

        {/* Add file / screenshot */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (optional)" style={{ ...inputStyle, height: 34 }} />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf,.txt,.md,.doc,.docx,.csv,.vtt"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { onUpload(f, caption, item.assetType); setCaption(""); }
              e.target.value = "";
            }}
          />
          <Button variant="secondary" size="sm" icon={<Icon name={uploading ? "loader" : "upload"} size={13} />} disabled={uploading} onClick={onPickFile}>
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </Field>

      <Field label="Anti-example (optional)">
        <input value={item.antiExample ?? ""} onChange={(e) => onPatch({ antiExample: e.target.value })} placeholder="What NOT to do…" style={{ ...inputStyle, height: 34 }} />
      </Field>
    </div>
  );
}
