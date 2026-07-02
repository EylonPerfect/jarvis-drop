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
  createdAt?: string;
}

export interface AgentPermission {
  label: string;
  allowed: boolean;
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
