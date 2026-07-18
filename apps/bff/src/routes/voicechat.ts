import type { FastifyInstance } from "fastify";
import { one } from "../db/pool.js";
import { getIntegrationValues } from "./integrations.js";
import { getCompany } from "./company.js";
import { orgId } from "../lib/auth.js";
import { getSetting, setSetting } from "../lib/settingsStore.js";
import { agentInOrg } from "../lib/tenancy.js";
import { compileClone, DEFAULT_PERSONA_STYLE, type PersonaSpec, type CallPlaybook } from "@jarvis/shared";

// Real-time voice chat for the Calibration Room (cold gear). One shared
// ElevenLabs Conversational AI agent is provisioned lazily and configured to
// ALLOW client overrides; every session then overrides prompt / first message /
// voice per clone, so the single ConvAI agent can speak as ANY clone with the
// CURRENT draft persona — same compile path as /api/sessions text chat.

const EL_BASE = "https://api.elevenlabs.io";
const SETTINGS_KEY = "elevenlabs_convai_agent";

const VOICE_SUFFIX =
  "\n\nLIVE VOICE MODE: You are on a live spoken conversation right now (real-time voice, not text). " +
  "Answer briefly and conversationally — one to three short sentences, like natural speech on a call. " +
  "No markdown, no lists, no headings, no stage directions. Ask at most one question at a time.";

function playbookOf(agent: Record<string, unknown> | null): CallPlaybook | null {
  const pb = agent?.playbook as { kind?: string; callPlaybook?: CallPlaybook } | null | undefined;
  return pb && pb.kind === "calls" && pb.callPlaybook ? pb.callPlaybook : null;
}

async function currentPersona(agent: Record<string, any>, org: string): Promise<PersonaSpec> {
  if (agent?.persona && agent.persona.identity) return agent.persona as PersonaSpec;
  const company = (await getCompany(org)).name || "the company";
  return {
    identity: { name: agent?.name || "the agent", role: agent?.role || "", company, self_description: "" },
    style: { ...DEFAULT_PERSONA_STYLE },
    lexicon: { signature_phrases: [], banned_phrases: ["As an AI", "I don't have feelings", "Certainly!"], vocabulary_notes: "" },
    behaviors: { rules: [], escalation: { triggers: [], action: "" } },
    knowledge_boundaries: [],
    few_shots: [],
    voice: { elevenlabs_voice_id: null, speaking_rate: 1.0, stability: 0.5 },
  };
}

// The agent config we need: overrides ENABLED for system prompt, first
// message, language and TTS voice — everything else stays default.
const OVERRIDES_ENABLED = {
  conversation_config_override: {
    agent: { prompt: { prompt: true }, first_message: true, language: true },
    tts: { voice_id: true },
  },
} as const;

async function elFetch(apiKey: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${EL_BASE}${path}`, {
    ...init,
    headers: { "xi-api-key": apiKey, ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
}

// Ensure ONE shared ConvAI agent exists with client overrides allowed.
// Returns its ElevenLabs agent id. Stored in settings under SETTINGS_KEY.
async function ensureConvaiAgent(org: string, apiKey: string, log: { warn: (o: unknown, m?: string) => void }): Promise<string> {
  const stored = await getSetting<{ agentId?: string }>(org, SETTINGS_KEY);
  const existing = stored?.agentId;
  if (existing) {
    const r = await elFetch(apiKey, `/v1/convai/agents/${encodeURIComponent(existing)}`);
    if (r.ok) {
      // Idempotently make sure overrides stayed enabled (someone may have
      // edited the agent in the ElevenLabs dashboard).
      const j = (await r.json()) as { platform_settings?: { overrides?: { conversation_config_override?: { agent?: { prompt?: { prompt?: boolean }; first_message?: boolean; language?: boolean }; tts?: { voice_id?: boolean } } } } };
      const o = j.platform_settings?.overrides?.conversation_config_override;
      const ok = o?.agent?.prompt?.prompt === true && o?.agent?.first_message === true && o?.agent?.language === true && o?.tts?.voice_id === true;
      if (!ok) {
        const p = await elFetch(apiKey, `/v1/convai/agents/${encodeURIComponent(existing)}`, {
          method: "PATCH",
          body: JSON.stringify({ platform_settings: { overrides: OVERRIDES_ENABLED } }),
        });
        if (!p.ok) log.warn({ status: p.status, detail: (await p.text().catch(() => "")).slice(0, 200) }, "convai agent override patch failed");
      }
      return existing;
    }
    log.warn({ status: r.status, agentId: existing }, "stored convai agent missing — creating a new one");
  }
  const c = await elFetch(apiKey, `/v1/convai/agents/create`, {
    method: "POST",
    body: JSON.stringify({
      name: "After Human — Calibration Room voice",
      conversation_config: {
        agent: {
          first_message: "",
          language: "en",
          prompt: { prompt: "You are a helpful voice assistant. (This prompt is always overridden per session.)" },
        },
      },
      platform_settings: { overrides: OVERRIDES_ENABLED },
    }),
  });
  if (!c.ok) {
    const detail = (await c.text().catch(() => "")).slice(0, 300);
    throw new Error(`ElevenLabs agent create failed (${c.status}): ${detail}`);
  }
  const cj = (await c.json()) as { agent_id?: string };
  if (!cj.agent_id) throw new Error("ElevenLabs agent create returned no agent_id");
  await setSetting(org, SETTINGS_KEY, { agentId: cj.agent_id, createdAt: new Date().toISOString() });
  return cj.agent_id;
}

export default async function voicechatRoutes(app: FastifyInstance) {
  // Mint a real-time voice session for a clone: signed WebSocket URL for the
  // shared ConvAI agent + per-clone overrides the web SDK passes on connect.
  app.post("/api/voicechat/session", async (req, reply) => {
    const b = (req.body ?? {}) as { agentId?: string };
    if (!b.agentId) return reply.code(400).send({ error: "agentId required" });
    const org = orgId(req);
    if (!(await agentInOrg(b.agentId, org))) return reply.code(404).send({ error: "not found" });
    const agent = await one<any>(`SELECT * FROM agents WHERE id = $1 AND org_id = $2`, [b.agentId, org]);
    if (!agent) return reply.code(404).send({ error: "agent not found" });

    const el = await getIntegrationValues(orgId(req), "elevenlabs");
    const apiKey = el?.apiKey?.trim();
    if (!apiKey) return reply.code(400).send({ error: "ElevenLabs is not connected — add the API key in Integrations" });

    // CURRENT draft persona, same compile as /api/sessions text chat.
    const spec = await currentPersona(agent, orgId(req));
    const company = (await getCompany(orgId(req))).name || "the company";
    const prompt = compileClone(spec, playbookOf(agent), agent.name, company) + VOICE_SUFFIX;
    const voiceId: string = (agent.voice_id || spec.voice?.elevenlabs_voice_id || "").toString().trim();
    const firstName = String(agent.name || "there").split(/\s+/)[0];
    const firstMessage = `Hey, ${firstName} here — good to meet you. What's on your mind?`;

    try {
      const convaiAgentId = await ensureConvaiAgent(org, apiKey, app.log);
      // Prefer WebRTC: its audio path runs the browser's echo cancellation, so
      // the clone doesn't hear itself through the operator's speakers (the raw
      // websocket AudioWorklet path does not — that echo loop was user-visible).
      let conversationToken: string | null = null;
      const t = await elFetch(apiKey, `/v1/convai/conversation/token?agent_id=${encodeURIComponent(convaiAgentId)}`);
      if (t.ok) {
        const tj = (await t.json()) as { token?: string };
        if (tj.token) conversationToken = tj.token;
      } else {
        app.log.warn({ status: t.status }, "convai webrtc token failed — falling back to websocket");
      }
      const s = await elFetch(apiKey, `/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(convaiAgentId)}`);
      if (!s.ok && !conversationToken) {
        const detail = (await s.text().catch(() => "")).slice(0, 300);
        return reply.code(502).send({ error: `ElevenLabs signed URL failed (${s.status})`, detail });
      }
      const sj = s.ok ? ((await s.json()) as { signed_url?: string }) : {};
      if (!sj.signed_url && !conversationToken) return reply.code(502).send({ error: "ElevenLabs returned no signed_url" });
      return { signedUrl: sj.signed_url ?? null, conversationToken, overrides: { prompt, firstMessage, voiceId } };
    } catch (e) {
      return reply.code(502).send({ error: `Voice session failed: ${(e as Error).message}` });
    }
  });
}
