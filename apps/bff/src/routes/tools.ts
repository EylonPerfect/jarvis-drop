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

  app.patch("/api/tools/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { enabled?: boolean };
    const existing = await one(`SELECT * FROM tool_toggles WHERE id = $1`, [id]);
    if (!existing) return reply.code(404).send({ error: "not found" });
    await query(`UPDATE tool_toggles SET enabled = COALESCE($2, enabled) WHERE id = $1`, [id, b.enabled ?? null]);
    return rowToTool(await one(`SELECT * FROM tool_toggles WHERE id = $1`, [id]));
  });
}
