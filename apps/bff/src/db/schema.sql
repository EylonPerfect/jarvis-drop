-- ============================================================
-- J.A.R.V.I.S. Command Center — BFF-owned schema.
-- These tables back the screens hermes-agent does not model
-- (agent roster, kanban, calendar, knowledge base, cost ledger,
-- tool toggles, personal-intelligence profile).
-- ============================================================

CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  icon          TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'standby',      -- optimal | standby
  status_label  TEXT NOT NULL DEFAULT 'Standby',
  model         TEXT,
  tools         JSONB NOT NULL DEFAULT '[]',
  collaborators JSONB NOT NULL DEFAULT '[]',
  autonomy      TEXT,
  instructions  TEXT,
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  col       TEXT NOT NULL,                             -- todo | progress | blocked | done
  priority  TEXT NOT NULL,                             -- critical | high | medium | low
  tags      JSONB NOT NULL DEFAULT '[]',
  link      TEXT,
  position  INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reminders (
  id       TEXT PRIMARY KEY,
  text     TEXT NOT NULL,
  time     TEXT NOT NULL,
  grp      TEXT NOT NULL,                              -- overdue | today | upcoming
  due_at   TIMESTAMPTZ,
  sort     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS time_entries (
  id       TEXT PRIMARY KEY,
  title    TEXT NOT NULL,
  project  TEXT NOT NULL,
  minutes  INTEGER NOT NULL,
  category TEXT,
  sort     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS memory_facts (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  value      TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS style_profiles (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  stats TEXT NOT NULL,
  msgs  TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id      TEXT PRIMARY KEY,
  icon    TEXT NOT NULL,
  title   TEXT NOT NULL,
  kind    TEXT NOT NULL,
  chunks  INTEGER NOT NULL DEFAULT 0,
  status  TEXT NOT NULL DEFAULT 'indexed',            -- indexed | indexing
  sort    INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collections (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0
);

-- Persisted enable/disable state for tools & skills, keyed by tool id.
CREATE TABLE IF NOT EXISTS tool_toggles (
  id           TEXT PRIMARY KEY,
  grp          TEXT NOT NULL,
  icon         TEXT NOT NULL,
  name         TEXT NOT NULL,
  descr        TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  status_tone  TEXT NOT NULL DEFAULT 'optimal',       -- optimal | warn | neutral
  sort         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS provider_keys (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  tier        TEXT NOT NULL,
  tier_tone   TEXT NOT NULL,
  placeholder TEXT NOT NULL,
  connected   BOOLEAN NOT NULL DEFAULT false,
  sort        INTEGER NOT NULL DEFAULT 0
);

-- Provider cost ledger for the current session (Memory + top-bar chip).
CREATE TABLE IF NOT EXISTS cost_entries (
  provider TEXT PRIMARY KEY,
  cost     NUMERIC(12,4) NOT NULL DEFAULT 0,
  tokens   INTEGER NOT NULL DEFAULT 0,
  sort     INTEGER NOT NULL DEFAULT 0
);

-- Misc key/value settings (vector item count, personal-intelligence prose, toggles).
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Ingested text for a knowledge source (uploaded files / Notion pages). Added
-- via ALTER so existing databases pick it up idempotently.
ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS content TEXT;

-- An agent's plan (goal) and routine (recurring steps), so it knows its job,
-- plus a spend budget, a schedule (its calendar), and granted permissions.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS plan TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS routine TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS budget TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS schedule TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]';

-- Hire-wizard operating spec: a human-grade setup captured across the steps —
-- role overview, reference playbook, weekly + calendar plan, connected systems,
-- and a structured budget. Legacy plan/routine/budget text stay in sync for
-- back-compat with the cockpit's summary views.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS overview TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS playbook JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS weekly_plan JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS calendar_playbooks JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS connections JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS budget_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Two-track hire: how the agent was built.
--   build_track  = 'clone' (mirror an existing employee's systems) | 'scratch'
--   clone_source = {name,title,email} of the person being cloned (clone track)
--   goals        = [{objective, metric}]
--   evidence     = [{behavior, instruction, examples:[{kind,text?,fileId?,caption?}], antiExample?}]
--                  the few-shot grounding that makes a from-scratch agent actually perform
ALTER TABLE agents ADD COLUMN IF NOT EXISTS build_track TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS clone_source JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS goals JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Living onboarding (assembled by the AI discovery interview): who the agent
-- reports to, which meetings it joins, and its access checklist (Slack, email,
-- demo env, …) with Needed/Pending/Granted status.
--   onboarding = { reportsTo:{name,email}, meetings:[{name,cadence}], access:[{item,status,note}] }
ALTER TABLE agents ADD COLUMN IF NOT EXISTS onboarding JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Real file store (evidence screenshots, uploaded docs). Bytes live in Postgres
-- (persists across restarts via the db volume); served back by id at /api/files/:id.
CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agent activity log (feeds the cockpit Performance box) and communications
-- (Latest communication block). Declared here because the cockpit routes that
-- read/write them shipped without their DDL — their absence made
-- DELETE /api/agents (which clears them) fail with 500 ("relation ... does not exist").
CREATE TABLE IF NOT EXISTS agent_activity (
  id       BIGSERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL,
  kind     TEXT NOT NULL,                       -- goal | task | routine | scheduled | workflow
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_comms (
  id       BIGSERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL,
  channel  TEXT NOT NULL,                       -- slack | email
  party    TEXT,
  subject  TEXT,
  preview  TEXT,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Human-in-the-loop approvals inbox. Produced when an agent (or the Execute-mode
-- chat) hits an irreversible action or needs a clarifying answer; resolved by the
-- operator in the Approvals inbox. Each resolve also appends to the system ledger.
CREATE TABLE IF NOT EXISTS approvals (
  id          TEXT PRIMARY KEY,
  agent       TEXT,
  action      TEXT NOT NULL,
  detail      TEXT,
  risk        TEXT,
  kind        TEXT NOT NULL DEFAULT 'action',          -- action | question
  options     JSONB NOT NULL DEFAULT '[]',
  diff        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',         -- pending | approved | rejected | answered
  answer      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Company org: the HUMANS in the company (onboarded on the Company screen).
-- reports_to_id references another row (nullable = top of the org); is_you marks
-- the operator. The org chart (GET /api/company/org) unifies these with agents.
CREATE TABLE IF NOT EXISTS company_people (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  title         TEXT,
  email         TEXT,
  department    TEXT,
  reports_to_id TEXT,          -- references company_people.id (nullable = top of org)
  is_you        BOOLEAN DEFAULT FALSE, -- marks the operator
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Operator-added AI providers (OpenAI-compatible). The active one is used
-- directly by the Command Center chat; the key is stored server-side only.
CREATE TABLE IF NOT EXISTS ai_providers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  base_url   TEXT NOT NULL,          -- e.g. https://api.openai.com/v1
  api_key    TEXT NOT NULL,
  model      TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Run history: every task an agent executed (via Hermes kanban or the provider
-- fallback), with its result. Hermes runs keep a task_id so their status/result
-- can be refreshed from the kanban board while still running.
CREATE TABLE IF NOT EXISTS agent_runs (
  id         BIGSERIAL PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  task_id    TEXT,                                -- hermes kanban task id (null for provider runs)
  task       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'running',     -- running | done | failed
  output     TEXT,
  via        TEXT,                                -- hermes | provider | none
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_agent_idx ON agent_runs (agent_id, created_at DESC);

-- Meetings an agent bot (Recall.ai) has joined. id = the Recall bot id.
CREATE TABLE IF NOT EXISTS meetings (
  id          TEXT PRIMARY KEY,
  meeting_url TEXT NOT NULL,
  bot_name    TEXT,
  agent_id    TEXT,
  status      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Real integration credentials (Gmail, Calendar, Slack, notetaker, ElevenLabs
-- voice, CRM, Notion, Drive, demo env, …). `values` holds the connect-form
-- fields as JSON; secret fields are stored here server-side and never returned
-- to the browser (only a masked hint). id = the integration id (e.g. 'slack').
CREATE TABLE IF NOT EXISTS integrations (
  id         TEXT PRIMARY KEY,
  values     JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected  BOOLEAN NOT NULL DEFAULT false,
  detail     TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Live Calibration Studio: tune a cloned agent's PersonaSpec in real time.
-- A "clone" is an existing agents row; these tables hang off agent_id.
-- ---------------------------------------------------------------------------

-- Immutable, numbered persona versions. spec = PersonaSpec JSON (sliders,
-- lexicon, rules, few-shots, knowledge boundaries, voice).
CREATE TABLE IF NOT EXISTS persona_versions (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  number      INTEGER NOT NULL,
  spec        JSONB NOT NULL,
  change_note TEXT NOT NULL DEFAULT '',
  parent_id   TEXT,
  created_by  TEXT NOT NULL DEFAULT 'operator', -- operator | feedback_compiler | extraction
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS persona_versions_agent ON persona_versions (agent_id, number);

-- A calibration or demo conversation. active_version_id advances on hot-reload.
CREATE TABLE IF NOT EXISTS calibration_sessions (
  id               TEXT PRIMARY KEY,
  agent_id         TEXT NOT NULL,
  mode             TEXT NOT NULL DEFAULT 'calibration', -- calibration | demo
  active_version_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One turn. version_id = the persona version that produced a clone turn.
CREATE TABLE IF NOT EXISTS calibration_turns (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  idx         INTEGER NOT NULL,
  role        TEXT NOT NULL,           -- user | clone
  text        TEXT NOT NULL DEFAULT '',
  version_id  TEXT,
  feedback    JSONB,                   -- { rating, note, resolvedInto }
  latency_ms  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calibration_turns_session ON calibration_turns (session_id, idx);

-- Persona fields on the agent (additive, JSONB-safe).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS persona JSONB NOT NULL DEFAULT '{}'::jsonb;           -- current PersonaSpec
ALTER TABLE agents ADD COLUMN IF NOT EXISTS golden_persona_id TEXT;                                -- pinned persona_versions.id
ALTER TABLE agents ADD COLUMN IF NOT EXISTS golden_instructions TEXT;                              -- compiled prompt the live bridge reads
ALTER TABLE agents ADD COLUMN IF NOT EXISTS voice_id TEXT;                                         -- ElevenLabs voice id

-- Clone source transcripts (Fathom note-takers) kept for persona extraction and
-- for verification (replaying real call moments against the clone).
CREATE TABLE IF NOT EXISTS clone_sources (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'fathom_transcript',
  title      TEXT,
  url        TEXT,
  transcript TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clone_sources_agent ON clone_sources (agent_id);

-- Post-call debriefs (Perfect Design System S11): corrections + memory extracted
-- from a finished call; finalize applies chosen deltas as one persona version.
CREATE TABLE IF NOT EXISTS debriefs (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  ref_kind   TEXT NOT NULL,             -- session | source
  ref_id     TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS debriefs_agent ON debriefs (agent_id, created_at DESC);

-- Live Zoom calls launched from Pre-call Check; phases tracked by the bff
-- monitor that tails the pipeline log. One active call at a time.
CREATE TABLE IF NOT EXISTS live_calls (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT,
  meeting_id  TEXT NOT NULL,
  mode        TEXT NOT NULL DEFAULT 'zoom',
  phase       TEXT NOT NULL DEFAULT 'starting',
  sandbox_id  TEXT,
  stream_url  TEXT,
  phases      JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ
);

-- Turn-by-turn rehearsal grades (server-authoritative approve/coach per part).
-- One row per (call, reply turn_seq, part); UNIQUE makes POST /api/rehearsal/grade
-- an idempotent upsert. coach_ref links a grade to the version/graph it produced.
CREATE TABLE IF NOT EXISTS rehearsal_grades (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  turn_seq INTEGER NOT NULL,
  part TEXT NOT NULL,            -- 'speech' | 'screen'
  verdict TEXT NOT NULL,         -- 'approve' | 'coach'
  coach_ref JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (call_id, turn_seq, part)
);

-- ---------------------------------------------------------------------------
-- CLONE JOIN + SCHEDULING (Launch Decisions Batch 3 #1/#5, Instant-link access
-- control). Each clone has its OWN meeting/calendar account (creds stored like
-- demo_login but encrypted); a calendar-watch scheduler reads that account and
-- fires the existing live-call launch at each meeting's start time; an
-- instant-link path summons the clone onto a pasted link now. Every live join —
-- scheduled OR instant — passes the >=70 readiness gate (never a bypass).
-- ---------------------------------------------------------------------------

-- Per-clone instant-join toggle. Default ON; an org may set a clone to
-- scheduled-only by turning this off. (INSTANT-LINK ACCESS CONTROL.)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS allow_instant_joins BOOLEAN NOT NULL DEFAULT true;
-- Per-clone calendar-watch toggle. When on (and a meeting account is stored),
-- the scheduler polls the clone's calendar and auto-schedules its meetings.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS calendar_watch BOOLEAN NOT NULL DEFAULT false;
-- Org ownership. Phase 2 (auth/roles/orgs) owns the canonical orgs table + the
-- member→org mapping; until it lands this is a nullable label so the concurrency
-- + access-control code paths are correct now and simply inherit real org ids
-- when Phase 2 is wired. INTEGRATION DEP.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS org_id TEXT;

-- Booked / summoned calls the clone should join. The calendar-watch scheduler
-- upserts calendar rows (dedup on external_event_id); the instant path inserts a
-- source='instant' row. A due-loop drives the state machine: scheduled →
-- prewarming (spin the sandbox ~3-5 min ahead) → launching (POST live/join,
-- which enforces the >=70 gate) → live → done, or → skipped/failed with a reason.
CREATE TABLE IF NOT EXISTS scheduled_calls (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL,
  org_id            TEXT,                                   -- denormalized from agents.org_id (Phase 2)
  meeting_link      TEXT NOT NULL,                          -- raw pasted/invite link
  meeting_id        TEXT,                                   -- parsed numeric Zoom id when derivable
  title             TEXT,
  source            TEXT NOT NULL DEFAULT 'calendar',       -- calendar | instant | manual
  external_event_id TEXT,                                   -- clone-calendar event id (dedup key)
  start_at          TIMESTAMPTZ NOT NULL,
  prewarm_at        TIMESTAMPTZ,                            -- computed = start_at - prewarm lead
  status            TEXT NOT NULL DEFAULT 'scheduled',      -- scheduled|prewarming|launching|live|done|failed|skipped|canceled
  prewarmed_at      TIMESTAMPTZ,
  launched_at       TIMESTAMPTZ,
  call_id           TEXT,                                   -- live_calls.id once launched
  last_error        TEXT,
  created_by        TEXT,                                   -- member id who summoned (instant) / 'scheduler'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, external_event_id)
);
CREATE INDEX IF NOT EXISTS scheduled_calls_due ON scheduled_calls (status, start_at);
CREATE INDEX IF NOT EXISTS scheduled_calls_agent ON scheduled_calls (agent_id, start_at DESC);

-- Immutable audit trail for every live join attempt (scheduled AND instant):
-- who/what summoned it, the gate decision, and the outcome. Feeds compliance +
-- the fleet watch. (INSTANT-LINK ACCESS CONTROL: audit-logged.)
CREATE TABLE IF NOT EXISTS call_audit (
  id           BIGSERIAL PRIMARY KEY,
  agent_id     TEXT,
  org_id       TEXT,
  actor        TEXT,                                        -- member id / 'scheduler'
  source       TEXT NOT NULL,                               -- instant | scheduled
  meeting_link TEXT,
  event        TEXT NOT NULL,                               -- summon | gate_pass | gate_block | concurrency_block | spend_block | disabled_block | launched | error
  score        INTEGER,                                     -- readiness score at decision time
  detail       TEXT,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_audit_agent ON call_audit (agent_id, at DESC);

-- Per-org concurrency caps (Phase 2 callstate integration). Row per org; the
-- platform-wide cap (tied to the Phase 3 spend budget/breaker) lives in settings
-- key 'platform_concurrency_cap'. Absent row → DEFAULT_ORG_CONCURRENCY in code.
CREATE TABLE IF NOT EXISTS org_concurrency (
  org_id       TEXT PRIMARY KEY,
  max_parallel INTEGER NOT NULL DEFAULT 3,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- OBSERVABILITY + INCIDENT RESPONSE (launch batch 4 — success metrics +
-- incident/breach). All additive/idempotent so migrate-on-boot is safe.
-- Spec: /root/jarvis-new/CLAUDE.md "LAUNCH DECISIONS BATCH 4".
-- ===========================================================================

-- Append-only product/funnel ledger — the "Phase 3 usage ledger" the six
-- launch metrics roll up from. One row per instrumented funnel step or usage
-- event. `name` is the event key (see lib/analytics.ts EVENTS); props carries
-- the event-specific payload. Mirrored to PostHog by lib/analytics.emit().
CREATE TABLE IF NOT EXISTS usage_events (
  id        BIGSERIAL PRIMARY KEY,
  name      TEXT NOT NULL,                       -- signup | reached_70 | went_live | live_call_run | live_call_completed | call_bail_out | call_report | landing_view | ava_session | signup_started ...
  org_id    TEXT,
  agent_id  TEXT,
  call_id   TEXT,
  value     NUMERIC,                             -- optional numeric (e.g. readiness score, minutes)
  props     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_name_ts ON usage_events (name, ts DESC);
CREATE INDEX IF NOT EXISTS usage_events_org      ON usage_events (org_id, ts DESC);
CREATE INDEX IF NOT EXISTS usage_events_agent    ON usage_events (agent_id, ts DESC);

-- NOTE (integration): the canonical `orgs` table is owned by Phase-2 tenancy
-- (apps/bff/src/db/tenancy.sql); the billing/lifecycle columns this batch needs
-- (plan/status/mrr_cents/seats/security_contact/signup_at/went_live_at/churned_at)
-- are added there as additive ALTERs so orgs stays a single canonical table.
-- Monthly MRR snapshots so NRR (net revenue retention) is computable across
-- months even as orgs upgrade/downgrade/churn. One row per (org, month).
CREATE TABLE IF NOT EXISTS mrr_snapshots (
  org_id    TEXT NOT NULL,
  month     DATE NOT NULL,                         -- first day of the month
  mrr_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, month)
);

-- NOTE (integration): the canonical `call_reports` table is owned by p5
-- (super-admin BE) and extended by p11 (transcript_ref); this batch only reads
-- COUNT(*)/created_at from it, which the canonical def provides.

-- Live-call health columns on the existing live_calls row (additive).
--   org_id            = which customer org ran the call
--   readiness_at_start= fused readiness score of the clone at join (avg-score metric)
--   outcome           = completed | bailed | ended | error (bail-out-rate metric)
ALTER TABLE live_calls ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE live_calls ADD COLUMN IF NOT EXISTS readiness_at_start INTEGER;
ALTER TABLE live_calls ADD COLUMN IF NOT EXISTS outcome TEXT;

-- Super-admin login history for the new-IP alert (the likeliest breach vector).
-- is_new_ip = true the first time an IP is seen; drives the alert in security.ts.
CREATE TABLE IF NOT EXISTS superadmin_logins (
  id         BIGSERIAL PRIMARY KEY,
  ip         TEXT NOT NULL,
  user_agent TEXT,
  is_new_ip  BOOLEAN NOT NULL DEFAULT false,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS superadmin_logins_ip ON superadmin_logins (ip, at DESC);

-- NOTE (integration): the canonical `superadmin_sessions` table is owned by p5
-- (super-admin BE). p10's lockdown/gate helper (lib/superadmin.ts) is wired to
-- that canonical table rather than redefining it here.

-- Fired-alert log (dedupe + forensics for the incident webhook dispatcher).
CREATE TABLE IF NOT EXISTS incident_alerts (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL,                         -- new_ip_superadmin | cost_runaway | bailout_spike | report_spike | lockdown
  severity   TEXT NOT NULL DEFAULT 'warning',       -- info | warning | critical
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivered  BOOLEAN NOT NULL DEFAULT false,        -- webhook POST succeeded
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incident_alerts_kind_at ON incident_alerts (kind, at DESC);

-- Cost/spend ledger with a timestamp for cost-runaway detection (the existing
-- cost_entries is a per-provider running total with no time axis, so it can't
-- detect a *rate* spike). Each row = an incremental spend event.
CREATE TABLE IF NOT EXISTS spend_events (
  id         BIGSERIAL PRIMARY KEY,
  provider   TEXT NOT NULL,                         -- openai | elevenlabs | e2b | ...
  org_id     TEXT,
  call_id    TEXT,
  cost_usd   NUMERIC(12,4) NOT NULL DEFAULT 0,
  detail     TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS spend_events_at ON spend_events (at DESC);

-- Operator-declared public status-page incidents (distinct from internal
-- incident_alerts): what customers see on /status. status: investigating |
-- identified | monitoring | resolved.
CREATE TABLE IF NOT EXISTS status_incidents (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT,
  severity   TEXT NOT NULL DEFAULT 'minor',         -- minor | major | critical | maintenance
  status     TEXT NOT NULL DEFAULT 'investigating',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Report-this-call queue (LAUNCH self-serve support). A rep files a structured
-- report from the live-call cockpit or the post-call debrief; it feeds the
-- super-admin "report-this-call queue" (routes/superadmin.ts reads this table).
-- SHAPE IS SHARED with the super-admin work — this definition matches theirs
-- exactly (CREATE TABLE IF NOT EXISTS is a no-op if they created it first). The
-- only addition is the nullable `transcript_ref` (added via ALTER below), which
-- their `SELECT *` surfaces for free.

-- ============================================================
-- SUPER-ADMIN control plane (the ONE deliberately cross-org surface).
-- Owns: superadmin identities, IP/session-gated auth, an append-only
-- audit log, time-boxed org impersonation ("enter org"), org
-- notifications, and a report-this-call queue.
--
-- Phase 2 tenancy (orgs / users / memberships / sessions + org_id on
-- tenant tables) and Phase 3 metering (usage_events + /api/usage*) are
-- DEPENDENCIES. Where those tables already exist this migration EXTENDS
-- them (see the DO block for users.is_superadmin); where they do not yet
-- exist (standalone test DB) it provisions a minimal `orgs` shim via
-- CREATE TABLE IF NOT EXISTS so this surface is testable in isolation.
-- On merge with Phase 2, reconcile the shim/columns.
-- ============================================================

-- NOTE (integration): the canonical `audit_log` is owned by Phase-2 tenancy
-- (tenancy.sql, used by lib/purge.ts). The super-admin columns this surface
-- writes (actor_user_id/severity/reason/ip/created_at/meta) + its indexes are
-- added there as additive ALTERs so audit_log stays ONE canonical table that
-- both the purge path and the super-admin control plane write to.

-- Superadmin identities. Bootstrapped from env on first login; passwords are
-- stored ONLY as a scrypt hash (format: scrypt$<N>$<saltB64>$<hashB64>).
CREATE TABLE IF NOT EXISTS superadmin_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_superadmin BOOLEAN NOT NULL DEFAULT true,
  totp_secret   TEXT,                            -- dormant; consulted only when SUPERADMIN_MFA=on
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- Short-TTL, IP-bound superadmin sessions (cookie value == token).
CREATE TABLE IF NOT EXISTS superadmin_sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES superadmin_users(id) ON DELETE CASCADE,
  ip          TEXT,                              -- session is bound to the login IP
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS superadmin_sessions_user_idx ON superadmin_sessions (user_id);

-- Time-boxed "enter org" full act-as-admin grants. Phase 2 /api/auth is expected
-- to honour a valid (unexpired, unrevoked) row as the acting org-admin identity.
-- Product credentials remain WRITE-ONLY regardless — there is never a read path.
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id                 TEXT PRIMARY KEY,
  superadmin_user_id TEXT NOT NULL,
  org_id             TEXT NOT NULL,
  reason             TEXT NOT NULL,
  ip                 TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS impersonation_org_idx ON impersonation_sessions (org_id, created_at DESC);

-- Org-facing notifications (the org is told whenever a superadmin enters or
-- suspends it). Phase 2's org UI is expected to surface unread rows.
CREATE TABLE IF NOT EXISTS org_notifications (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  kind       TEXT NOT NULL,                      -- 'impersonation_started' | 'org_suspended' | ...
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS org_notifications_org_idx ON org_notifications (org_id, created_at DESC);

-- Report-this-call queue. Rows are created org-side (Phase 2) when a call is
-- flagged; the superadmin triages them here.
CREATE TABLE IF NOT EXISTS call_reports (
  id          TEXT PRIMARY KEY,
  org_id      TEXT,
  call_id     TEXT,
  agent_id    TEXT,
  reason      TEXT NOT NULL,
  reporter    TEXT,
  severity    TEXT NOT NULL DEFAULT 'notice',
  status      TEXT NOT NULL DEFAULT 'open',      -- open | triaged | dismissed
  triage_note TEXT,
  triaged_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  triaged_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS call_reports_status_idx ON call_reports (status, created_at DESC);
-- Pointer to the reported call's transcript/film (defaults to the call id).
ALTER TABLE call_reports ADD COLUMN IF NOT EXISTS transcript_ref TEXT;

-- Phase 2 dependency: promote a real user to superadmin where the users table
-- exists. No-op on standalone/test DBs (users absent). Until Phase 2 lands the
-- bootstrap identity lives in superadmin_users above; reconcile onto users then.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    EXECUTE 'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT false';
  END IF;
END $$;
-- NOTE (integration): the provisional `orgs` shim from this surface is dropped;
-- Phase-2 tenancy (tenancy.sql) owns the canonical `orgs` (+ the lifecycle
-- columns super-admin reads), so there is a single canonical orgs table.
