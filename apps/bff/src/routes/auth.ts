import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { config } from "../config.js";
import {
  hashPassword, verifyPassword, newId, createSession, destroySession,
  setSessionCookie, clearSessionCookie, parseCookies, orgId,
} from "../lib/auth.js";
import { getOrgDemoLogin, setOrgDemoLogin } from "../lib/tenancy.js";

// ============================================================
// PHASE 2 — auth endpoints (email + password + session cookie).
// These are always mounted, but only enforced when config.auth.mode ==
// "password". In access-code mode they still work (so orgs/users can be
// provisioned ahead of cutover), but callers already pass the shared key.
// The onRequest hook (index.ts) exempts /api/auth/{signup,login} so an
// unauthenticated client can obtain a session.
// ============================================================
export default async function authRoutes(app: FastifyInstance) {
  // Public: which auth mode the backend runs (access-code vs password). The
  // FE fetches this BEFORE gating so it shows the right login. Exempted in the
  // onRequest hook (index.ts) so an unauthenticated client can read it.
  app.get("/api/auth/mode", async () => ({ mode: config.auth.mode }));

  // Whoami: current user, active org, and all orgs they belong to.
  app.get("/api/auth/me", async (req) => {
    if (!req.user) return { authenticated: false, mode: config.auth.mode, org: req.org ?? null };
    const orgs = await query<{ id: string; name: string; role: string }>(
      `SELECT o.id, o.name, m.role FROM memberships m JOIN orgs o ON o.id = m.org_id
        WHERE m.user_id = $1 ORDER BY m.created_at`,
      [req.user.id],
    );
    return { authenticated: true, mode: config.auth.mode, user: req.user, org: req.org ?? null, orgs };
  });

  // Sign up: creates a user, a brand-new org, an owner membership, and a session.
  app.post("/api/auth/signup", async (req, reply) => {
    if (!config.auth.allowSignup) return reply.code(403).send({ error: "signup disabled" });
    const b = (req.body ?? {}) as { email?: string; password?: string; name?: string; orgName?: string };
    const email = (b.email ?? "").trim().toLowerCase();
    const password = b.password ?? "";
    if (!email.includes("@")) return reply.code(400).send({ error: "valid email required" });
    if (password.length < 8) return reply.code(400).send({ error: "password must be at least 8 characters" });

    const existing = await one<{ id: string }>(`SELECT id FROM users WHERE lower(email) = $1`, [email]);
    if (existing) return reply.code(409).send({ error: "an account with that email already exists" });

    const userId = newId("usr");
    const orgId = newId("org");
    const orgName = (b.orgName ?? "").trim() || `${(b.name ?? email.split("@")[0])}'s workspace`;
    const pwHash = await hashPassword(password);

    // orgs -> users -> membership, then session. Best-effort cleanup on failure.
    await query(`INSERT INTO orgs (id, name) VALUES ($1, $2)`, [orgId, orgName]);
    try {
      await query(`INSERT INTO users (id, email, password_hash, name) VALUES ($1,$2,$3,$4)`,
        [userId, email, pwHash, (b.name ?? "").trim() || null]);
    } catch (err) {
      await query(`DELETE FROM orgs WHERE id = $1`, [orgId]).catch(() => {});
      return reply.code(409).send({ error: "could not create account" });
    }
    await query(`INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,'owner')`, [userId, orgId]);

    const token = await createSession(userId, orgId);
    setSessionCookie(reply, token);
    return reply.code(201).send({ ok: true, user: { id: userId, email, name: b.name ?? undefined }, org: { id: orgId, name: orgName, role: "owner" } });
  });

  // Log in: verify password, open a session, set the cookie.
  app.post("/api/auth/login", async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string; password?: string };
    const email = (b.email ?? "").trim().toLowerCase();
    const password = b.password ?? "";
    const user = await one<{ id: string; email: string; name: string | null; password_hash: string | null }>(
      `SELECT id, email, name, password_hash FROM users WHERE lower(email) = $1`,
      [email],
    );
    // Constant-ish work whether or not the user exists (mitigate enumeration).
    const ok = await verifyPassword(password, user?.password_hash ?? "scrypt$16384$8$1$00$00");
    if (!user || !ok) return reply.code(401).send({ error: "invalid email or password" });

    // Default the session to the user's first org.
    const firstOrg = await one<{ org_id: string }>(
      `SELECT org_id FROM memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1`,
      [user.id],
    );
    const token = await createSession(user.id, firstOrg?.org_id ?? null);
    setSessionCookie(reply, token);
    return { ok: true, user: { id: user.id, email: user.email, name: user.name ?? undefined } };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = parseCookies(req)[config.auth.cookieName];
    if (token) await destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  // Switch the active org for the current session (must be a member).
  app.post("/api/auth/switch-org", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "not authenticated" });
    const b = (req.body ?? {}) as { orgId?: string };
    const target = (b.orgId ?? "").trim();
    const member = await one<{ org_id: string }>(
      `SELECT org_id FROM memberships WHERE user_id = $1 AND org_id = $2`,
      [req.user.id, target],
    );
    if (!member) return reply.code(403).send({ error: "not a member of that org" });
    const token = parseCookies(req)[config.auth.cookieName];
    await query(`UPDATE sessions SET org_id = $2 WHERE id = $1`, [token, target]);
    return { ok: true, orgId: target };
  });

  // ---- Task 6: the MANDATORY, org-scoped demo/product account ----
  // The org-level default demo login every clone falls back to when it has no
  // own creds. Resolves per-org (never global). Password stays write-only.
  app.get("/api/org/demo-login", async (req) => {
    const cur = (await getOrgDemoLogin(orgId(req))) ?? {};
    return {
      system: cur.system ?? "", url: cur.url ?? "", notes: cur.notes ?? "",
      email: cur.email ?? "", hasPassword: !!cur.password,
    };
  });
  app.put("/api/org/demo-login", async (req, reply) => {
    const org = orgId(req);
    const b = (req.body ?? {}) as { system?: string; url?: string; notes?: string; email?: string; password?: string };
    const email = (b.email ?? "").trim();
    if (email && !email.includes("@")) return reply.code(400).send({ error: "that email doesn't look valid" });
    const cur = (await getOrgDemoLogin(org)) ?? {};
    // Merge: partial edits never wipe other fields; password kept unless retyped.
    await setOrgDemoLogin(org, {
      system: b.system !== undefined ? String(b.system).trim() : (cur.system ?? ""),
      url: b.url !== undefined ? String(b.url).trim() : (cur.url ?? ""),
      notes: b.notes !== undefined ? String(b.notes).trim() : (cur.notes ?? ""),
      email: b.email !== undefined ? email : (cur.email ?? ""),
      password: (b.password ?? "").trim() || cur.password || "",
    });
    return { ok: true };
  });
}
