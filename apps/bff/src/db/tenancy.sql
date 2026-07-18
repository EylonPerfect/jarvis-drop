-- ============================================================
-- PHASE 2 — Minimum multi-tenancy migration.
--
-- Adds the identity tables (orgs / users / memberships / sessions),
-- an org_id column on every tenant-scoped table, and a backfill that
-- assigns all pre-existing single-tenant rows to one default "legacy"
-- org so current data survives untouched.
--
-- Idempotent (safe to re-run): follows schema.sql idioms —
-- CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, and guarded
-- DO-blocks for the primary-key swaps. Applied by migrate.ts AFTER
-- schema.sql (so every tenant table already exists).
-- ============================================================

-- ------------------------------------------------------------
-- Identity tables (NOT tenant-scoped — they define the tenancy).
-- ------------------------------------------------------------

-- An org == a customer/tenant. Every tenant row hangs off orgs.id.
CREATE TABLE IF NOT EXISTS orgs (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Integration (Phase 3/4): billing + lifecycle columns consumed by the super-
-- admin backend (p5) and the observability/metrics layer (p10). Added here as
-- additive, idempotent ALTERs so `orgs` remains ONE canonical table instead of
-- being redefined in schema.sql. status spans both models: trial|active|
-- suspended|churned (default active for the existing/legacy tenant).
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS plan             TEXT NOT NULL DEFAULT 'free';
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'active';
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS mrr_cents        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS seats            INTEGER NOT NULL DEFAULT 1;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS security_contact TEXT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS signup_at        TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS went_live_at     TIMESTAMPTZ;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS churned_at       TIMESTAMPTZ;

-- A global human identity. One user can belong to many orgs (memberships).
-- password_hash = scrypt "N:r:p:saltHex:hashHex" (see lib/auth.ts); nullable so
-- an SSO/invite-only user can exist before setting a password.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  password_hash TEXT,
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Email is unique case-insensitively (login is by lower(email)).
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uniq ON users (lower(email));

-- user <-> org, with a role. PK is the pair so a user has one row per org.
CREATE TABLE IF NOT EXISTS memberships (
  user_id    TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  org_id     TEXT NOT NULL REFERENCES orgs(id)   ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',      -- owner | admin | member
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);
CREATE INDEX IF NOT EXISTS memberships_org_idx ON memberships (org_id);

-- Server-side sessions. id = the opaque random token stored in the httpOnly
-- cookie. org_id = the org this session is currently acting in (a user with
-- multiple orgs picks one; defaults to their first membership at login).
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     TEXT REFERENCES orgs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- ------------------------------------------------------------
-- The default "legacy" org: all existing single-tenant data is
-- assigned here so nothing is orphaned at cutover.
-- ------------------------------------------------------------
INSERT INTO orgs (id, name, slug)
  VALUES ('org_legacy', 'Legacy (default)', 'legacy')
  ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- org_id on every tenant-scoped table (simple case: keep the existing
-- PK, just add + backfill + constrain org_id). Done in one loop so the
-- set of tenant tables is auditable in one place.
--
-- NOTE the DEFAULT 'org_legacy': it is a TRANSITION SAFETY so any code
-- path not yet passing org_id keeps writing into the legacy org instead
-- of failing (nothing breaks pre-cutover). It MUST be dropped once every
-- write is org-aware — see the migration runbook — otherwise a forgotten
-- org_id silently leaks a row into the legacy tenant.
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'agents','tasks','reminders','time_entries','memory_facts','style_profiles',
    'knowledge_sources','collections','tool_toggles','provider_keys','files',
    'agent_activity','agent_comms','approvals','company_people','ai_providers',
    'agent_runs','meetings','integrations','persona_versions',
    'calibration_sessions','calibration_turns','clone_sources','debriefs',
    'live_calls','rehearsal_grades'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS org_id TEXT', t);
    EXECUTE format('UPDATE %I SET org_id = ''org_legacy'' WHERE org_id IS NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET DEFAULT ''org_legacy''', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (org_id)', t || '_org_idx', t);
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (org_id) REFERENCES orgs(id)',
        t, t || '_org_fk');
    EXCEPTION WHEN duplicate_object THEN
      NULL; -- FK already present
    END;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- settings: PK was (key); becomes (org_id, key) so two orgs can hold the
-- same logical key (e.g. 'company', 'workflows', or 'demo_login:<agentId>').
-- ------------------------------------------------------------
ALTER TABLE settings ADD COLUMN IF NOT EXISTS org_id TEXT;
UPDATE settings SET org_id = 'org_legacy' WHERE org_id IS NULL;
ALTER TABLE settings ALTER COLUMN org_id SET DEFAULT 'org_legacy';
ALTER TABLE settings ALTER COLUMN org_id SET NOT NULL;
DO $$
BEGIN
  -- Swap to the composite PK only if the current PK isn't already 2-column.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
     WHERE c.relname = 'settings' AND i.indisprimary
       AND array_length(i.indkey, 1) = 2
  ) THEN
    ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
    ALTER TABLE settings ADD CONSTRAINT settings_pkey PRIMARY KEY (org_id, key);
  END IF;
  BEGIN
    ALTER TABLE settings ADD CONSTRAINT settings_org_fk FOREIGN KEY (org_id) REFERENCES orgs(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ------------------------------------------------------------
-- integrations: PK was the bare connector id ('slack','gmail',…), so two orgs
-- could not both connect Slack and a second org's connect would OVERWRITE the
-- first org's stored API credentials. PK becomes (org_id, id) — each org holds
-- its own credential row per connector. org_id was already added by the loop
-- above; here we only swap the primary key.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
     WHERE c.relname = 'integrations' AND i.indisprimary
       AND array_length(i.indkey, 1) = 2
  ) THEN
    ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_pkey;
    ALTER TABLE integrations ADD CONSTRAINT integrations_pkey PRIMARY KEY (org_id, id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- cost_entries: PK was (provider) — a single GLOBAL rollup; becomes
-- (org_id, provider) so each org has its own provider ledger.
-- ------------------------------------------------------------
ALTER TABLE cost_entries ADD COLUMN IF NOT EXISTS org_id TEXT;
UPDATE cost_entries SET org_id = 'org_legacy' WHERE org_id IS NULL;
ALTER TABLE cost_entries ALTER COLUMN org_id SET DEFAULT 'org_legacy';
ALTER TABLE cost_entries ALTER COLUMN org_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
     WHERE c.relname = 'cost_entries' AND i.indisprimary
       AND array_length(i.indkey, 1) = 2
  ) THEN
    ALTER TABLE cost_entries DROP CONSTRAINT IF EXISTS cost_entries_pkey;
    ALTER TABLE cost_entries ADD CONSTRAINT cost_entries_pkey PRIMARY KEY (org_id, provider);
  END IF;
  BEGIN
    ALTER TABLE cost_entries ADD CONSTRAINT cost_entries_org_fk FOREIGN KEY (org_id) REFERENCES orgs(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ------------------------------------------------------------
-- audit_log: append-only record of privileged/governance actions —
-- primarily the HARD purge path (lib/purge.ts). This table is deliberately
-- NOT a tenant-scoped table and its org_id is NOT a FK to orgs: a purge
-- DELETEs the org row, and the audit record of that purge MUST survive it.
-- It is therefore excluded from every purge cascade and from admin "clear".
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor   TEXT,                       -- user id, or 'system'
  action  TEXT NOT NULL,              -- purge_org | purge_agent | purge_call | purge_org_external | ...
  org_id  TEXT,                       -- target org (plain text, intentionally no FK)
  target  TEXT,                       -- agentId / callId / orgId that was purged
  detail  JSONB NOT NULL DEFAULT '{}' -- row counts, external-revoke outcomes, etc.
);
CREATE INDEX IF NOT EXISTS audit_log_org_idx    ON audit_log (org_id);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action);
-- Integration (p5 super-admin control plane): the same append-only audit_log is
-- written by the super-admin surface (routes/superadmin.ts writeAudit). These
-- additive columns/indexes let both writers (purge path + super-admin) share ONE
-- canonical table instead of redefining it. All nullable/defaulted so the purge
-- writer is unaffected.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_user_id TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS severity      TEXT NOT NULL DEFAULT 'info';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS reason        TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip            TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS meta          JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx   ON audit_log (actor_user_id, created_at DESC);
