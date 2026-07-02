import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { hermes } from "../hermes.js";
import type { Agent, AgentRun, RuntimeStats, NewAgent } from "@jarvis/shared";

function rowToAgent(r: any): Agent {
  return {
    id: r.id,
    icon: r.icon,
    name: r.name,
    role: r.role,
    status: r.status,
    statusLabel: r.status_label,
    model: r.model ?? undefined,
    tools: r.tools ?? [],
    collaborators: r.collaborators ?? [],
    autonomy: r.autonomy ?? undefined,
    instructions: r.instructions ?? undefined,
    plan: r.plan ?? undefined,
    routine: r.routine ?? undefined,
    createdAt: r.created_at,
  };
}

export default async function agentsRoutes(app: FastifyInstance) {
  // Roster (Postgres-owned orchestration config; each entry can reference a
  // hermes sub-agent / skill once the operator wires it).
  app.get("/api/agents", async () => {
    const rows = await query(`SELECT * FROM agents ORDER BY sort, created_at`);
    return rows.map(rowToAgent);
  });

  app.post("/api/agents", async (req, reply) => {
    const b = req.body as NewAgent;
    if (!b?.name?.trim() || !b?.role?.trim()) {
      return reply.code(400).send({ error: "name and role are required" });
    }
    const id = `ag_${Date.now().toString(36)}`;
    const maxSort = await one<{ m: number }>(`SELECT COALESCE(MAX(sort), -1) + 1 AS m FROM agents`);
    await query(
      `INSERT INTO agents (id, icon, name, role, status, status_label, model, tools, collaborators, autonomy, instructions, plan, routine, sort)
       VALUES ($1,$2,$3,$4,'standby','Standby',$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        b.icon || "bot",
        b.name.trim(),
        b.role.trim(),
        b.model ?? null,
        JSON.stringify(b.tools ?? []),
        JSON.stringify(b.collaborators ?? []),
        b.autonomy ?? "Ask before acting",
        b.instructions ?? null,
        b.plan ?? null,
        b.routine ?? null,
        maxSort?.m ?? 0,
      ],
    );
    const row = await one(`SELECT * FROM agents WHERE id = $1`, [id]);
    return reply.code(201).send(rowToAgent(row));
  });

  // Update an existing agent (rename, re-role, change model/autonomy, status).
  app.patch("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as Partial<NewAgent> & { status?: string; statusLabel?: string };
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => {
      sets.push(`${col} = $${sets.length + 1}`);
      vals.push(v);
    };
    if (b.name !== undefined) set("name", b.name);
    if (b.role !== undefined) set("role", b.role);
    if (b.icon !== undefined) set("icon", b.icon);
    if (b.model !== undefined) set("model", b.model);
    if (b.autonomy !== undefined) set("autonomy", b.autonomy);
    if (b.instructions !== undefined) set("instructions", b.instructions);
    if (b.plan !== undefined) set("plan", b.plan);
    if (b.routine !== undefined) set("routine", b.routine);
    if (b.status !== undefined) set("status", b.status);
    if (b.statusLabel !== undefined) set("status_label", b.statusLabel);
    if (b.tools !== undefined) set("tools", JSON.stringify(b.tools));
    if (b.collaborators !== undefined) set("collaborators", JSON.stringify(b.collaborators));
    if (!sets.length) return reply.code(400).send({ error: "no fields to update" });
    vals.push(id);
    await query(`UPDATE agents SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
    const row = await one(`SELECT * FROM agents WHERE id = $1`, [id]);
    if (!row) return reply.code(404).send({ error: "not found" });
    return rowToAgent(row);
  });

  // Remove all agents (clear the roster).
  app.delete("/api/agents", async () => {
    await query(`DELETE FROM agents`);
    return { ok: true };
  });

  app.delete("/api/agents/:id", async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM agents WHERE id = $1`, [id]);
    return { ok: true };
  });

  // Runtime executions. Prefer live hermes runs; fall back to the seeded log.
  app.get("/api/agents/runs", async () => {
    const live = await hermes.get<any>("/v1/runs");
    // Accept a bare array or the OpenAI-style {data:[...]} / {runs:[...]} envelope.
    const list = Array.isArray(live.data) ? live.data : live.data?.data ?? live.data?.runs;
    if (live.ok && Array.isArray(list)) {
      const runs: AgentRun[] = list.map((r: any, i: number) => ({
        id: r.run_id ?? r.id ?? `run_${i}`,
        query: r.input ?? r.query ?? r.prompt ?? "(run)",
        ts: r.created_at ?? "",
        okCount: r.ok_count ?? r.steps_ok ?? 0,
        errCount: r.error_count ?? r.errors ?? 0,
        steps: Array.isArray(r.events)
          ? r.events.map((e: any) => ({
              agent: e.agent ?? e.tool ?? "agent",
              detail: e.detail ?? e.message ?? "",
              tone: e.error ? "red" : "green",
            }))
          : [],
        state: r.state,
      }));
      if (runs.length) return runs;
    }
    const seeded = await one<{ value: AgentRun[] }>(`SELECT value FROM settings WHERE key = 'runs'`);
    return seeded?.value ?? [];
  });

  app.get("/api/agents/runtime", async (): Promise<RuntimeStats> => {
    const rows = await query<{ status: string }>(`SELECT status FROM agents`);
    const active = rows.filter((r) => r.status === "optimal").length;
    const runs = (await one<{ value: AgentRun[] }>(`SELECT value FROM settings WHERE key = 'runs'`))?.value ?? [];
    const stepsToday = runs.reduce((n, r) => n + (r.steps?.length ?? 0), 0);
    const errors = runs.reduce((n, r) => n + (r.errCount ?? 0), 0);
    return { active, recentRuns: runs.length, stepsToday, errors };
  });
}
