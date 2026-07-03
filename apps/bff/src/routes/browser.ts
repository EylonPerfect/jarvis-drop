import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

// Real server-side browser: the Command Center drives a headless Chrome running
// on the VPS (browserless) to actually open pages and stream them into the UI.
// The screenshot endpoint renders the live page server-side and relays the image.

function normalizeUrl(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "https://www.google.com";
  if (/^https?:\/\//i.test(s)) return s;
  // Looks like a domain → https://; otherwise treat as a Google search.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

// Per-agent browser sessions: each agent has its own current page. The
// Command Center (no agent) uses the shared "operator" session. Keyed by an
// `agent` id passed on the request; falls back to "operator" for back-compat.
const DEFAULT_SESSION = "operator";
const sessions = new Map<string, string>();
const sessionOf = (agent?: string) => (agent && agent.trim() ? agent.trim() : DEFAULT_SESSION);
const getUrl = (agent?: string) => sessions.get(sessionOf(agent)) ?? "https://www.google.com";
const setUrl = (agent: string | undefined, url: string) => { sessions.set(sessionOf(agent), url); return url; };

export default async function browserRoutes(app: FastifyInstance) {
  const shotEndpoint = () => `${config.browserless.url}/screenshot?token=${encodeURIComponent(config.browserless.token)}`;

  // Set the page to show (from an "open a browser / go to X" command).
  app.post("/api/browser/open", async (req) => {
    const b = req.body as { url?: string; agent?: string };
    const url = setUrl(b?.agent, normalizeUrl(b?.url ?? ""));
    return { ok: true, url, agent: sessionOf(b?.agent) };
  });

  app.get("/api/browser/state", async (req) => {
    const q = req.query as { agent?: string };
    return { url: getUrl(q?.agent), agent: sessionOf(q?.agent) };
  });

  // Live view: render the current (or ?url=) page on the VPS Chrome and relay
  // the image. The UI polls this to show the page live.
  app.get("/api/browser/screenshot", async (req, reply) => {
    const q = req.query as { url?: string; agent?: string };
    const url = q?.url ? normalizeUrl(q.url) : getUrl(q?.agent);
    setUrl(q?.agent, url);
    try {
      const r = await fetch(shotEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          viewport: { width: 1280, height: 800 },
          gotoOptions: { waitUntil: "networkidle2", timeout: 20000 },
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        return reply.code(502).send({ error: `browser render failed (${r.status})`, detail: t.slice(0, 200) });
      }
      const buf = Buffer.from(await r.arrayBuffer());
      return reply
        .header("Content-Type", r.headers.get("content-type") || "image/png")
        .header("Cache-Control", "no-store")
        .send(buf);
    } catch (e) {
      return reply.code(502).send({ error: "browser unreachable", detail: e instanceof Error ? e.message : String(e) });
    }
  });
}
