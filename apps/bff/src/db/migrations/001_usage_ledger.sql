-- ============================================================
-- Phase 3 — Metering & cost safety.
-- A REAL per-org usage ledger (replaces the trivial GLOBAL cost_entries
-- rollup, PK=provider) plus per-org/day and per-org/month rollup views and
-- a per-org billing-config table for the hybrid pricing model
-- (seat fee + included allowance + metered overage).
--
-- Idempotent (CREATE ... IF NOT EXISTS / CREATE OR REPLACE VIEW) so it is safe
-- to re-apply on boot. Designed ORG-SCOPED: org_id is carried on every event.
-- The tenancy migration (Phase 2) adds orgs/users and org_id to tenant rows;
-- until an event's real org is known the ledger falls back to org 'default'
-- so rows always land somewhere and the rollups stay correct.
-- ============================================================

-- One row per metered unit of consumption. The billable/overage unit for
-- pricing is the live_call_minute; the other event_types are the underlying
-- cost drivers (COGS) recorded for visibility and reconciliation.
CREATE TABLE IF NOT EXISTS usage_ledger (
  id          BIGSERIAL PRIMARY KEY,
  org_id      TEXT NOT NULL DEFAULT 'default',
  event_type  TEXT NOT NULL
    CHECK (event_type IN ('sandbox_minute','llm_tokens','tts_chars','live_call_minute')),
  quantity    NUMERIC(18,4) NOT NULL DEFAULT 0,   -- minutes | tokens | characters
  unit_cost   NUMERIC(18,8) NOT NULL DEFAULT 0,   -- USD per unit (may be blended)
  cost        NUMERIC(18,6) NOT NULL DEFAULT 0,   -- USD total for this event
  agent_id    TEXT,
  call_id     TEXT,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb, -- model, tier, provider, tokens_in/out, …
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_ledger_org_time     ON usage_ledger (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_ledger_org_type_time ON usage_ledger (org_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_ledger_call         ON usage_ledger (call_id);
CREATE INDEX IF NOT EXISTS usage_ledger_agent        ON usage_ledger (agent_id);

-- Per-org billing configuration for the HYBRID model. NULL columns fall back to
-- the env-driven global defaults (see config.ts `metering`). `paused` is the
-- org-level hard-cap switch flipped by the circuit breaker / operator.
CREATE TABLE IF NOT EXISTS org_billing_config (
  org_id            TEXT PRIMARY KEY,
  seat_fee_usd      NUMERIC(12,2),   -- per-org seat fee (informational for the ledger)
  included_minutes  INTEGER,         -- SOFT cap: allowance of live-call-minutes / month
  hard_cap_minutes  INTEGER,         -- HARD cap: pause new calls above this / month
  overage_per_min   NUMERIC(12,4),   -- price billed per overage live-call-minute
  paused            BOOLEAN NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Rollup views ---------------------------------------------------------

-- Per org, per day, per event_type.
CREATE OR REPLACE VIEW usage_daily AS
SELECT org_id,
       date_trunc('day', created_at)::date AS day,
       event_type,
       count(*)          AS events,
       sum(quantity)     AS quantity,
       sum(cost)         AS cost
FROM usage_ledger
GROUP BY org_id, date_trunc('day', created_at)::date, event_type;

-- Per org, per calendar month, per event_type.
CREATE OR REPLACE VIEW usage_monthly AS
SELECT org_id,
       date_trunc('month', created_at)::date AS month,
       event_type,
       count(*)          AS events,
       sum(quantity)     AS quantity,
       sum(cost)         AS cost
FROM usage_ledger
GROUP BY org_id, date_trunc('month', created_at)::date, event_type;

-- Wide per-org, per-month summary: the billable live-call-minutes and the total
-- COGS across every driver. This is what the hybrid allowance/overage/hard-cap
-- accounting reads.
CREATE OR REPLACE VIEW usage_org_month AS
SELECT org_id,
       date_trunc('month', created_at)::date AS month,
       sum(cost) AS total_cost,
       sum(quantity) FILTER (WHERE event_type = 'live_call_minute') AS live_call_minutes,
       sum(cost)     FILTER (WHERE event_type = 'live_call_minute') AS live_call_cost,
       sum(quantity) FILTER (WHERE event_type = 'sandbox_minute')   AS sandbox_minutes,
       sum(cost)     FILTER (WHERE event_type = 'sandbox_minute')   AS sandbox_cost,
       sum(quantity) FILTER (WHERE event_type = 'llm_tokens')       AS llm_tokens,
       sum(cost)     FILTER (WHERE event_type = 'llm_tokens')       AS llm_cost,
       sum(quantity) FILTER (WHERE event_type = 'tts_chars')        AS tts_chars,
       sum(cost)     FILTER (WHERE event_type = 'tts_chars')        AS tts_cost
FROM usage_ledger
GROUP BY org_id, date_trunc('month', created_at)::date;
