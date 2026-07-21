import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { query, one } from "../db/pool.js";
import { config } from "../config.js";
import { getCall, endCall } from "../lib/callstate.js";
import { createSession, setSessionCookie as setAppSessionCookie } from "../lib/auth.js";
import { setKillSwitch } from "../lib/metering.js";
import { setSetting, getSetting } from "../lib/settingsStore.js";
import { pushPersonaReload } from "./live.js";

// ============================================================
// SUPER-ADMIN BACKEND — the one deliberately CROSS-ORG surface.
// Every route requires: (1) IP allowlist (PRIMARY active gate), (2) a valid,
// unexpired, IP-bound superadmin session (except /login), and (3) the actor's
// superadmin role. It reads UN-scoped by org on purpose — this is the only place
// that is allowed to. Every mutation calls writeAudit() with the caller's reason.
// ============================================================

// ---- config (all knobs are env-driven; see config.ts `superadmin`) ----
const SA = config.superadmin;

// superadmin_config and superadmin_rate_card are GLOBAL platform config in the
// settings table — pin their reads and writes to the platform-config org so they
// survive dropping the settings org_id DEFAULT (existing rows are under
// org_legacy = legacyOrgId). This is NOT per-tenant scoping — the super-admin
// surface stays deliberately cross-org everywhere else.
const PLATFORM_ORG = config.legacyOrgId;

// ---- password hashing (scrypt; no external deps) ----
const SCRYPT_N = 16384;
function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}
function verifyPassword(pw: string, stored: string): boolean {
  try {
    const [scheme, nStr, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(pw, salt, expected.length, { N: Number(nStr) || SCRYPT_N });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
// Strong-password policy enforced whenever a superadmin password is set.
function strongEnough(pw: string): boolean {
  return typeof pw === "string" && pw.length >= 12 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw);
}

// ---- client IP + allowlist (PRIMARY active gate) ----
function clientIp(req: FastifyRequest): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.ip;
}
function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return ((+m[1] << 24) >>> 0) + (+m[2] << 16) + (+m[3] << 8) + +m[4];
}
function ipMatches(ip: string, rule: string): boolean {
  if (rule === ip) return true; // exact (covers IPv6)
  const slash = rule.indexOf("/");
  if (slash === -1) return false;
  const base = ipv4ToInt(rule.slice(0, slash));
  const bits = Number(rule.slice(slash + 1));
  const target = ipv4ToInt(ip);
  if (base === null || target === null || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (base & mask) === (target & mask);
}
// Empty allowlist = allow (documented dev default; MUST be set in prod).
function ipAllowed(ip: string): boolean {
  if (!SA.ipAllowlist.length) return true;
  return SA.ipAllowlist.some((r) => ipMatches(ip, r));
}

// ---- dormant TOTP (RFC 6238, SHA-1, 6 digits). Only consulted when SA.mfa. ----
function base32Decode(s: string): Buffer {
  const alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const v = alph.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpValid(secret: string, code: string): boolean {
  const key = base32Decode(secret);
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let w = -1; w <= 1; w++) {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(step + w));
    const hmac = createHmac("sha1", key).update(buf).digest();
    const off = hmac[hmac.length - 1] & 0xf;
    const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
    if ((bin % 1_000_000).toString().padStart(6, "0") === code) return true;
  }
  return false;
}

// ---- audit (append-only) ----
type Severity = "info" | "notice" | "warning" | "critical";
async function writeAudit(a: {
  actorUserId: string | null;
  action: string;
  target?: string | null;
  severity?: Severity;
  reason?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO audit_log (actor_user_id, action, target, severity, reason, ip, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [a.actorUserId, a.action, a.target ?? null, a.severity ?? "info", a.reason ?? null, a.ip ?? null, JSON.stringify(a.meta ?? {})],
  );
}

// ---- runtime column probe (Phase 2 adds org_id; degrade gracefully until then) ----
const colCache = new Map<string, boolean>();
async function hasColumn(table: string, col: string): Promise<boolean> {
  const k = `${table}.${col}`;
  if (colCache.has(k)) return colCache.get(k)!;
  const row = await one<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2) AS exists`,
    [table, col],
  );
  const v = !!row?.exists;
  colCache.set(k, v);
  return v;
}

// ---- cookie helpers (no cookie plugin dependency) ----
function readCookie(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
function setSessionCookie(reply: FastifyReply, token: string, maxAgeSec: number): void {
  const parts = [
    `${SA.cookieName}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSec}`,
  ];
  if (SA.cookieSecure) parts.push("Secure");
  reply.header("Set-Cookie", parts.join("; "));
}
function clearSessionCookie(reply: FastifyReply): void {
  const parts = [`${SA.cookieName}=`, "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=0"];
  if (SA.cookieSecure) parts.push("Secure");
  reply.header("Set-Cookie", parts.join("; "));
}

// ---- bootstrap the first superadmin from env (idempotent) ----
async function ensureBootstrap(): Promise<void> {
  if (!SA.bootstrapEmail) return;
  const existing = await one<{ id: string }>(`SELECT id FROM superadmin_users WHERE email=$1`, [SA.bootstrapEmail]);
  if (existing) return;
  let hash: string | null = null;
  if (SA.bootstrapPasswordHash) {
    hash = SA.bootstrapPasswordHash;
  } else if (SA.bootstrapPassword) {
    if (!strongEnough(SA.bootstrapPassword)) {
      throw new Error("SUPERADMIN_PASSWORD too weak (need >=12 chars incl. lower, upper, digit)");
    }
    hash = hashPassword(SA.bootstrapPassword);
  }
  if (!hash) return;
  await query(`INSERT INTO superadmin_users (id, email, password_hash) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING`, [
    `sa_${randomUUID().slice(0, 8)}`,
    SA.bootstrapEmail,
    hash,
  ]);
}

interface SaSession { token: string; user_id: string; ip: string | null; expires_at: string; revoked_at: string | null }
interface SaUser { id: string; email: string; password_hash: string; is_superadmin: boolean; totp_secret: string | null }

export default async function superadminRoutes(app: FastifyInstance) {
  // ---- gate: IP allowlist (all routes) + session (all except /login) ----
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/superadmin")) return;
    const ip = clientIp(req);
    if (!ipAllowed(ip)) {
      await writeAudit({ actorUserId: null, action: "superadmin.ip_blocked", target: req.url, severity: "warning", ip });
      return reply.code(403).send({ error: "ip not allowed" });
    }
    // login / logout do not require an existing session
    const path = req.url.split("?")[0];
    if (path === "/api/superadmin/login") return;
    const token = readCookie(req, SA.cookieName);
    if (!token) return reply.code(401).send({ error: "no session" });
    const sess = await one<SaSession>(
      `SELECT token, user_id, ip, expires_at, revoked_at FROM superadmin_sessions WHERE token=$1`,
      [token],
    );
    if (!sess || sess.revoked_at || new Date(sess.expires_at).getTime() < Date.now()) {
      return reply.code(401).send({ error: "session expired" });
    }
    if (sess.ip && sess.ip !== ip) {
      return reply.code(401).send({ error: "session ip mismatch" }); // bound to login IP
    }
    const user = await one<{ id: string; is_superadmin: boolean }>(
      `SELECT id, is_superadmin FROM superadmin_users WHERE id=$1`,
      [sess.user_id],
    );
    if (!user || !user.is_superadmin) return reply.code(403).send({ error: "not a superadmin" });
    (req as any).saUserId = user.id;
    (req as any).saIp = ip;
  });

  // ---- POST /login ----
  app.post("/api/superadmin/login", async (req, reply) => {
    const ip = clientIp(req);
    const body = (req.body ?? {}) as { email?: string; password?: string; totp?: string };
    if (!body.password) return reply.code(400).send({ error: "password required" });
    // Password-only gate: the FE sends only a password. Resolve the account via a
    // provided email if any, else the single bootstrap superadmin (SUPERADMIN_EMAIL).
    const email = ((body.email ?? "").trim()) || SA.bootstrapEmail || "";
    if (!email) return reply.code(400).send({ error: "no superadmin configured" });
    await ensureBootstrap();
    const user = await one<SaUser>(
      `SELECT id, email, password_hash, is_superadmin, totp_secret FROM superadmin_users WHERE email=$1`,
      [email],
    );
    const ok = !!user && user.is_superadmin && verifyPassword(body.password, user.password_hash);
    if (!ok) {
      await writeAudit({ actorUserId: user?.id ?? null, action: "superadmin.login_failed", target: email, severity: "warning", ip });
      return reply.code(401).send({ error: "invalid credentials" });
    }
    // Dormant MFA: only enforced when SUPERADMIN_MFA=on AND a secret is set.
    if (SA.mfa && user!.totp_secret) {
      if (!body.totp || !totpValid(user!.totp_secret, body.totp)) {
        return reply.code(401).send({ error: "totp required" });
      }
    }
    const token = randomBytes(32).toString("hex");
    const ttlSec = SA.sessionTtlMinutes * 60;
    await query(
      `INSERT INTO superadmin_sessions (token, user_id, ip, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' seconds')::interval)`,
      [token, user!.id, ip, String(ttlSec)],
    );
    await query(`UPDATE superadmin_users SET last_login_at = now() WHERE id=$1`, [user!.id]);
    setSessionCookie(reply, token, ttlSec);
    await writeAudit({ actorUserId: user!.id, action: "superadmin.login", severity: "notice", ip });
    return { ok: true, user: { id: user!.id, email: user!.email }, expiresInSec: ttlSec };
  });

  // ---- POST /logout ----
  app.post("/api/superadmin/logout", async (req, reply) => {
    const token = readCookie(req, SA.cookieName);
    if (token) await query(`UPDATE superadmin_sessions SET revoked_at = now() WHERE token=$1`, [token]);
    clearSessionCookie(reply);
    await writeAudit({ actorUserId: (req as any).saUserId ?? null, action: "superadmin.logout", severity: "info", ip: (req as any).saIp });
    return { ok: true };
  });

  // ---- GET /me (session probe for the frontend) ----
  app.get("/api/superadmin/me", async (req) => {
    const user = await one<{ id: string; email: string }>(`SELECT id, email FROM superadmin_users WHERE id=$1`, [(req as any).saUserId]);
    return { user, ipAllowlistActive: SA.ipAllowlist.length > 0, mfa: SA.mfa };
  });

  // ---- GET /fleet — live calls across ALL orgs ----
  app.get("/api/superadmin/fleet", async () => {
    const hasOrg = await hasColumn("live_calls", "org_id");
    const orgSel = hasOrg ? "lc.org_id" : "NULL::text";
    const rows = await query<{
      id: string; org: string | null; agent_id: string | null; clone: string | null;
      meeting_id: string; phase: string; started_at: string; ended_at: string | null;
    }>(
      `SELECT lc.id, ${orgSel} AS org, lc.agent_id, a.name AS clone, lc.meeting_id, lc.phase,
              lc.started_at, lc.ended_at
         FROM live_calls lc
         LEFT JOIN agents a ON a.id = lc.agent_id
        WHERE lc.ended_at IS NULL
        ORDER BY lc.started_at DESC`,
    );
    const now = Date.now();
    const fleet = rows.map((r) => {
      const cs = getCall(r.id);
      // status = coarse lifecycle phase from the row; health = bridge/watchdog signal.
      let health: "healthy" | "stalling" | "bailing" = "healthy";
      if (["error", "expired", "killed"].includes(r.phase)) health = "bailing";
      else if (cs?.lastError) health = "stalling";
      else if (cs?.inFlight && now - cs.inFlight.startedAt > 45_000) health = "stalling";
      return {
        id: r.id,
        org: r.org ?? "unassigned",
        clone: r.clone ?? r.agent_id ?? "unknown",
        prospect: cs?.transcript.find((t) => t.who === "customer")?.text?.slice(0, 60) ?? r.meeting_id,
        dur: Math.max(0, Math.round((now - new Date(r.started_at).getTime()) / 1000)),
        health,
        status: r.phase,
      };
    });
    return { fleet, orgScoped: hasOrg };
  });

  // ---- POST /calls/:id/watch — hand back the live stream URL ----
  app.post("/api/superadmin/calls/:id/watch", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = await one<{ stream_url: string | null; ended_at: string | null }>(
      `SELECT stream_url, ended_at FROM live_calls WHERE id=$1`,
      [id],
    );
    if (!row) return reply.code(404).send({ error: "call not found" });
    if (row.ended_at) return reply.code(409).send({ error: "call has ended" });
    if (!row.stream_url) return reply.code(409).send({ error: "stream not ready yet" });
    await writeAudit({ actorUserId: (req as any).saUserId, action: "call.watch", target: id, severity: "notice", ip: (req as any).saIp });
    return { streamUrl: row.stream_url };
  });

  // ---- POST /calls/:id/kill — end a call (reason required) ----
  app.post("/api/superadmin/calls/:id/kill", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const reason = ((req.body ?? {}) as { reason?: string }).reason;
    if (!reason) return reply.code(400).send({ error: "reason required" });
    const row = await one<{ id: string; ended_at: string | null; org_id?: string | null }>(
      `SELECT id, ended_at FROM live_calls WHERE id=$1`,
      [id],
    );
    if (!row) return reply.code(404).send({ error: "call not found" });
    // Mark ended in the authoritative row; the live monitor/reaper tears the
    // sandbox down on next tick (we do NOT invoke e2b directly here).
    await query(`UPDATE live_calls SET ended_at = now(), phase = 'killed' WHERE id=$1 AND ended_at IS NULL`, [id]);
    endCall(id);
    await writeAudit({ actorUserId: (req as any).saUserId, action: "call.kill", target: id, severity: "critical", reason, ip: (req as any).saIp });
    return { ok: true, id, status: "killed" };
  });

  // ---- POST /emergency-stop — the highest-impact button in the console ----
  // Ends EVERY in-progress live call across ALL orgs (same authoritative-row
  // mechanism as calls/:id/kill — the reaper tears sandboxes down next tick; we
  // do NOT invoke e2b directly) AND engages the global spend kill-switch so no
  // clone can start new model spend. Reason required; fully audited. Cross-org by
  // design — this is a platform emergency control, not a per-tenant action.
  app.post("/api/superadmin/emergency-stop", async (req, reply) => {
    const reason = ((req.body ?? {}) as { reason?: string }).reason;
    if (!reason) return reply.code(400).send({ error: "reason required" });
    // 1) End all live calls (mark ended; drop live state per call).
    const live = await query<{ id: string }>(`SELECT id FROM live_calls WHERE ended_at IS NULL`);
    await query(`UPDATE live_calls SET ended_at = now(), phase = 'killed' WHERE ended_at IS NULL`);
    for (const r of live) endCall(r.id);
    // 2) Engage the global spend kill-switch (halts all model spend platform-wide).
    await setKillSwitch(true, `emergency-stop: ${reason}`);
    await writeAudit({ actorUserId: (req as any).saUserId, action: "platform.emergency_stop", severity: "critical", reason, ip: (req as any).saIp, meta: { endedCalls: live.length } });
    return { ok: true, endedCalls: live.length, killSwitch: true };
  });

  // ---- GET /orgs ----
  app.get("/api/superadmin/orgs", async () => {
    const orgs = await query(
      `SELECT id, name, slug, status, suspended_reason, created_at FROM orgs ORDER BY created_at DESC`,
    );
    return { orgs };
  });

  // ---- POST /orgs (create) ----
  app.post("/api/superadmin/orgs", async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; slug?: string };
    if (!body.name) return reply.code(400).send({ error: "name required" });
    const id = `org_${randomUUID().slice(0, 8)}`;
    const slug = (body.slug ?? body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    try {
      const org = await one(
        `INSERT INTO orgs (id, name, slug) VALUES ($1,$2,$3)
         RETURNING id, name, slug, status, created_at`,
        [id, body.name, slug],
      );
      await writeAudit({ actorUserId: (req as any).saUserId, action: "org.create", target: id, severity: "notice", ip: (req as any).saIp, meta: { name: body.name, slug } });
      return reply.code(201).send({ org });
    } catch (e) {
      return reply.code(409).send({ error: "org slug already exists" });
    }
  });

  // ---- POST /orgs/:id/suspend (reason required) ----
  app.post("/api/superadmin/orgs/:id/suspend", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const reason = ((req.body ?? {}) as { reason?: string }).reason;
    if (!reason) return reply.code(400).send({ error: "reason required" });
    const org = await one(
      `UPDATE orgs SET status='suspended', suspended_reason=$2 WHERE id=$1 RETURNING id, name, status, suspended_reason`,
      [id, reason],
    );
    if (!org) return reply.code(404).send({ error: "org not found" });
    await query(
      `INSERT INTO org_notifications (id, org_id, kind, body) VALUES ($1,$2,'org_suspended',$3)`,
      [`on_${randomUUID().slice(0, 8)}`, id, `Your organization was suspended by platform staff. Reason: ${reason}`],
    );
    await writeAudit({ actorUserId: (req as any).saUserId, action: "org.suspend", target: id, severity: "critical", reason, ip: (req as any).saIp });
    return { org };
  });

  // ---- POST /orgs/:id/enter — issue an audited, time-boxed full act-as session ----
  app.post("/api/superadmin/orgs/:id/enter", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const reason = ((req.body ?? {}) as { reason?: string }).reason;
    if (!reason) return reply.code(400).send({ error: "reason required" });
    const org = await one<{ id: string; name: string }>(`SELECT id, name FROM orgs WHERE id=$1`, [id]);
    if (!org) return reply.code(404).send({ error: "org not found" });
    const impId = `imp_${randomUUID().slice(0, 8)}`;
    const ttlSec = SA.impersonationTtlMinutes * 60;
    await query(
      `INSERT INTO impersonation_sessions (id, superadmin_user_id, org_id, reason, ip, expires_at)
       VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' seconds')::interval)`,
      [impId, (req as any).saUserId, id, reason, (req as any).saIp, String(ttlSec)],
    );
    // The org is notified that staff entered it.
    await query(
      `INSERT INTO org_notifications (id, org_id, kind, body) VALUES ($1,$2,'impersonation_started',$3)`,
      [`on_${randomUUID().slice(0, 8)}`, id, `Platform staff entered your workspace (full admin access, ${SA.impersonationTtlMinutes}m) to assist. Reason: ${reason}`],
    );
    await writeAudit({ actorUserId: (req as any).saUserId, action: "org.enter", target: id, severity: "critical", reason, ip: (req as any).saIp, meta: { impersonationId: impId, ttlMinutes: SA.impersonationTtlMinutes } });
    // Act-as: mint a real, TIME-BOXED (impersonation TTL, not the normal 7d) app
    // session as the org's own owner/admin so resolveRequestAuth scopes the whole
    // Command Center to this tenant. The impersonation is fully attributed via the
    // impersonation_sessions row + the org.enter audit above; product credentials
    // stay write-only (impersonation never unlocks a read path).
    const actAs = await one<{ user_id: string }>(
      `SELECT user_id FROM memberships WHERE org_id = $1
        ORDER BY (role='owner') DESC, (role='admin') DESC, created_at ASC LIMIT 1`,
      [id],
    );
    if (!actAs) return reply.code(409).send({ error: "org has no admin user to act as" });
    const token = await createSession(actAs.user_id, id, ttlSec * 1000);
    setAppSessionCookie(reply, token);
    return {
      ok: true,
      impersonationId: impId,
      orgId: id,
      actingAs: "org-admin",
      expiresInSec: ttlSec,
      redirect: "/",
      note: "full act-as-admin; product credentials remain write-only/never-readable",
    };
  });

  // ---- GET /readiness — clones + scores across ALL orgs ----
  app.get("/api/superadmin/readiness", async () => {
    const cfg = await loadConfig();
    const threshold = cfg.certThreshold ?? 70;
    const hasOrg = await hasColumn("agents", "org_id");
    const orgSel = hasOrg ? "a.org_id" : "NULL::text";
    const rows = await query<{
      id: string; org: string | null; clone: string; golden: string | null;
      verify: { average?: number } | null; redteam: { average?: number } | null;
    }>(
      `SELECT a.id, ${orgSel} AS org, a.name AS clone, a.golden_persona_id AS golden,
              v.value AS verify, r.value AS redteam
         FROM agents a
         LEFT JOIN settings v ON v.key = 'verify_result:' || a.id
         LEFT JOIN settings r ON r.key = 'redteam_result:' || a.id
        ORDER BY a.name`,
    );
    const clones = rows.map((r) => {
      const verifyPct = typeof r.verify?.average === "number" ? Math.round(r.verify.average * 100) : null;
      const redteamPct = typeof r.redteam?.average === "number" ? Math.round(r.redteam.average * 100) : null;
      const certified = verifyPct != null && verifyPct >= threshold && redteamPct != null && redteamPct >= 70;
      return {
        org: r.org ?? "unassigned",
        agentId: r.id,
        clone: r.clone,
        verify: verifyPct,
        redteam: redteamPct,
        golden: !!r.golden,
        certified,
      };
    });
    return { threshold, clones, orgScoped: hasOrg };
  });

  // ---- GET /reports — report-this-call queue ----
  app.get("/api/superadmin/reports", async (req) => {
    const status = (req.query as { status?: string } | undefined)?.status;
    const rows = status
      ? await query(`SELECT * FROM call_reports WHERE status=$1 ORDER BY created_at DESC LIMIT 200`, [status])
      : await query(`SELECT * FROM call_reports ORDER BY created_at DESC LIMIT 200`);
    return { reports: rows };
  });

  // ---- POST /reports/:id/triage ----
  app.post("/api/superadmin/reports/:id/triage", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { status?: string; note?: string };
    const status = body.status ?? "triaged";
    if (!["triaged", "dismissed", "open"].includes(status)) return reply.code(400).send({ error: "status must be triaged|dismissed|open" });
    const report = await one(
      `UPDATE call_reports SET status=$2, triage_note=$3, triaged_by=$4, triaged_at=now() WHERE id=$1
       RETURNING id, status, triage_note`,
      [id, status, body.note ?? null, (req as any).saUserId],
    );
    if (!report) return reply.code(404).send({ error: "report not found" });
    await writeAudit({ actorUserId: (req as any).saUserId, action: "report.triage", target: id, severity: "notice", reason: body.note, ip: (req as any).saIp, meta: { status } });
    return { report };
  });

  // ---- GET/POST /config (settings-backed) ----
  app.get("/api/superadmin/config", async () => {
    return { config: await loadConfig() };
  });
  app.post("/api/superadmin/config", async (req) => {
    const patch = (req.body ?? {}) as Record<string, unknown>;
    const current = await loadConfig();
    const next = { ...current, ...patch };
    await query(
      `INSERT INTO settings (org_id, key, value) VALUES ($1, 'superadmin_config', $2)
       ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [PLATFORM_ORG, JSON.stringify(next)],
    );
    await writeAudit({ actorUserId: (req as any).saUserId, action: "config.update", severity: "warning", ip: (req as any).saIp, meta: { keys: Object.keys(patch) } });
    return { config: next };
  });

  // ---- GET /billing + POST /billing/rate-card (p6 super-admin cost/revenue) ----
  // Integration (reconciliation #10): the p6 FE expects a `billing` endpoint.
  // KPIs are derived from the canonical orgs (MRR/active/paying); the editable
  // rate card is settings-backed, defaulting to the Phase-3 metering rates.
  app.get("/api/superadmin/billing", async () => {
    const rows = await query<{ id: string; name: string; plan: string | null; status: string; mrr_cents: number; seats: number; signup_at: string | null; went_live_at: string | null; churned_at: string | null }>(
      `SELECT id, name, plan, status, mrr_cents, seats, signup_at, went_live_at, churned_at FROM orgs ORDER BY mrr_cents DESC NULLS LAST, name ASC`,
    ).catch(() => []);
    const mrr = rows.reduce((a, o) => a + (Number(o.mrr_cents) || 0), 0) / 100;
    const active = rows.filter((o) => o.status === "active").length;
    const paying = rows.filter((o) => (Number(o.mrr_cents) || 0) > 0).length;
    const liveCount = rows.filter((o) => !!o.went_live_at && !o.churned_at).length;
    const kpis = [
      { label: "MRR", val: `$${mrr.toLocaleString()}` },
      { label: "Paying orgs", val: String(paying) },
      { label: "Active orgs", val: String(active) },
      { label: "Live orgs", val: String(liveCount) },
    ];
    const orgs = rows.map((o) => ({
      id: o.id, name: o.name, plan: o.plan || "free", status: o.status,
      mrrCents: Number(o.mrr_cents) || 0, seats: Number(o.seats) || 0,
      signupAt: o.signup_at, liveAt: o.went_live_at, churnedAt: o.churned_at,
    }));
    return { kpis, orgs, rateCard: await loadRateCard() };
  });
  app.post("/api/superadmin/billing/rate-card", async (req, reply) => {
    const b = (req.body ?? {}) as { id?: string; price?: string; reason?: string };
    if (!b.id || typeof b.price !== "string") return reply.code(400).send({ error: "id and price (string) required" });
    const row = await one<{ value: Record<string, string> }>(`SELECT value FROM settings WHERE org_id=$1 AND key='superadmin_rate_card'`, [PLATFORM_ORG]);
    const next = { ...(row?.value ?? {}), [b.id]: b.price };
    await query(
      `INSERT INTO settings (org_id, key, value) VALUES ($1, 'superadmin_rate_card', $2)
       ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [PLATFORM_ORG, JSON.stringify(next)],
    );
    await writeAudit({ actorUserId: (req as any).saUserId, action: "billing.rate_card_update", target: b.id, severity: "notice", reason: b.reason, ip: (req as any).saIp });
    return { ok: true, rateCard: await loadRateCard() };
  });

  // ---- GET /audit — read the append-only log ----
  // ---- Ava demo brain (RAW golden editor) --------------------------------
  // GET the demo host golden instructions; POST replaces them wholesale and
  // applies to the demo agent (next lease + hot-reload of any running session).
  app.get("/api/superadmin/demo-golden", async () => {
    const row = await getSetting<{ instructions?: string }>(config.legacyOrgId, "demo_host_golden");
    return { text: (row?.instructions ?? ""), agentId: config.demo.agentId, orgId: config.demo.orgId };
  });
  app.post("/api/superadmin/demo-golden", async (req, reply) => {
    const b = (req.body ?? {}) as { text?: string };
    const text = (b.text ?? "").toString();
    if (text.trim().length < 200) return reply.code(400).send({ error: "That looks too short — paste the full instructions (200+ chars)." });
    const cur = await getSetting<Record<string, unknown>>(config.legacyOrgId, "demo_host_golden");
    await setSetting(config.legacyOrgId, "demo_host_golden", { ...(cur ?? {}), instructions: text });
    await query("UPDATE agents SET golden_instructions=$1 WHERE id=$2", [text, config.demo.agentId]);
    // hot-reload any LIVE demo session so the edit lands mid-call, not just next lease
    let live = false;
    try { await pushPersonaReload(config.demo.orgId, config.demo.agentId); live = true; } catch { /* no live session / best effort */ }
    return { ok: true, length: text.length, hotReloaded: live };
  });

  app.get("/api/superadmin/audit", async (req) => {
    const q = (req.query ?? {}) as { action?: string; severity?: string; limit?: string };
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.action) { params.push(q.action); where.push(`action = $${params.length}`); }
    if (q.severity) { params.push(q.severity); where.push(`severity = $${params.length}`); }
    params.push(limit);
    const rows = await query(
      `SELECT id, actor_user_id, action, target, severity, reason, ip, created_at, meta
         FROM audit_log
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return { audit: rows };
  });
}

// ---- config store (settings key 'superadmin_config') ----
interface SuperadminConfig {
  certThreshold: number;   // cert gate (default 70)
  modelTier: string;       // e.g. 'standard' | 'premium'
  authMode: string;        // AUTH_MODE surfaced to the platform
  featureFlags: Record<string, boolean>;
}
async function loadConfig(): Promise<SuperadminConfig> {
  const row = await one<{ value: Partial<SuperadminConfig> }>(`SELECT value FROM settings WHERE org_id=$1 AND key='superadmin_config'`, [PLATFORM_ORG]);
  return {
    certThreshold: 70,
    modelTier: "standard",
    authMode: "password",
    featureFlags: {},
    ...(row?.value ?? {}),
  };
}

// ---- rate card store (settings key 'superadmin_rate_card' overrides) ----
interface RateCardItem { id: string; item: string; price: string; }
async function loadRateCard(): Promise<RateCardItem[]> {
  const m = config.metering;
  const defaults: RateCardItem[] = [
    { id: "live_call_minute", item: "Live call (per minute)", price: `$${m.liveCallUsdPerMin.toFixed(2)}` },
    { id: "overage_minute", item: "Overage (per minute)", price: `$${m.overagePerMinDefault.toFixed(2)}` },
    { id: "sandbox_minute", item: "Sandbox (per minute)", price: `$${m.sandboxUsdPerMin.toFixed(3)}` },
    { id: "tts_1k_chars", item: "TTS (per 1k chars)", price: `$${(m.ttsUsdPerChar * 1000).toFixed(3)}` },
    { id: "llm_1k_in", item: "LLM input (per 1k tokens)", price: `$${m.llmUsdPer1kInput.toFixed(4)}` },
    { id: "llm_1k_out", item: "LLM output (per 1k tokens)", price: `$${m.llmUsdPer1kOutput.toFixed(4)}` },
  ];
  const row = await one<{ value: Record<string, string> }>(`SELECT value FROM settings WHERE org_id=$1 AND key='superadmin_rate_card'`, [PLATFORM_ORG]);
  const overrides = row?.value ?? {};
  return defaults.map((d) => (overrides[d.id] ? { ...d, price: overrides[d.id] } : d));
}
