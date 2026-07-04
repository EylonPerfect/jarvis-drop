import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { getIntegrationValues } from "./integrations.js";
import type { Meeting, MeetingTranscriptLine } from "@jarvis/shared";

// Recall.ai meeting bot: send an AI bot into a live Zoom/Meet/Teams call, watch
// its status, and pull the transcript. Credentials come from the Integrations
// store (recall: apiKey + region). Region-scoped base URL.

async function recall(): Promise<{ base: string; key: string } | null> {
  const v = await getIntegrationValues("recall");
  const key = v?.apiKey?.trim();
  const region = (v?.region?.trim() || "us-east-1").replace(/[^a-z0-9-]/gi, "");
  if (!key) return null;
  return { base: `https://${region}.recall.ai`, key };
}

// Current status = the latest status_changes[].code, else a top-level field.
function statusOf(bot: any): string {
  const changes = Array.isArray(bot?.status_changes) ? bot.status_changes : [];
  return (changes.length ? changes[changes.length - 1]?.code : bot?.status?.code || bot?.status) || "unknown";
}

// Normalize Recall's transcript shapes into {speaker,text} lines.
function normalizeTranscript(data: any): MeetingTranscriptLine[] {
  if (!Array.isArray(data)) return [];
  return data.map((seg: any) => {
    const speaker = seg?.speaker ?? seg?.participant?.name ?? undefined;
    let text = "";
    if (typeof seg?.text === "string") text = seg.text;
    else if (Array.isArray(seg?.words)) text = seg.words.map((w: any) => w?.text ?? "").join(" ").trim();
    return { speaker, text };
  }).filter((l: MeetingTranscriptLine) => l.text);
}

function rowToMeeting(r: any): Meeting {
  return { id: r.id, meetingUrl: r.meeting_url, botName: r.bot_name ?? "", agentId: r.agent_id ?? undefined, status: r.status ?? "unknown", createdAt: r.created_at };
}

export default async function meetingsRoutes(app: FastifyInstance) {
  // Send a bot into a meeting.
  app.post("/api/meetings/join", async (req, reply) => {
    const b = (req.body ?? {}) as { meetingUrl?: string; botName?: string; agentId?: string };
    const meetingUrl = (b.meetingUrl ?? "").trim();
    const botName = (b.botName ?? "After Human").trim() || "After Human";
    if (!meetingUrl) return reply.code(400).send({ error: "meetingUrl required" });
    const rc = await recall();
    if (!rc) return reply.code(400).send({ error: "Recall.ai not connected — add the key in Integrations." });
    try {
      const r = await fetch(`${rc.base}/api/v1/bot/`, {
        method: "POST",
        headers: { authorization: `Token ${rc.key}`, "content-type": "application/json" },
        body: JSON.stringify({ meeting_url: meetingUrl, bot_name: botName }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return reply.code(502).send({ error: `Recall rejected the request (${r.status})`, detail: JSON.stringify(j).slice(0, 300) });
      const id = j?.id;
      const raw = statusOf(j);
      const status = raw === "unknown" ? "joining" : raw;
      if (!id) return reply.code(502).send({ error: "Recall did not return a bot id", detail: JSON.stringify(j).slice(0, 200) });
      await query(
        `INSERT INTO meetings (id, meeting_url, bot_name, agent_id, status) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
        [id, meetingUrl, botName, b.agentId ?? null, status],
      ).catch(() => {});
      return { id, meetingUrl, botName, agentId: b.agentId, status, createdAt: new Date().toISOString() } as Meeting;
    } catch (e) {
      return reply.code(502).send({ error: `Could not reach Recall.ai: ${(e as Error).message}` });
    }
  });

  // List meetings (refreshes live status for still-active bots).
  app.get("/api/meetings", async (): Promise<Meeting[]> => {
    const rows = await query(`SELECT * FROM meetings ORDER BY created_at DESC LIMIT 30`);
    const rc = await recall();
    const meetings = rows.map(rowToMeeting);
    if (rc) {
      for (const m of meetings.filter((x) => !["done", "error", "left", "call_ended"].includes(x.status))) {
        try {
          const r = await fetch(`${rc.base}/api/v1/bot/${m.id}/`, { headers: { authorization: `Token ${rc.key}` } });
          if (r.ok) {
            const st = statusOf(await r.json());
            if (st !== m.status) { m.status = st; await query(`UPDATE meetings SET status = $1 WHERE id = $2`, [st, m.id]).catch(() => {}); }
          }
        } catch { /* leave */ }
      }
    }
    return meetings;
  });

  // One meeting: live status + transcript.
  app.get("/api/meetings/:id", async (req, reply): Promise<Meeting> => {
    const { id } = req.params as { id: string };
    const row = await one(`SELECT * FROM meetings WHERE id = $1`, [id]);
    const rc = await recall();
    const base: Meeting = row ? rowToMeeting(row) : { id, meetingUrl: "", botName: "", status: "unknown", createdAt: new Date().toISOString() };
    if (!rc) { reply.code(400); return base; }
    try {
      const r = await fetch(`${rc.base}/api/v1/bot/${id}/`, { headers: { authorization: `Token ${rc.key}` } });
      if (r.ok) base.status = statusOf(await r.json());
      const t = await fetch(`${rc.base}/api/v1/bot/${id}/transcript/`, { headers: { authorization: `Token ${rc.key}` } });
      if (t.ok) base.transcript = normalizeTranscript(await t.json());
      await query(`UPDATE meetings SET status = $1 WHERE id = $2`, [base.status, id]).catch(() => {});
    } catch { /* return what we have */ }
    return base;
  });

  // Remove the bot from the call.
  app.delete("/api/meetings/:id", async (req) => {
    const { id } = req.params as { id: string };
    const rc = await recall();
    if (rc) {
      try { await fetch(`${rc.base}/api/v1/bot/${id}/leave_call/`, { method: "POST", headers: { authorization: `Token ${rc.key}` } }); } catch { /* ignore */ }
    }
    await query(`DELETE FROM meetings WHERE id = $1`, [id]).catch(() => {});
    return { ok: true };
  });
}
