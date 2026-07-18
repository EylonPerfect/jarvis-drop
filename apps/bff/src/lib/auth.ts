// ============================================================
// PHASE 2 — Auth + tenancy resolution.
//
// Replaces the single shared access code with real email+password auth:
//  - passwords hashed with scrypt (node:crypto — no new dependency)
//  - opaque server-side sessions in the `sessions` table
//  - an httpOnly session cookie
//  - resolveRequestAuth(): resolves the caller's user + active org from the
//    cookie, OR (in access-code mode) pins them to the legacy org so the old
//    single-tenant path keeps working unchanged until cutover.
//
// The mode is chosen by config.auth.mode ("access-code" | "password").
// ============================================================
import { randomBytes, scrypt as _scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { query, one } from "../db/pool.js";
import { config } from "../config.js";

// Promisified scrypt WITH the options arg. util.promisify picks the no-options
// overload, so we wrap the callback form directly to keep N/r/p tunable.
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    _scrypt(password, salt, keylen, options, (err, dk) => (err ? reject(err) : resolve(dk as Buffer)));
  });
}

// ---- password hashing (scrypt) --------------------------------------------
const N = 16384, r = 8, p = 1, KEYLEN = 32;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = (await scrypt(pw, salt, KEYLEN, { N, r, p })) as Buffer;
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${dk.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, sN, sR, sP, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, "hex");
  const dk = (await scrypt(pw, Buffer.from(saltHex, "hex"), expected.length, {
    N: Number(sN), r: Number(sR), p: Number(sP),
  })) as Buffer;
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}

// ---- ids / cookies ---------------------------------------------------------
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Parse the request's Cookie header into a plain map (no cookie dependency). */
export function parseCookies(req: FastifyRequest): Record<string, string> {
  const raw = req.headers["cookie"];
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  const maxAge = config.auth.sessionTtlDays * 24 * 60 * 60;
  const attrs = [
    `${config.auth.cookieName}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  if (config.auth.cookieSecure) attrs.push("Secure");
  reply.header("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(reply: FastifyReply): void {
  const attrs = [`${config.auth.cookieName}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (config.auth.cookieSecure) attrs.push("Secure");
  reply.header("Set-Cookie", attrs.join("; "));
}

// ---- domain types ----------------------------------------------------------
export interface AuthUser { id: string; email: string; name?: string }
export interface AuthOrg { id: string; name: string; role: string }

// ---- session lifecycle -----------------------------------------------------
export async function createSession(userId: string, orgId: string | null): Promise<string> {
  const token = newSessionToken();
  const ttlMs = config.auth.sessionTtlDays * 24 * 60 * 60 * 1000;
  await query(
    `INSERT INTO sessions (id, user_id, org_id, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' milliseconds')::interval)`,
    [token, userId, orgId, String(ttlMs)],
  );
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE id = $1`, [token]).catch(() => {});
}

interface SessionRow { user_id: string; org_id: string | null; email: string; name: string | null }

async function loadSession(token: string): Promise<SessionRow | null> {
  const row = await one<SessionRow>(
    `SELECT s.user_id, s.org_id, u.email, u.name
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [token],
  );
  if (row) query(`UPDATE sessions SET last_seen = now() WHERE id = $1`, [token]).catch(() => {});
  return row;
}

/** Resolve a user's active org (session.org_id, else their first membership). */
async function resolveOrg(userId: string, preferOrgId: string | null): Promise<AuthOrg | null> {
  if (preferOrgId) {
    const m = await one<{ org_id: string; role: string; name: string }>(
      `SELECT m.org_id, m.role, o.name FROM memberships m JOIN orgs o ON o.id = m.org_id
        WHERE m.user_id = $1 AND m.org_id = $2`,
      [userId, preferOrgId],
    );
    if (m) return { id: m.org_id, name: m.name, role: m.role };
  }
  const first = await one<{ org_id: string; role: string; name: string }>(
    `SELECT m.org_id, m.role, o.name FROM memberships m JOIN orgs o ON o.id = m.org_id
      WHERE m.user_id = $1 ORDER BY m.created_at LIMIT 1`,
    [userId],
  );
  return first ? { id: first.org_id, name: first.name, role: first.role } : null;
}

/**
 * The single entry point the onRequest hook calls. Populates req.user / req.org /
 * req.orgId. Returns { ok:false } when the request must be rejected.
 *
 * access-code mode: the caller has already passed the BFF_API_KEY check in the
 * hook; here we simply pin the request to the legacy org so every org-scoped
 * query behaves exactly like today's single tenant. (No user identity.)
 *
 * password mode: require a valid session cookie -> user + active org.
 */
export async function resolveRequestAuth(req: FastifyRequest): Promise<{ ok: boolean; reason?: string }> {
  if (config.auth.mode === "access-code") {
    req.orgId = config.legacyOrgId;
    req.org = { id: config.legacyOrgId, name: "Legacy", role: "owner" };
    return { ok: true };
  }
  // password mode — a valid session cookie ALWAYS wins (scopes to the user's org),
  // so a real user is never affected by the service path below.
  const token = parseCookies(req)[config.auth.cookieName];
  const sess = token ? await loadSession(token) : null;
  if (!sess) {
    // No valid session: internal/service callers that hold BFF_API_KEY act as the
    // platform (legacy) org — a trusted service account. Only the BFF's own
    // self-calls (fidelity, readiness, debrief/build, scheduled-join, the studio
    // pipeline, etc.) send this key; the web client does not send X-API-Key in
    // password mode. By default this pins service calls to the LEGACY org
    // (back-compat); a multi-org self-call names its target tenant via the
    // X-Service-Org header, honored below (internal-call org propagation, #73).
    if (config.bffApiKey) {
      const authz = req.headers["authorization"];
      const provided = (req.headers["x-api-key"] as string | undefined)
        ?? (typeof authz === "string" && authz.startsWith("Bearer ") ? authz.slice(7) : undefined);
      if (provided === config.bffApiKey) {
        // ORG PROPAGATION (follow-up #73): an internal self-call may name the
        // TARGET org via X-Service-Org so a multi-org call (readiness/debrief/
        // fidelity/scheduled-join/pipeline) resolves in the RIGHT tenant instead
        // of always pinning to legacy. We honor this header ONLY because the
        // BFF_API_KEY above already checked out, and only after validating the
        // org actually exists — a present-but-unknown org is rejected rather
        // than silently mis-scoped. An absent header keeps the legacy back-compat
        // pin (single-tenant behavior unchanged). Never scopes a real user: a
        // valid session cookie already returned above.
        const svcHeader = req.headers["x-service-org"];
        const svcOrg = typeof svcHeader === "string" ? svcHeader.trim() : "";
        if (svcOrg) {
          const orgRow = await one<{ name: string }>(`SELECT name FROM orgs WHERE id = $1`, [svcOrg]);
          if (!orgRow) return { ok: false, reason: "unknown service org" };
          req.orgId = svcOrg;
          req.org = { id: svcOrg, name: orgRow.name, role: "owner" };
          return { ok: true };
        }
        req.orgId = config.legacyOrgId;
        req.org = { id: config.legacyOrgId, name: "Legacy", role: "owner" };
        return { ok: true };
      }
    }
    return { ok: false, reason: token ? "invalid or expired session" : "no session" };
  }
  const org = await resolveOrg(sess.user_id, sess.org_id);
  req.user = { id: sess.user_id, email: sess.email, name: sess.name ?? undefined };
  req.org = org ?? undefined;
  req.orgId = org?.id;
  if (!org) return { ok: false, reason: "no org membership" };
  return { ok: true };
}

/** Convenience: the caller's org id, or throw (routes rely on the hook having run). */
export function orgId(req: FastifyRequest): string {
  const id = req.orgId;
  if (!id) throw new Error("org not resolved on request (auth hook did not run?)");
  return id;
}

// Fastify request augmentation.
declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
    org?: AuthOrg;
    orgId?: string;
  }
}
