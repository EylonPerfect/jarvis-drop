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
