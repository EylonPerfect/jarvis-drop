import type { FastifyInstance } from "fastify";
import { one, query } from "../db/pool.js";
import { hermes } from "../hermes.js";
import { getConnectedIntegrationIds } from "./integrations.js";
import { getActiveProvider, completeProviderChat } from "../lib/providers.js";
import type { FeedItem, AgentRunResult } from "@jarvis/shared";

// Build a system prompt grounded in THIS system's live state — what's connected
// to the Hermes agent, which integrations have credentials, the agent roster,
// and the app's capabilities — so the Command Center is not a generic chatbot.
async function systemContext(): Promise<string> {
  const [status, connected, agents] = await Promise.all([
    hermes.get<{ version?: string }>("/api/status"),
    getConnectedIntegrationIds(),
    query<{ name: string; role: string; status: string }>(`SELECT name, role, status FROM agents ORDER BY sort, created_at`).catch(() => []),
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
  app.get("/api/command/feed", async (): Promise<FeedItem[]> => {
    return (await one<{ value: FeedItem[] }>(`SELECT value FROM settings WHERE key = 'feed'`))?.value ?? [];
  });

  // "Act" mode for the Command Center voice: grounded in the system state and
  // executed ON the Hermes agent runtime (real tools/memory), with a provider
  // fallback for a fast grounded answer when Hermes can't run it.
  app.post("/api/command/run", async (req): Promise<AgentRunResult> => {
    const text = ((req.body as { text?: string })?.text ?? "").toString().trim();
    const at = new Date().toISOString();
    if (!text) return { ok: false, output: "", detail: "empty command", via: "none", at };
    const system = await systemContext();

    // 1) Execute on Hermes (can actually act with tools). Poll briefly.
    try {
      const create = await hermes.post<{ task?: { id?: string } }>("/api/plugins/kanban/tasks", {
        title: `Command: ${text.slice(0, 60)}`,
        body: `${system}\n\n--- OPERATOR COMMAND ---\n${text}\n\n--- OUTPUT REQUIREMENT ---\nReply with the answer or the result of the work itself — concise and natural to be read aloud. Not a description of what you did.`,
        assignee: "default",
        max_runtime_seconds: 600,
      });
      const tid = create.data?.task?.id;
      if (create.ok && tid) {
        const deadline = Date.now() + 75_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 4000));
          const g = await hermes.get<{ task?: Record<string, unknown> }>(`/api/plugins/kanban/tasks/${tid}`);
          const t = (g.data?.task ?? g.data) as Record<string, unknown> | undefined;
          const st = t?.status as string | undefined;
          if (st === "done") return { ok: true, output: String(t?.latest_summary || t?.result || "Done."), via: "hermes", at };
          if (st === "blocked" || st === "failed" || st === "error") break;
        }
        return { ok: true, output: `Working on it on Hermes (task ${tid}). It's taking longer than a moment — it'll finish in the background.`, via: "hermes", at };
      }
    } catch { /* fall through */ }

    // 2) Provider fallback — a fast, grounded answer (no tool execution).
    const active = await getActiveProvider();
    if (active) {
      const r = await completeProviderChat(active, [ { role: "system", content: system }, { role: "user", content: text } ]);
      if (r.ok && r.content) return { ok: true, output: r.content, via: "provider", at };
    }
    return { ok: false, output: "", detail: "No runtime available — connect a model in AI Core or start the Hermes gateway.", via: "none", at };
  });
}
