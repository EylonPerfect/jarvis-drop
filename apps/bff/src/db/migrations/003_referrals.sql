-- ============================================================
-- PLG VIRAL LOOPS — the referral graph + double-sided reward ledger.
-- Backbone for all three loops (Send-to-Ava / Clone-your-team / Brag-a-clip);
-- loops differ only by referrals.loop / channel / wow_trigger.
--
-- Reward = a "free clone-month": one reward_grants row (kind='free_clone_month',
-- months=1) = +1 COMPED clone slot for 30 days, honored by lib/billing.ts
-- effective-slot math. No Lemon Squeezy coupon wiring needed to ship.
--
-- CONVERSION = the referred org's FIRST paid subscription (billing
-- subscription_created) — NOT signup. See PLG-DESIGN.md.
--
-- Idempotent (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS). Applied on
-- every boot AFTER tenancy.sql (orgs/users exist). MIGRATE_ON_BOOT-safe.
-- ============================================================

-- Each org's shareable referral code (short, url-safe). Assigned lazily by
-- lib/referrals.ts ensureRefCode() on first need (signup / GET /referrals/me).
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ref_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orgs_ref_code_uniq ON orgs (ref_code) WHERE ref_code IS NOT NULL;

-- The referral graph: ONE row per referred party (filled progressively as they
-- move clicked -> signed_up -> converted -> rewarded).
CREATE TABLE IF NOT EXISTS referrals (
  id             TEXT PRIMARY KEY,
  referrer_org   TEXT NOT NULL REFERENCES orgs(id)  ON DELETE CASCADE,
  referrer_user  TEXT          REFERENCES users(id) ON DELETE SET NULL,
  ref_code       TEXT NOT NULL,                     -- code used (snapshot)
  loop           TEXT NOT NULL DEFAULT 'ava',       -- ava | team | clip
  channel        TEXT,                              -- link | email | slack | linkedin | copy
  wow_trigger    TEXT,                              -- talk_to_ava | watched_clone | live_call | ...
  -- referred side (progressively filled)
  referred_email TEXT,
  referred_org   TEXT          REFERENCES orgs(id) ON DELETE SET NULL,
  demo_session   TEXT,                              -- ds_... if they met Ava first
  -- clicked | signed_up | converted | rewarded | void
  status         TEXT NOT NULL DEFAULT 'clicked',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_up_at   TIMESTAMPTZ,
  converted_at   TIMESTAMPTZ,
  rewarded_at    TIMESTAMPTZ
);
-- An org can be the REFERRED party at most once (attribute-once, anti-abuse).
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_org_uniq ON referrals (referred_org) WHERE referred_org IS NOT NULL;
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_org, status);
CREATE INDEX IF NOT EXISTS referrals_code_idx     ON referrals (ref_code);

-- The reward ledger. A conversion writes TWO rows (referrer + referred).
CREATE TABLE IF NOT EXISTS reward_grants (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'free_clone_month',
  months       INTEGER NOT NULL DEFAULT 1,
  reason       TEXT NOT NULL DEFAULT 'referral',
  referral_id  TEXT          REFERENCES referrals(id) ON DELETE SET NULL,
  role         TEXT,                                -- referrer | referred
  -- active | consumed | expired | revoked
  status       TEXT NOT NULL DEFAULT 'active',
  starts_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,                         -- starts_at + months*30d
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reward_grants_org_idx ON reward_grants (org_id, status);
-- One reward per (referral, role) — idempotent conversion (webhook retries safe).
CREATE UNIQUE INDEX IF NOT EXISTS reward_grants_referral_role_uniq
  ON reward_grants (referral_id, role) WHERE referral_id IS NOT NULL;
