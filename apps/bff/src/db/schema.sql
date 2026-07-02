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

-- An agent's plan (goal) and routine (recurring steps), so it knows its job.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS plan TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS routine TEXT;

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
