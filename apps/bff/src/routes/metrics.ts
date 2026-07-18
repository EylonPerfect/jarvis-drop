import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { emit, EVENTS, type EventName } from "../lib/analytics.js";
import { requireSuperadmin } from "../lib/superadmin.js";

// ============================================================================
// LAUNCH METRICS — the six-metric set (CLAUDE.md BATCH 4), rolled up from the
// usage_events ledger + live_calls + call_reports + orgs + readiness. Exposed as
// GET /api/metrics/summary (super-admin gated) feeding the fleet dashboard.
//   1. weekly live calls run          [NORTH STAR]
//   2. activation = % signups reaching 70 + median time-to-70
//   3. free->paid (went-live) rate
//   4. MRR + NRR
//   5. live-call health = report rate + bail-out rate + avg score of live clones
//   6. landing/Ava -> signup conversion
// Also POST /api/metrics/event to record funnel steps the web/marketing surface
// emits (landing_view, ava_session, signup...). Emit is idempotent-friendly and
// never blocks the caller.
// ============================================================================

async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const r = await one<{ v: string | number | null }>(sql, params).catch(() => null);
  return Number(r?.v ?? 0);
}

// ---- (1) North Star: weekly live calls run --------------------------------
async function weeklyLiveCalls() {
  const thisWeek = await scalar(`SELECT COUNT(*) AS v FROM live_calls WHERE mode='zoom' AND started_at > now() - interval '7 days'`);
  const prevWeek = await scalar(`SELECT COUNT(*) AS v FROM live_calls WHERE mode='zoom' AND started_at > now() - interval '14 days' AND started_at <= now() - interval '7 days'`);
  // 8-week trend for the sparkline
  const series = await query<{ week: string; n: string }>(
    `SELECT date_trunc('week', started_at)::date AS week, COUNT(*) AS n
       FROM live_calls WHERE mode='zoom' AND started_at > now() - interval '8 weeks'
      GROUP BY 1 ORDER BY 1`,
  ).catch(() => []);
  const wow = prevWeek > 0 ? (thisWeek - prevWeek) / prevWeek : null;
  return { thisWeek, prevWeek, wowChange: wow, series: series.map((r) => ({ week: r.week, calls: Number(r.n) })) };
}

// ---- (2) Activation: % signups reaching 70 + median time-to-70 -------------
async function activation() {
  const signups = await scalar(`SELECT COUNT(DISTINCT org_id) AS v FROM usage_events WHERE name=$1 AND org_id IS NOT NULL`, [EVENTS.SIGNUP]);
  const reached = await scalar(`SELECT COUNT(DISTINCT org_id) AS v FROM usage_events WHERE name=$1 AND org_id IS NOT NULL`, [EVENTS.REACHED_70]);
  // median time-to-70 per org = first reached_70 - first signup, in hours
  const median = await scalar(
    `WITH firsts AS (
       SELECT s.org_id,
              MIN(s.ts) AS signup_ts,
              MIN(r.ts) AS reached_ts
         FROM usage_events s
         JOIN usage_events r ON r.org_id = s.org_id AND r.name=$2
        WHERE s.name=$1 AND s.org_id IS NOT NULL
        GROUP BY s.org_id
     )
     SELECT percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (reached_ts - signup_ts))/3600.0
     ) AS v FROM firsts WHERE reached_ts >= signup_ts`,
    [EVENTS.SIGNUP, EVENTS.REACHED_70],
  );
  return {
    signups,
    reached70: reached,
    activationRate: signups > 0 ? reached / signups : null,
    medianHoursTo70: median || null,
  };
}

// ---- (3) free->paid (went-live) rate ---------------------------------------
async function freeToPaid() {
  const signups = await scalar(`SELECT COUNT(*) AS v FROM orgs`);
  const wentLive = await scalar(`SELECT COUNT(*) AS v FROM orgs WHERE went_live_at IS NOT NULL`);
  const paying = await scalar(`SELECT COUNT(*) AS v FROM orgs WHERE status='active'`);
  return {
    orgs: signups,
    wentLive,
    paying,
    freeToPaidRate: signups > 0 ? wentLive / signups : null,
  };
}

// ---- (4) MRR + NRR ---------------------------------------------------------
async function revenue() {
  const mrrCents = await scalar(`SELECT COALESCE(SUM(mrr_cents),0) AS v FROM orgs WHERE status='active'`);
  // NRR = revenue this month from orgs that were active LAST month / last month's
  // revenue from those same orgs (expansion - contraction - churn; new logos excluded).
  const thisMonth = `date_trunc('month', now())::date`;
  const lastMonth = `(date_trunc('month', now()) - interval '1 month')::date`;
  const nrrRow = await one<{ base: string; retained: string }>(
    `WITH last_cohort AS (
       SELECT org_id, mrr_cents FROM mrr_snapshots WHERE month = ${lastMonth} AND mrr_cents > 0
     )
     SELECT COALESCE(SUM(lc.mrr_cents),0) AS base,
            COALESCE(SUM(cur.mrr_cents),0) AS retained
       FROM last_cohort lc
       LEFT JOIN mrr_snapshots cur ON cur.org_id = lc.org_id AND cur.month = ${thisMonth}`,
  ).catch(() => null);
  const base = Number(nrrRow?.base ?? 0);
  const retained = Number(nrrRow?.retained ?? 0);
  return {
    mrrUsd: mrrCents / 100,
    arrUsd: (mrrCents / 100) * 12,
    nrr: base > 0 ? retained / base : null,
    nrrBasisAvailable: base > 0,
  };
}

// ---- (5) live-call health --------------------------------------------------
async function liveCallHealth() {
  const windowDays = 30;
  const calls = await scalar(`SELECT COUNT(*) AS v FROM live_calls WHERE mode='zoom' AND started_at > now() - ($1 || ' days')::interval`, [String(windowDays)]);
  const bailed = await scalar(`SELECT COUNT(*) AS v FROM live_calls WHERE mode='zoom' AND outcome='bailed' AND started_at > now() - ($1 || ' days')::interval`, [String(windowDays)]);
  const reports = await scalar(`SELECT COUNT(*) AS v FROM call_reports WHERE created_at > now() - ($1 || ' days')::interval`, [String(windowDays)]);
  // avg readiness of clones that actually ran live (score captured at join);
  // fallback to the avg captured across all live calls if the window is empty.
  const avgReadiness = await scalar(`SELECT AVG(readiness_at_start) AS v FROM live_calls WHERE mode='zoom' AND readiness_at_start IS NOT NULL AND started_at > now() - ($1 || ' days')::interval`, [String(windowDays)]);
  return {
    windowDays,
    liveCalls: calls,
    reportRate: calls > 0 ? reports / calls : null,
    bailOutRate: calls > 0 ? bailed / calls : null,
    avgReadinessLiveClones: avgReadiness || null,
  };
}

// ---- (6) landing/Ava -> signup conversion ----------------------------------
async function topOfFunnel() {
  const landing = await scalar(`SELECT COUNT(*) AS v FROM usage_events WHERE name=$1`, [EVENTS.LANDING_VIEW]);
  const ava = await scalar(`SELECT COUNT(*) AS v FROM usage_events WHERE name=$1`, [EVENTS.AVA_SESSION]);
  const signups = await scalar(`SELECT COUNT(*) AS v FROM usage_events WHERE name=$1`, [EVENTS.SIGNUP]);
  return {
    landingViews: landing,
    avaSessions: ava,
    signups,
    landingToSignup: landing > 0 ? signups / landing : null,
    avaToSignup: ava > 0 ? signups / ava : null,
  };
}

export default async function metricsRoutes(app: FastifyInstance) {
  // The fleet dashboard's data source. Super-admin gated (cross-org rollup).
  app.get("/api/metrics/summary", { preHandler: requireSuperadmin }, async () => {
    const [northStar, act, f2p, rev, health, funnel] = await Promise.all([
      weeklyLiveCalls(), activation(), freeToPaid(), revenue(), liveCallHealth(), topOfFunnel(),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      northStar: { label: "Weekly live calls run", ...northStar },
      activation: { label: "Activation (% signups reaching 70)", ...act },
      freeToPaid: { label: "Free -> paid (went live)", ...f2p },
      revenue: { label: "MRR + NRR", ...rev },
      liveCallHealth: { label: "Live-call health", ...health },
      funnel: { label: "Landing/Ava -> signup", ...funnel },
    };
  });

  // Record a funnel/usage event from the web/marketing surface (landing_view,
  // ava_session, signup_started, signup...). Guarded by the BFF key (the web app
  // already carries it). Keeps the ledger the single source of truth.
  app.post("/api/metrics/event", async (req, reply) => {
    const b = (req.body ?? {}) as { name?: string; orgId?: string; agentId?: string; callId?: string; value?: number; props?: Record<string, unknown> };
    if (!b.name) return reply.code(400).send({ error: "name required" });
    await emit(b.name as EventName, { orgId: b.orgId, agentId: b.agentId, callId: b.callId, value: b.value, props: b.props });
    return { ok: true };
  });
}
