import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import type { Task, TaskColumn, Priority } from "@jarvis/shared";

function rowToTask(r: any): Task {
  return {
    id: r.id,
    title: r.title,
    column: r.col,
    priority: r.priority,
    tags: r.tags ?? [],
    link: r.link ?? null,
    position: r.position,
  };
}

export default async function tasksRoutes(app: FastifyInstance) {
  app.get("/api/tasks", async () => {
    const rows = await query(`SELECT * FROM tasks ORDER BY col, position`);
    return rows.map(rowToTask);
  });

  app.post("/api/tasks", async (req, reply) => {
    const b = req.body as Partial<Task>;
    if (!b?.title?.trim()) return reply.code(400).send({ error: "title required" });
    const id = `t_${Date.now().toString(36)}`;
    const col: TaskColumn = (b.column as TaskColumn) ?? "todo";
    const maxPos = await one<{ m: number }>(`SELECT COALESCE(MAX(position), -1) + 1 AS m FROM tasks WHERE col = $1`, [col]);
    await query(
      `INSERT INTO tasks (id, title, col, priority, tags, link, position) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, b.title.trim(), col, (b.priority as Priority) ?? "medium", JSON.stringify(b.tags ?? []), b.link ?? null, maxPos?.m ?? 0],
    );
    return reply.code(201).send(rowToTask(await one(`SELECT * FROM tasks WHERE id = $1`, [id])));
  });

  // Move / edit a task (drag between columns, change priority, etc.).
  app.patch("/api/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as Partial<Task>;
    const existing = await one(`SELECT * FROM tasks WHERE id = $1`, [id]);
    if (!existing) return reply.code(404).send({ error: "not found" });
    await query(
      `UPDATE tasks SET
         title = COALESCE($2, title),
         col = COALESCE($3, col),
         priority = COALESCE($4, priority),
         tags = COALESCE($5, tags),
         link = $6,
         position = COALESCE($7, position)
       WHERE id = $1`,
      [
        id,
        b.title ?? null,
        (b.column as string) ?? null,
        (b.priority as string) ?? null,
        b.tags ? JSON.stringify(b.tags) : null,
        b.link ?? (existing as any).link,
        b.position ?? null,
      ],
    );
    return rowToTask(await one(`SELECT * FROM tasks WHERE id = $1`, [id]));
  });

  app.delete("/api/tasks/:id", async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM tasks WHERE id = $1`, [id]);
    return { ok: true };
  });
}
