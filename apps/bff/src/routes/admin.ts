import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { seed } from "../db/seed.js";

// Every table seed() manages — the destructive scope of a reset.
const TABLES =
  "agents, tasks, reminders, time_entries, memory_facts, style_profiles, " +
  "knowledge_sources, collections, tool_toggles, provider_keys, cost_entries, settings";

// Dev/admin utility: wipe the BFF-owned Postgres data so the operator can
// start from a clean slate (or restore the canonical demo data).
//   mode: "clear" → truncate every table (empty DB)
//   mode: "seed"  → truncate + reload the canonical demo data
export default async function adminRoutes(app: FastifyInstance) {
  app.post("/api/admin/reset", async (req, reply) => {
    const mode = ((req.body as { mode?: string } | undefined)?.mode ?? "clear").toLowerCase();
    if (mode === "seed") {
      await seed({ force: true });
      return { ok: true, mode: "seed" };
    }
    if (mode === "clear") {
      await pool.query(`TRUNCATE ${TABLES}`);
      return { ok: true, mode: "clear" };
    }
    return reply.code(400).send({ error: "mode must be 'clear' or 'seed'" });
  });
}
