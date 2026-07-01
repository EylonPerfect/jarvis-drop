import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import type { Reminder, TimeEntry, ReminderGroup } from "@jarvis/shared";

function rowToReminder(r: any): Reminder {
  return { id: r.id, text: r.text, time: r.time, group: r.grp, dueAt: r.due_at ?? undefined };
}
function rowToEntry(r: any): TimeEntry {
  return { id: r.id, title: r.title, project: r.project, minutes: r.minutes, category: r.category ?? undefined };
}

export default async function calendarRoutes(app: FastifyInstance) {
  app.get("/api/calendar/reminders", async () => {
    const rows = await query(`SELECT * FROM reminders ORDER BY sort`);
    return rows.map(rowToReminder);
  });

  app.post("/api/calendar/reminders", async (req, reply) => {
    const b = req.body as Partial<Reminder>;
    if (!b?.text?.trim()) return reply.code(400).send({ error: "text required" });
    const id = `r_${Date.now().toString(36)}`;
    const grp: ReminderGroup = (b.group as ReminderGroup) ?? "upcoming";
    const maxSort = await one<{ m: number }>(`SELECT COALESCE(MAX(sort), -1) + 1 AS m FROM reminders WHERE grp = $1`, [grp]);
    await query(`INSERT INTO reminders (id, text, time, grp, sort) VALUES ($1,$2,$3,$4,$5)`, [id, b.text.trim(), b.time ?? "", grp, maxSort?.m ?? 0]);
    return reply.code(201).send(rowToReminder(await one(`SELECT * FROM reminders WHERE id = $1`, [id])));
  });

  app.delete("/api/calendar/reminders/:id", async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM reminders WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.get("/api/calendar/time", async () => {
    const rows = await query(`SELECT * FROM time_entries ORDER BY sort`);
    return rows.map(rowToEntry);
  });
}
