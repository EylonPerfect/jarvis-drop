-- ============================================================
-- BILLING (Stripe) — org subscription state for the hybrid-but-flat
-- per-clone pricing model (see CLAUDE.md PRICING). This table is the
-- source of truth for the free->paid LIVE gate (lib/billing.ts
-- orgCanGoLive): a clone may go LIVE only when its org has an ACTIVE
-- paid subscription with an available paid clone slot.
--
-- Kept SEPARATE from org_billing_config (which holds the metering
-- allowance/overage/hard-cap knobs). This table holds the Stripe
-- subscription identity + entitlement (paid_clone_slots = the billable
-- quantity = # of certified/live clones the org has paid for).
--
-- Idempotent (CREATE ... IF NOT EXISTS) — applied on every boot after
-- tenancy.sql, so org_id / orgs already exist.
-- ============================================================

CREATE TABLE IF NOT EXISTS org_billing (
  org_id                 TEXT PRIMARY KEY,
  -- free | starter | growth | enterprise. free never goes live.
  plan                   TEXT NOT NULL DEFAULT 'free',
  -- inactive | active | trialing | past_due | canceled | incomplete.
  -- Only active|trialing count as an ACTIVE paid subscription for the gate.
  status                 TEXT NOT NULL DEFAULT 'inactive',
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  -- The billable quantity = number of paid clone slots (certified/live clones).
  -- Updated from the Stripe subscription item quantity via the webhook.
  paid_clone_slots       INTEGER NOT NULL DEFAULT 0,
  current_period_end     TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Webhook lookups resolve an org by its Stripe ids (subscription.* events carry
-- the customer/subscription id, not necessarily our org_id in metadata).
CREATE INDEX IF NOT EXISTS org_billing_customer_idx     ON org_billing (stripe_customer_id);
CREATE INDEX IF NOT EXISTS org_billing_subscription_idx ON org_billing (stripe_subscription_id);
