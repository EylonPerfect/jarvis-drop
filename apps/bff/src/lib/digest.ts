import { query } from "../db/pool.js";
import { notifyOnce } from "./notify.js";

// ============================================================================
// lib/digest.ts — the once-a-day per-org digest. Composed from the last 24h of
// real activity (live calls + open reports) and written as ONE in-app
// notification per org per day (deduped via notifyOnce with a date-stamped kind).
// Scheduled hourly from index.ts; only composes around the target hour.
// ============================================================================
export async function runDailyDigest(): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const orgs = await query<{ org_id: string }>(
      `SELECT DISTINCT org_id FROM live_calls WHERE started_at > now() - interval '24 hours'`,
    );
    for (const { org_id } of orgs) {
      const c = await query<{ n: string }>(
        `SELECT count(*)::text AS n FROM live_calls WHERE org_id=$1 AND mode='zoom' AND started_at > now() - interval '24 hours'`, [org_id],
      );
      const calls = Number(c[0]?.n ?? 0);
      const r = await query<{ n: string }>(`SELECT count(*)::text AS n FROM call_reports WHERE org_id=$1 AND status='open'`, [org_id]);
      const reports = Number(r[0]?.n ?? 0);
      if (calls === 0 && reports === 0) continue;
      const body = `${calls} live call${calls === 1 ? "" : "s"} in the last 24 hours`
        + (reports ? ` · ${reports} open report${reports === 1 ? "" : "s"} to review` : "");
      await notifyOnce(org_id, `daily_digest:${day}`, {
        kind: "daily_digest", title: "Your clones today", body, href: "#/echo", severity: "info", icon: "wb_sunny",
      });
    }
  } catch { /* best-effort — a digest must never crash the scheduler */ }
}
