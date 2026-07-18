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
  // ---- v2 hire: onboard an agent like a human employee ----
  dutyCycle?: DutyCycle;            // step 1 — $ backstage · $$ balanced · $$$ front-stage
  identity?: AgentIdentity;         // step 1 — reserved now, created at deploy
  autonomyTier?: AutonomyTier;      // step 4 — 1 Shadow · 2 Supervised · 3 Autonomous (permissions derive from this)
  escalation?: EscalationConfig;    // step 4 — triggers + contact
  disclosurePolicy?: DisclosurePolicy; // step 4 — required when it takes calls
  kpis?: AgentKpi[];                // step 5 — performance contract
  promotionCriteria?: string;       // step 4 — what earns T1→T2→T3
  reviewCadence?: ReviewCadence;    // step 4/5
  createdAt?: string;
}

export interface AgentPermission {
  label: string;
  allowed: boolean;
}

// ---- Wizard sub-types ----
export interface AgentPlaybook {
  kind: "notion" | "file" | "text" | "calls" | "none";
  name?: string; // display title
  url?: string; // notion url (kind=notion)
  sourceId?: string; // knowledge_sources id when attached
  callPlaybook?: CallPlaybook; // kind=calls — clone-from-calls storyboard
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

// ---- v2 hire types (onboard an agent like a human employee) ----
export type DutyCycle = "backstage" | "balanced" | "frontstage";
export type AutonomyTier = 1 | 2 | 3; // 1 Shadow (read+draft) · 2 Supervised (approval queue) · 3 Autonomous
export type DisclosurePolicy = "always" | "when_asked" | "per_customer";
export type ReviewCadence = "daily_2w_then_weekly" | "weekly" | "biweekly";

// Reserved at step 1, real accounts created at deploy (never before).
export interface AgentIdentity {
  email: string;          // proposed local-part @ workspace domain
  slackHandle: string;    // @maya-ai
  zoomDisplayName: string;
  reserved: boolean;      // true once step 1 saved
  created?: boolean;      // true once deploy provisions the real accounts
}

export interface EscalationConfig {
  discountOrContract?: boolean;
  churnOrLegalRisk?: boolean;
  askedIfAI?: boolean;
  irreversibleAction?: boolean;
  sentimentDrop?: boolean;
  lowConfidence?: boolean;
  contact?: string;       // user id or slack channel — required before deploy
}

export interface AgentKpi { name: string; target: string }

// ---- Apprenticeship (clone path): consent-gated learning from a mentor ----
export type ConsentStatus = "not_sent" | "pending" | "approved" | "declined";
export interface ApprenticeshipSources {
  meetings: boolean;
  email: boolean;
  slackChannels: string[]; // explicit channel ids, never "all"
  calendar: boolean;
  crmHistory: boolean;
  supportConvos: boolean;
}
export interface Apprenticeship {
  consentStatus: ConsentStatus;
  sources: ApprenticeshipSources;
  exclusions: string[];
  observationWeeks: 2 | 4 | 6;
  understandingPct: number; // 0-100, filled by ingest
}

// ---- Access grant (Step 3): a scoped, per-agent grant over a system ----
export interface Grant {
  system: string;   // catalog connection id
  granted: boolean;
  scope?: string;   // e.g. "own mailbox", "channels: #cs-team"
  transport: "api" | "vm"; // vm = browser/GUI fallback, logged per action
}

// ---- Runtime capabilities (Step 3) ----
export interface RuntimeCapabilities {
  webSearch: boolean;
  browserControl: boolean;
  terminal: boolean;
  longTermMemory: boolean;
  scheduling: boolean;
  codeExecution: boolean;
}

// Permissions derived from the autonomy tier (the "trust is a tier" model).
export function permissionsForTier(tier: AutonomyTier): { read: boolean; write: boolean; send: boolean; approvalQueue: boolean; verifyIrreversible: boolean } {
  if (tier === 1) return { read: true, write: false, send: false, approvalQueue: false, verifyIrreversible: true };
  if (tier === 2) return { read: true, write: true, send: true, approvalQueue: true, verifyIrreversible: true };
  return { read: true, write: true, send: true, approvalQueue: false, verifyIrreversible: true };
}

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
  aiHub?: boolean; // an AI-model/AI-API service (ElevenLabs, Recall) surfaced & managed in AI Core
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
  autonomyTier?: AutonomyTier;
  dutyCycle?: DutyCycle;
  identity?: AgentIdentity;
  escalation?: EscalationConfig;   // chain-of-command: when to hand off to a human
  reviewCadence?: ReviewCadence;   // mission: how often the manager reviews the work
  department?: string;             // step 1 — which team this unit belongs to
  startDate?: string;              // step 1 — first day (ISO date)
  disclosurePolicy?: DisclosurePolicy;   // step 4 — required when it takes calls
  promotionCriteria?: string;            // step 4 — what earns T1→T2→T3
  kpis?: AgentKpi[];                     // step 5 — performance contract
  reviewOwner?: Manager;                 // step 5 — who reviews (defaults to reportsTo)
  killSwitchOwner?: Manager;             // step 6 — who can suspend + revoke access
  apprenticeship?: Apprenticeship;       // step 2 — clone-path consent + ingest
  grants?: Grant[];                      // step 3 — scoped per-agent grants
  runtimeCapabilities?: RuntimeCapabilities; // step 3
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
  /** Clone-from-calls playbook (AE/CS clone track). Compiled server-side on deploy. */
  callPlaybook?: CallPlaybook;
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
  evidenceAsk?: string; // when the question wants an artifact: what file to attach
  summary?: string; // running overall understanding of the role
  profile: DiscoverProfile;
  source: "ai" | "template";
}

// ---- Meetings (Recall.ai meeting bot: join a live call, transcribe, speak) ----
export interface MeetingTranscriptLine {
  speaker?: string;
  text: string;
}
export interface Meeting {
  id: string; // Recall bot id
  meetingUrl: string;
  botName: string;
  agentId?: string;
  status: string; // joining | in_call | done | error | left | …
  createdAt: string;
  transcript?: MeetingTranscriptLine[];
}

// ---- Artifacts (per-agent department dashboard / roadmap) ----
export interface ArtifactKPI {
  label: string;
  value?: string; // current value ("" until the agent produces data)
  target?: string; // goal / benchmark
  unit?: string; // "%", "$", "days", …
  hint?: string;
}
export interface ArtifactSection {
  title: string; // e.g. "Now", "Next", "Later" for a roadmap
  items: string[];
}
export interface Artifact {
  id: string; // = agent id
  agentId: string;
  agentName: string;
  role: string;
  department: string; // "Customer Success", "Engineering (R&D)", …
  kind: "dashboard" | "roadmap";
  icon: string;
  summary?: string;
  kpis: ArtifactKPI[];
  sections?: ArtifactSection[];
}

// ---- Agent execution (deploy + run on Hermes) ----
export interface AgentRunResult {
  ok: boolean;
  output: string; // the agent's response / result
  detail?: string; // error detail when !ok
  via: "hermes" | "provider" | "none";
  at: string;
}

// Command Center "Act" result. Questions/drafting resolve instantly (status
// "done"); real tasks run on Hermes and return status "running" + a taskId the
// client polls via /api/command/status for live progress.
export interface CommandResult {
  ok: boolean;
  via: "hermes" | "provider" | "none";
  status: "running" | "done" | "failed";
  taskId?: string;
  output?: string; // final answer/result (when done)
  progress?: string; // live "what it's doing" line (while running)
  detail?: string;
}

// A recorded run in an agent's history.
export interface AgentRunRecord {
  id: number;
  agentId: string;
  taskId?: string;
  task: string;
  status: "running" | "done" | "failed";
  output?: string;
  via?: string;
  createdAt: string;
  updatedAt?: string;
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

// ---------------------------------------------------------------------------
// Clone-from-calls: AE/CS agents onboarded from real call transcripts.
// The wizard collects >=4 note-taker sources (link + pasted transcript),
// the bff distills them into a CallPlaybook (generic FLOW, stage by stage,
// each stage = wireframe + what the VOICE does + what the SCREEN does),
// and playbookToInstructions() compiles it into live-call instructions.
// ---------------------------------------------------------------------------

export interface CallSource {
  id: string;
  /** Note-taker share link (Fathom etc.) — kept as a label, never fetched. */
  url: string;
  title?: string;
  /** Pasted transcript text. Required (>500 chars) before analysis. */
  transcript?: string;
  status: "empty" | "ready";
}

/** Generic screen-layout sketches the storyboard can render. */
export type WireframeArchetype =
  | "talk-only"
  | "dashboard"
  | "list"
  | "record-detail"
  | "form-wizard"
  | "chat-assistant"
  | "progress"
  | "compose"
  | "settings";

export const WIREFRAME_ARCHETYPES: WireframeArchetype[] = [
  "talk-only", "dashboard", "list", "record-detail", "form-wizard",
  "chat-assistant", "progress", "compose", "settings",
];

export interface WireframeSpec {
  archetype: WireframeArchetype;
  /** What this screen is, in the product's own words (e.g. "Candidate pipeline"). */
  screenTitle: string;
  /** 2-5 labels for the visible areas referenced during the stage. */
  regions: string[];
}

export interface CallStageVoice {
  objective: string;
  moves: string[];
  exampleLines: string[];
  listenFor: string[];
}

export interface CallStageScreen {
  /** Ordered screen-control intents (e.g. "bring up the ranked candidate list"). */
  actions: string[];
  /** What the voice does while the screen works (loaders, async processing). */
  waitBehavior: string;
}

export interface CallStage {
  id: string;
  name: string;
  goal: string;
  wireframe: WireframeSpec;
  voice: CallStageVoice;
  screen: CallStageScreen;
  exitCriteria?: string;
}

export interface ObjectionPair {
  objection: string;
  response: string;
}

export interface CloseByBuyer {
  buyerType: string;
  close: string;
}

/** Situational coaching directive ("when X -> do Y"), added via /api/coach. */
export interface ConditionalDirective {
  id: string;
  when: string;
  do: string;
  /** Optional screen to bring up when it fires: a site-map key (goto) or a show_screen name. */
  screen?: string;
  source?: string;
  active?: boolean;
}

export interface CallPlaybook {
  /** Source references only — transcripts are stripped after analysis. */
  sources: Pick<CallSource, "id" | "url" | "title">[];
  stages: CallStage[];
  /** Situational coaching directives — compiled as SITUATIONAL DIRECTIVES; never override honesty rules. */
  directives?: ConditionalDirective[];
  /** Exact claims the agent may state. Anything else -> offer to follow up. */
  facts: string[];
  objections: ObjectionPair[];
  pricing?: string;
  closes: CloseByBuyer[];
  generatedAt: string;
  approved: boolean;
}

export interface CloneCallsJobSource {
  id: string;
  title?: string;
  state: "queued" | "extracting" | "done" | "error";
}

export interface CloneCallsJobStatus {
  jobId: string;
  phase: "extracting" | "unifying" | "done" | "error";
  pct: number;
  perSource: CloneCallsJobSource[];
  error?: string;
  playbook?: CallPlaybook;
}

/** Role bucket that turns the Apprenticeship step into clone-from-calls. */
export function roleCategoryOf(role?: string | null): "ae" | "cs" | "other" {
  const r = (role ?? "").toLowerCase();
  if (/\baccount executive\b|\ba\.?e\.?\b|\bsales executive\b|\bsales rep\b/.test(r)) return "ae";
  if (/customer success|\bcsm\b|\bcs rep\b|\baccount manager\b/.test(r)) return "cs";
  return "other";
}

export * from "./playbookCompiler";

// ---------------------------------------------------------------------------
// Live Calibration Studio — PersonaSpec (conversational STYLE of the clone),
// tuned live and versioned. Distinct from CallPlaybook (the demo FLOW). The
// compiler merges both into one live-call system prompt.
// ---------------------------------------------------------------------------

export interface PersonaStyle {
  formality: number;    // 0..1 — anchor table in personaCompiler
  verbosity: number;
  assertiveness: number;
  warmth: number;
  humor: number;
  proactivity: number;
}
export interface SignaturePhrase { text: string; source?: string }
export interface PersonaLexicon {
  signature_phrases: SignaturePhrase[];
  banned_phrases: string[];
  vocabulary_notes: string;
}
export interface PersonaRule { id: string; text: string; source?: string; active: boolean }
export interface PersonaEscalation { triggers: string[]; action: string }
export interface PersonaFewShot {
  id: string;
  situation: string;
  human_response: string;
  source?: string;
  active: boolean;
}
export interface PersonaVoiceCfg {
  elevenlabs_voice_id?: string | null;
  speaking_rate?: number;
  stability?: number;
}

// CLONE AUTHORITY (#3) — what the clone is ALLOWED to assert as company-official,
// and how far it may commit. The authorized-facts sheet is the ONLY source of
// hard facts (real pricing, product facts, approved competitive positioning,
// common answers); everything else the clone defers on. The dial governs how
// far it can go on pricing/commitments. Two HARD landmines are baked into the
// compiler unconditionally (never invent a number; never bind a contract by
// voice) and are NOT configurable here. Compiled by personaCompiler.
export type AuthorityLevel = "conservative" | "standard" | "empowered";
export interface AuthorizedFactsSheet {
  pricing: string;        // real pricing the clone may quote verbatim
  product: string;        // key product facts it may state as fact
  positioning: string;    // approved competitive positioning / talk track
  commonAnswers: string;  // approved answers to common questions
}
export interface PersonaAuthority {
  level: AuthorityLevel;          // the dial — default "standard"
  facts: AuthorizedFactsSheet;    // the customer-editable authorized-facts sheet
}
export const DEFAULT_AUTHORITY: PersonaAuthority = {
  level: "standard",
  facts: { pricing: "", product: "", positioning: "", commonAnswers: "" },
};

export interface PersonaSpec {
  identity: { name: string; role: string; company: string; self_description?: string };
  style: PersonaStyle;
  lexicon: PersonaLexicon;
  behaviors: { rules: PersonaRule[]; escalation: PersonaEscalation };
  knowledge_boundaries: string[];
  few_shots: PersonaFewShot[];
  voice: PersonaVoiceCfg;
  // Optional for backward-compat with specs stored before CLONE AUTHORITY (#3);
  // the compiler falls back to DEFAULT_AUTHORITY (STANDARD + landmines) when absent.
  authority?: PersonaAuthority;
}

// A stored, immutable persona version.
export interface PersonaVersionRec {
  id: string;
  agentId: string;
  number: number;
  spec: PersonaSpec;
  changeNote: string;
  parentId?: string | null;
  createdBy: "operator" | "feedback_compiler" | "extraction";
  createdAt?: string;
}

export interface CalibrationTurnRec {
  id: string;
  sessionId: string;
  idx: number;
  role: "user" | "clone";
  text: string;
  versionId?: string | null;
  feedback?: { rating?: string; note?: string; resolvedInto?: string } | null;
  latencyMs?: number | null;
  createdAt?: string;
}

// A proposed change from the feedback compiler (shown as a diff before apply).
export interface PersonaDelta {
  summary: string;                 // human-readable change note
  addRule?: { text: string };
  addFewShot?: { situation: string; human_response: string };
  styleChange?: Partial<PersonaStyle>;
  addBannedPhrase?: string;
  addSignaturePhrase?: string;
}

// Verification of the clone against a real note-taker moment.
export interface VerifyResult {
  situation: string;
  humanResponse: string;     // what the human actually said (from the call)
  cloneResponse: string;     // what the clone says now
  score: number;             // 0..1 match
  note: string;
  source?: string;
}

export const DEFAULT_PERSONA_STYLE: PersonaStyle = {
  formality: 0.4, verbosity: 0.3, assertiveness: 0.6, warmth: 0.7, humor: 0.2, proactivity: 0.5,
};

export * from "./personaCompiler";
