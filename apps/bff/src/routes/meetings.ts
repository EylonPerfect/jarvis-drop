import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { getIntegrationValues } from "./integrations.js";
import { getActiveProvider, completeProviderChat } from "../lib/providers.js";
import { ttsMp3 } from "../lib/tts.js";
import { orgForAgent } from "../lib/metering.js";
import { getCompany } from "./company.js";
import { orgId } from "../lib/auth.js";
import { config } from "../config.js";
import type { Meeting, MeetingTranscriptLine } from "@jarvis/shared";

// Where Recall reaches our webhook (must be publicly reachable).
const PUBLIC_BASE = (process.env.PRESENTER_BASE_URL || "https://jarvis.srv1797540.hstgr.cloud").replace(/\/$/, "");
// Per-bot conversation guard: cooldown so the bot doesn't answer its own audio,
// and a busy flag so it doesn't talk over itself. In-memory (best-effort).
const convo = new Map<string, { busy: boolean; mutedUntil: number }>();

// Recall.ai meeting bot: send an AI bot into a live Zoom/Meet/Teams call, watch
// its status, and pull the transcript. Credentials come from the Integrations
// store (recall: apiKey + region). Region-scoped base URL.

async function recall(org: string): Promise<{ base: string; key: string } | null> {
  const v = await getIntegrationValues(org, "recall");
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

// Real-time transcription → our webhook, so the bot can converse. Needs a
// transcript provider (meeting_captions = platform captions, no extra key) or
// Recall drops the realtime_endpoints.
function realtimeConfig() {
  return {
    transcript: { provider: { meeting_captions: {} } },
    realtime_endpoints: [{ type: "webhook", url: `${PUBLIC_BASE}/api/meetings/webhook?t=${encodeURIComponent(config.bffApiKey ?? "open")}`, events: ["transcript.data"] }],
  };
}

// Make a bot say something out loud in the call (TTS → Recall output_audio).
async function speakInCall(org: string, botId: string, text: string): Promise<boolean> {
  const rc = await recall(org);
  if (!rc) return false;
  const m = await one<{ agent_id: string | null }>(`SELECT agent_id FROM meetings WHERE id = $1`, [botId]).catch(() => null);
  const ctx = { orgId: await orgForAgent(m?.agent_id), agentId: m?.agent_id ?? null };
  const mp3 = await ttsMp3(org, text, ctx);
  if (!mp3) return false;
  try {
    const r = await fetch(`${rc.base}/api/v1/bot/${botId}/output_audio/`, {
      method: "POST",
      headers: { authorization: `Token ${rc.key}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "mp3", b64_data: mp3.toString("base64") }),
    });
    return r.ok;
  } catch { return false; }
}

// Generate a short, spoken, grounded reply to something a participant said.
async function replyTo(org: string, botId: string, said: string): Promise<string | null> {
  const c = await getCompany(org);
  const m = await one<{ agent_id: string | null }>(`SELECT agent_id FROM meetings WHERE id = $1`, [botId]);
  let persona = `You are ${c.name}'s AI on a live call.`;
  if (m?.agent_id) {
    const a = await one<{ instructions: string | null; role: string | null; name: string | null }>(`SELECT instructions, role, name FROM agents WHERE id = $1`, [m.agent_id]);
    if (a?.instructions) persona = a.instructions;
    else if (a?.name) persona = `You are ${a.name}${a.role ? `, ${a.role}` : ""} at ${c.name}.`;
  }
  const active = await getActiveProvider(org);
  if (!active) return null;
  const sys = `${persona}\nYou are speaking OUT LOUD in a live video call. A participant just said something — respond helpfully in 1-2 short spoken sentences (natural to hear, no markdown, no lists). If they didn't ask anything answerable, reply briefly and warmly. Company: ${c.name} — ${c.coreBusiness || c.industry}.`;
  const r = await completeProviderChat(active, [ { role: "system", content: sys }, { role: "user", content: said } ], { ctx: { orgId: await orgForAgent(m?.agent_id), agentId: m?.agent_id ?? null }, kind: "meeting_reply" });
  return r.ok && r.content ? r.content.trim() : null;
}

export default async function meetingsRoutes(app: FastifyInstance) {
  // Send a bot into a meeting.
  app.post("/api/meetings/join", async (req, reply) => {
    const b = (req.body ?? {}) as { meetingUrl?: string; botName?: string; agentId?: string };
    const meetingUrl = (b.meetingUrl ?? "").trim();
    const botName = (b.botName ?? "After Human").trim() || "After Human";
    if (!meetingUrl) return reply.code(400).send({ error: "meetingUrl required" });
    const rc = await recall(orgId(req));
    if (!rc) return reply.code(400).send({ error: "Recall.ai not connected — add the key in Integrations." });
    try {
      const r = await fetch(`${rc.base}/api/v1/bot/`, {
        method: "POST",
        headers: { authorization: `Token ${rc.key}`, "content-type": "application/json" },
        body: JSON.stringify({ meeting_url: meetingUrl, bot_name: botName, recording_config: realtimeConfig() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return reply.code(502).send({ error: `Recall rejected the request (${r.status})`, detail: JSON.stringify(j).slice(0, 300) });
      const id = j?.id;
      const raw = statusOf(j);
      const status = raw === "unknown" ? "joining" : raw;
      if (!id) return reply.code(502).send({ error: "Recall did not return a bot id", detail: JSON.stringify(j).slice(0, 200) });
      await query(
        `INSERT INTO meetings (id, meeting_url, bot_name, agent_id, status, org_id) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
        [id, meetingUrl, botName, b.agentId ?? null, status, orgId(req)],
      ).catch(() => {});
      return { id, meetingUrl, botName, agentId: b.agentId, status, createdAt: new Date().toISOString() } as Meeting;
    } catch (e) {
      return reply.code(502).send({ error: `Could not reach Recall.ai: ${(e as Error).message}` });
    }
  });

  // List meetings (refreshes live status for still-active bots).
  app.get("/api/meetings", async (req): Promise<Meeting[]> => {
    const rows = await query(`SELECT * FROM meetings WHERE org_id = $1 ORDER BY created_at DESC LIMIT 30`, [orgId(req)]);
    const rc = await recall(orgId(req));
    const meetings = rows.map(rowToMeeting);
    if (rc) {
      for (const m of meetings.filter((x) => !["done", "error", "left", "call_ended"].includes(x.status))) {
        try {
          const r = await fetch(`${rc.base}/api/v1/bot/${m.id}/`, { headers: { authorization: `Token ${rc.key}` } });
          if (r.ok) {
            const st = statusOf(await r.json());
            if (st !== m.status) { m.status = st; await query(`UPDATE meetings SET status = $1 WHERE id = $2 AND org_id = $3`, [st, m.id, orgId(req)]).catch(() => {}); }
          }
        } catch { /* leave */ }
      }
    }
    return meetings;
  });

  // One meeting: live status + transcript.
  app.get("/api/meetings/:id", async (req, reply): Promise<Meeting> => {
    const { id } = req.params as { id: string };
    const row = await one(`SELECT * FROM meetings WHERE id = $1 AND org_id = $2`, [id, orgId(req)]);
    if (!row) { reply.code(404); return { id, meetingUrl: "", botName: "", status: "unknown", createdAt: new Date().toISOString() }; }
    const rc = await recall(orgId(req));
    const base: Meeting = rowToMeeting(row);
    if (!rc) { reply.code(400); return base; }
    try {
      const r = await fetch(`${rc.base}/api/v1/bot/${id}/`, { headers: { authorization: `Token ${rc.key}` } });
      if (r.ok) base.status = statusOf(await r.json());
      const t = await fetch(`${rc.base}/api/v1/bot/${id}/transcript/`, { headers: { authorization: `Token ${rc.key}` } });
      if (t.ok) base.transcript = normalizeTranscript(await t.json());
      await query(`UPDATE meetings SET status = $1 WHERE id = $2 AND org_id = $3`, [base.status, id, orgId(req)]).catch(() => {});
    } catch { /* return what we have */ }
    return base;
  });

  // Remove the bot from the call.
  app.delete("/api/meetings/:id", async (req) => {
    const { id } = req.params as { id: string };
    const rc = await recall(orgId(req));
    if (rc) {
      try { await fetch(`${rc.base}/api/v1/bot/${id}/leave_call/`, { method: "POST", headers: { authorization: `Token ${rc.key}` } }); } catch { /* ignore */ }
    }
    await query(`DELETE FROM meetings WHERE id = $1 AND org_id = $2`, [id, orgId(req)]).catch(() => {});
    return { ok: true };
  });

  // Make the bot say something in the call on demand (operator-triggered).
  app.post("/api/meetings/:id/speak", async (req, reply) => {
    const { id } = req.params as { id: string };
    const text = ((req.body as { text?: string })?.text ?? "").toString().trim();
    if (!text) return reply.code(400).send({ error: "text required" });
    // Gate the bot to the caller's org: only speak into a meeting this org owns.
    const owned = await one<{ id: string }>(`SELECT id FROM meetings WHERE id = $1 AND org_id = $2`, [id, orgId(req)]);
    if (!owned) return reply.code(404).send({ error: "not found" });
    const ok = await speakInCall(orgId(req), id, text);
    return ok ? { ok: true } : reply.code(502).send({ error: "Could not speak (check Recall + a voice provider, and that the bot is in the call)." });
  });

  // Recall real-time transcription webhook → the bot converses. Auth-exempt (the
  // ?t token authorizes it); guarded against answering its own audio.
  app.post("/api/meetings/webhook", async (req, reply) => {
    const t = (req.query as { t?: string })?.t;
    if (config.bffApiKey && t !== config.bffApiKey) return reply.code(401).send({ error: "unauthorized" });
    const body = (req.body ?? {}) as any;
    // Parse defensively across Recall payload shapes.
    const data = body?.data ?? body;
    const botId: string | undefined = data?.bot_id || data?.bot?.id || body?.bot_id;
    const tr = data?.transcript ?? data?.data ?? data;
    const isFinal = tr?.is_final ?? tr?.is_complete ?? true;
    const text: string = (typeof tr?.text === "string" ? tr.text : Array.isArray(tr?.words) ? tr.words.map((w: any) => w?.text ?? "").join(" ") : "").trim();
    reply.send({ ok: true }); // ack immediately; process async

    if (!botId || !isFinal || text.length < 8) return;
    const state = convo.get(botId) ?? { busy: false, mutedUntil: 0 };
    if (state.busy || Date.now() < state.mutedUntil) return; // ignore our own echo / overlap
    // Only respond to things that look addressed to us (question or a direct ask).
    if (!/[?]|\b(what|how|why|when|can you|could you|tell me|show|explain|do you|walk|price|cost|demo)\b/i.test(text)) return;
    state.busy = true; convo.set(botId, state);
    try {
      const answer = await replyTo(orgId(req), botId, text);
      if (answer) {
        await speakInCall(orgId(req), botId, answer);
        // Mute for ~ the spoken duration so we don't transcribe+answer ourselves.
        const secs = Math.min(30, Math.max(4, Math.round(answer.split(/\s+/).length / 2.5)));
        convo.set(botId, { busy: false, mutedUntil: Date.now() + secs * 1000 });
        return;
      }
    } catch { /* ignore */ }
    convo.set(botId, { busy: false, mutedUntil: Date.now() + 2000 });
  });
}
