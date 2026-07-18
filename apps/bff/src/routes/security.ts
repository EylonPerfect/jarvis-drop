import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { config } from "../config.js";
import { emit, EVENTS } from "../lib/analytics.js";
import { fireAlert, checkCostRunaway, checkBailAndReportSpikes, checkErrorSpike, getConfig } from "../lib/alerts.js";
import {
  requireSuperadmin, getSecurityState, setSecurityState,
  recordSuperadminLogin, invalidateAllSessions, clientIp,
} from "../lib/superadmin.js";

// ============================================================================
// SECURITY / INCIDENT endpoints (CLAUDE.md BATCH 4 "Incident/breach").
//   - POST /api/admin/lockdown        one-click: MFA on + restrictive allowlist
//                                      + invalidate ALL super-admin sessions
//   - GET  /api/admin/security        current security posture + recent alerts
//   - POST /api/admin/security/config edit alert webhook/thresholds (no deploy)
//   - POST /api/admin/superadmin/login-event  record a super-admin login (new-IP alert)
//   - POST /api/admin/incident-scan   run cost-runaway + bail/report spike detectors
//   - POST /api/calls/:id/report      the self-serve "report this call" button
// The FE LOCKDOWN button lives in the super-admin app ("another copy"); it POSTs
// /api/admin/lockdown with the super-admin credential (see deliverable notes).
// ============================================================================

// incident_config is GLOBAL platform config in the settings table — pin its read
// and write to the platform-config org (matches lib/alerts.ts getConfig) so it
// survives dropping the settings org_id DEFAULT and never mis-scopes.
const PLATFORM_ORG = config.legacyOrgId;

export default async function securityRoutes(app: FastifyInstance) {
  // ---- one-click LOCKDOWN (super-admin gated) ----
  app.post("/api/admin/lockdown", { preHandler: requireSuperadmin }, async (req) => {
    const b = (req.body ?? {}) as { allowlist?: string[]; by?: string; reason?: string };
    const ip = clientIp(req);
    // Restrictive allowlist: caller-supplied, else pin to the requester's own IP
    // (the operator engaging lockdown), else a deny-all sentinel that blocks all.
    const allowlist = Array.isArray(b.allowlist) && b.allowlist.length
      ? b.allowlist
      : ip && ip !== "unknown" ? [`${ip}/32`] : ["0.0.0.0/32"];
    await setSecurityState({
      mfaEnabled: true,
      ipAllowlist: allowlist,
      lockdownAt: new Date().toISOString(),
      lockdownBy: b.by ?? "superadmin",
    });
    const revoked = await invalidateAllSessions();
    await fireAlert("lockdown", "critical", { by: b.by ?? "superadmin", reason: b.reason ?? null, allowlist, sessionsRevoked: revoked, ip });
    app.log.warn({ allowlist, revoked, ip }, "SUPER-ADMIN LOCKDOWN engaged");
    return {
      ok: true,
      lockdown: { mfaEnabled: true, ipAllowlist: allowlist, sessionsRevoked: revoked },
      note: "MFA required, allowlist restricted, all super-admin sessions invalidated. The super-admin FE enforces these on its next request.",
    };
  });

  // ---- security posture read ----
  app.get("/api/admin/security", { preHandler: requireSuperadmin }, async () => {
    const state = await getSecurityState();
    const cfg = await getConfig();
    const recentAlerts = await query(`SELECT kind, severity, detail, delivered, at FROM incident_alerts ORDER BY at DESC LIMIT 20`).catch(() => []);
    const recentLogins = await query(`SELECT ip, user_agent, is_new_ip, at FROM superadmin_logins ORDER BY at DESC LIMIT 20`).catch(() => []);
    const activeSessions = await one<{ n: string }>(`SELECT COUNT(*) AS n FROM superadmin_sessions WHERE revoked_at IS NULL`).catch(() => null);
    // Launch-funnel counters (last 24h) from the analytics ledger — a quick
    // operator glance at signups / activation / go-lives / revenue alongside alerts.
    const funnel = await one<{ signups: string; reached70: string; wentlive: string; livecalls: string; payments: string }>(
      `SELECT COUNT(*) FILTER (WHERE name='signup')        AS signups,
              COUNT(*) FILTER (WHERE name='reached_70')    AS reached70,
              COUNT(*) FILTER (WHERE name='went_live')     AS wentlive,
              COUNT(*) FILTER (WHERE name='live_call_run') AS livecalls,
              COUNT(*) FILTER (WHERE name='mrr_change')    AS payments
         FROM usage_events WHERE ts > now() - interval '24 hours'`,
    ).catch(() => null);
    return {
      posture: {
        mfaEnabled: state.mfaEnabled,
        ipAllowlist: state.ipAllowlist,
        allowlistActive: state.ipAllowlist.length > 0,
        lockdownAt: state.lockdownAt,
        // pre-launch deploy gate (CLAUDE.md): at least one of {MFA, allowlist} before real customers
        launchGateMet: state.mfaEnabled || state.ipAllowlist.length > 0,
      },
      alertChannels: { webhook: !!cfg.webhookUrl, slack: !!cfg.slackWebhookUrl },
      activeSuperadminSessions: Number(activeSessions?.n ?? 0),
      launchFunnel24h: {
        signups: Number(funnel?.signups ?? 0),
        reached70: Number(funnel?.reached70 ?? 0),
        wentLive: Number(funnel?.wentlive ?? 0),
        liveCalls: Number(funnel?.livecalls ?? 0),
        payments: Number(funnel?.payments ?? 0),
      },
      recentAlerts,
      recentLogins,
    };
  });

  // ---- edit alert config (webhook + thresholds), no deploy needed ----
  app.post("/api/admin/security/config", { preHandler: requireSuperadmin }, async (req) => {
    const patch = (req.body ?? {}) as Record<string, unknown>;
    const cur = await one<{ value: Record<string, unknown> }>(`SELECT value FROM settings WHERE org_id=$1 AND key='incident_config'`, [PLATFORM_ORG]).catch(() => null);
    const next = { ...(cur?.value ?? {}), ...patch };
    await query(
      `INSERT INTO settings (org_id, key, value) VALUES ($1, 'incident_config', $2)
       ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [PLATFORM_ORG, JSON.stringify(next)],
    );
    return { ok: true, config: next };
  });

  // ---- record a super-admin login (new-IP alert). The super-admin FE calls
  // this immediately after a successful authentication. ----
  app.post("/api/admin/superadmin/login-event", { preHandler: requireSuperadmin }, async (req) => {
    const ip = clientIp(req);
    const ua = (req.headers["user-agent"] as string | undefined) ?? undefined;
    const r = await recordSuperadminLogin(ip, ua);
    return { ok: true, ip, isNewIp: r.isNewIp };
  });

  // ---- run the incident detectors (cron / scheduler hits this) ----
  app.post("/api/admin/incident-scan", { preHandler: requireSuperadmin }, async () => {
    const [cost, spikes, errors] = await Promise.all([checkCostRunaway(), checkBailAndReportSpikes(), checkErrorSpike()]);
    return { ok: true, scannedAt: new Date().toISOString(), cost, spikes, errors };
  });

  // NOTE (integration, reconciliation #3): the self-serve "report this call"
  // endpoint (POST /api/calls/:id/report) is owned by p11's routes/reports.ts,
  // which writes the canonical call_reports shape (status='open' + transcript_ref)
  // that p5's super-admin queue reads. This p10 duplicate was removed to avoid a
  // FST_ERR_DUPLICATED_ROUTE and a write to the non-existent `note` column; the
  // analytics emit + spike detection it added now live in reports.ts.
}
