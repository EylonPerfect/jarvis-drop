import type { FastifyInstance } from "fastify";
import { getIntegrationValues } from "./integrations.js";

// Server-side voice via ElevenLabs — so an agent can actually SPEAK (demos,
// calls). Uses the ElevenLabs API key stored in the integrations credential
// store. Returns audio/mpeg the client can play. A default voice is used when
// none is configured.
const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // "Rachel" — natural English

export default async function voiceRoutes(app: FastifyInstance) {
  // Reports whether voice is configured, without exposing the key.
  app.get("/api/voice/status", async () => {
    const v = await getIntegrationValues("elevenlabs");
    return { connected: !!v?.apiKey, provider: "elevenlabs", voiceId: v?.voiceId || DEFAULT_VOICE };
  });

  app.post("/api/voice/speak", async (req, reply) => {
    const body = (req.body ?? {}) as { text?: string; voiceId?: string };
    const text = (body.text ?? "").toString().slice(0, 5000).trim();
    if (!text) return reply.code(400).send({ error: "text required" });

    const creds = await getIntegrationValues("elevenlabs");
    const apiKey = creds?.apiKey?.trim();
    if (!apiKey) return reply.code(400).send({ error: "ElevenLabs not connected — add the key in Integrations." });
    const voiceId = (body.voiceId?.trim() || creds?.voiceId?.trim() || DEFAULT_VOICE);

    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.4, similarity_boost: 0.75 } }),
      });
      if (!r.ok || !r.body) {
        const detail = await r.text().catch(() => "");
        return reply.code(502).send({ error: `ElevenLabs error (${r.status})`, detail: detail.slice(0, 200) });
      }
      const buf = Buffer.from(await r.arrayBuffer());
      reply.header("content-type", "audio/mpeg");
      reply.header("cache-control", "no-store");
      return reply.send(buf);
    } catch (e) {
      return reply.code(502).send({ error: `Could not reach ElevenLabs: ${(e as Error).message}` });
    }
  });
}
