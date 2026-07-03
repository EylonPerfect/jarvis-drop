import type { FastifyInstance } from "fastify";
import { getIntegrationValues } from "./integrations.js";
import { getActiveProvider } from "../lib/providers.js";

// Server-side voice so an agent can actually SPEAK (demos, calls). Prefers
// ElevenLabs when connected; otherwise falls back to OpenAI-compatible TTS using
// the active AI Core provider's key (so voice works with the model key you
// already have — no extra credential needed). Returns audio/mpeg.
const EL_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs "Rachel"
const OA_DEFAULT_VOICE = "alloy"; // OpenAI TTS

export default async function voiceRoutes(app: FastifyInstance) {
  // Reports whether voice is available and via which provider (no keys exposed).
  app.get("/api/voice/status", async () => {
    const el = await getIntegrationValues("elevenlabs");
    if (el?.apiKey) return { connected: true, provider: "elevenlabs", voiceId: el.voiceId || EL_DEFAULT_VOICE };
    const p = await getActiveProvider();
    if (p) return { connected: true, provider: "openai", voiceId: OA_DEFAULT_VOICE };
    return { connected: false, provider: "none", voiceId: OA_DEFAULT_VOICE };
  });

  app.post("/api/voice/speak", async (req, reply) => {
    const body = (req.body ?? {}) as { text?: string; voiceId?: string };
    const text = (body.text ?? "").toString().slice(0, 5000).trim();
    if (!text) return reply.code(400).send({ error: "text required" });

    // 1) ElevenLabs (best quality) when connected.
    const el = await getIntegrationValues("elevenlabs");
    if (el?.apiKey?.trim()) {
      const voiceId = body.voiceId?.trim() || el.voiceId?.trim() || EL_DEFAULT_VOICE;
      try {
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
          method: "POST",
          headers: { "xi-api-key": el.apiKey.trim(), "content-type": "application/json", accept: "audio/mpeg" },
          body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.4, similarity_boost: 0.75 } }),
        });
        if (r.ok) { reply.header("content-type", "audio/mpeg").header("cache-control", "no-store"); return reply.send(Buffer.from(await r.arrayBuffer())); }
        const detail = await r.text().catch(() => "");
        return reply.code(502).send({ error: `ElevenLabs error (${r.status})`, detail: detail.slice(0, 200) });
      } catch (e) {
        return reply.code(502).send({ error: `Could not reach ElevenLabs: ${(e as Error).message}` });
      }
    }

    // 2) Fall back to OpenAI-compatible TTS using the active AI Core provider key.
    const p = await getActiveProvider();
    if (p?.api_key) {
      const base = p.base_url.replace(/\/$/, "");
      const voice = body.voiceId?.trim() || OA_DEFAULT_VOICE;
      try {
        const r = await fetch(`${base}/audio/speech`, {
          method: "POST",
          headers: { authorization: `Bearer ${p.api_key}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text, response_format: "mp3" }),
        });
        if (r.ok) { reply.header("content-type", "audio/mpeg").header("cache-control", "no-store"); return reply.send(Buffer.from(await r.arrayBuffer())); }
        // Retry once with the older, widely-available TTS model.
        const r2 = await fetch(`${base}/audio/speech`, {
          method: "POST",
          headers: { authorization: `Bearer ${p.api_key}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "tts-1", voice, input: text, response_format: "mp3" }),
        });
        if (r2.ok) { reply.header("content-type", "audio/mpeg").header("cache-control", "no-store"); return reply.send(Buffer.from(await r2.arrayBuffer())); }
        const detail = await r2.text().catch(() => "");
        return reply.code(502).send({ error: `TTS not available on this provider (${r2.status}). Connect ElevenLabs in Integrations for voice.`, detail: detail.slice(0, 200) });
      } catch (e) {
        return reply.code(502).send({ error: `Could not reach the TTS provider: ${(e as Error).message}` });
      }
    }

    return reply.code(400).send({ error: "No voice provider — connect ElevenLabs in Integrations, or an OpenAI provider in AI Core." });
  });
}
