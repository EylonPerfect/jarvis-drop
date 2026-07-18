import { query, one } from "../db/pool.js";
import { config } from "../config.js";

// incident_config is GLOBAL platform config in the settings table (its writer
// lives in routes/security.ts) — pin this companion read to the platform-config
// org so it matches the write and survives dropping the org_id DEFAULT.
const PLATFORM_ORG = config.legacyOrgId;

// ============================================================================
// INCIDENT ALERTS — configurable webhook/channel alerts (CLAUDE.md BATCH 4).
// fireAlert() dedupes within a window, logs to incident_alerts, and POSTs to
// the configured webhook (generic JSON) + optional Slack incoming-webhook.
// The detectors (cost runaway, bail-out/report spike) are pure reads run on a
// schedule by POST /api/admin/incident-scan (see routes/security.ts) or cron.
// Config lives in settings['incident_config'] so it's editable without a deploy.
// ============================================================================

export type AlertKind = "new_ip_superadmin" | "cost_runaway" | "bailout_spike" | "report_spike" | "lockdown"
  | "signup" | "first_go_live" | "payment" | "error_spike";
export type Severity = "info" | "warning" | "critical";

export type IncidentConfig = {
  webhookUrl?: string;        // generic JSON POST (any receiver)
  slackWebhookUrl?: string;   // Slack incoming webhook (text payload)
  dedupeMinutes?: number;     // suppress the same kind within N minutes (default 30)
  costRunawayUsdPerHour?: number;  // spend rate threshold (default 25)
  bailoutRateThreshold?: number;   // fraction of live calls bailing in window (default 0.3)
  reportRateThreshold?: number;    // fraction of live calls reported in window (default 0.3)
  errorRateThreshold?: number;     // fraction of live calls stuck in error in window (default 0.3)
  spikeWindowHours?: number;       // window for the spike detectors (default 6)
  spikeMinCalls?: number;          // ignore spikes below this call volume (default 5)
};

const DEFAULTS: Required<Omit<IncidentConfig, "webhookUrl" | "slackWebhookUrl">> = {
  dedupeMinutes: 30,
  costRunawayUsdPerHour: 25,
  bailoutRateThreshold: 0.3,
  reportRateThreshold: 0.3,
  errorRateThreshold: 0.3,
  spikeWindowHours: 6,
  spikeMinCalls: 5,
};

export async function getConfig(): Promise<Required<IncidentConfig>> {
  const row = await one<{ value: IncidentConfig }>(`SELECT value FROM settings WHERE org_id=$1 AND key='incident_config'`, [PLATFORM_ORG]).catch(() => null);
  const v = row?.value ?? {};
  return {
    webhookUrl: v.webhookUrl ?? process.env.INCIDENT_WEBHOOK_URL ?? "",
    slackWebhookUrl: v.slackWebhookUrl ?? process.env.INCIDENT_SLACK_WEBHOOK_URL ?? "",
    dedupeMinutes: v.dedupeMinutes ?? DEFAULTS.dedupeMinutes,
    costRunawayUsdPerHour: v.costRunawayUsdPerHour ?? DEFAULTS.costRunawayUsdPerHour,
    bailoutRateThreshold: v.bailoutRateThreshold ?? DEFAULTS.bailoutRateThreshold,
    reportRateThreshold: v.reportRateThreshold ?? DEFAULTS.reportRateThreshold,
    errorRateThreshold: v.errorRateThreshold ?? DEFAULTS.errorRateThreshold,
    spikeWindowHours: v.spikeWindowHours ?? DEFAULTS.spikeWindowHours,
    spikeMinCalls: v.spikeMinCalls ?? DEFAULTS.spikeMinCalls,
  };
}

async function deliver(cfg: Required<IncidentConfig>, kind: AlertKind, severity: Severity, detail: Record<string, unknown>): Promise<boolean> {
  let ok = false;
  const text = `[After Human] ${severity.toUpperCase()} incident: ${kind}\n${JSON.stringify(detail, null, 2)}`;
  if (cfg.webhookUrl) {
    try {
      const r = await fetch(cfg.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "after-human", kind, severity, detail, at: new Date().toISOString() }),
        signal: AbortSignal.timeout(8000),
      });
      ok = ok || r.ok;
    } catch { /* keep going */ }
  }
  if (cfg.slackWebhookUrl) {
    try {
      const r = await fetch(cfg.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(8000),
      });
      ok = ok || r.ok;
    } catch { /* keep going */ }
  }
  return ok;
}

/**
 * Fire an alert: dedupe within the window, persist to incident_alerts, dispatch
 * to the configured channels. Returns {fired,delivered}; never throws.
 */
export async function fireAlert(kind: AlertKind, severity: Severity, detail: Record<string, unknown> = {}, opts: { dedupeMinutes?: number } = {}): Promise<{ fired: boolean; delivered: boolean }> {
  try {
    const cfg = await getConfig();
    const dedupeMinutes = opts.dedupeMinutes ?? cfg.dedupeMinutes;
    const recent = await one<{ id: number }>(
      `SELECT id FROM incident_alerts WHERE kind=$1 AND at > now() - ($2 || ' minutes')::interval ORDER BY at DESC LIMIT 1`,
      [kind, String(dedupeMinutes)],
    ).catch(() => null);
    if (recent) return { fired: false, delivered: false }; // deduped
    const delivered = await deliver(cfg, kind, severity, detail);
    await query(
      `INSERT INTO incident_alerts (kind, severity, detail, delivered) VALUES ($1,$2,$3,$4)`,
      [kind, severity, JSON.stringify(detail), delivered],
    );
    return { fired: true, delivered };
  } catch (err) {
    console.error("[alerts] fireAlert failed:", (err as Error).message);
    return { fired: false, delivered: false };
  }
}

// ---- launch funnel signals (operator-visible pings on good/notable events) -
// Positive funnel events (signup, first go-live, payment) are info-level and
// each one matters, so they are NOT deduped per-kind (dedupeMinutes:0). They
// travel the SAME incident_alerts ledger + webhook/Slack path as incidents, so
// the operator sees them in GET /api/admin/security (recentAlerts) and any
// configured Slack channel. Never throws (fireAlert swallows its own errors).
export async function notifyFunnelEvent(
  kind: Extract<AlertKind, "signup" | "first_go_live" | "payment">,
  detail: Record<string, unknown> = {},
): Promise<{ fired: boolean; delivered: boolean }> {
  return fireAlert(kind, "info", detail, { dedupeMinutes: 0 });
}

// ---- detectors (pure reads; call from the scan endpoint / cron) ------------

/** Cost runaway: spend rate over the last hour above the configured $/hr. */
export async function checkCostRunaway(): Promise<{ tripped: boolean; usdLastHour: number }> {
  const cfg = await getConfig();
  const row = await one<{ sum: string }>(`SELECT COALESCE(SUM(cost_usd),0) AS sum FROM spend_events WHERE at > now() - interval '1 hour'`).catch(() => null);
  const usd = Number(row?.sum ?? 0);
  const tripped = usd > cfg.costRunawayUsdPerHour;
  if (tripped) await fireAlert("cost_runaway", "critical", { usdLastHour: usd, thresholdUsdPerHour: cfg.costRunawayUsdPerHour });
  return { tripped, usdLastHour: usd };
}

/** Bail-out / report spike over the spike window (live calls only). */
export async function checkBailAndReportSpikes(): Promise<{ bailoutRate: number; reportRate: number; calls: number; bailoutTripped: boolean; reportTripped: boolean }> {
  const cfg = await getConfig();
  const w = String(cfg.spikeWindowHours);
  const calls = Number((await one<{ n: string }>(`SELECT COUNT(*) AS n FROM live_calls WHERE mode='zoom' AND started_at > now() - ($1 || ' hours')::interval`, [w]).catch(() => null))?.n ?? 0);
  const bailed = Number((await one<{ n: string }>(`SELECT COUNT(*) AS n FROM live_calls WHERE mode='zoom' AND outcome='bailed' AND started_at > now() - ($1 || ' hours')::interval`, [w]).catch(() => null))?.n ?? 0);
  const reports = Number((await one<{ n: string }>(`SELECT COUNT(*) AS n FROM call_reports WHERE created_at > now() - ($1 || ' hours')::interval`, [w]).catch(() => null))?.n ?? 0);
  const bailoutRate = calls > 0 ? bailed / calls : 0;
  const reportRate = calls > 0 ? reports / calls : 0;
  let bailoutTripped = false, reportTripped = false;
  if (calls >= cfg.spikeMinCalls) {
    if (bailoutRate >= cfg.bailoutRateThreshold) { bailoutTripped = true; await fireAlert("bailout_spike", "warning", { bailoutRate, bailed, calls, windowHours: cfg.spikeWindowHours }); }
    if (reportRate >= cfg.reportRateThreshold) { reportTripped = true; await fireAlert("report_spike", "warning", { reportRate, reports, calls, windowHours: cfg.spikeWindowHours }); }
  }
  return { bailoutRate, reportRate, calls, bailoutTripped, reportTripped };
}

/** Error spike: fraction of recent live calls stuck in an error phase. */
export async function checkErrorSpike(): Promise<{ errorRate: number; errored: number; calls: number; tripped: boolean }> {
  const cfg = await getConfig();
  const w = String(cfg.spikeWindowHours);
  const calls = Number((await one<{ n: string }>(`SELECT COUNT(*) AS n FROM live_calls WHERE mode='zoom' AND started_at > now() - ($1 || ' hours')::interval`, [w]).catch(() => null))?.n ?? 0);
  const errored = Number((await one<{ n: string }>(`SELECT COUNT(*) AS n FROM live_calls WHERE mode='zoom' AND phase='error' AND started_at > now() - ($1 || ' hours')::interval`, [w]).catch(() => null))?.n ?? 0);
  const errorRate = calls > 0 ? errored / calls : 0;
  let tripped = false;
  if (calls >= cfg.spikeMinCalls && errorRate >= cfg.errorRateThreshold) {
    tripped = true;
    await fireAlert("error_spike", "critical", { errorRate, errored, calls, windowHours: cfg.spikeWindowHours });
  }
  return { errorRate, errored, calls, tripped };
}
