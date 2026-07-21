import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { emit, EVENTS } from "../lib/analytics.js";
import { checkBailAndReportSpikes } from "../lib/alerts.js";
import { orgId } from "../lib/auth.js";
import { notify } from "../lib/notify.js";

// REPORT-THIS-CALL — the self-serve support surface for launch (docs + debrief
// + "report this call" button). A rep who sees a live or finished call go wrong
// files a structured report; it lands in `call_reports` and feeds the
// super-admin report-this-call queue (routes/superadmin.ts reads this table).
//
// The table shape is OWNED by the super-admin work — this writer aligns to it
// exactly (CREATE TABLE IF NOT EXISTS in schema.sql matches theirs; the only
// addition is a nullable `transcript_ref`, which their `SELECT *` surfaces for
// free). Org-scoped: every row carries org_id so the queue is attributable to
// the customer that raised it.

const SEVERITIES = new Set(["notice", "warning", "critical"]);

function reportId(): string {
  return `cr_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// Org context comes from the authenticated session (orgId(req)) — NEVER from the
// caller-controlled request body or X-Org-Id header, which a client could forge
// to write into or read another tenant's reports.

export default async function reportsRoutes(app: FastifyInstance) {
  // POST /api/calls/:id/report — file a report against a call.
  // :id = the call being reported (live_calls.id on a live call, or the source
  // id that carries the transcript on a post-call debrief). Stored as call_id.
  app.post("/api/calls/:id/report", async (req, reply) => {
    const { id } = req.params as { id: string };
    const callId = (id ?? "").trim();
    if (!callId) return reply.code(400).send({ error: "call id required" });

    const body = (req.body ?? {}) as {
      reason?: string;
      reporter?: string | null;
      severity?: string;
      agentId?: string | null;
      orgId?: string | null;
      transcriptRef?: string | null;
    };

    const reason = (body.reason ?? "").toString().trim();
    if (!reason) return reply.code(400).send({ error: "what-went-wrong (reason) is required" });

    const severity = SEVERITIES.has((body.severity ?? "").toString()) ? body.severity! : "notice";
    const reporter = (body.reporter ?? "").toString().trim() || "operator";
    const agentId = (body.agentId ?? "").toString().trim() || null;
    const org = orgId(req);
    // Transcript pointer: the debrief/film for this call is keyed by the call id,
    // so the id itself is the canonical pointer unless the caller passes a
    // more specific one (e.g. a source id).
    const transcriptRef = (body.transcriptRef ?? "").toString().trim() || callId;

    const rid = reportId();
    await query(
      `INSERT INTO call_reports (id, org_id, call_id, agent_id, reason, reporter, severity, status, transcript_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8)`,
      [rid, org, callId, agentId, reason.slice(0, 4000), reporter.slice(0, 200), severity, transcriptRef.slice(0, 400)],
    );

    // Observability (from the retired p10 duplicate): feed the report-rate metric
    // + opportunistic spike detector. Both best-effort so a report never fails on them.
    void emit(EVENTS.CALL_REPORT, { orgId: org, agentId, callId, props: { reason: reason.slice(0, 200), severity } }).catch(() => {});
    void checkBailAndReportSpikes().catch(() => {});
    // in-app notification: the owner should know a call was flagged for review
    void notify(org, { kind: "call_reported", title: "A call was reported for review", body: reason.slice(0, 140), href: "#/debrief", severity: "warning", icon: "flag" });

    const row = await one(`SELECT * FROM call_reports WHERE id = $1`, [rid]);
    return reply.code(201).send({ ok: true, report: row });
  });

  // GET /api/calls/:id/reports — reports already filed against a call.
  // ALWAYS org-scoped to the authenticated caller, so a customer only ever sees
  // their own org's reports; the super-admin queue (all orgs) lives in
  // routes/superadmin.ts.
  app.get("/api/calls/:id/reports", async (req, reply) => {
    const { id } = req.params as { id: string };
    const callId = (id ?? "").trim();
    if (!callId) return reply.code(400).send({ error: "call id required" });
    const rows = await query(
      `SELECT * FROM call_reports WHERE call_id = $1 AND org_id = $2 ORDER BY created_at DESC`,
      [callId, orgId(req)],
    );
    return { reports: rows };
  });
}
