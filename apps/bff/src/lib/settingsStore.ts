// ============================================================
// PHASE 2 — org-scoped settings accessors.
//
// The `settings` table PK is now (org_id, key). Every read/write MUST carry an
// org id. Route code should use these helpers instead of hand-writing SQL so the
// ON CONFLICT target stays (org_id, key) in exactly one place.
// ============================================================
import { query, one } from "../db/pool.js";

export async function getSetting<T = unknown>(orgId: string, key: string): Promise<T | null> {
  const row = await one<{ value: T }>(
    `SELECT value FROM settings WHERE org_id = $1 AND key = $2`,
    [orgId, key],
  );
  return row?.value ?? null;
}

export async function setSetting(orgId: string, key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO settings (org_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [orgId, key, JSON.stringify(value)],
  );
}

export async function deleteSetting(orgId: string, key: string): Promise<void> {
  await query(`DELETE FROM settings WHERE org_id = $1 AND key = $2`, [orgId, key]);
}

/** All settings for an org whose key starts with `prefix` (e.g. "demo_login:"). */
export async function listSettings<T = unknown>(
  orgId: string,
  prefix?: string,
): Promise<Array<{ key: string; value: T }>> {
  if (prefix) {
    return query<{ key: string; value: T }>(
      `SELECT key, value FROM settings WHERE org_id = $1 AND key LIKE $2`,
      [orgId, prefix.replace(/[%_]/g, "\\$&") + "%"],
    );
  }
  return query<{ key: string; value: T }>(`SELECT key, value FROM settings WHERE org_id = $1`, [orgId]);
}
