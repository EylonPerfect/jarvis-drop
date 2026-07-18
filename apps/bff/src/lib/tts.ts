import { getIntegrationValues } from "../routes/integrations.js";
import { getActiveProvider } from "./providers.js";
import { recordTtsChars, type UsageContext } from "./metering.js";

// Resolve a usable ElevenLabs voice id. The old hardcoded default ("Rachel",
// 21m00…) is a *library* voice that free-tier accounts can't use via the API
// (402 paid_plan_required). So: use the operator-configured voice if set,
// otherwise fetch the account's own /v1/voices and prefer an owned voice
// (cloned/generated/professional — e.g. a custom brand voice), falling back to
// whatever the account actually has. Cached in-memory to avoid a lookup per call.
let cachedVoiceId: string | null = null;
export async function resolveElevenVoiceId(apiKey: string, configured?: string): Promise<string> {
  const c = configured?.trim();
  if (c) return c;
  if (cachedVoiceId) return cachedVoiceId;
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey } });
    if (r.ok) {
      const j = (await r.json()) as { voices?: { voice_id?: string; category?: string }[] };
      const voices = Array.isArray(j.voices) ? j.voices : [];
      const owned = voices.find((v) => ["cloned", "generated", "professional"].includes(v.category ?? ""));
      const pick = owned?.voice_id || voices[0]?.voice_id;
      if (pick) { cachedVoiceId = pick; return pick; }
    }
  } catch { /* fall through */ }
  return "21m00Tcm4TlvDq8ikWAM"; // last resort (works on paid plans)
}

// Text → speech (mp3 Buffer). Prefers ElevenLabs; falls back to OpenAI-compatible
// TTS using the active AI Core provider. Returns null if no voice is available.
// `ctx` (optional) meters the synthesized characters against the org (fail-open).
export async function ttsMp3(org: string, text: string, ctx?: UsageContext): Promise<Buffer | null> {
  const t = (text ?? "").toString().slice(0, 5000).trim();
  if (!t) return null;

  const el = await getIntegrationValues(org, "elevenlabs");
  if (el?.apiKey?.trim()) {
    const voice = await resolveElevenVoiceId(el.apiKey.trim(), el.voiceId);
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
        method: "POST",
        headers: { "xi-api-key": el.apiKey.trim(), "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text: t, model_id: "eleven_turbo_v2_5" }),
      });
      if (r.ok) {
        void recordTtsChars(ctx ?? {}, t.length, { provider: "elevenlabs", voice });
        return Buffer.from(await r.arrayBuffer());
      }
    } catch { /* fall through */ }
  }

  const p = await getActiveProvider(org);
  if (p?.api_key) {
    try {
      const r = await fetch(`${p.base_url.replace(/\/$/, "")}/audio/speech`, {
        method: "POST",
        headers: { authorization: `Bearer ${p.api_key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: t, response_format: "mp3" }),
      });
      if (r.ok) {
        void recordTtsChars(ctx ?? {}, t.length, { provider: "openai", model: "gpt-4o-mini-tts" });
        return Buffer.from(await r.arrayBuffer());
      }
    } catch { /* fall through */ }
  }
  return null;
}
