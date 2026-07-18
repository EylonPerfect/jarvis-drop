import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { orgId } from "../lib/auth.js";
import { getSetting, setSetting } from "../lib/settingsStore.js";
import type { Approval, ApprovalDecision, LedgerEntry, NewApproval } from "@jarvis/shared";

function rowToApproval(r: any): Approval {
  return {
    id: r.id,
    agent: r.agent ?? undefined,
    action: r.action,
    detail: r.detail ?? undefined,
    risk: r.risk ?? undefined,
    kind: r.kind,
    options: r.options ?? [],
    diff: r.diff ?? undefined,
    status: r.status,
    answer: r.answer ?? undefined,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at ?? undefined,
  };
}

// Append a resolved approval to the Live Action Ledger (settings 'ledger'),
// newest-first, capped so the ledger doesn't grow unbounded.
async function logToLedger(org: string, action: string, decision: ApprovalDecision, detail?: string): Promise<void> {
  const tone: LedgerEntry["tone"] = decision === "approved" ? "green" : decision === "rejected" ? "red" : "cyan";
  const status = decision === "approved" ? "approved · fired" : decision === "rejected" ? "rejected · blocked" : "answered";
  const entry: LedgerEntry = { tool: action, status: detail ? `${status} — ${detail}` : status, duration: "—", tone };
  const current = (await getSetting<LedgerEntry[]>(org, "ledger")) ?? [];
  const next = [entry, ...current].slice(0, 100);
  await setSetting(org, "ledger", next);
}

export default async function approvalsRoutes(app: FastifyInstance) {
  // Inbox. Default: pending only (what the operator must act on). ?status=all
  // returns every row (including resolved), newest first.
  app.get("/api/approvals", async (req) => {
    const status = ((req.query as { status?: string } | undefined)?.status ?? "pending").toLowerCase();
    const rows =
      status === "all"
        ? await query(`SELECT * FROM approvals WHERE org_id = $1 ORDER BY created_at DESC`, [orgId(req)])
        : await query(`SELECT * FROM approvals WHERE org_id = $1 AND status = 'pending' ORDER BY created_at DESC`, [orgId(req)]);
    return rows.map(rowToApproval);
  });

  // Producer API — any component (or the Execute-mode chat) can queue an approval.
  app.post("/api/approvals", async (req, reply) => {
    const b = req.body as NewApproval;
    if (!b?.action?.trim()) return reply.code(400).send({ error: "action is required" });
    const kind = b.kind === "question" ? "question" : "action";
    const id = `apr_${Date.now().toString(36)}`;
    await query(
      `INSERT INTO approvals (id, agent, action, detail, risk, kind, options, diff, org_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        b.agent ?? null,
        b.action.trim(),
        b.detail ?? null,
        b.risk ?? null,
        kind,
        JSON.stringify(b.options ?? []),
        b.diff ?? null,
        orgId(req),
      ],
    );
    const row = await one(`SELECT * FROM approvals WHERE id = $1 AND org_id = $2`, [id, orgId(req)]);
    return reply.code(201).send(rowToApproval(row));
  });

  // Resolve an approval: set status/answer/resolved_at, then log to the ledger.
  app.post("/api/approvals/:id/resolve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { decision?: ApprovalDecision; answer?: string };
    const decision = b?.decision;
    if (decision !== "approved" && decision !== "rejected" && decision !== "answered") {
      return reply.code(400).send({ error: "decision must be 'approved', 'rejected', or 'answered'" });
    }
    const existing = await one<{ action: string; detail: string | null }>(
      `SELECT action, detail FROM approvals WHERE id = $1 AND org_id = $2`,
      [id, orgId(req)],
    );
    if (!existing) return reply.code(404).send({ error: "not found" });
    await query(
      `UPDATE approvals SET status = $1, answer = $2, resolved_at = now() WHERE id = $3 AND org_id = $4`,
      [decision, b.answer ?? null, id, orgId(req)],
    );
    await logToLedger(orgId(req), existing.action, decision, existing.detail ?? undefined);
    const row = await one(`SELECT * FROM approvals WHERE id = $1 AND org_id = $2`, [id, orgId(req)]);
    return rowToApproval(row);
  });

  // Dismiss a single approval.
  app.delete("/api/approvals/:id", async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM approvals WHERE id = $1 AND org_id = $2`, [id, orgId(req)]);
    return { ok: true };
  });

  // Clear all approvals ("Clear all" button).
  app.delete("/api/approvals", async (req) => {
    await query(`DELETE FROM approvals WHERE org_id = $1`, [orgId(req)]);
    return { ok: true };
  });
}
