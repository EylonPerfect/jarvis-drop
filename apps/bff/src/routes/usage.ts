import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import {
  checkCaps,
  getOrgBilling,
  isKillSwitchOn,
  setKillSwitch,
  isBreakerEnabled,
  setBreakerEnabled,
  globalWindowSpend,
} from "../lib/metering.js";
import { config } from "../config.js";
import { orgId } from "../lib/auth.js";
import { requireSuperadmin } from "../lib/superadmin.js";

// Phase 3 — read-only usage/cost visibility + the operator kill-switch.
// Backs a future billing/usage screen; also the runbook's inspection surface.
export default async function usageRoutes(app: FastifyInstance) {
  // Per-org rollup for a period ('month' | 'day'), plus the org's cap state.
  // A normal caller sees ONLY their own org — the org is taken from the
  // authenticated session, never the URL param (which would be an IDOR).
  app.get("/api/usage/:orgId", async (req) => {
    const org = orgId(req);
    const period = ((req.query as { period?: string })?.period ?? "month").toLowerCase();
    const view = period === "day" ? "usage_daily" : "usage_monthly";
    const bucket = period === "day" ? "day" : "month";
    const rows = await query<any>(
      `SELECT ${bucket} AS bucket, event_type, events, quantity, cost
       FROM ${view} WHERE org_id = $1 ORDER BY ${bucket} DESC, event_type`,
      [org],
    ).catch(() => []);
    const billing = await getOrgBilling(org);
    const cap = await checkCaps(org);
    return { orgId: org, period, rows, billing, cap };
  });

  // Platform-wide snapshot: recent spend window + breaker/kill state + top orgs.
  // Cross-org rollup (top-50 orgs) — platform operator only.
  app.get("/api/usage", { preHandler: requireSuperadmin }, async () => {
    const windowSpend = await globalWindowSpend();
    const killed = await isKillSwitchOn();
    const breakerEnabled = await isBreakerEnabled();
    const topOrgs = await query<any>(
      `SELECT org_id, sum(cost) AS cost,
              sum(quantity) FILTER (WHERE event_type='live_call_minute') AS live_call_minutes
       FROM usage_ledger WHERE created_at >= date_trunc('month', now())
       GROUP BY org_id ORDER BY cost DESC LIMIT 50`,
    ).catch(() => []);
    return {
      window: { minutes: config.metering.runawayWindowMinutes, spendUsd: windowSpend, limitUsd: config.metering.runawayUsdLimit },
      killSwitch: killed,
      killSwitchEnabled: killed,
      breakerEnabled,
      topOrgs,
    };
  });

  // Operator kill-switch / breaker toggle. Two controls share this endpoint (the
  // p6 super-admin cost panel):
  //   target 'breaker'                    → runaway-spend circuit breaker enable
  //   target 'global' | 'kill' | absent   → global emergency-stop kill-switch
  // Body: { target?, enabled?/on?: bool, note?/reason? }. `on` is back-compat.
  app.post("/api/usage/kill-switch", { preHandler: requireSuperadmin }, async (req, reply) => {
    const b = (req.body ?? {}) as { target?: string; enabled?: boolean; on?: boolean; note?: string; reason?: string };
    const val = typeof b.enabled === "boolean" ? b.enabled : b.on;
    if (typeof val !== "boolean") return reply.code(400).send({ error: "enabled/on (boolean) required" });
    const note = b.note ?? b.reason;
    if (b.target === "breaker") {
      await setBreakerEnabled(val, note);
      return { ok: true, target: "breaker", enabled: val };
    }
    await setKillSwitch(val, note);
    return { ok: true, target: "global", on: val, enabled: val };
  });

  // Set/adjust an org's billing config (allowance / hard cap / overage / pause).
  // Platform/operator write — superadmin only; the :orgId param is the operator's
  // chosen target org (safe here because the caller is a verified superadmin).
  app.post("/api/usage/:orgId/billing", { preHandler: requireSuperadmin }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const b = (req.body ?? {}) as {
      seatFeeUsd?: number; includedMinutes?: number; hardCapMinutes?: number; overagePerMin?: number; paused?: boolean;
    };
    await query(
      `INSERT INTO org_billing_config (org_id, seat_fee_usd, included_minutes, hard_cap_minutes, overage_per_min, paused, updated_at)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,false), now())
       ON CONFLICT (org_id) DO UPDATE SET
         seat_fee_usd     = COALESCE(EXCLUDED.seat_fee_usd, org_billing_config.seat_fee_usd),
         included_minutes = COALESCE(EXCLUDED.included_minutes, org_billing_config.included_minutes),
         hard_cap_minutes = COALESCE(EXCLUDED.hard_cap_minutes, org_billing_config.hard_cap_minutes),
         overage_per_min  = COALESCE(EXCLUDED.overage_per_min, org_billing_config.overage_per_min),
         paused           = EXCLUDED.paused,
         updated_at       = now()`,
      [orgId, b.seatFeeUsd ?? null, b.includedMinutes ?? null, b.hardCapMinutes ?? null, b.overagePerMin ?? null, b.paused ?? null],
    );
    const row = await one<any>(`SELECT * FROM org_billing_config WHERE org_id=$1`, [orgId]);
    return { ok: true, billing: row };
  });
}
