import { query, one } from "../db/pool.js";
import { newId } from "./auth.js";

// ============================================================================
// lib/legal.ts — Terms acceptance. Every user must affirmatively accept the
// current TOS_VERSION before using the platform; bumping the version forces
// re-acceptance across ALL users (T&C §18). See routes/legal.ts + the FE gate.
// ============================================================================

// BUMP THIS when the Terms materially change → everyone re-accepts on next load.
// Format: date the version took effect.
export const TOS_VERSION = "2026-07-19";
export const TOS_DOC = "terms";

/** Has this user accepted the given Terms version? No user id (access-code /
 *  demo tenant) → treated as accepted so the operator/demo is never nagged. */
export async function hasAcceptedTos(userId: string | null, version = TOS_VERSION): Promise<boolean> {
  if (!userId) return true;
  const row = await one<{ id: string }>(
    `SELECT id FROM tos_acceptances WHERE user_id=$1 AND doc=$2 AND version=$3 LIMIT 1`,
    [userId, TOS_DOC, version],
  );
  return !!row;
}

/** Record an affirmative acceptance (idempotent on user+doc+version). */
export async function recordTosAcceptance(
  userId: string | null,
  orgId: string | null,
  ip: string | null,
  userAgent: string | null,
  version = TOS_VERSION,
): Promise<void> {
  if (!userId) return;
  try {
    await query(
      `INSERT INTO tos_acceptances (id, user_id, org_id, doc, version, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [newId("tos"), userId, orgId, TOS_DOC, version, ip ? ip.slice(0, 64) : null, userAgent ? userAgent.slice(0, 300) : null],
    );
  } catch { /* unique(user,doc,version) — already recorded */ }
}
