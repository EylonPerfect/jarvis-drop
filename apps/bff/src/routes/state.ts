import type { FastifyInstance } from "fastify";
import { one, query } from "../db/pool.js";

// Generic persistent state for the agent control-plane screens (approvals,
// permissions, spend, ledger, integrations, cockpit). JARVIS is the system of
// record for these — the store persists the operator's data + decisions in the
// `settings` table so they survive reloads and redeploys. Keys are allowlisted.
const KEYS = new Set([
  "approvals",
  "permissions",
  "spend",
  "ledger",
  "integrations",
  "cockpit",
  "agent_models",
]);

export default async function stateRoutes(app: FastifyInstance) {
  app.get("/api/state/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    if (!KEYS.has(key)) return reply.code(404).send({ error: "unknown state key" });
    const row = await one<{ value: unknown }>(`SELECT value FROM settings WHERE key = $1`, [`state:${key}`]);
    return { key, value: row?.value ?? null };
  });

  app.put("/api/state/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    if (!KEYS.has(key)) return reply.code(404).send({ error: "unknown state key" });
    const body = req.body as { value?: unknown };
    if (body?.value === undefined) return reply.code(400).send({ error: "value required" });
    await query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [`state:${key}`, JSON.stringify(body.value)],
    );
    return { key, ok: true };
  });
}
