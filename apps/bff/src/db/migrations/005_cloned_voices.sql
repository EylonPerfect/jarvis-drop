-- ============================================================
-- CLONED-VOICE OWNERSHIP LEDGER — records every ElevenLabs voice WE created for
-- a clone (via clone-from-calls or clone-from-sample), and WHICH org's EL key
-- created it (via_org: the org's own key, or the platform key for self-serve).
--
-- Purpose: on org/clone deletion (lib/purge.ts) we must REVOKE the biometric
-- voice we generated — but ONLY those, never a library/platform voice the org
-- merely SELECTED, and using the SAME key that created it. This ledger is the
-- source of truth for "voices that are ours to delete".
--
-- Idempotent; applied on boot AFTER tenancy.sql (orgs exist). MIGRATE_ON_BOOT-safe.
-- ============================================================
CREATE TABLE IF NOT EXISTS cloned_voices (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent_id   TEXT,                 -- the clone this voice belongs to (one canonical voice per clone)
  voice_id   TEXT NOT NULL,        -- the ElevenLabs voice id we created
  via_org    TEXT NOT NULL,        -- org whose EL key created it (own, or the platform org)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cloned_voices_org_idx ON cloned_voices (org_id);
CREATE INDEX IF NOT EXISTS cloned_voices_agent_idx ON cloned_voices (agent_id);
-- A given ElevenLabs voice id is tracked once.
CREATE UNIQUE INDEX IF NOT EXISTS cloned_voices_voice_uniq ON cloned_voices (voice_id);
