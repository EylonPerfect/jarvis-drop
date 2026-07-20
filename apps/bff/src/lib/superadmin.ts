import type { FastifyReply, FastifyRequest } from "fastify";
import { query, one } from "../db/pool.js";
import { config } from "../config.js";
import { fireAlert } from "./alerts.js";

// security_state is GLOBAL platform config in the settings table — pin its read
// and write to the platform-config org so it survives dropping the org_id
// DEFAULT (existing row is already under org_legacy = legacyOrgId).
const PLATFORM_ORG = config.legacyOrgId;

// ============================================================================
// SUPER-ADMIN gate + security state. This BFF's baseline auth is a single
// BFF_API_KEY (see index.ts). Super-admin endpoints (fleet metrics, lockdown)
// need a STRONGER gate, so they require a distinct SUPERADMIN_API_KEY presented
// as X-Superadmin-Key (or Bearer when it differs from the BFF key). Until the
// real multi-user super-admin auth lands (Phase 2 — see the super-admin backend
// in the separate super-admin app), this key is the gate.
//
// Security state (MFA on/off, IP allowlist, lockdown timestamp) lives in
// settings['security_state'] so LOCKDOWN can flip it with no deploy. Enforcement
// of the allowlist/MFA belongs to the super-admin FE's own auth layer; this
// module owns the STATE + the session-invalidation + the login alert.
// ============================================================================

export type SecurityState = {
  mfaEnabled: boolean;
  ipAllowlist: string[];      // empty = allow-all (pre-launch posture)
  lockdownAt?: string | null; // ISO when LOCKDOWN was last engaged
  lockdownBy?: string | null;
};

const SA_KEY = process.env.SUPERADMIN_API_KEY ?? "";

/** Guard: returns true if the request carries the super-admin key. */
export function isSuperadmin(req: FastifyRequest): boolean {
  if (!SA_KEY) return false; // no key configured → endpoint is closed, not open
  const hdr = (req.headers["x-superadmin-key"] as string | undefined) ?? undefined;
  const auth = req.headers["authorization"];
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
  return hdr === SA_KEY || bearer === SA_KEY;
}

/** Fastify preHandler: 401 unless super-admin. Use on fleet/lockdown routes. */
export async function requireSuperadmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Two accepted credentials: the SUPERADMIN_API_KEY header/bearer (server-to-
  // server: cron, incident scans) OR a live sa_session cookie (the operator's
  // browser). The browser can never hold SUPERADMIN_API_KEY, so cookie auth is
  // what makes panels outside /api/superadmin — e.g. Cost & metering — work.
  if (isSuperadmin(req)) return;
  if (await hasValidSaSession(req)) return;
  if (!SA_KEY) return reply.code(503).send({ error: "super-admin endpoints disabled — set SUPERADMIN_API_KEY" });
  return reply.code(401).send({ error: "super-admin authorization required" });
}

function readSaCookie(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

async function hasValidSaSession(req: FastifyRequest): Promise<boolean> {
  const token = readSaCookie(req, config.superadmin.cookieName);
  if (!token) return false;
  const row = await one<{ token: string }>(
    `SELECT token FROM superadmin_sessions WHERE token=$1 AND revoked_at IS NULL AND expires_at > now() LIMIT 1`,
    [token],
  ).catch(() => null);
  return !!row;
}

export async function getSecurityState(): Promise<SecurityState> {
  const row = await one<{ value: SecurityState }>(`SELECT value FROM settings WHERE org_id=$1 AND key='security_state'`, [PLATFORM_ORG]).catch(() => null);
  return {
    mfaEnabled: row?.value?.mfaEnabled ?? false,
    ipAllowlist: Array.isArray(row?.value?.ipAllowlist) ? row!.value.ipAllowlist : [],
    lockdownAt: row?.value?.lockdownAt ?? null,
    lockdownBy: row?.value?.lockdownBy ?? null,
  };
}

export async function setSecurityState(next: SecurityState): Promise<void> {
  await query(
    `INSERT INTO settings (org_id, key, value) VALUES ($1, 'security_state', $2)
     ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [PLATFORM_ORG, JSON.stringify(next)],
  );
}

/** Real client IP behind Traefik (needs Fastify trustProxy for X-Forwarded-For). */
export function clientIp(req: FastifyRequest): string {
  const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return xff || req.ip || "unknown";
}

/**
 * Record a super-admin login; if the IP has never been seen before, flag it
 * and fire the new-IP alert (the highest-value concrete build per the spec).
 * The super-admin FE calls this after a successful authentication.
 */
export async function recordSuperadminLogin(ip: string, userAgent?: string): Promise<{ isNewIp: boolean }> {
  const seen = await one<{ id: number }>(`SELECT id FROM superadmin_logins WHERE ip=$1 LIMIT 1`, [ip]).catch(() => null);
  const isNewIp = !seen;
  await query(`INSERT INTO superadmin_logins (ip, user_agent, is_new_ip) VALUES ($1,$2,$3)`, [ip, userAgent ?? null, isNewIp]);
  if (isNewIp) {
    await fireAlert("new_ip_superadmin", "critical", { ip, userAgent: userAgent ?? null });
  }
  return { isNewIp };
}

/** Invalidate every super-admin session (part of LOCKDOWN). Returns count. */
export async function invalidateAllSessions(): Promise<number> {
  const rows = await query<{ token: string }>(`UPDATE superadmin_sessions SET revoked_at = now() WHERE revoked_at IS NULL RETURNING token`).catch(() => []);
  return rows.length;
}
