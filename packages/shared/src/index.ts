// ============================================================
// @jarvis/shared — types shared by the web app and the BFF.
// The domain model mirrors the J.A.R.V.I.S. design so the UI
// renders identically whether data comes from Postgres or hermes.
// ============================================================

export type Tone =
  | "optimal"
  | "info"
  | "warn"
  | "critical"
  | "standby"
  | "live"
  | "neutral";

export type Priority = "critical" | "high" | "medium" | "low";

// ---- Agents (Postgres-owned; runs come from hermes) ----
export type AgentStatus = "optimal" | "standby";

export interface Agent {
  id: string;
  icon: string;
  name: string;
  role: string;
  status: AgentStatus;
  statusLabel: string;
  model?: string;
  tools?: string[];
  collaborators?: string[];
  autonomy?: string;
  instructions?: string;
  plan?: string; // the agent's goal / plan — what it's trying to achieve
  routine?: string; // the recurring routine / steps it follows
  budget?: string; // spend cap, e.g. "$500/mo"
  schedule?: string; // when/how often it runs (its calendar)
  permissions?: AgentPermission[]; // granted capabilities
  // ---- Wizard-captured operating spec (human-grade hire) ----
  overview?: string; // step 1 — what this role is about (generic explainer)
  playbook?: AgentPlaybook; // step 2 — reference doc (Notion / uploaded file / text)
  weeklyPlan?: WeeklyPlan; // step 3 — per-day focus + daily repeatable tasks
  calendarPlaybooks?: CalendarPlaybook[]; // step 3 — calendar-triggered scenarios
  connections?: string[]; // step 4 — enabled connection ids (see ConnectionCatalogItem)
  budgetConfig?: BudgetConfig; // step 5 — comprehensive, structured budget
  // ---- Two-track hire ----
  buildTrack?: BuildTrack; // 'clone' | 'scratch'
  cloneSource?: CloneSource; // clone track — the person being mirrored
  goals?: AgentGoal[]; // objectives + success metrics
  evidence?: EvidenceItem[]; // scratch track — few-shot grounding per behavior
  onboarding?: Onboarding; // living onboarding: manager, meetings, access checklist
  createdAt?: string;
}

export interface AgentPermission {
  label: string;
  allowed: boolean;
}

// ---- Wizard sub-types ----
export interface AgentPlaybook {
  kind: "notion" | "file" | "text" | "none";
  name?: string; // display title
  url?: string; // notion url (kind=notion)
  sourceId?: string; // knowledge_sources id when attached
}

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface WeeklyPlan {
  days: Partial<Record<WeekdayKey, string[]>>; // per-day focus / tasks
  daily: string[]; // repeatable every-day tasks
}

export interface CalendarPlaybook {
  id: string;
  name: string; // scenario name, e.g. "Product demo call"
  trigger: string; // e.g. "meeting" or a keyword matched against calendar events
  steps: string[]; // ordered steps to run
}

export interface BudgetConfig {
  currency: string; // e.g. "USD"
  monthlyCap?: number; // total spend cap / month
  perActionLimit?: number; // max spend per single action
  approvalThreshold?: number; // spend above this routes to the Approvals inbox
  allowPayments: boolean; // may it move money (Stripe / back office)?
  tokenBudgetUsd?: number; // LLM spend cap
  maxMessagesPerDay?: number;
  maxBrowserSessionsPerDay?: number;
  notes?: string; // free-text authority summary
}

// ---- Two-track hire types ----
export type BuildTrack = "clone" | "scratch";

export interface CloneSource {
  name?: string;
  title?: string;
  email?: string;
}

export interface AgentGoal {
  objective: string;
  metric?: string;
}

// Living-onboarding artifact: what a new hire needs on day one.
export type AccessStatus = "needed" | "pending" | "granted";
export interface AccessItem {
  item: string; // e.g. "Slack", "Email address", "Demo environment"
  status: AccessStatus;
  note?: string;
}
export interface OnboardingMeeting {
  name: string; // e.g. "Monday team standup"
  cadence?: string; // e.g. "Weekly, Mon 9:00"
}
export interface Manager {
  name?: string;
  email?: string;
}
export interface Onboarding {
  reportsTo?: Manager; // which manager the agent reports to
  meetings?: OnboardingMeeting[]; // company meetings to join
  access?: AccessItem[]; // access checklist (Slack, email, demo env, …)
}

export type EvidenceKind = "text" | "screenshot" | "file" | "link";

// The KIND of artifact an example represents — so the wizard can ask for the
// RIGHT evidence per behavior (a notetaker transcript, a policy, a Notion page,
// a calendar screenshot, an email, …) and the agent learns from real material.
export type EvidenceAssetType =
  | "output" // an example of the ideal result / output
  | "notetaker" // a call transcript or recording (Fathom / Otter / Gong)
  | "policy" // a policy / guardrails doc
  | "notion" // a Notion page / SOP
  | "calendar" // a calendar cadence example (screenshot)
  | "email" // an email / outreach example
  | "crm" // a CRM record example
  | "doc" // a generic doc / deck
  | "other";

export interface EvidenceExample {
  kind: EvidenceKind;
  assetType?: EvidenceAssetType; // what this artifact IS (notetaker, policy, …)
  text?: string; // for kind=text, or a caption/URL note
  url?: string; // for kind=link — a link to the source (Notion, drive, …)
  fileId?: string; // for kind=screenshot|file — references /api/files/:id
  fileName?: string; // original filename for kind=file
  caption?: string;
}

// One behavior the agent must perform, backed by concrete examples of good
// (and optionally bad) behavior. This is the grounding that makes a
// from-scratch agent actually work.
export interface EvidenceItem {
  behavior: string; // e.g. "Qualify an inbound lead"
  assetType?: EvidenceAssetType; // the primary evidence type this behavior wants
  ask?: string; // the interview's request, e.g. "Share a notetaker transcript of a great discovery call"
  instruction?: string; // how to do it well
  examples: EvidenceExample[]; // good examples (screenshots / text / files / links)
  antiExample?: string; // what NOT to do
  cloneConnection?: string; // clone track — the connection id that supplies this evidence
}

// What evidence to request per behavior so the agent can LEARN (from-scratch).
// In clone mode `connection` names the tool that supplies this automatically.
export interface EvidenceRequest {
  behavior: string;
  ask: string; // human-facing request for the artifact
  assetType: EvidenceAssetType;
  connection?: string; // connection id that satisfies this in clone mode
}

// Catalog of connectable systems, mapped to real Hermes toolsets. `live` marks
// whether the connection is actually wired now vs. configured-pending.
export interface ConnectionCatalogItem {
  id: string;
  label: string;
  category: "runtime" | "messaging" | "email" | "productivity" | "payments" | "dev" | "voice";
  hermesToolset?: string;
  live: boolean;
  note?: string;
  connected?: boolean; // a real credential/token is stored for this connector
}

// ---- Integrations (real credential store) ----
export type IntegrationCategory =
  | "email" | "calendar" | "messaging" | "voice" | "productivity" | "crm" | "payments" | "runtime";
export type IntegrationAuthKind = "apiKey" | "token" | "oauth" | "basic" | "none";
export type IntegrationStatus = "connected" | "disconnected" | "error";

// One field the Connect form collects. `secret` fields are stored server-side
// and never returned to the browser (only a masked hint).
export interface IntegrationField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
}

export interface Integration {
  id: string; // gmail, google_calendar, slack, notetaker, elevenlabs, crm, notion, drive, stripe, demo, browser, web, memory
  label: string;
  category: IntegrationCategory;
  icon: string; // lucide name
  authKind: IntegrationAuthKind;
  fields: IntegrationField[]; // what the Connect form collects (empty for Hermes-native/none)
  connected: boolean;
  status: IntegrationStatus;
  detail?: string; // masked summary, e.g. "bot ••••1234" or "csm@company.com"
  note?: string;
  recommended?: boolean; // e.g. ElevenLabs for voice
  hermesToolset?: string; // routes through this Hermes toolset when live
  live?: boolean; // runtime availability (Hermes/browserless reachable) regardless of creds
  docsUrl?: string; // where to get the credential
}

export interface IntegrationConnectRequest {
  values: Record<string, string>;
}
export interface IntegrationTestResult {
  ok: boolean;
  detail: string;
}

export interface AgentPerformance {
  period: "daily" | "weekly" | "monthly";
  goals: number;
  tasks: number;
  routine: number;
  scheduled: number;
  workflow: number;
}

export interface AgentComm {
  id: number;
  channel: "slack" | "email";
  party?: string;
  subject?: string;
  preview?: string;
  at: string;
}

export interface NewAgent {
  icon: string;
  name: string;
  role: string;
  model?: string;
  tools?: string[];
  collaborators?: string[];
  autonomy?: string;
  instructions?: string;
  plan?: string;
  routine?: string;
  budget?: string;
  schedule?: string;
  permissions?: AgentPermission[];
  overview?: string;
  playbook?: AgentPlaybook;
  weeklyPlan?: WeeklyPlan;
  calendarPlaybooks?: CalendarPlaybook[];
  connections?: string[];
  budgetConfig?: BudgetConfig;
  buildTrack?: BuildTrack;
  cloneSource?: CloneSource;
  goals?: AgentGoal[];
  evidence?: EvidenceItem[];
  onboarding?: Onboarding;
}

// ---- AI discovery ("breathing artifact") interview ----
export interface DiscoverProfile {
  overview?: string;
  goals?: AgentGoal[];
  reportsTo?: Manager;
  meetings?: OnboardingMeeting[];
  access?: AccessItem[];
  connections?: string[];
  tools?: string[];
  routine?: string[];
  evidenceRequests?: EvidenceRequest[]; // per-behavior evidence to ask for (scratch) / connect (clone)
}
export interface DiscoverResult {
  understanding: number; // 0-100
  done: boolean;
  nextQuestion: string;
  suggestion?: string; // a recommended ANSWER to nextQuestion (question-specific)
  summary?: string; // running overall understanding of the role
  profile: DiscoverProfile;
  source: "ai" | "template";
}

export interface RunStep {
  agent: string;
  detail: string;
  tone: "green" | "red" | "amber" | "cyan";
}

export interface AgentRun {
  id: string;
  query: string;
  ts: string;
  okCount: number;
  errCount: number;
  steps: RunStep[];
  state?: "running" | "completed" | "error";
}

export interface RuntimeStats {
  active: number;
  recentRuns: number;
  stepsToday: number;
  errors: number;
}

// ---- Tasks / Kanban (Postgres-owned) ----
export type TaskColumn = "todo" | "progress" | "blocked" | "done";

export interface Task {
  id: string;
  title: string;
  column: TaskColumn;
  priority: Priority;
  tags: string[];
  link?: string | null;
  position?: number;
}

// ---- Calendar (Postgres-owned) ----
export type ReminderGroup = "overdue" | "today" | "upcoming";

export interface Reminder {
  id: string;
  text: string;
  time: string;
  group: ReminderGroup;
  dueAt?: string;
}

export interface TimeEntry {
  id: string;
  title: string;
  project: string;
  minutes: number;
  category?: string;
}

// ---- Memory (blend: Postgres facts + hermes sessions) ----
export interface MemoryFact {
  id: string;
  label: string;
  value: string;
  confidence: number;
}

export interface StyleProfile {
  id: string;
  name: string;
  stats: string;
  msgs: string;
}

export interface VectorStoreStatus {
  status: string;
  online: boolean;
  items: number;
  detail: string;
}

export interface CostEntry {
  provider: string;
  cost: string;
  tokens: string;
}

export interface SessionCost {
  total: string;
  entries: CostEntry[];
}

// ---- Conversations (hermes sessions) ----
export interface Conversation {
  id: string;
  title: string;
  date: string;
  sessionId?: string;
}

export interface ChatMessage {
  who: "you" | "jarvis";
  text: string;
}

// ---- Knowledge Base (Postgres-owned) ----
export type IndexStatus = "indexed" | "indexing";

export interface KnowledgeSource {
  id: string;
  icon: string;
  title: string;
  kind: string;
  chunks: number;
  status: IndexStatus;
}

export interface Collection {
  id: string;
  name: string;
  count: number;
  color: string;
}

// ---- Tools & Skills (blend: hermes toolsets/skills + Postgres toggles) ----
export type ToolStatusTone = "optimal" | "warn" | "neutral";

export interface ToolItem {
  id: string;
  group: string;
  icon: string;
  name: string;
  desc: string;
  enabled: boolean;
  statusTone: ToolStatusTone;
}

// ---- Workflows (hermes jobs) ----
export type WorkflowStatus = "Enabled" | "Paused";

export interface WorkflowStep {
  icon: string;
  label: string;
}

export interface Workflow {
  id: string;
  name: string;
  trigger: string;
  status: WorkflowStatus;
  steps: WorkflowStep[];
  jobId?: string;
}

export interface WorkflowRun {
  id: string;
  name: string;
  when: string;
  tone: "optimal" | "standby";
}

// ---- AI Core (providers) ----
export interface ProviderKey {
  id: string;
  name: string;
  tier: string;
  tierTone: "free" | "paid" | "free tier";
  placeholder: string;
  connected: boolean;
}

export interface AICoreState {
  activeModel: string;
  connectedProviders: string;
  fallbacks: string;
  savedKeys: string;
  providers: ProviderKey[];
  routing: boolean;
  streaming: boolean;
  verification: boolean;
  models: string[];
}

// Operator-added OpenAI-compatible AI provider. The API key is never returned
// to the client — only whether one is set and its last 4 chars.
export interface AiProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  active: boolean;
  hasKey: boolean;
  keyLast4: string;
}

export interface NewAiProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

// ---- System Monitor (hermes health/runs + seeded telemetry) ----
export interface Gauges {
  cpu: number;
  ram: number;
  disk: number;
}

export interface LedgerEntry {
  tool: string;
  status: string;
  duration: string;
  tone: "green" | "amber" | "red" | "cyan";
}

export interface SlowTurn {
  query: string;
  meta: string;
  duration: string;
}

export type LogLevel = "INFO" | "DEBUG" | "WARN" | "ERROR";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  message: string;
  req: string;
}

// ---- Command Center ----
export interface StatusStripItem {
  icon: string;
  name: string;
  status: string;
  tone: "optimal" | "info" | "standby" | "warn";
}

export interface FeedItem {
  icon: string;
  tone: string;
  title: string;
  sub: string;
  tag: string;
}

export interface SystemHealth {
  strip: StatusStripItem[];
  gauges: Gauges;
  online: boolean;
  hermesReachable: boolean;
}

// ---- Chat request/response contract with the BFF ----
export interface ChatRequest {
  message: string;
  mode?: string | null;
  sessionId?: string | null;
}

export const HERMES_ENDPOINTS = {
  chatCompletions: "/v1/chat/completions",
  responses: "/v1/responses",
  runs: "/v1/runs",
  sessions: "/api/sessions",
  jobs: "/api/jobs",
  models: "/v1/models",
  capabilities: "/v1/capabilities",
  skills: "/v1/skills",
  toolsets: "/v1/toolsets",
  health: "/health",
  healthDetailed: "/health/detailed",
} as const;

// ---- Approvals (human-in-the-loop; Postgres-owned) ----
export type ApprovalKind = "action" | "question";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "answered";
export type ApprovalDecision = "approved" | "rejected" | "answered";

export interface Approval {
  id: string;
  agent?: string;
  action: string;
  detail?: string;
  risk?: string;
  kind: ApprovalKind;
  options: string[];
  diff?: string;
  status: ApprovalStatus;
  answer?: string;
  createdAt?: string;
  resolvedAt?: string;
}

export interface NewApproval {
  agent?: string;
  action: string;
  detail?: string;
  risk?: string;
  kind?: ApprovalKind;
  options?: string[];
  diff?: string;
}

// ---- Company people & org chart ----
// A HUMAN in the company (onboarded on the Company screen). reportsToId points
// at another Person's id (null/absent = top of the org). isYou marks the operator.
export interface Person {
  id: string;
  name: string;
  title?: string;
  email?: string;
  department?: string;
  reportsToId?: string | null;
  isYou?: boolean;
  notes?: string;
  createdAt?: string;
}

export interface NewPerson {
  name: string;
  title?: string;
  email?: string;
  department?: string;
  reportsToId?: string | null;
  isYou?: boolean;
  notes?: string;
}

// A unified org-chart node covering both humans and AI agents. Agents are
// attached under the person they report to (matched by email, then name).
export interface OrgNode {
  id: string;
  kind: "person" | "agent";
  name: string;
  title?: string;
  email?: string;
  department?: string;
  reportsToId?: string | null;
  icon?: string;
  children: OrgNode[];
}
