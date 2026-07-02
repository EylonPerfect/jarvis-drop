import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
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
async function logToLedger(action: string, decision: ApprovalDecision, detail?: string): Promise<void> {
  const tone: LedgerEntry["tone"] = decision === "approved" ? "green" : decision === "rejected" ? "red" : "cyan";
  const status = decision === "approved" ? "approved · fired" : decision === "rejected" ? "rejected · blocked" : "answered";
  const entry: LedgerEntry = { tool: action, status: detail ? `${status} — ${detail}` : status, duration: "—", tone };
  const current = (await one<{ value: LedgerEntry[] }>(`SELECT value FROM settings WHERE key = 'ledger'`))?.value ?? [];
  const next = [entry, ...current].slice(0, 100);
  await query(
    `INSERT INTO settings (key, value) VALUES ('ledger', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(next)],
  );
}

export default async function approvalsRoutes(app: FastifyInstance) {
  // Inbox. Default: pending only (what the operator must act on). ?status=all
  // returns every row (including resolved), newest first.
  app.get("/api/approvals", async (req) => {
    const status = ((req.query as { status?: string } | undefined)?.status ?? "pending").toLowerCase();
    const rows =
      status === "all"
        ? await query(`SELECT * FROM approvals ORDER BY created_at DESC`)
        : await query(`SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at DESC`);
    return rows.map(rowToApproval);
  });

  // Producer API — any component (or the Execute-mode chat) can queue an approval.
  app.post("/api/approvals", async (req, reply) => {
    const b = req.body as NewApproval;
    if (!b?.action?.trim()) return reply.code(400).send({ error: "action is required" });
    const kind = b.kind === "question" ? "question" : "action";
    const id = `apr_${Date.now().toString(36)}`;
    await query(
      `INSERT INTO approvals (id, agent, action, detail, risk, kind, options, diff)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        b.agent ?? null,
        b.action.trim(),
        b.detail ?? null,
        b.risk ?? null,
        kind,
        JSON.stringify(b.options ?? []),
        b.diff ?? null,
      ],
    );
    const row = await one(`SELECT * FROM approvals WHERE id = $1`, [id]);
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
      `SELECT action, detail FROM approvals WHERE id = $1`,
      [id],
    );
    if (!existing) return reply.code(404).send({ error: "not found" });
    await query(
      `UPDATE approvals SET status = $1, answer = $2, resolved_at = now() WHERE id = $3`,
      [decision, b.answer ?? null, id],
    );
    await logToLedger(existing.action, decision, existing.detail ?? undefined);
    const row = await one(`SELECT * FROM approvals WHERE id = $1`, [id]);
    return rowToApproval(row);
  });

  // Dismiss a single approval.
  app.delete("/api/approvals/:id", async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM approvals WHERE id = $1`, [id]);
    return { ok: true };
  });

  // Clear all approvals ("Clear all" button).
  app.delete("/api/approvals", async () => {
    await query(`DELETE FROM approvals`);
    return { ok: true };
  });
}
