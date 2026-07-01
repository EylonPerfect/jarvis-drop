import type { FastifyInstance, FastifyReply } from "fastify";
import { hermes, diagnose } from "../hermes.js";
import { config } from "../config.js";
import type { ChatRequest } from "@jarvis/shared";

// Per-mode system prompt layered on top of hermes' core prompt.
const MODE_SYSTEM: Record<string, string> = {
  Compose: "You are in Compose mode. Write and structure content clearly and concisely.",
  Research: "You are in Research mode. Do a deep pass and cite the strongest findings.",
  Execute: "You are in Execute mode. Run and automate; report each tool call as you go.",
  Debug: "You are in Debug mode. Reproduce, isolate the failing module, and fix.",
  Brainstorm: "You are in Brainstorm mode. Offer several angles ranked by effort vs. impact.",
};

// Offline fallback replies (mirror the prototype so the UI still works with
// no live gateway). Sent as OpenAI-style SSE so the client reader is uniform.
const FALLBACK: Record<string, string> = {
  Compose: "Drafting now — I'll structure it in three sections and surface it in the Compose panel.",
  Research: "Running a deep pass across your sources. I'll cite the top findings with latency notes.",
  Execute: "Queuing the workflow. I'll report each tool call in the Live Action Ledger as it runs.",
  Debug: "Reproducing the issue against the last known-good build. Isolating the failing module now.",
  Brainstorm: "Here are three angles to explore — I'll rank them by effort vs. impact.",
  default: "Understood, Commander. Working on it — I'll keep the reasoning visible as I go. (hermes gateway offline — this is a local fallback.)",
};

// hijack() bypasses the global onSend hook, so set the baseline headers here too.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "SAMEORIGIN",
} as const;

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

async function streamFallback(reply: FastifyReply, mode: string | null | undefined) {
  const text = FALLBACK[mode ?? ""] ?? FALLBACK.default;
  reply.raw.write(sseChunk(text));
  reply.raw.write("data: [DONE]\n\n");
  reply.raw.end();
}

export default async function chatRoutes(app: FastifyInstance) {
  // Connectivity diagnosis — pins down WHY live chat is falling back. Gated by
  // the same BFF auth as everything else; returns no secrets.
  app.get("/api/chat/diag", async () => {
    return diagnose();
  });

  app.post("/api/chat/stream", async (req, reply) => {
    const b = req.body as ChatRequest;
    const message = (b?.message ?? "").trim();

    // Take over the socket so Fastify doesn't try to send()/serialize the reply.
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...SECURITY_HEADERS,
    });

    if (!message) {
      reply.raw.write(sseChunk(""));
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
      return;
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (b.mode && MODE_SYSTEM[b.mode]) messages.push({ role: "system", content: MODE_SYSTEM[b.mode] });
    messages.push({ role: "user", content: message });

    const body = { model: config.hermes.model, messages, stream: true };
    // X-Hermes-Session-Key is the stable per-operator long-term-memory scope
    // (config default), NOT a per-conversation id — don't override it here.
    const result = await hermes.chatStream(body);

    if (!result.ok || !result.stream) {
      app.log.warn({ err: result.error }, "hermes chat unreachable — using fallback");
      return streamFallback(reply, b.mode);
    }

    try {
      for await (const buf of result.stream) {
        reply.raw.write(buf);
      }
      reply.raw.end();
    } catch (err) {
      app.log.error({ err }, "hermes stream error");
      if (!reply.raw.writableEnded) {
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
      }
    }
  });

  // Non-streaming send (used when the caller prefers a single JSON reply).
  app.post("/api/chat", async (req) => {
    const b = req.body as ChatRequest;
    const message = (b?.message ?? "").trim();
    if (!message) return { reply: "" };
    const messages: Array<{ role: string; content: string }> = [];
    if (b.mode && MODE_SYSTEM[b.mode]) messages.push({ role: "system", content: MODE_SYSTEM[b.mode] });
    messages.push({ role: "user", content: message });

    const r = await hermes.post<any>("/v1/chat/completions", { model: config.hermes.model, messages, stream: false });
    if (r.ok && r.data?.choices?.[0]?.message?.content) {
      return { reply: r.data.choices[0].message.content, sessionId: b.sessionId ?? null };
    }
    return { reply: FALLBACK[b.mode ?? ""] ?? FALLBACK.default, sessionId: b.sessionId ?? null, offline: true };
  });
}
