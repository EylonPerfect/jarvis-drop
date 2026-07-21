import type { FastifyInstance } from "fastify";
import { getIntegrationValues, getIntegrationSource } from "./integrations.js";
import { getActiveProvider } from "../lib/providers.js";
import { orgId, newId } from "../lib/auth.js";
import { resolveElevenVoiceId } from "../lib/tts.js";
import { one, query } from "../db/pool.js";

// Server-side voice so an agent can actually SPEAK (demos, calls). Prefers
// ElevenLabs when connected; otherwise falls back to OpenAI-compatible TTS using
// the active AI Core provider's key (so voice works with the model key you
// already have — no extra credential needed). Returns audio/mpeg.
const OA_DEFAULT_VOICE = "alloy"; // OpenAI TTS

// 10-min voice-library cache — module scope so other routes can bust it (the
// fathom clone-voice endpoint must make its freshly created voice visible to
// the wizard's picker refresh immediately).
// Cache the RAW ElevenLabs voice library PER account key — different accounts
// (a customer's own key vs the platform key) must never share a cache entry, and
// the org-specific visibility filter is applied per-request AFTER the cache.
type CachedVoice = { id: string; name: string; tagline: string; gender: string; accent: string; age: string; category: string; previewUrl: string };
const voiceCache = new Map<string, { at: number; voices: CachedVoice[] }>();
export function bustVoiceCache(): void { voiceCache.clear(); }

export default async function voiceRoutes(app: FastifyInstance) {
  // Reports whether voice is available and via which provider (no keys exposed).
  app.get("/api/voice/status", async (req) => {
    const el = await getIntegrationValues(orgId(req), "elevenlabs");
    if (el?.apiKey) return { connected: true, provider: "elevenlabs", voiceId: await resolveElevenVoiceId(el.apiKey, el.voiceId) };
    const p = await getActiveProvider(orgId(req));
    if (p) return { connected: true, provider: "openai", voiceId: OA_DEFAULT_VOICE };
    return { connected: false, provider: "none", voiceId: OA_DEFAULT_VOICE };
  });

  // The ElevenLabs voice library for the picker. VISIBILITY: when this org rides
  // the SHARED platform key (self-serve fallback), the account holds voices cloned
  // by MANY orgs — so show only ElevenLabs template (premade) voices + THIS org's
  // OWN cloned voices (from the ownership ledger), never another org's clone. When
  // the org uses its OWN key, the account is theirs, so show everything.
  app.get("/api/voice/options", async (req) => {
    const org = orgId(req);
    const src = await getIntegrationSource(org, "elevenlabs");
    const apiKey = src?.values?.apiKey?.trim();
    if (!apiKey) return { voices: [], connected: false };
    const sharedAccount = src!.viaOrg !== org; // platform fallback => filter to own + templates
    let ownVoiceIds: Set<string> | null = null;
    if (sharedAccount) {
      const rows = await query<{ voice_id: string }>(`SELECT voice_id FROM cloned_voices WHERE org_id=$1`, [org]);
      ownVoiceIds = new Set(rows.map((r) => r.voice_id));
    }
    try {
      let cached = voiceCache.get(apiKey);
      if (!cached || Date.now() - cached.at >= 10 * 60_000) {
        const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey } });
        if (!r.ok) return { voices: [], connected: true, error: `ElevenLabs error (${r.status})` };
        const j = (await r.json()) as { voices?: { voice_id?: string; name?: string; category?: string; preview_url?: string; labels?: Record<string, string> }[] };
        const mapped: CachedVoice[] = (Array.isArray(j.voices) ? j.voices : []).map((v) => {
          const [name, tagline] = String(v.name || "").split(/\s+-\s+/);
          const l = v.labels || {};
          return {
            id: v.voice_id || "", name: name || v.voice_id || "", tagline: tagline || "",
            gender: l.gender || "", accent: l.accent || "", age: (l.age || "").replace(/_/g, " "),
            category: v.category || "", previewUrl: v.preview_url || "",
          };
        }).filter((v) => v.id);
        cached = { at: Date.now(), voices: mapped };
        voiceCache.set(apiKey, cached);
      }
      const voices = cached.voices
        .filter((v) => !ownVoiceIds || v.category === "premade" || ownVoiceIds.has(v.id))
        // custom (cloned/generated/professional) voices first, then the library
        .sort((a, b) => Number(a.category === "premade") - Number(b.category === "premade"));
      return { voices, connected: true };
    } catch (e) {
      return { voices: [], connected: true, error: `Could not reach ElevenLabs: ${(e as Error).message}` };
    }
  });

  // VOICE SOURCE (feature 3) — the RECOMMENDED DEFAULT: a clean 60-90s sample the
  // rep records/uploads in the wizard, fed straight to ElevenLabs INSTANT cloning.
  // Auto-extract-from-calls (/api/fathom/clone-voice) is the zero-friction FALLBACK.
  // Both write ONE canonical "<name> — real voice" per clone (replace, never
  // accumulate), so whichever source built it last is the clone's real voice.
  // Consent stays on T&C — recording one's own sample is itself consent.
  // Larger bodyLimit: a 90s mp3 as base64 is ~2MB, over Fastify's 1MB default.
  app.post("/api/voice/clone-sample", { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const b = (req.body ?? {}) as { agentId?: string; audioBase64?: string; mime?: string; seconds?: number };
    if (!b.agentId) return reply.code(400).send({ error: "agentId required" });
    const agent = await one<{ id: string; name: string }>(`SELECT id, name FROM agents WHERE id=$1 AND org_id=$2`, [b.agentId, orgId(req)]);
    if (!agent) return reply.code(404).send({ error: "agent not found" });
    const raw = (b.audioBase64 ?? "").replace(/^data:[^;]+;base64,/, "").trim();
    if (!raw) return reply.code(400).send({ error: "audioBase64 required (record or upload a 60–90s clean sample)" });
    let sample: Buffer;
    try { sample = Buffer.from(raw, "base64"); } catch { return reply.code(400).send({ error: "could not decode the audio sample" }); }
    if (sample.length < 40_000) return reply.code(400).send({ error: "that sample is too short — record about 60–90 seconds of clean speech" });
    if (sample.length > 11 * 1024 * 1024) return reply.code(400).send({ error: "that sample is too large — keep it under ~90 seconds" });

    const elSrc = await getIntegrationSource(orgId(req), "elevenlabs");
    const elKey = elSrc?.values?.apiKey?.trim();
    if (!elKey) return reply.code(400).send({ error: "ElevenLabs is not connected — add the API key in Integrations" });

    // Tier guard — surface plan problems verbatim before uploading.
    const subR = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": elKey } });
    if (!subR.ok) return reply.code(502).send({ error: `ElevenLabs subscription check failed (${subR.status}): ${(await subR.text().catch(() => "")).slice(0, 200)}` });
    const sub = (await subR.json()) as { tier?: string; can_use_instant_voice_cloning?: boolean };
    if (!sub.can_use_instant_voice_cloning) return reply.code(400).send({ error: `Your ElevenLabs plan ("${sub.tier ?? "unknown"}") cannot use instant voice cloning — upgrade the plan and retry.` });

    // Idempotency: ONE "<name> — real voice" per agent — replace, never accumulate.
    const voiceName = `${agent.name} — real voice`;
    const lv = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": elKey } });
    if (lv.ok) {
      const vj = (await lv.json()) as { voices?: { voice_id: string; name?: string }[] };
      for (const v of vj.voices ?? []) {
        if ((v.name || "") === voiceName) {
          await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(v.voice_id)}`, { method: "DELETE", headers: { "xi-api-key": elKey } }).catch(() => { /* add still proceeds */ });
        }
      }
    }

    const mime = (b.mime || "audio/mpeg").split(";")[0].trim();
    const ext = mime.includes("wav") ? "wav" : mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : "mp3";
    const form = new FormData();
    form.append("name", voiceName);
    form.append("files", new Blob([new Uint8Array(sample)], { type: mime }), `clean-sample.${ext}`);
    const addR = await fetch("https://api.elevenlabs.io/v1/voices/add", { method: "POST", headers: { "xi-api-key": elKey }, body: form });
    if (!addR.ok) return reply.code(502).send({ error: `ElevenLabs voice add failed (${addR.status}): ${(await addR.text().catch(() => "")).slice(0, 300)}` });
    const added = (await addR.json()) as { voice_id?: string };
    if (!added.voice_id) return reply.code(502).send({ error: "ElevenLabs returned no voice_id" });
    // OWNERSHIP LEDGER: record the voice WE created + the key-org that made it,
    // so org/clone deletion can revoke exactly this biometric (and only ours).
    await query(`DELETE FROM cloned_voices WHERE org_id=$1 AND agent_id=$2`, [orgId(req), b.agentId]).catch(() => {});
    await query(
      `INSERT INTO cloned_voices (id, org_id, agent_id, voice_id, via_org) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (voice_id) DO NOTHING`,
      [newId("cv"), orgId(req), b.agentId, added.voice_id, elSrc?.viaOrg ?? orgId(req)],
    ).catch(() => {});
    bustVoiceCache(); // the wizard's picker refresh must see the new voice immediately
    app.log.info({ agentId: b.agentId, voiceId: added.voice_id, bytes: sample.length, source: "clean-sample" }, "real voice cloned from clean sample");
    return { voiceId: added.voice_id, name: voiceName, sampleSeconds: Math.round(Number(b.seconds) || 0) || undefined, source: "clean-sample" };
  });

  app.post("/api/voice/speak", async (req, reply) => {
    const body = (req.body ?? {}) as { text?: string; voiceId?: string };
    const text = (body.text ?? "").toString().slice(0, 5000).trim();
    if (!text) return reply.code(400).send({ error: "text required" });

    // 1) ElevenLabs (best quality) when connected — but if it FAILS (quota,
    // auth, outage), fall through to the provider TTS instead of going silent.
    const el = await getIntegrationValues(orgId(req), "elevenlabs");
    if (el?.apiKey?.trim()) {
      const voiceId = await resolveElevenVoiceId(el.apiKey.trim(), body.voiceId?.trim() || el.voiceId);
      try {
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
          method: "POST",
          headers: { "xi-api-key": el.apiKey.trim(), "content-type": "application/json", accept: "audio/mpeg" },
          body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.4, similarity_boost: 0.75 } }),
        });
        if (r.ok) { reply.header("content-type", "audio/mpeg").header("cache-control", "no-store"); return reply.send(Buffer.from(await r.arrayBuffer())); }
        const detail = await r.text().catch(() => "");
        app.log.warn({ status: r.status, detail: detail.slice(0, 160) }, "elevenlabs tts failed — falling back to provider tts");
      } catch (e) {
        app.log.warn({ err: (e as Error).message }, "elevenlabs unreachable — falling back to provider tts");
      }
    }

    // 2) Fall back to OpenAI-compatible TTS using the active AI Core provider key.
    const p = await getActiveProvider(orgId(req));
    if (p?.api_key) {
      const base = p.base_url.replace(/\/$/, "");
      // body.voiceId is usually an ElevenLabs id — only pass through voices OpenAI knows
      const OA_VOICES = ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "marin"];
      const voice = OA_VOICES.includes((body.voiceId ?? "").trim()) ? (body.voiceId ?? "").trim() : OA_DEFAULT_VOICE;
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
