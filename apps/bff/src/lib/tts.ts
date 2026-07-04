import { getIntegrationValues } from "../routes/integrations.js";
import { getActiveProvider } from "./providers.js";

// Text → speech (mp3 Buffer). Prefers ElevenLabs; falls back to OpenAI-compatible
// TTS using the active AI Core provider. Returns null if no voice is available.
export async function ttsMp3(text: string): Promise<Buffer | null> {
  const t = (text ?? "").toString().slice(0, 5000).trim();
  if (!t) return null;

  const el = await getIntegrationValues("elevenlabs");
  if (el?.apiKey?.trim()) {
    const voice = el.voiceId?.trim() || "21m00Tcm4TlvDq8ikWAM";
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
        method: "POST",
        headers: { "xi-api-key": el.apiKey.trim(), "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text: t, model_id: "eleven_turbo_v2_5" }),
      });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* fall through */ }
  }

  const p = await getActiveProvider();
  if (p?.api_key) {
    try {
      const r = await fetch(`${p.base_url.replace(/\/$/, "")}/audio/speech`, {
        method: "POST",
        headers: { authorization: `Bearer ${p.api_key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: t, response_format: "mp3" }),
      });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* fall through */ }
  }
  return null;
}
