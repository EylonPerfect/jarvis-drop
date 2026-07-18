import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { orgId } from "../lib/auth.js";
import type { Reminder, TimeEntry, ReminderGroup } from "@jarvis/shared";

function rowToReminder(r: any): Reminder {
  return { id: r.id, text: r.text, time: r.time, group: r.grp, dueAt: r.due_at ?? undefined };
}
function rowToEntry(r: any): TimeEntry {
  return { id: r.id, title: r.title, project: r.project, minutes: r.minutes, category: r.category ?? undefined };
}

export default async function calendarRoutes(app: FastifyInstance) {
  app.get("/api/calendar/reminders", async (req) => {
    const rows = await query(`SELECT * FROM reminders WHERE org_id = $1 ORDER BY sort`, [orgId(req)]);
    return rows.map(rowToReminder);
  });

  app.post("/api/calendar/reminders", async (req, reply) => {
    const b = req.body as Partial<Reminder>;
    if (!b?.text?.trim()) return reply.code(400).send({ error: "text required" });
    const id = `r_${Date.now().toString(36)}`;
    const grp: ReminderGroup = (b.group as ReminderGroup) ?? "upcoming";
    const org = orgId(req);
    const maxSort = await one<{ m: number }>(`SELECT COALESCE(MAX(sort), -1) + 1 AS m FROM reminders WHERE grp = $1 AND org_id = $2`, [grp, org]);
    await query(`INSERT INTO reminders (id, text, time, grp, sort, org_id) VALUES ($1,$2,$3,$4,$5,$6)`, [id, b.text.trim(), b.time ?? "", grp, maxSort?.m ?? 0, org]);
    return reply.code(201).send(rowToReminder(await one(`SELECT * FROM reminders WHERE id = $1 AND org_id = $2`, [id, org])));
  });

  app.delete("/api/calendar/reminders/:id", async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM reminders WHERE id = $1 AND org_id = $2`, [id, orgId(req)]);
    return { ok: true };
  });

  // Clear all reminders.
  app.delete("/api/calendar/reminders", async (req) => {
    await query(`DELETE FROM reminders WHERE org_id = $1`, [orgId(req)]);
    return { ok: true };
  });

  app.get("/api/calendar/time", async (req) => {
    const rows = await query(`SELECT * FROM time_entries WHERE org_id = $1 ORDER BY sort`, [orgId(req)]);
    return rows.map(rowToEntry);
  });

  // Clear all time entries.
  app.delete("/api/calendar/time", async (req) => {
    await query(`DELETE FROM time_entries WHERE org_id = $1`, [orgId(req)]);
    return { ok: true };
  });
}
