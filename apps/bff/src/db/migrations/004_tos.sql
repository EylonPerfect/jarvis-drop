-- ============================================================
-- TERMS ACCEPTANCE — append-only proof that a user affirmatively accepted a
-- given version of the Terms (and other legal docs). Every user must accept
-- before using the platform; a version bump (lib/legal.ts TOS_VERSION) forces
-- re-acceptance (T&C §18). Recorded at signup AND via the in-app blocking gate.
--
-- Idempotent (CREATE ... IF NOT EXISTS). Applied on boot AFTER tenancy.sql
-- (users/orgs exist). MIGRATE_ON_BOOT-safe.
-- ============================================================
CREATE TABLE IF NOT EXISTS tos_acceptances (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  org_id      TEXT REFERENCES orgs(id)  ON DELETE SET NULL,
  doc         TEXT NOT NULL DEFAULT 'terms',   -- terms | dpa | privacy | ...
  version     TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS tos_acceptances_user_idx ON tos_acceptances (user_id, doc);
-- One acceptance row per (user, doc, version) — idempotent on retries / re-clicks.
CREATE UNIQUE INDEX IF NOT EXISTS tos_acceptances_user_doc_version_uniq
  ON tos_acceptances (user_id, doc, version) WHERE user_id IS NOT NULL;
