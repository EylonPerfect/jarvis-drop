import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { hermes } from "../hermes.js";
import { getConnectedIntegrationIds } from "./integrations.js";
import { getActiveProvider, completeProviderChat } from "../lib/providers.js";
import { orgId } from "../lib/auth.js";
import { getSetting } from "../lib/settingsStore.js";
import type { FeedItem, CommandResult } from "@jarvis/shared";

// Commands that need real tool execution (web, browser, sending, scheduling,
// live data, running agents) go to Hermes. Everything else — questions about the
// system and pure content drafting — is answered instantly by the grounded model.
const TOOL_ACTION = /\b(research|browse|open|go to|navigate|visit|search the web|look ?up|scrape|fetch|pull|download|upload|screenshot|send|post|message|dm|email|notify|deploy|launch|schedule|book|remind|run |execute|monitor|check (the|my|our|for|on)|log ?in|sign ?in|crawl|call )\b/i;

// Strip ANSI + box-drawing noise and return the last meaningful line of a log —
// a short "what it's doing right now" hint.
function progressFromLog(log: string): string {
  const clean = log
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/[─-╿▀-▟■-◿⚙]/g, "")
    .split("\n").map((l) => l.trim()).filter((l) => l.length > 2 && !/^[-─┊|]+$/.test(l));
  const last = clean[clean.length - 1] ?? "";
  return last.slice(0, 160);
}

// Build a system prompt grounded in THIS system's live state — what's connected
// to the Hermes agent, which integrations have credentials, the agent roster,
// and the app's capabilities — so the Command Center is not a generic chatbot.
async function systemContext(org: string): Promise<string> {
  const [status, connected, agents] = await Promise.all([
    hermes.get<{ version?: string }>("/api/status"),
    getConnectedIntegrationIds(org),
    query<{ name: string; role: string; status: string }>(`SELECT name, role, status FROM agents WHERE org_id = $1 ORDER BY sort, created_at`, [org]).catch(() => []),
  ]);
  const hermesUp = status.ok && !!status.data && typeof status.data === "object";
  const conn = [...connected];
  const roster = (agents as { name: string; role: string; status: string }[]).map((a) => `${a.name} — ${a.role}${a.status === "optimal" ? " (deployed)" : ""}`);
  return [
    "You are After Human, the operator's Command Center. You are NOT a generic assistant — you operate THIS system and know its live state. Speak concisely, like a capable chief of staff.",
    `Hermes agent runtime: ${hermesUp ? "ONLINE" : "offline"}. Through Hermes you can actually DO work with these tools: live web search, a headless browser, terminal/shell, code execution, vision, image generation, text-to-speech, long-term memory, and cron scheduling. Use them to complete the operator's request and report the concrete result.`,
    conn.length ? `Connected integrations (credentials stored, usable): ${conn.join(", ")}.` : "No external integrations are connected yet — Slack/Gmail/Calendar/etc. can be connected on the Integrations screen.",
    roster.length ? `Agents on the roster: ${roster.join("; ")}.` : "No agents have been created yet.",
    "System capabilities you can explain and help the operator use: create / deploy / run agents (each runs on Hermes with tools + memory), per-department Artifacts with KPIs, the Integrations credential store, the humans+agents org chart, per-agent Run history, voice, and opening a live server-side browser.",
    "If the operator asks for something that needs a credential or capability that isn't connected, say exactly what to connect and where. Never pretend an action happened if it didn't.",
  ].join("\n");
}

export default async function commandRoutes(app: FastifyInstance) {
  app.get("/api/command/feed", async (req): Promise<FeedItem[]> => {
    return (await getSetting<FeedItem[]>(orgId(req), "feed")) ?? [];
  });

  // "Act" mode. Questions + drafting → instant grounded answer from the model.
  // Real tasks → dispatched to the Hermes runtime (tools/memory); returns a
  // taskId immediately so the client can show live progress via /status.
  app.post("/api/command/run", async (req): Promise<CommandResult> => {
    const text = ((req.body as { text?: string })?.text ?? "").toString().trim();
    if (!text) return { ok: false, via: "none", status: "failed", detail: "empty command" };
    const system = await systemContext(orgId(req));
    const needsTools = TOOL_ACTION.test(text);

    // Fast path: questions / drafting → grounded model answer, right now.
    if (!needsTools) {
      const active = await getActiveProvider(orgId(req));
      if (active) {
        const r = await completeProviderChat(active, [ { role: "system", content: system }, { role: "user", content: text } ]);
        if (r.ok && r.content) return { ok: true, via: "provider", status: "done", output: r.content };
      }
      // No provider — fall through to Hermes.
    }

    // Task path: dispatch to Hermes and return immediately (client polls /status).
    try {
      const create = await hermes.post<{ task?: { id?: string } }>("/api/plugins/kanban/tasks", {
        title: `Command: ${text.slice(0, 60)}`,
        body: `${system}\n\n--- OPERATOR COMMAND ---\n${text}\n\n--- OUTPUT REQUIREMENT ---\nReply with the answer or the result of the work itself — concise and natural to be read aloud. Not a description of what you did.`,
        assignee: "default",
        max_runtime_seconds: 600,
      });
      const tid = create.data?.task?.id;
      if (create.ok && tid) return { ok: true, via: "hermes", status: "running", taskId: tid, progress: "Dispatched to Hermes…" };
    } catch { /* fall through */ }

    // Last resort: grounded provider answer even for a tool request.
    const active = await getActiveProvider(orgId(req));
    if (active) {
      const r = await completeProviderChat(active, [ { role: "system", content: system }, { role: "user", content: text } ]);
      if (r.ok && r.content) return { ok: true, via: "provider", status: "done", output: r.content };
    }
    return { ok: false, via: "none", status: "failed", detail: "No runtime available — connect a model in AI Core or start the Hermes gateway." };
  });

  // Poll a running Hermes command for live progress + the final result.
  app.post("/api/command/status", async (req): Promise<CommandResult> => {
    const tid = ((req.body as { taskId?: string })?.taskId ?? "").toString().trim();
    if (!tid) return { ok: false, via: "hermes", status: "failed", detail: "missing taskId" };
    try {
      const g = await hermes.get<{ task?: Record<string, unknown> }>(`/api/plugins/kanban/tasks/${tid}`);
      const t = (g.data?.task ?? g.data) as Record<string, unknown> | undefined;
      const st = t?.status as string | undefined;
      if (st === "done") return { ok: true, via: "hermes", status: "done", output: String(t?.latest_summary || t?.result || "Done.") };
      if (st === "blocked" || st === "failed" || st === "error") return { ok: false, via: "hermes", status: "failed", detail: String(t?.latest_summary || `Hermes task ${st}`) };
      // Still running — surface a live progress hint from the task log.
      let progress = "Working…";
      try {
        const l = await hermes.get<{ content?: string }>(`/api/plugins/kanban/tasks/${tid}/log`);
        const p = progressFromLog(l.data?.content ?? "");
        if (p) progress = p;
      } catch { /* keep default */ }
      return { ok: true, via: "hermes", status: "running", taskId: tid, progress };
    } catch (e) {
      return { ok: false, via: "hermes", status: "failed", detail: `Could not reach Hermes: ${(e as Error).message}` };
    }
  });
}
