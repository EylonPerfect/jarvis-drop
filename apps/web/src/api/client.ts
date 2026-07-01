// Same-origin by default (production: Nginx/BFF serve web + /api together).
// In dev, set VITE_API_BASE=http://localhost:8787 in .env to reach the BFF.
const BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
// Optional BFF auth key. In an Nginx-fronted deploy the proxy injects the key so
// the browser needn't hold it; set this only for the single-process/dev path.
const API_KEY = import.meta.env.VITE_BFF_API_KEY;
const authHeaders = (): Record<string, string> => (API_KEY ? { "X-API-Key": API_KEY } : {});

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => j<T>(path),
  post: <T>(path: string, body?: unknown) => j<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => j<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => j<T>(path, { method: "DELETE" }),
  base: BASE,
};

/**
 * Stream a chat turn from the BFF (which relays hermes SSE). Calls onDelta for
 * each token chunk; resolves when the stream ends. Parses OpenAI-style chunks
 * plus [DONE]. Tolerates hermes' extra hermes.tool.progress events (ignored).
 */
export async function streamChat(
  body: { message: string; mode?: string | null; sessionId?: string | null },
  onDelta: (text: string) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeaders() },
    body: JSON.stringify(body),
  });
  // Throw on HTTP errors so the caller shows its error fallback (an error
  // response has a body too, so checking res.body alone isn't enough).
  if (!res.ok) throw new Error(`chat/stream → ${res.status}`);
  if (!res.body) throw new Error("no stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE-spec-tolerant framing: events split on blank line (CRLF or LF).
    const events = buf.split(/\r\n\r\n|\r\r|\n\n/);
    buf = events.pop() ?? "";
    for (const evt of events) {
      const line = evt.split(/\r\n|\r|\n/).find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const obj = JSON.parse(payload);
        const delta =
          obj?.choices?.[0]?.delta?.content ??
          obj?.choices?.[0]?.message?.content ??
          obj?.delta ??
          (obj?.type === "response.output_text.delta" ? obj.delta : "");
        if (typeof delta === "string" && delta) onDelta(delta);
      } catch {
        /* ignore non-JSON keep-alives / progress events */
      }
    }
  }
}
