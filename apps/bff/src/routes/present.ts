import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { one, query } from "../db/pool.js";
import { config } from "../config.js";
import { getIntegrationValues } from "./integrations.js";
import { getActiveProvider, completeProviderChat } from "../lib/providers.js";
import { resolveElevenVoiceId } from "../lib/tts.js";
import { getCompany } from "./company.js";

// AI presenter: a Recall bot renders our /present page as its shared screen. The
// page shows a live browser feed of the product and speaks the narration. The
// present session (script + product URL) is stored under a settings key; the
// unguessable session id is the capability token, so /api/present/* is auth-exempt
// (Recall's headless browser has no login) — see the auth hook in index.ts.

interface PresentStep { say: string; }
interface PresentSession { title: string; url: string; steps: PresentStep[]; }

// Where the Recall bot loads the presenter page from (must be publicly reachable).
const PRESENTER_BASE = (process.env.PRESENTER_BASE_URL || "https://jarvis.srv1797540.hstgr.cloud").replace(/\/$/, "");

// The caller's org, falling back to the legacy org for the cookieless Recall
// browser (GET /api/present/* is auth-exempt) — see TENANCY-SCOPING.md.
function reqOrg(req: { orgId?: string }): string {
  return req.orgId ?? config.legacyOrgId;
}

async function recall(org: string): Promise<{ base: string; key: string } | null> {
  const v = await getIntegrationValues(org, "recall");
  const key = v?.apiKey?.trim();
  const region = (v?.region?.trim() || "us-east-1").replace(/[^a-z0-9-]/gi, "");
  return key ? { base: `https://${region}.recall.ai`, key } : null;
}

async function getSession(id: string): Promise<PresentSession | null> {
  const row = await one<{ value: PresentSession }>(`SELECT value FROM settings WHERE key = $1`, [`present:${id}`]);
  return row?.value ?? null;
}

interface PresenterAgent { instructions: string | null; role: string | null; name: string | null; goals: unknown }

// Generate the narration from the AGENT's instructions/role (its persona drives
// how it presents), grounded in the company + product. Falls back to a generic
// company presenter when no agent is given.
async function generateScript(org: string, topic: string, agent: PresenterAgent | null): Promise<PresentStep[]> {
  const c = await getCompany(org);
  const active = await getActiveProvider(org);
  const who = agent?.name?.trim();
  const persona = agent?.instructions?.trim()
    ? agent.instructions.trim()
    : `You are ${c.name}'s AI presenter${agent?.role ? `, a ${agent.role}` : ""}.`;
  if (active) {
    const sys = `${persona}\n\nYou have joined a live video call to PRESENT and demo ${c.name}'s product, which is live on your shared screen (${c.name} — ${c.coreBusiness || c.industry}). Acting fully in your role, write the spoken demo narration as JSON: {"steps":[{"say":"..."}]} — 5-8 short spoken lines (1-2 sentences each), natural to say aloud, walking the customer through the product's value in your own voice. No markdown, JSON only.`;
    const r = await completeProviderChat(active, [ { role: "system", content: sys }, { role: "user", content: `Focus for this demo: ${topic || "a value-led walkthrough for this customer"}` } ]);
    if (r.ok && r.content) {
      try {
        const j = JSON.parse(r.content.replace(/^```json\s*|\s*```$/g, "").trim());
        const steps = Array.isArray(j?.steps) ? j.steps.filter((s: PresentStep) => s?.say?.trim()).map((s: PresentStep) => ({ say: String(s.say).trim() })) : [];
        if (steps.length) return steps;
      } catch { /* fall through */ }
    }
  }
  return [
    { say: `Hi everyone${who ? `, I'm ${who}` : ""} — thanks for the time. Let me walk you through ${c.name}.` },
    { say: `${c.name} helps you ${c.coreBusiness || "get more done"} — here's the product live on my screen.` },
    { say: "Happy to take questions any time — just jump in." },
  ];
}

export default async function presentRoutes(app: FastifyInstance) {
  // Create a presenter session + send a bot into the meeting to present it.
  app.post("/api/meetings/present", async (req, reply) => {
    const b = (req.body ?? {}) as { meetingUrl?: string; url?: string; topic?: string; steps?: PresentStep[]; botName?: string; agentId?: string };
    const meetingUrl = (b.meetingUrl ?? "").trim();
    if (!meetingUrl) return reply.code(400).send({ error: "meetingUrl required" });
    const org = reqOrg(req);
    const company = await getCompany(org);
    // Which agent is presenting — its instructions/role drive the narration and
    // the in-call conversation (Phase 2 replyTo reads the meeting's agent_id).
    const agent = b.agentId
      ? await one<PresenterAgent>(`SELECT instructions, role, name, goals FROM agents WHERE id = $1 AND org_id = $2`, [b.agentId, org])
      : null;
    const url = (b.url ?? "").trim() || (company.domain ? `https://${company.domain.replace(/^https?:\/\//, "")}` : "https://www.google.com");
    const steps = (Array.isArray(b.steps) && b.steps.length ? b.steps : await generateScript(org, b.topic ?? "", agent)).slice(0, 12);
    const title = `${agent?.name?.trim() || company.name} — live demo`;
    const id = randomUUID();
    await query(`INSERT INTO settings (org_id, key, value) VALUES ($3, $1, $2) ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`, [`present:${id}`, JSON.stringify({ title, url, steps } satisfies PresentSession), org]);

    const rc = await recall(org);
    if (!rc) return reply.code(400).send({ error: "Recall.ai not connected — add the key in Integrations." });
    const presentUrl = `${PRESENTER_BASE}/present?s=${id}`;
    try {
      const r = await fetch(`${rc.base}/api/v1/bot/`, {
        method: "POST",
        headers: { authorization: `Token ${rc.key}`, "content-type": "application/json" },
        body: JSON.stringify({
          meeting_url: meetingUrl,
          bot_name: b.botName?.trim() || `${company.name} AI`,
          output_media: { camera: { kind: "webpage", config: { url: presentUrl } } },
          recording_config: { transcript: { provider: { meeting_captions: {} } }, realtime_endpoints: [{ type: "webhook", url: `${PRESENTER_BASE}/api/meetings/webhook?t=${encodeURIComponent(config.bffApiKey ?? "open")}`, events: ["transcript.data"] }] },
        }),
      });
      const j = await r.json().catch(() => ({} as Record<string, unknown>));
      if (!r.ok) return reply.code(502).send({ error: `Recall rejected the request (${r.status})`, detail: JSON.stringify(j).slice(0, 300) });
      const botId = (j as { id?: string }).id;
      if (botId) await query(`INSERT INTO meetings (id, meeting_url, bot_name, agent_id, status, org_id) VALUES ($1,$2,$3,$4,'presenting',$5) ON CONFLICT (id) DO NOTHING`, [botId, meetingUrl, agent?.name?.trim() || "AI Presenter", b.agentId ?? null, org]).catch(() => {});
      return { ok: true, sessionId: id, botId, presentUrl, meetingUrl, steps };
    } catch (e) {
      return reply.code(502).send({ error: `Could not reach Recall.ai: ${(e as Error).message}` });
    }
  });

  // ---- Public (auth-exempt) endpoints the presenter page uses inside Recall ----

  app.get("/api/present/:id", async (req, reply): Promise<PresentSession | { error: string }> => {
    const { id } = req.params as { id: string };
    const s = await getSession(id);
    if (!s) { reply.code(404); return { error: "not found" }; }
    return s;
  });

  // TTS for a step — good voice via ElevenLabs, else OpenAI-compatible TTS.
  app.get("/api/present/:id/audio", async (req, reply) => {
    const { id } = req.params as { id: string };
    const i = Number((req.query as { i?: string }).i ?? "0");
    const s = await getSession(id);
    const text = s?.steps?.[i]?.say?.trim();
    if (!text) return reply.code(404).send({ error: "no step" });
    const el = await getIntegrationValues(reqOrg(req), "elevenlabs");
    if (el?.apiKey?.trim()) {
      const voice = await resolveElevenVoiceId(el.apiKey.trim(), el.voiceId);
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
        method: "POST", headers: { "xi-api-key": el.apiKey.trim(), "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5" }),
      });
      if (r.ok) { reply.header("content-type", "audio/mpeg").header("cache-control", "no-store"); return reply.send(Buffer.from(await r.arrayBuffer())); }
    }
    const p = await getActiveProvider(reqOrg(req));
    if (p?.api_key) {
      const r = await fetch(`${p.base_url.replace(/\/$/, "")}/audio/speech`, {
        method: "POST", headers: { authorization: `Bearer ${p.api_key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: text, response_format: "mp3" }),
      });
      if (r.ok) { reply.header("content-type", "audio/mpeg").header("cache-control", "no-store"); return reply.send(Buffer.from(await r.arrayBuffer())); }
    }
    return reply.code(502).send({ error: "no voice provider" });
  });

  // Live screenshot of the session's product URL (the "shared screen" feed).
  app.get("/api/present/:id/shot", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await getSession(id);
    if (!s) return reply.code(404).send({ error: "not found" });
    try {
      const r = await fetch(`${config.browserless.url}/screenshot?token=${encodeURIComponent(config.browserless.token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: s.url, viewport: { width: 1280, height: 720 }, gotoOptions: { waitUntil: "networkidle2", timeout: 20000 } }),
      });
      if (!r.ok) return reply.code(502).send({ error: "render failed" });
      reply.header("Content-Type", r.headers.get("content-type") || "image/png").header("Cache-Control", "no-store");
      return reply.send(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
}
