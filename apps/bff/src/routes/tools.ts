import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { hermes } from "../hermes.js";
import type { ToolItem } from "@jarvis/shared";

function rowToTool(r: any): ToolItem {
  return {
    id: r.id,
    group: r.grp,
    icon: r.icon,
    name: r.name,
    desc: r.descr,
    enabled: r.enabled,
    statusTone: r.status_tone,
  };
}

export default async function toolsRoutes(app: FastifyInstance) {
  // Tools & Skills registry. Toggle state persists in Postgres; hermes
  // /v1/toolsets + /v1/skills are surfaced under `hermes` for reference.
  app.get("/api/tools", async () => {
    const rows = await query(`SELECT * FROM tool_toggles ORDER BY sort`);
    const items = rows.map(rowToTool);
    const [toolsets, skills] = await Promise.all([hermes.toolsets(), hermes.skills()]);
    return {
      items,
      hermes: {
        toolsets: toolsets.ok ? toolsets.data : null,
        skills: skills.ok ? skills.data : null,
        reachable: toolsets.ok || skills.ok,
      },
    };
  });

  app.post("/api/tools", async (req, reply) => {
    const b = req.body as { name?: string; descr?: string; grp?: string; icon?: string };
    if (!b?.name?.trim()) return reply.code(400).send({ error: "name required" });
    const id = `tl_${Date.now().toString(36)}`;
    const maxSort = await one<{ m: number }>(`SELECT COALESCE(MAX(sort), -1) + 1 AS m FROM tool_toggles`);
    await query(
      `INSERT INTO tool_toggles (id, grp, icon, name, descr, enabled, status_tone, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, b.grp?.trim() || "Built-in Skills", b.icon?.trim() || "wrench", b.name.trim(), b.descr?.trim() || "", true, "optimal", maxSort?.m ?? 0],
    );
    return reply.code(201).send(rowToTool(await one(`SELECT * FROM tool_toggles WHERE id = $1`, [id])));
  });

  app.patch("/api/tools/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { enabled?: boolean };
    const existing = await one(`SELECT * FROM tool_toggles WHERE id = $1`, [id]);
    if (!existing) return reply.code(404).send({ error: "not found" });
    await query(`UPDATE tool_toggles SET enabled = COALESCE($2, enabled) WHERE id = $1`, [id, b.enabled ?? null]);
    return rowToTool(await one(`SELECT * FROM tool_toggles WHERE id = $1`, [id]));
  });

  app.delete("/api/tools/:id", async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM tool_toggles WHERE id = $1`, [id]);
    return { ok: true };
  });

  // Clear all tools & skills.
  app.delete("/api/tools", async () => {
    await query(`DELETE FROM tool_toggles`);
    return { ok: true };
  });
}
