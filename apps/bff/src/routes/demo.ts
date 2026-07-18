import type { FastifyInstance, FastifyRequest } from "fastify";
import { query, one } from "../db/pool.js";
import { config } from "../config.js";
import { emit, EVENTS } from "../lib/analytics.js";
import { lease, reap, sayTo, slotForSession, transcriptFor, poolStats, audioFor } from "../lib/demoPool.js";

// ============================================================================
// routes/demo.ts — PUBLIC, UNAUTHENTICATED "Talk to Ava" demo API.
//
// Exempt from the session / API-key gate (see the /api/demo bypass in
// index.ts, mirroring /api/superadmin) and RATE-LIMITED here in-process:
//   * per-IP: at most 1 active session (config.demo.perIpActive)
//   * per-IP: at most N session starts / hour (config.demo.perIpHour)
//   * global concurrency: bounded by the warm-pool hard cap — an exhausted pool
//     returns { status:"queued" } instead of a new sandbox.
//   * hard session timeout: config.demo.sessionSec, after which the session
//     flips to "expired" and the sandbox is reaped (lazy, on the next poll).
// NO CAPTCHA. All demo rows are scoped to the fixed DEMO tenant (org_id).
// ============================================================================

const ORG = config.demo.orgId;
const SESSION_MS = config.demo.sessionSec * 1000;

interface DemoSession {
  id: string; sandbox_id: string | null; status: string; ip: string | null;
  utm: string | null; started_at: string; expires_at: string | null;
  ended_at: string | null; transcript: unknown; created_at: string;
}

function clientIp(req: FastifyRequest): string { return (req.ip || "0.0.0.0").slice(0, 64); }
function newId(prefix: string): string { return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
function remainingSec(expiresAt: string | null): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

// Lazily expire a live session past its hard timeout: flip status + reap sandbox.
async function expireIfDue(s: DemoSession): Promise<DemoSession> {
  if (s.status === "live" && s.expires_at && new Date(s.expires_at).getTime() < Date.now()) {
    await query(`UPDATE demo_sessions SET status='expired', ended_at=now() WHERE id=$1 AND org_id=$2`, [s.id, ORG]);
    void reap(s.id).catch(() => {});
    return { ...s, status: "expired", ended_at: new Date().toISOString() };
  }
  return s;
}

// Map internal DB status → the API's status vocabulary.
function apiStatus(dbStatus: string): "connecting" | "live" | "ended" | "expired" {
  if (dbStatus === "queued") return "connecting";
  if (dbStatus === "live") return "live";
  if (dbStatus === "expired") return "expired";
  return "ended";
}

export default async function demoRoutes(app: FastifyInstance) {
  // ---- POST /api/demo/start : lease a warm slot (or queue) ----------------
  app.post("/api/demo/start", async (req, reply) => {
    const b = (req.body ?? {}) as { utm?: string };
    const ip = clientIp(req);
    const utm = typeof b.utm === "string" ? b.utm.slice(0, 200) : null;

    // Abuse control 1: cap concurrent active (queued|live) sessions per IP.
    const active = await one<{ n: string }>(
      `SELECT count(*)::text AS n FROM demo_sessions WHERE org_id=$1 AND ip=$2 AND status IN ('queued','live')`, [ORG, ip],
    );
    if (active && Number(active.n) >= config.demo.perIpActive) {
      return reply.code(429).send({ error: "You already have an active demo. Finish or end it first.", code: "ip_active" });
    }

    // Abuse control 2: per-IP starts/hour cap.
    const recent = await one<{ n: string }>(
      `SELECT count(*)::text AS n FROM demo_sessions WHERE org_id=$1 AND ip=$2 AND created_at > now() - interval '1 hour'`, [ORG, ip],
    );
    if (recent && Number(recent.n) >= config.demo.perIpHour) {
      return reply.code(429).send({ error: "Hourly demo limit reached for your network. Try again later.", code: "ip_hour" });
    }

    const id = newId("ds");
    // Try to lease a warm slot. Global concurrency is enforced by the pool's
    // hard cap: an exhausted pool returns queued (never a fresh over-cap boot).
    const result = await lease(id);
    if (result.ok) {
      const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
      await query(
        `INSERT INTO demo_sessions (id, org_id, sandbox_id, status, ip, utm, started_at, expires_at)
         VALUES ($1,$2,$3,'live',$4,$5, now(), $6)`,
        [id, ORG, result.sandboxId, ip, utm, expiresAt],
      );
      void emit(EVENTS.AVA_SESSION, { orgId: ORG, callId: id, distinctId: id, props: { utm, mode: "ready" } });
      return reply.code(201).send({ sessionId: id, status: "ready", streamUrl: result.streamUrl, expiresAt });
    }
    // Queued: no warm slot right now. Persist queued; the FE polls status, which
    // lazily promotes it as soon as a slot frees.
    await query(
      `INSERT INTO demo_sessions (id, org_id, status, ip, utm) VALUES ($1,$2,'queued',$3,$4)`,
      [id, ORG, ip, utm],
    );
    void emit(EVENTS.AVA_SESSION, { orgId: ORG, callId: id, distinctId: id, props: { utm, mode: "queued" } });
    return reply.code(201).send({ sessionId: id, status: "queued", queuePosition: result.position, expiresAt: null });
  });

  // ---- GET /api/demo/:sessionId/status : drives the FE poll ----------------
  app.get("/api/demo/:sessionId/status", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    let s = await one<DemoSession>(`SELECT * FROM demo_sessions WHERE id=$1 AND org_id=$2`, [sessionId, ORG]);
    if (!s) return reply.code(404).send({ error: "no such demo session" });
    s = await expireIfDue(s);

    // Lazy queue→live promotion: a queued session tries to grab a freed slot.
    if (s.status === "queued") {
      const got = await lease(sessionId);
      if (got.ok) {
        const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
        await query(`UPDATE demo_sessions SET status='live', sandbox_id=$3, started_at=now(), expires_at=$4 WHERE id=$1 AND org_id=$2`,
          [sessionId, ORG, got.sandboxId, expiresAt]);
        return {
          status: "live", streamUrl: got.streamUrl, remainingSec: config.demo.sessionSec,
        };
      }
      return { status: "connecting", streamUrl: "", remainingSec: 0, queuePosition: got.queued ? got.position : undefined };
    }

    if (s.status === "live") {
      const slot = slotForSession(sessionId);
      const streamUrl = slot?.streamUrl || "";
      let transcript: { role: string; text: string }[] | undefined;
      try { transcript = await transcriptFor(sessionId); } catch { transcript = undefined; }
      return { status: "live", streamUrl, remainingSec: remainingSec(s.expires_at), transcript };
    }
    // ended | expired
    return {
      status: apiStatus(s.status), streamUrl: "", remainingSec: 0,
      transcript: Array.isArray(s.transcript) ? s.transcript : undefined,
    };
  });

  // ---- POST /api/demo/:sessionId/say : inject a guest turn -----------------
  app.post("/api/demo/:sessionId/say", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const b = (req.body ?? {}) as { text?: string };
    const text = (b.text ?? "").toString().trim();
    if (!text) return reply.code(400).send({ error: "text required" });
    let s = await one<DemoSession>(`SELECT * FROM demo_sessions WHERE id=$1 AND org_id=$2`, [sessionId, ORG]);
    if (!s) return reply.code(404).send({ error: "no such demo session" });
    s = await expireIfDue(s);
    if (s.status !== "live") return reply.code(409).send({ error: `session is ${apiStatus(s.status)}`, status: apiStatus(s.status) });
    const ok = await sayTo(sessionId, text.slice(0, 500));
    if (!ok) return reply.code(502).send({ error: "could not reach the demo bridge" });
    return reply.code(200).send({ ok: true });
  });

  // ---- POST /api/demo/:sessionId/end : end + reap sandbox ------------------
  app.post("/api/demo/:sessionId/end", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const s = await one<DemoSession>(`SELECT * FROM demo_sessions WHERE id=$1 AND org_id=$2`, [sessionId, ORG]);
    if (!s) return reply.code(404).send({ error: "no such demo session" });
    if (s.ended_at) return reply.code(200).send({ endedAt: s.ended_at });
    // Persist the transcript before teardown (best-effort).
    let transcript: { role: string; text: string }[] = [];
    if (s.status === "live") { try { transcript = await transcriptFor(sessionId); } catch { /* best-effort */ } }
    const endedAt = new Date().toISOString();
    await query(`UPDATE demo_sessions SET status='ended', ended_at=now(), transcript=$3 WHERE id=$1 AND org_id=$2`,
      [sessionId, ORG, JSON.stringify(transcript)]);
    void reap(sessionId).catch(() => {});
    return reply.code(200).send({ endedAt });
  });

  // ---- POST /api/demo/:sessionId/lead : capture a lead email ---------------
  app.post("/api/demo/:sessionId/lead", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const b = (req.body ?? {}) as { email?: string };
    const email = (b.email ?? "").toString().trim().toLowerCase();
    // Pragmatic RFC-lite email check.
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: "a valid email is required" });
    }
    const s = await one<{ id: string }>(`SELECT id FROM demo_sessions WHERE id=$1 AND org_id=$2`, [sessionId, ORG]);
    if (!s) return reply.code(404).send({ error: "no such demo session" });
    await query(`INSERT INTO demo_leads (id, org_id, session_id, email) VALUES ($1,$2,$3,$4)`,
      [newId("dl"), ORG, sessionId, email]);
    void emit(EVENTS.SIGNUP_STARTED, { orgId: ORG, callId: sessionId, distinctId: sessionId, props: { source: "ava_demo" } });
    return reply.code(200).send({ ok: true });
  });

  // ---- GET /api/demo/:sessionId/audio : Ava's REAL spoken voice (vspk PCM) -
  // Unauthenticated, like the rest of /api/demo/*. Streams the session's bound
  // sandbox output EXACTLY as GET /api/live/audio does — base64 PCM s16le/24k
  // mono chunks the browser schedules via Web Audio (see TalkToAva.tsx). The
  // sandbox is resolved from the warm pool by sessionId inside audioFor() (same
  // slot binding slotForSession/sayTo/transcriptFor use), so this stays a cheap
  // in-memory lookup on the hot poll path — no per-poll DB read. Capture
  // self-starts on the first poll (after=-1 asks for the live edge); each later
  // poll tails up to 72KB (~1.5s). Returns { live:false } for any non-live or
  // unknown session, which the client treats as "not voicing yet".
  app.get("/api/demo/:sessionId/audio", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const q = (req.query ?? {}) as { after?: string };
    const after = Math.max(-1, parseInt(q.after ?? "-1", 10) || -1);
    const a = await audioFor(sessionId, after);
    return reply.code(200).send(a);
  });

  // ---- GET /api/demo/pool : lightweight pool health (ops visibility) -------
  app.get("/api/demo/pool", async () => poolStats());
}
