import { request, type Dispatcher } from "undici";
import { one } from "../db/pool.js";
import { config } from "../config.js";
import { recordLlmUsage, estimateTokens, type UsageContext } from "./metering.js";

// A stored OpenAI-compatible provider (row shape). The api_key never leaves the
// server except as a masked last-4 in the API layer.
export interface AiProviderRow {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  active: boolean;
}

// Options for the chat helpers (Phase 3):
//   model — override the provider's model (used to route non-live work to a
//           cheaper tier; see cheapModel()).
//   ctx   — org/agent/call context so the LLM cost is metered against the org.
//   kind  — free-form label recorded on the usage event (e.g. "extraction").
export interface ChatOpts {
  model?: string;
  ctx?: UsageContext;
  kind?: string;
}

const trimBase = (base: string) => base.replace(/\/+$/, "");
const joinUrl = (base: string, path: string) => `${trimBase(base)}${path}`;

/**
 * The model to use for NON-LIVE back-office work (extraction, persona-compile,
 * verify, redteam, playbook analysis). Returns the configured cheap tier when
 * set, else the provider's own model (no behavior change). The live realtime
 * call never calls this — it keeps the high-quality model.
 */
export function cheapModel(p: AiProviderRow): string {
  return config.models.cheapTier || p.model;
}

// The platform's default tenant. Orgs that have not configured their OWN model
// provider fall back to this org's active provider, so every self-serve org gets
// a working model out of the box (the platform provides the model, COGS-metered).
// Override with PLATFORM_ORG_ID if the operator tenant is not org_legacy.
const PLATFORM_ORG = (process.env.PLATFORM_ORG_ID ?? "org_legacy").trim();

async function activeProviderForOrg(org: string): Promise<AiProviderRow | null> {
  return (await one<AiProviderRow>(`SELECT * FROM ai_providers WHERE org_id = $1 AND active = true ORDER BY created_at DESC LIMIT 1`, [org])) ?? null;
}

/**
 * The model provider the given org should use. Prefers the org's OWN active
 * provider (a tenant that set its own key/model in AI Core); if it has none,
 * falls back to the PLATFORM default provider so self-serve orgs work without
 * bringing their own key. Returns null only if neither exists.
 *
 * The customer's own provider always wins, so this never spends a tenant's key
 * for another tenant — the only shared key is the platform's own default.
 */
export async function getActiveProvider(org: string): Promise<AiProviderRow | null> {
  const own = await activeProviderForOrg(org);
  if (own) return own;
  if (org !== PLATFORM_ORG) {
    const platform = await activeProviderForOrg(PLATFORM_ORG);
    if (platform) return platform;
  }
  return null;
}

// Pull a human error message out of an OpenAI-style error body.
function extractErr(text: string): string {
  try {
    const j = JSON.parse(text);
    return j?.error?.message ?? j?.message ?? text.slice(0, 160);
  } catch {
    return text.slice(0, 160);
  }
}

/**
 * Probe a provider end-to-end: first list models (validates key + reachability),
 * then run a 1-token chat completion with the configured model (validates the
 * chat path + that the key actually has access to that model). This mirrors
 * exactly what the Command Center chat does, so a green result means chat works.
 */
export async function testConnection(p: AiProviderRow): Promise<{ ok: boolean; status: number; detail: string }> {
  // 1. models — key + reachability
  try {
    const res = await request(joinUrl(p.base_url, "/models"), {
      method: "GET",
      headers: { authorization: `Bearer ${p.api_key}` },
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
      maxRedirections: 2,
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) {
      return { ok: false, status: res.statusCode, detail: `Key/endpoint rejected (${res.statusCode}): ${extractErr(text)}` };
    }
  } catch (err) {
    return { ok: false, status: 0, detail: `Unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 2. a real (tiny) chat completion — validates the model + chat path.
  // NOTE: no max_tokens cap — newer OpenAI models (GPT-5.x / o-series) reject
  // `max_tokens` (require `max_completion_tokens`), and other OpenAI-compatible
  // providers may not know `max_completion_tokens`. Omitting the cap works for
  // all of them; a one-word "ping" reply is cheap regardless. The real chat path
  // (streamProviderChat/completeProviderChat) already sends no cap, so this
  // mirrors exactly what production chat does.
  try {
    const res = await request(joinUrl(p.base_url, "/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${p.api_key}` },
      body: JSON.stringify({ model: p.model, messages: [{ role: "user", content: "ping" }], stream: false }),
      headersTimeout: 30_000,
      bodyTimeout: 30_000,
      maxRedirections: 2,
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) {
      return { ok: false, status: res.statusCode, detail: `Chat failed (${res.statusCode}): ${extractErr(text)}` };
    }
    return { ok: true, status: 200, detail: `Connected — chat works with ${p.model}` };
  } catch (err) {
    return { ok: false, status: 0, detail: `Chat error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Stream an OpenAI-compatible chat completion from the provider. Returns the
 * raw undici response so the caller can relay the SSE body byte-for-byte (the
 * browser's stream parser already understands the OpenAI chunk format).
 *
 * NOTE: token usage is NOT metered here — the body is relayed byte-for-byte and
 * we must not perturb it. Callers that need the streamed reply metered can
 * estimate tokens from the messages + accumulated text and call recordLlmUsage.
 */
export async function streamProviderChat(
  p: AiProviderRow,
  messages: Array<{ role: string; content: string }>,
  opts?: ChatOpts,
): Promise<Dispatcher.ResponseData> {
  return request(joinUrl(p.base_url, "/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${p.api_key}`,
    },
    body: JSON.stringify({ model: opts?.model || p.model, messages, stream: true }),
    headersTimeout: 120_000,
    bodyTimeout: 600_000,
    maxRedirections: 2,
  });
}

/** Non-streaming completion (single JSON reply). Meters LLM token usage. */
export async function completeProviderChat(
  p: AiProviderRow,
  messages: Array<{ role: string; content: string }>,
  opts?: ChatOpts,
): Promise<{ ok: boolean; content: string }> {
  const model = opts?.model || p.model;
  try {
    const res = await request(joinUrl(p.base_url, "/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${p.api_key}` },
      body: JSON.stringify({ model, messages, stream: false }),
      headersTimeout: 120_000,
      bodyTimeout: 300_000,
      maxRedirections: 2,
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) return { ok: false, content: "" };
    const j = JSON.parse(text);
    const content = j?.choices?.[0]?.message?.content ?? "";
    // Meter tokens (fail-open inside recordLlmUsage). Prefer provider-reported
    // usage; fall back to a char/4 estimate when it is omitted.
    const u = j?.usage ?? {};
    const tokensIn = Number(u.prompt_tokens ?? u.input_tokens ?? estimateTokens(messages.map((m) => m.content).join("\n")));
    const tokensOut = Number(u.completion_tokens ?? u.output_tokens ?? estimateTokens(content));
    void recordLlmUsage(opts?.ctx ?? {}, tokensIn, tokensOut, { model, kind: opts?.kind, estimated: j?.usage == null });
    return { ok: true, content };
  } catch {
    return { ok: false, content: "" };
  }
}
