import { request } from "undici";
import { config } from "./config.js";
import { HERMES_ENDPOINTS } from "@jarvis/shared";

// ------------------------------------------------------------
// Thin server-side client for the NousResearch hermes-agent
// gateway. The Bearer key lives here and NEVER reaches the
// browser. hermes is an agent harness (sub-agents, skills,
// tools+MCP, cross-session memory) driving a swappable model.
// ------------------------------------------------------------

export interface HermesResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

function baseHeaders(sessionKey?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${config.hermes.apiKey}`,
    "Content-Type": "application/json",
  };
  // Stable per-operator key threads long-term memory across turns.
  h["X-Hermes-Session-Key"] = sessionKey ?? config.hermes.sessionKey;
  return h;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  sessionKey?: string,
): Promise<HermesResult<T>> {
  const url = `${config.hermes.baseUrl}${path}`;
  try {
    const res = await request(url, {
      method: method as any,
      headers: baseHeaders(sessionKey),
      body: body === undefined ? undefined : JSON.stringify(body),
      // hermes turns can be long-running; give tool/LLM work room.
      headersTimeout: 120_000,
      bodyTimeout: 300_000,
    });
    const status = res.statusCode;
    const text = await res.body.text();
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = text as unknown as T;
      }
    }
    if (status >= 400) {
      return { ok: false, status, data, error: `hermes ${status}` };
    }
    return { ok: true, status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const hermes = {
  get: <T>(path: string, sessionKey?: string) => call<T>("GET", path, undefined, sessionKey),
  post: <T>(path: string, body?: unknown, sessionKey?: string) => call<T>("POST", path, body, sessionKey),
  patch: <T>(path: string, body?: unknown, sessionKey?: string) => call<T>("PATCH", path, body, sessionKey),
  del: <T>(path: string, sessionKey?: string) => call<T>("DELETE", path, undefined, sessionKey),

  health: () => call<any>("GET", HERMES_ENDPOINTS.health),
  healthDetailed: () => call<any>("GET", HERMES_ENDPOINTS.healthDetailed),
  models: () => call<any>("GET", HERMES_ENDPOINTS.models),
  capabilities: () => call<any>("GET", HERMES_ENDPOINTS.capabilities),
  skills: () => call<any>("GET", HERMES_ENDPOINTS.skills),
  toolsets: () => call<any>("GET", HERMES_ENDPOINTS.toolsets),

  /**
   * Streaming chat. Returns the raw SSE body stream (async iterable of
   * Buffers) plus status so the route can relay it to the browser as SSE.
   * Falls back to `ok:false` if the gateway is unreachable.
   */
  async chatStream(
    body: unknown,
    sessionKey?: string,
  ): Promise<{ ok: boolean; status: number; stream: AsyncIterable<Buffer> | null; error?: string }> {
    const url = `${config.hermes.baseUrl}${HERMES_ENDPOINTS.chatCompletions}`;
    try {
      const res = await request(url, {
        method: "POST",
        headers: { ...baseHeaders(sessionKey), Accept: "text/event-stream" },
        body: JSON.stringify(body),
        headersTimeout: 120_000,
        bodyTimeout: 600_000,
      });
      if (res.statusCode >= 400) {
        const text = await res.body.text();
        return { ok: false, status: res.statusCode, stream: null, error: text || `hermes ${res.statusCode}` };
      }
      return { ok: true, status: res.statusCode, stream: res.body as AsyncIterable<Buffer> };
    } catch (err) {
      return { ok: false, status: 0, stream: null, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

/** Reachability probe used by the health route and status strips. */
export async function hermesReachable(): Promise<boolean> {
  const r = await hermes.health();
  return r.ok;
}
