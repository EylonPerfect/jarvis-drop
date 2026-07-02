import { request, type Dispatcher } from "undici";
import { one } from "../db/pool.js";

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

const trimBase = (base: string) => base.replace(/\/+$/, "");
const joinUrl = (base: string, path: string) => `${trimBase(base)}${path}`;

/** The provider the Command Center chat should use, if the operator set one. */
export async function getActiveProvider(): Promise<AiProviderRow | null> {
  return (await one<AiProviderRow>(`SELECT * FROM ai_providers WHERE active = true ORDER BY created_at DESC LIMIT 1`)) ?? null;
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

  // 2. a real (tiny) chat completion — validates the model + chat path
  try {
    const res = await request(joinUrl(p.base_url, "/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${p.api_key}` },
      body: JSON.stringify({ model: p.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
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
 */
export async function streamProviderChat(
  p: AiProviderRow,
  messages: Array<{ role: string; content: string }>,
): Promise<Dispatcher.ResponseData> {
  return request(joinUrl(p.base_url, "/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${p.api_key}`,
    },
    body: JSON.stringify({ model: p.model, messages, stream: true }),
    headersTimeout: 120_000,
    bodyTimeout: 600_000,
    maxRedirections: 2,
  });
}

/** Non-streaming completion (single JSON reply). */
export async function completeProviderChat(
  p: AiProviderRow,
  messages: Array<{ role: string; content: string }>,
): Promise<{ ok: boolean; content: string }> {
  try {
    const res = await request(joinUrl(p.base_url, "/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${p.api_key}` },
      body: JSON.stringify({ model: p.model, messages, stream: false }),
      headersTimeout: 120_000,
      bodyTimeout: 300_000,
      maxRedirections: 2,
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) return { ok: false, content: "" };
    const j = JSON.parse(text);
    return { ok: true, content: j?.choices?.[0]?.message?.content ?? "" };
  } catch {
    return { ok: false, content: "" };
  }
}
