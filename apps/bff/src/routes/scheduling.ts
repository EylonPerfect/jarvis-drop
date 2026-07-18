import type { FastifyInstance, FastifyRequest } from "fastify";
import { spawn } from "node:child_process";
import { openSync, existsSync } from "node:fs";
import { query, one } from "../db/pool.js";
import { encryptSecret, decryptSecret, credAad } from "../lib/cryptoCreds.js";
import { fetchCloneCalendar } from "../lib/cloneCalendar.js";
import { liveJoinGate } from "./readiness.js";
import { orgId } from "../lib/auth.js";
import { config } from "../config.js";

// ============================================================
// CLONE JOIN + SCHEDULING (Launch Decisions Batch 3 #1/#5 + Instant-link access
// control). Three surfaces, one gate:
//   1. Clone meeting/calendar ACCOUNT — the clone's OWN email+username+password
//      (a real dedicated account, e.g. maya-ai@theircompany.com), stored like
//      demo_login but ENCRYPTED. This is the account whose calendar we watch.
//   2. CALENDAR-WATCH scheduler — reads that account's calendar and, at each
//      meeting's start time, triggers the EXISTING live-call launch (via
//      /api/live/join → call_up/call_wake). New table `scheduled_calls`.
//   3. INSTANT-LINK join — summon a clone onto a pasted link NOW.
//
// NON-NEGOTIABLE: the >=70 readiness gate (readiness.ts liveJoinGate) applies to
// EVERY live join — scheduled AND instant. Both paths delegate to /api/live/join,
// which is the structural backstop; this layer ALSO pre-checks so it can fail fast
// with a clear reason + an audit row. AI disclosure fires in the bridge on every
// live (zoom) call regardless of how it was summoned.
// ============================================================

const AH = "/app/ah";
const PORT = process.env.PORT || 8787;
const KEY = process.env.BFF_API_KEY || "";

// Pre-warm lead: spin the sandbox this many ms before start so a cold start
// (~60-120s) still joins on time. Batch 3 #5 says 3-5 min.
const PREWARM_LEAD_MS = 4 * 60_000;
// How close to start_at we actually launch the join.
const LAUNCH_WINDOW_MS = 90_000;
// Give up on a booked call this long after its start if it never launched.
const LAUNCH_GRACE_MS = 10 * 60_000;
// Concurrency defaults (Phase 2 owns real per-org caps; see org_concurrency).
const DEFAULT_ORG_CONCURRENCY = 3;
const DEFAULT_PLATFORM_CONCURRENCY = 10;

const MEETING_KEY = (agentId: string) => `meeting_account:${agentId}`;

// Parse a Zoom-style numeric id out of a pasted link (mirrors live.ts).
function parseMeetingId(raw: string): string {
  const jm = raw.match(/\/j\/(\d{9,11})/);
  const runs = raw.match(/\d{9,11}/g);
  return jm ? jm[1] : runs?.length ? runs[runs.length - 1] : "";
}

// ---- audit -------------------------------------------------------------------
type AuditEvent =
  | "summon" | "gate_pass" | "gate_block" | "concurrency_block"
  | "spend_block" | "disabled_block" | "launched" | "error";
async function audit(row: {
  agentId?: string | null; orgId?: string | null; actor?: string; source: "instant" | "scheduled";
  meetingLink?: string; event: AuditEvent; score?: number | null; detail?: string;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO call_audit (agent_id, org_id, actor, source, meeting_link, event, score, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.agentId ?? null, row.orgId ?? null, row.actor ?? null, row.source,
       (row.meetingLink ?? "").slice(0, 500), row.event, row.score ?? null, (row.detail ?? "").slice(0, 500)],
    );
  } catch { /* audit must never block a call decision */ }
}

// ---- access control (Phase 2 multi-tenant auth) ------------------------------
// Authorization is derived ONLY from the caller's server-resolved identity:
// orgId(req) is the caller's authenticated org (from the session cookie in
// AUTH_MODE=password, resolved via a memberships lookup in lib/auth.ts; pinned to
// the legacy org in access-code mode). Client-supplied values — the x-member-id
// header, any body org — are NEVER trusted for authz.

// Identity string for the AUDIT TRAIL ONLY — never used for an authz decision.
// Derived from the authenticated session, not from any client-supplied value.
function resolveActor(req: FastifyRequest): string {
  return req.user?.email ?? req.user?.id ?? "operator";
}

// True iff `agentId` exists AND belongs to `org`. Gate EVERY :agentId handler
// with this: an agent id is globally unique, so once we've confirmed it's this
// org's agent, its many child rows filtered only by agent_id (scheduled_calls,
// call_audit, meeting-account settings, …) are this org's too. A miss returns
// 404 (never 403) so we never leak another org's clone's existence.
// (Mirrors lib/tenancy.ts#agentInOrg; kept local to the one file this fix owns.)
async function agentInOrg(agentId: string, org: string): Promise<boolean> {
  const row = await one<{ ok: number }>(`SELECT 1 AS ok FROM agents WHERE id = $1 AND org_id = $2`, [agentId, org]);
  return !!row;
}

// Verify the caller may summon this clone. The clone must belong to the caller's
// authenticated org, and (password mode) the caller must hold a live membership
// in that org. Cross-org is REJECTED. No client header/body is consulted.
async function assertOrgMember(req: FastifyRequest, agent: { org_id?: string | null }): Promise<{ ok: boolean; reason?: string }> {
  const callerOrg = orgId(req); // the onRequest hook guarantees this is resolved (else 401)
  // Authoritative cross-org denial: the clone must live in the caller's own org.
  if (!agent.org_id || agent.org_id !== callerOrg) return { ok: false, reason: "not authorized for this clone" };
  // Defense in depth: in password mode confirm an active membership row exists.
  // (access-code mode has no user identity — the org pin above is the gate.)
  if (req.user?.id) {
    const m = await one<{ ok: number }>(
      `SELECT 1 AS ok FROM memberships WHERE user_id = $1 AND org_id = $2`,
      [req.user.id, callerOrg],
    );
    if (!m) return { ok: false, reason: "not a member of this org" };
  }
  return { ok: true };
}

// ---- concurrency (Phase 2 callstate) + spend (Phase 3 breaker) ---------------
async function concurrencyState(orgId: string | null): Promise<{ orgActive: number; orgCap: number; platActive: number; platCap: number }> {
  // Active live calls = un-ended live_calls rows. Per-org via agents.org_id.
  const platActive = Number((await one<{ n: string }>(`SELECT COUNT(*) n FROM live_calls WHERE ended_at IS NULL`))?.n ?? 0);
  let orgActive = platActive;
  if (orgId) {
    orgActive = Number((await one<{ n: string }>(
      `SELECT COUNT(*) n FROM live_calls lc JOIN agents a ON a.id = lc.agent_id WHERE lc.ended_at IS NULL AND a.org_id = $1`,
      [orgId],
    ))?.n ?? 0);
  }
  const orgCapRow = orgId ? await one<{ max_parallel: number }>(`SELECT max_parallel FROM org_concurrency WHERE org_id=$1`, [orgId]) : null;
  const orgCap = orgCapRow?.max_parallel ?? DEFAULT_ORG_CONCURRENCY;
  // Platform-wide cap lives under the platform/legacy tenant. Scope explicitly by
  // org_id so the (org_id,key) composite PK read is deterministic and does not
  // depend on the org_id DEFAULT that the cutover drops. Read from BOTH the
  // request path and the worker sweep, so it must not reference req.
  const platCapRow = (await one<any>(`SELECT value FROM settings WHERE org_id=$1 AND key='platform_concurrency_cap'`, [config.legacyOrgId]))?.value;
  const platCap = typeof platCapRow === "number" ? platCapRow : DEFAULT_PLATFORM_CONCURRENCY;
  return { orgActive, orgCap, platActive, platCap };
}
async function concurrencyAllowed(orgId: string | null): Promise<{ ok: boolean; reason?: string }> {
  const c = await concurrencyState(orgId);
  if (c.platActive >= c.platCap) return { ok: false, reason: `platform concurrency cap reached (${c.platActive}/${c.platCap})` };
  if (c.orgActive >= c.orgCap) return { ok: false, reason: `org concurrency cap reached (${c.orgActive}/${c.orgCap})` };
  return { ok: true };
}
async function spendAllowed(_orgId: string | null): Promise<{ ok: boolean; reason?: string }> {
  // Phase 3 owns the spend ledger + budget breaker. We honor a global breaker
  // flag it can flip; the real per-org budget check plugs in here. INTEGRATION DEP.
  // Platform-wide breaker lives under the platform/legacy tenant — scope explicitly
  // (same rationale as platform_concurrency_cap: deterministic composite-PK read,
  // no reliance on the dropping DEFAULT, req-free for the worker path).
  const breaker = (await one<any>(`SELECT value FROM settings WHERE org_id=$1 AND key='platform_spend_breaker'`, [config.legacyOrgId]))?.value;
  if (breaker === true || breaker === "tripped") return { ok: false, reason: "spend breaker tripped (Phase 3 budget cap)" };
  return { ok: true };
}

// ---- the one launch path — delegates to /api/live/join (the gate backstop) ---
// Both instant and scheduled call this. This layer pre-checks the gate (for a
// fast, audited failure) but /api/live/join ALWAYS re-runs the gate itself as the
// authoritative enforcement — there is no bypass flag.
async function launchLive(agentId: string, meetingLink: string, org: string): Promise<{ ok: boolean; callId?: string; error?: string; status: number }> {
  try {
    const r = await fetch(`http://localhost:${PORT}/api/live/join`, {
      method: "POST",
      // X-Service-Org: /api/live/join must resolve the clone in ITS org, not legacy (follow-up #73).
      headers: { "Content-Type": "application/json", "X-API-Key": KEY, "X-Service-Org": org },
      body: JSON.stringify({ agentId, meetingId: meetingLink, mode: "zoom" }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await r.json().catch(() => ({}))) as any;
    if (!r.ok) return { ok: false, error: j?.error || `join failed (${r.status})`, status: r.status };
    return { ok: true, callId: j.callId, status: r.status };
  } catch (e) {
    return { ok: false, error: String(e), status: 500 };
  }
}

// Full pre-flight for a live join (used by BOTH paths): toggle → gate →
// concurrency → spend. Writes the audit trail. Returns a decision.
async function preflight(agent: any, source: "instant" | "scheduled", actor: string, meetingLink: string): Promise<{ ok: boolean; code?: string; reason?: string; score?: number }> {
  const orgId = agent.org_id ?? null;
  if (source === "instant" && agent.allow_instant_joins === false) {
    await audit({ agentId: agent.id, orgId, actor, source, meetingLink, event: "disabled_block", detail: "allow_instant_joins is off" });
    return { ok: false, code: "instant_disabled", reason: "instant joins are turned off for this clone" };
  }
  // THE GATE — never bypassed.
  const gate = await liveJoinGate(agent.id);
  if (!gate.ok) {
    await audit({ agentId: agent.id, orgId, actor, source, meetingLink, event: "gate_block", score: gate.score, detail: gate.reason });
    return { ok: false, code: "readiness_gate", reason: gate.reason, score: gate.score };
  }
  await audit({ agentId: agent.id, orgId, actor, source, meetingLink, event: "gate_pass", score: gate.score, detail: gate.reason });
  const conc = await concurrencyAllowed(orgId);
  if (!conc.ok) {
    await audit({ agentId: agent.id, orgId, actor, source, meetingLink, event: "concurrency_block", score: gate.score, detail: conc.reason });
    return { ok: false, code: "concurrency", reason: conc.reason!, score: gate.score };
  }
  const spend = await spendAllowed(orgId);
  if (!spend.ok) {
    await audit({ agentId: agent.id, orgId, actor, source, meetingLink, event: "spend_block", score: gate.score, detail: spend.reason });
    return { ok: false, code: "spend", reason: spend.reason!, score: gate.score };
  }
  return { ok: true, score: gate.score };
}

// ---- calendar reader ---------------------------------------------------------
// Read UPCOMING meetings from the clone's OWN meeting account. The account is
// email+username+PASSWORD (no OAuth), so we read the mailbox over IMAPS and parse
// invite iCalendar parts (text/calendar / .ics) into CalEvent[] — see
// lib/cloneCalendar.ts (provider→IMAP host map; Gmail/MS need an app password;
// UID/DTSTART/SUMMARY + Zoom/Meet/Teams link extraction). Fail-safe: returns []
// on any connection/parse error and never throws into the scheduler.
type CalEvent = { externalId: string; title: string; link: string; startAt: string };
async function readCloneCalendar(_agent: any, account: { email: string; username: string; password: string; provider: string }): Promise<CalEvent[]> {
  try {
    return await fetchCloneCalendar(account);
  } catch {
    return []; // belt-and-suspenders: the reader is already fail-safe internally
  }
}

// ---- pre-warm (reuse the existing standby mechanism) -------------------------
// Batch 3 #5: spin the sandbox ~3-5 min before a booked call. We reuse the
// existing standby scripts: warm_standby.mjs resumes+keeps a paused body hot
// (fast call_wake path); prepare_standby.mjs builds+pauses one when none exists.
// live.ts already picks call_wake when ${AH}/standby.txt is present, so a warm
// body ⇒ join in seconds. We only TRIGGER these (detached), mirroring live.ts's
// spawn.
//
// HEADLESS HAND-OFF: when NO standby exists we run prepare_standby, which
// PUBLISHES the new (paused) sandbox id into ${AH}/standby.txt itself so the
// headless call_wake can consume it with no operator in the loop. The publish is
// made atomic (tmp + rename) by join-prewarm.patch (the proposed ah-scripts
// change) so a concurrent call_wake/warm read never sees a partial id; the
// trigger below is the bff half of that wiring. When a standby already exists we
// run warm_standby, which keeps that same id hot and does not rewrite standby.txt.
function triggerPrewarm(scheduledId: string): void {
  try {
    const hasStandby = existsSync(`${AH}/standby.txt`);
    const script = hasStandby ? `${AH}/warm_standby.mjs` : `${AH}/prepare_standby.mjs`;
    if (!existsSync(script)) return; // scripts not mounted in this env — no-op
    const out = openSync(`${AH}/prewarm_${scheduledId}.log`, "a");
    const child = spawn("node", [script], { detached: true, stdio: ["ignore", out, out], env: { ...process.env } });
    child.unref();
  } catch { /* pre-warm is an accelerator; a failure just means a cold start */ }
}

// ---- scheduler loops ---------------------------------------------------------
let calendarTimer: ReturnType<typeof setInterval> | null = null;
let dueTimer: ReturnType<typeof setInterval> | null = null;

async function calendarWatchTick(): Promise<void> {
  const agents = await query<any>(`SELECT * FROM agents WHERE calendar_watch = true`).catch(() => []);
  for (const agent of agents) {
    const acct = await one<{ value: any }>(`SELECT value FROM settings WHERE org_id=$1 AND key=$2`, [agent.org_id, MEETING_KEY(agent.id)]);
    const v = acct?.value;
    if (!v?.email) continue; // no account to watch
    let events: CalEvent[] = [];
    try {
      events = await readCloneCalendar(agent, {
        email: v.email, username: v.username || v.email,
        password: v.password_enc ? decryptSecret(v.password_enc, credAad(agent.org_id, MEETING_KEY(agent.id))) : "",
        provider: v.calendarProvider || v.provider || "",
      });
    } catch { events = []; }
    for (const ev of events) {
      if (!ev.link || !ev.startAt) continue;
      const startAt = new Date(ev.startAt);
      if (isNaN(startAt.getTime()) || startAt.getTime() < Date.now() - 60_000) continue; // skip past
      const prewarmAt = new Date(startAt.getTime() - PREWARM_LEAD_MS);
      await query(
        `INSERT INTO scheduled_calls (id, agent_id, org_id, meeting_link, meeting_id, title, source, external_event_id, start_at, prewarm_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'calendar',$7,$8,$9,'scheduler')
         ON CONFLICT (agent_id, external_event_id) DO UPDATE SET
           meeting_link = EXCLUDED.meeting_link, meeting_id = EXCLUDED.meeting_id,
           title = EXCLUDED.title, start_at = EXCLUDED.start_at, prewarm_at = EXCLUDED.prewarm_at,
           updated_at = now()
         WHERE scheduled_calls.status = 'scheduled'`,
        [`sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, agent.id, agent.org_id ?? null,
         ev.link, parseMeetingId(ev.link) || null, ev.title || null, ev.externalId, startAt.toISOString(), prewarmAt.toISOString()],
      ).catch(() => {});
    }
  }
}

async function dueCallsTick(): Promise<void> {
  const now = Date.now();
  // 1) PRE-WARM: scheduled rows entering the pre-warm window.
  const toWarm = await query<any>(
    `SELECT * FROM scheduled_calls WHERE status='scheduled' AND prewarm_at IS NOT NULL AND prewarm_at <= now() AND start_at > now()`,
  ).catch(() => []);
  for (const row of toWarm) {
    triggerPrewarm(row.id);
    await query(`UPDATE scheduled_calls SET status='prewarming', prewarmed_at=now(), updated_at=now() WHERE id=$1 AND status='scheduled'`, [row.id]).catch(() => {});
    await audit({ agentId: row.agent_id, orgId: row.org_id, actor: "scheduler", source: "scheduled", meetingLink: row.meeting_link, event: "summon", detail: "pre-warm triggered" });
  }
  // 2) LAUNCH: rows at/just before start time.
  const toLaunch = await query<any>(
    `SELECT * FROM scheduled_calls WHERE status IN ('scheduled','prewarming') AND start_at <= now() + interval '90 seconds' ORDER BY start_at LIMIT 20`,
  ).catch(() => []);
  for (const row of toLaunch) {
    const agent = await one<any>(`SELECT * FROM agents WHERE id=$1`, [row.agent_id]);
    if (!agent) { await query(`UPDATE scheduled_calls SET status='failed', last_error='clone not found', updated_at=now() WHERE id=$1`, [row.id]).catch(() => {}); continue; }
    const pf = await preflight(agent, "scheduled", "scheduler", row.meeting_link);
    if (!pf.ok) {
      // A gate/disabled fail is terminal for this booking; concurrency/spend are
      // transient — leave it scheduled to retry until the grace window lapses.
      const transient = pf.code === "concurrency" || pf.code === "spend";
      if (transient && now < new Date(row.start_at).getTime() + LAUNCH_GRACE_MS) {
        await query(`UPDATE scheduled_calls SET last_error=$2, updated_at=now() WHERE id=$1`, [row.id, pf.reason ?? pf.code]).catch(() => {});
      } else {
        await query(`UPDATE scheduled_calls SET status='skipped', last_error=$2, updated_at=now() WHERE id=$1`, [row.id, pf.reason ?? pf.code]).catch(() => {});
      }
      continue;
    }
    const launched = await launchLive(agent.id, row.meeting_link, agent.org_id);
    if (launched.ok) {
      await query(`UPDATE scheduled_calls SET status='live', call_id=$2, launched_at=now(), last_error=NULL, updated_at=now() WHERE id=$1`, [row.id, launched.callId ?? null]).catch(() => {});
      await audit({ agentId: agent.id, orgId: agent.org_id, actor: "scheduler", source: "scheduled", meetingLink: row.meeting_link, event: "launched", score: pf.score, detail: `call ${launched.callId}` });
    } else {
      // 409 = a call already active (single-active-call pipeline). Retry within grace.
      const retry = launched.status === 409 && now < new Date(row.start_at).getTime() + LAUNCH_GRACE_MS;
      await query(`UPDATE scheduled_calls SET status=$2, last_error=$3, updated_at=now() WHERE id=$1`, [row.id, retry ? "scheduled" : "failed", launched.error ?? "launch failed"]).catch(() => {});
      await audit({ agentId: agent.id, orgId: agent.org_id, actor: "scheduler", source: "scheduled", meetingLink: row.meeting_link, event: "error", detail: launched.error });
    }
  }
  // 3) RECONCILE: mark live rows done once their call has ended.
  await query(
    `UPDATE scheduled_calls sc SET status='done', updated_at=now()
     FROM live_calls lc WHERE sc.call_id = lc.id AND sc.status='live' AND lc.ended_at IS NOT NULL`,
  ).catch(() => {});
}

export function startScheduler(): void {
  if (!calendarTimer) { calendarTimer = setInterval(() => { void calendarWatchTick(); }, 60_000); calendarTimer.unref?.(); }
  if (!dueTimer) { dueTimer = setInterval(() => { void dueCallsTick(); }, 20_000); dueTimer.unref?.(); }
}

// ============================================================================
// ROUTES
// ============================================================================
export default async function schedulingRoutes(app: FastifyInstance) {
  // ---- clone meeting/calendar ACCOUNT (creds) -------------------------------
  // Stored like demo_login but the password is ENCRYPTED at rest (cryptoCreds,
  // Phase 2 CRED_ENC_KEY, AAD-bound to org+key). Password is write-only: never returned.
  app.get("/api/clones/:agentId/meeting-account", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const org = orgId(req);
    if (!(await agentInOrg(agentId, org))) return reply.code(404).send({ error: "clone not found" });
    const agent = await one<any>(`SELECT id, org_id, calendar_watch, allow_instant_joins FROM agents WHERE id=$1 AND org_id=$2`, [agentId, org]);
    if (!agent) return reply.code(404).send({ error: "clone not found" });
    const row = await one<{ value: any }>(`SELECT value FROM settings WHERE org_id=$1 AND key=$2`, [org, MEETING_KEY(agentId)]);
    const v = row?.value ?? {};
    return {
      email: v.email ?? "", username: v.username ?? "", provider: v.provider ?? "",
      calendarProvider: v.calendarProvider ?? "", hasPassword: !!v.password_enc,
      calendarWatch: agent.calendar_watch === true, allowInstantJoins: agent.allow_instant_joins !== false,
    };
  });
  app.put("/api/clones/:agentId/meeting-account", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const org = orgId(req);
    if (!(await agentInOrg(agentId, org))) return reply.code(404).send({ error: "clone not found" });
    const b = (req.body ?? {}) as { email?: string; username?: string; password?: string; provider?: string; calendarProvider?: string; calendarWatch?: boolean; allowInstantJoins?: boolean };
    const email = (b.email ?? "").trim();
    if (email && !email.includes("@")) return reply.code(400).send({ error: "that email doesn't look valid" });
    const existing = await one<{ value: any }>(`SELECT value FROM settings WHERE org_id=$1 AND key=$2`, [org, MEETING_KEY(agentId)]);
    const cur = existing?.value ?? {};
    const merged = {
      email: b.email !== undefined ? email : (cur.email ?? ""),
      username: b.username !== undefined ? String(b.username).trim() : (cur.username ?? ""),
      provider: b.provider !== undefined ? String(b.provider).trim() : (cur.provider ?? ""),
      calendarProvider: b.calendarProvider !== undefined ? String(b.calendarProvider).trim() : (cur.calendarProvider ?? ""),
      // Password write-only + encrypted (cryptoCreds, Phase-2 CRED_ENC_KEY, AAD-bound to org+key).
      password_enc: (b.password ?? "").trim() ? encryptSecret((b.password as string).trim(), credAad(org, MEETING_KEY(agentId))) : (cur.password_enc ?? ""),
      updated_at: new Date().toISOString(),
    };
    await query(
      `INSERT INTO settings (org_id, key, value) VALUES ($1,$2,$3) ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [org, MEETING_KEY(agentId), JSON.stringify(merged)],
    );
    // Toggles live on the agent row (calendar-watch + instant-join). Org-scoped.
    if (b.calendarWatch !== undefined) await query(`UPDATE agents SET calendar_watch=$2 WHERE id=$1 AND org_id=$3`, [agentId, !!b.calendarWatch, org]);
    if (b.allowInstantJoins !== undefined) await query(`UPDATE agents SET allow_instant_joins=$2 WHERE id=$1 AND org_id=$3`, [agentId, !!b.allowInstantJoins, org]);
    return { ok: true, hasPassword: !!merged.password_enc };
  });

  // ---- per-clone instant-join toggle (standalone) ---------------------------
  app.put("/api/clones/:agentId/allow-instant-joins", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const org = orgId(req);
    if (!(await agentInOrg(agentId, org))) return reply.code(404).send({ error: "clone not found" });
    const b = (req.body ?? {}) as { enabled?: boolean };
    await query(`UPDATE agents SET allow_instant_joins=$2 WHERE id=$1 AND org_id=$3`, [agentId, b.enabled !== false, org]);
    return { ok: true, allowInstantJoins: b.enabled !== false };
  });

  // ---- INSTANT-LINK JOIN — summon a clone onto a pasted link NOW ------------
  // Authorized org member only · >=70 gate (never bypassed) · counts against
  // concurrency + spend caps · audit-logged · AI disclosure fires in the bridge.
  app.post("/api/clones/:agentId/instant-join", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const org = orgId(req);
    const b = (req.body ?? {}) as { meetingLink?: string };
    const meetingLink = (b.meetingLink ?? "").trim();
    if (!meetingLink) return reply.code(400).send({ error: "meetingLink required (paste the meeting link)" });
    // Ownership gate first — 404 (not 403) so we never leak another org's clone.
    if (!(await agentInOrg(agentId, org))) return reply.code(404).send({ error: "clone not found" });
    const agent = await one<any>(`SELECT * FROM agents WHERE id=$1 AND org_id=$2`, [agentId, org]);
    if (!agent) return reply.code(404).send({ error: "clone not found" });
    const actor = resolveActor(req);
    // Access control: the caller must be an authorized member of the clone's org.
    const member = await assertOrgMember(req, agent);
    if (!member.ok) {
      await audit({ agentId, orgId: org, actor, source: "instant", meetingLink, event: "disabled_block", detail: member.reason });
      return reply.code(403).send({ error: member.reason ?? "not authorized for this clone" });
    }
    await audit({ agentId, orgId: org, actor, source: "instant", meetingLink, event: "summon", detail: "instant-link summon" });
    const pf = await preflight(agent, "instant", actor, meetingLink);
    if (!pf.ok) {
      const status = pf.code === "concurrency" || pf.code === "spend" ? 429 : 403;
      return reply.code(status).send({ error: pf.reason, code: pf.code, score: pf.score });
    }
    const launched = await launchLive(agentId, meetingLink, org);
    if (!launched.ok) {
      await audit({ agentId, orgId: org, actor, source: "instant", meetingLink, event: "error", score: pf.score, detail: launched.error });
      return reply.code(launched.status === 409 ? 409 : 502).send({ error: launched.error ?? "launch failed" });
    }
    // Record the instant summon as a scheduled_calls row (source=instant) so the
    // fleet view + reconciler see it like any other live join. org_id set explicitly.
    await query(
      `INSERT INTO scheduled_calls (id, agent_id, org_id, meeting_link, meeting_id, source, start_at, status, call_id, launched_at, created_by)
       VALUES ($1,$2,$3,$4,$5,'instant', now(), 'live', $6, now(), $7)`,
      [`sc_${Date.now().toString(36)}`, agentId, org, meetingLink, parseMeetingId(meetingLink) || null, launched.callId ?? null, actor],
    ).catch(() => {});
    await audit({ agentId, orgId: org, actor, source: "instant", meetingLink, event: "launched", score: pf.score, detail: `call ${launched.callId}` });
    return reply.code(201).send({ callId: launched.callId, score: pf.score });
  });

  // ---- scheduled_calls CRUD (fleet view + manual booking) -------------------
  app.get("/api/clones/:agentId/scheduled-calls", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const org = orgId(req);
    if (!(await agentInOrg(agentId, org))) return reply.code(404).send({ error: "clone not found" });
    const rows = await query<any>(
      `SELECT * FROM scheduled_calls WHERE agent_id=$1 AND org_id=$2 AND (status NOT IN ('done','skipped','failed') OR start_at > now() - interval '1 day') ORDER BY start_at DESC LIMIT 100`,
      [agentId, org],
    );
    return { scheduled: rows };
  });
  // Manually book a call (also the shape the calendar reader upserts).
  app.post("/api/clones/:agentId/scheduled-calls", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const org = orgId(req);
    if (!(await agentInOrg(agentId, org))) return reply.code(404).send({ error: "clone not found" });
    const b = (req.body ?? {}) as { meetingLink?: string; startAt?: string; title?: string; externalEventId?: string };
    const meetingLink = (b.meetingLink ?? "").trim();
    const startAt = new Date(b.startAt ?? "");
    if (!meetingLink) return reply.code(400).send({ error: "meetingLink required" });
    if (isNaN(startAt.getTime())) return reply.code(400).send({ error: "valid startAt (ISO timestamp) required" });
    const prewarmAt = new Date(startAt.getTime() - PREWARM_LEAD_MS);
    const id = `sc_${Date.now().toString(36)}`;
    await query(
      `INSERT INTO scheduled_calls (id, agent_id, org_id, meeting_link, meeting_id, title, source, external_event_id, start_at, prewarm_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'manual',$7,$8,$9,'operator')
       ON CONFLICT (agent_id, external_event_id) DO UPDATE SET meeting_link=EXCLUDED.meeting_link, start_at=EXCLUDED.start_at, updated_at=now()`,
      [id, agentId, org, meetingLink, parseMeetingId(meetingLink) || null, b.title || null,
       b.externalEventId || id, startAt.toISOString(), prewarmAt.toISOString()],
    );
    return reply.code(201).send({ id, startAt: startAt.toISOString() });
  });
  // Cancel a booking (before it launches).
  app.delete("/api/scheduled-calls/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const org = orgId(req);
    // Org-scope the lookup: a miss (wrong org or unknown id) is 404, never a
    // cross-org peek at another tenant's booking status.
    const row = await one<any>(`SELECT status FROM scheduled_calls WHERE id=$1 AND org_id=$2`, [id, org]);
    if (!row) return reply.code(404).send({ error: "not found" });
    if (row.status === "live") return reply.code(409).send({ error: "call is live — end it via /api/live/end" });
    await query(`UPDATE scheduled_calls SET status='canceled', updated_at=now() WHERE id=$1 AND org_id=$2`, [id, org]);
    return { ok: true };
  });

  // ---- audit read (compliance / fleet watch) --------------------------------
  app.get("/api/clones/:agentId/call-audit", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const org = orgId(req);
    if (!(await agentInOrg(agentId, org))) return reply.code(404).send({ error: "clone not found" });
    const rows = await query<any>(`SELECT * FROM call_audit WHERE agent_id=$1 AND org_id=$2 ORDER BY at DESC LIMIT 100`, [agentId, org]);
    return { audit: rows };
  });
}
