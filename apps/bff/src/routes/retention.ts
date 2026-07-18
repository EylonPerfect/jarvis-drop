import type { FastifyInstance } from "fastify";
import { one, query } from "../db/pool.js";
import { config } from "../config.js";

// The retention policy is GLOBAL platform config (not per-tenant): pin every read
// and write to the platform-config org so it survives dropping the settings
// org_id DEFAULT. Existing rows are already under org_legacy = legacyOrgId.
const PLATFORM_ORG = config.legacyOrgId;

// ============================================================
// DATA GOVERNANCE (#2) — per-org retention policy.
//
// The POLICY surface only. The actual cascade PURGE execution
// (DB rows + stored files + e2b artifacts + ElevenLabs voice
// revoke + product-credential wipe) is built by the Phase 2
// agent; that job READS this policy via getRetentionPolicy().
//
// Stored in the existing key/value `settings` table under key
// 'retention' (same pattern as 'company'), so no schema
// migration is required. Single-org today (single operator);
// when Phase 2 introduces org_id the value keys per org.
// ============================================================

// mode:
//   keep-while-active — retain data while the clone/org is active,
//                       purge on delete (the launch default).
//   hard-timebox      — additionally purge data older than
//                       hardTimeboxDays regardless of activity
//                       (the customer-configurable option for later).
export type RetentionMode = "keep-while-active" | "hard-timebox";

export interface RetentionPolicy {
  /** Retention strategy the Phase 2 job enforces. */
  mode: RetentionMode;
  /**
   * Hard delete on org/clone/call delete (not soft-delete). Non-negotiable
   * per governance — surfaced read-only so questionnaires can cite it, but
   * never turned off from the UI.
   */
  purgeOnDelete: true;
  /** Days to keep data in hard-timebox mode; null when mode = keep-while-active. */
  hardTimeboxDays: number | null;
  /** Last time an operator changed the policy (ISO 8601). */
  updatedAt: string | null;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  mode: "keep-while-active",
  purgeOnDelete: true,
  hardTimeboxDays: null,
  updatedAt: null,
};

/**
 * The single read target for the Phase 2 purge/retention job.
 * Always returns a complete, defaulted policy (never throws on a
 * missing row). Phase 2: `import { getRetentionPolicy } from "./retention.js"`.
 */
export async function getRetentionPolicy(): Promise<RetentionPolicy> {
  const row = await one<{ value: Partial<RetentionPolicy> }>(
    `SELECT value FROM settings WHERE org_id = $1 AND key = 'retention'`,
    [PLATFORM_ORG],
  );
  const v = row?.value && typeof row.value === "object" ? row.value : {};
  const mode: RetentionMode = v.mode === "hard-timebox" ? "hard-timebox" : "keep-while-active";
  let days: number | null = null;
  if (mode === "hard-timebox") {
    const n = Number(v.hardTimeboxDays);
    days = Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
  }
  return {
    mode,
    purgeOnDelete: true, // non-negotiable
    hardTimeboxDays: days,
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null,
  };
}

export default async function retentionRoutes(app: FastifyInstance) {
  app.get("/api/retention", async () => getRetentionPolicy());

  app.put("/api/retention", async (req) => {
    const b = (req.body as Partial<RetentionPolicy>) ?? {};
    const mode: RetentionMode = b.mode === "hard-timebox" ? "hard-timebox" : "keep-while-active";
    let hardTimeboxDays: number | null = null;
    if (mode === "hard-timebox") {
      const n = Number(b.hardTimeboxDays);
      // clamp to a sane 1..3650 day window; default 30 if unset/invalid
      hardTimeboxDays = Number.isFinite(n) && n > 0 ? Math.min(3650, Math.floor(n)) : 30;
    }
    const next: RetentionPolicy = {
      mode,
      purgeOnDelete: true,
      hardTimeboxDays,
      updatedAt: new Date().toISOString(),
    };
    await query(
      `INSERT INTO settings (org_id, key, value) VALUES ($1, 'retention', $2)
       ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [PLATFORM_ORG, JSON.stringify(next)],
    );
    return next;
  });
}
