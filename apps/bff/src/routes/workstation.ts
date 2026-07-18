import type { FastifyInstance } from "fastify";
import { one } from "../db/pool.js";
import { getActiveProvider } from "../lib/providers.js";
import { getCompany } from "./company.js";
import { orgId } from "../lib/auth.js";
import { wsStart, wsScreenshot, wsAct, wsStop, wsHas, wsOpenUrl, type WsAction } from "../lib/workstation.js";
import { getCall, setInFlight, setResult, commitScreen } from "../lib/callstate.js";

const DISPLAY = { width: 1024, height: 768 };

interface RunState { running: boolean; task: string; log: unknown[]; startedAt?: string; error?: string }
const runStates = new Map<string, RunState>();

// Map an OpenAI computer-use action to our E2B workstation action.
function mapAction(a: Record<string, unknown>): WsAction | null {
  const t = a.type as string;
  const x = Math.round(Number(a.x ?? 0));
  const y = Math.round(Number(a.y ?? 0));
  if (t === "click") return { type: "click", x, y };
  if (t === "double_click") return { type: "double_click", x, y };
  if (t === "move" || t === "mouse_move") return { type: "move", x, y };
  if (t === "scroll") { const sy = Number(a.scroll_y ?? 0); return { type: "scroll", amount: sy > 0 ? -3 : 3 }; }
  if (t === "type") return { type: "type", text: String(a.text ?? "") };
  if (t === "keypress") { const keys = Array.isArray(a.keys) ? (a.keys as string[]) : [String(a.keys ?? "")]; return { type: "key", keys }; }
  if (t === "wait") return { type: "wait", ms: 800 };
  return null; // screenshot/drag/other → just re-screenshot
}

function extractText(output: unknown[]): string {
  const parts: string[] = [];
  for (const o of output as Record<string, unknown>[]) {
    if (o.type === "message" && Array.isArray(o.content)) {
      for (const c of o.content as Record<string, unknown>[]) if (typeof c.text === "string") parts.push(c.text);
    }
    if (o.type === "reasoning" && Array.isArray(o.summary)) {
      for (const s of o.summary as Record<string, unknown>[]) if (typeof s.text === "string") parts.push(s.text);
    }
  }
  return parts.join(" ").trim();
}

// The computer-use loop: screenshot → OpenAI decides → act on the E2B desktop →
// repeat, grounded in the agent's own instructions. Bounded for cost/safety.
export interface RunOpts { sink?: unknown[]; callId?: string; confirmMode?: "auto" | "halt" }

export async function runComputerUse(org: string, agentId: string, task: string, maxSteps: number, opts: RunOpts = {}): Promise<{ ok: boolean; error?: string; needsConfirm?: unknown[]; log: unknown[] }> {
  const log: unknown[] = opts.sink ?? [];
  const callId = opts.callId;
  // Tiered verification: OpenAI computer-use raises pending_safety_checks for
  // risky/irreversible actions (logins, purchases, consequential clicks). We run
  // reversible actions optimistically, but for flagged ones we HALT by default
  // (only auto-acknowledge when explicitly allowed) — verify-before-commit.
  const confirmMode = opts.confirmMode ?? "halt";
  const provider = await getActiveProvider(org);
  if (!provider?.api_key || !/openai\.com/i.test(provider.base_url || "")) return { ok: false, error: "Needs an OpenAI provider active in AI Core.", log };
  const start = await wsStart(org, agentId);
  if (!start.ok) return { ok: false, error: start.error, log };

  const agent = await one<{ instructions: string | null; name: string | null; role: string | null }>(`SELECT instructions, name, role FROM agents WHERE id = $1 AND org_id = $2`, [agentId, org]);
  const company = await getCompany(org);
  const persona = agent?.instructions?.trim() || `You are ${agent?.name || "an"} ${agent?.role || "AI teammate"} at ${company.name}.`;
  const preamble = `${persona}\n\nYou are operating YOUR OWN Linux desktop computer (a real browser is available). Accomplish the task by controlling the screen. Be efficient. When done, briefly state what you did.\n\nTASK: ${task}`;

  // Seed the browser: if the task names a URL, open it first so the agent starts
  // on the page (avoids it staring at a blank desktop).
  const urlMatch = task.match(/https?:\/\/[^\s"')]+/);
  if (urlMatch) { const seedUrl = urlMatch[0].replace(/[.,);\]]+$/, ""); const opened = await wsOpenUrl(agentId, seedUrl); log.push({ seed: seedUrl, opened }); if (callId && opened) commitScreen(callId, seedUrl); await new Promise((res) => setTimeout(res, 5000)); }

  const shot0 = await wsScreenshot(agentId);
  if (!shot0) return { ok: false, error: "no screenshot", log };
  let input: unknown[] = [{ role: "user", content: [ { type: "input_text", text: preamble }, { type: "input_image", image_url: `data:image/png;base64,${shot0.toString("base64")}` } ] }];
  let prevId: string | undefined;

  for (let i = 0; i < maxSteps; i++) {
    const body: Record<string, unknown> = {
      model: "computer-use-preview",
      tools: [{ type: "computer_use_preview", display_width: DISPLAY.width, display_height: DISPLAY.height, environment: "linux" }],
      input, truncation: "auto",
      ...(prevId ? { previous_response_id: prevId } : {}),
    };
    const r = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${provider.api_key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json()) as { id?: string; output?: Record<string, unknown>[]; error?: unknown };
    if (!r.ok) return { ok: false, error: `OpenAI ${r.status}: ${JSON.stringify(j).slice(0, 200)}`, log };
    prevId = j.id;
    const output = j.output ?? [];
    const call = output.find((o) => o.type === "computer_call") as Record<string, unknown> | undefined;
    const say = extractText(output);
    if (say) log.push({ step: i, text: say });
    if (!call) { log.push({ done: true }); return { ok: true, log }; }

    const action = (call.action ?? {}) as Record<string, unknown>;
    const pending = (call.pending_safety_checks ?? []) as unknown[];

    // Tiered verification: flagged (risky/irreversible) action + not auto-approved
    // → HALT and surface it for confirmation instead of doing it unattended.
    if (pending.length && confirmMode !== "auto") {
      log.push({ step: i, needsConfirm: true, action: action.type, checks: pending });
      if (callId) setResult(callId, undefined, `paused for confirmation: ${action.type}`);
      return { ok: true, needsConfirm: pending, log };
    }

    log.push({ step: i, action: action.type, x: action.x, y: action.y });
    if (callId) setInFlight(callId, String(action.type), typeof action.text === "string" ? action.text : undefined);
    const mapped = mapAction(action);
    if (mapped) await wsAct(agentId, mapped);
    else await new Promise((res) => setTimeout(res, 400));
    if (callId) { setInFlight(callId, null); setResult(callId, `did ${action.type}`); }

    const shot = await wsScreenshot(agentId);
    input = [{ type: "computer_call_output", call_id: call.call_id, ...(pending.length ? { acknowledged_safety_checks: pending } : {}), output: { type: "input_image", image_url: `data:image/png;base64,${shot ? shot.toString("base64") : ""}` } }];
  }
  return { ok: true, log };
}

// Agent Workstation API — start/stop an agent's E2B desktop, read its screen, and
// perform low-level actions. The computer-use loop + HUD build on these. (Authed;
// operator-only — these are only ever driven from the app behind the login gate.)
export default async function workstationRoutes(app: FastifyInstance) {
  app.post("/api/workstation/:agentId/start", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const r = await wsStart(orgId(req), agentId);
    if (!r.ok) return reply.code(502).send({ error: r.error });
    return r;
  });

  app.get("/api/workstation/:agentId/status", async (req) => {
    const { agentId } = req.params as { agentId: string };
    return { running: wsHas(agentId) };
  });

  app.get("/api/workstation/:agentId/screenshot", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const buf = await wsScreenshot(agentId);
    if (!buf) return reply.code(503).send({ error: "no screenshot (is the workstation started?)" });
    return reply.header("Content-Type", "image/png").header("Cache-Control", "no-store").send(buf);
  });

  app.post("/api/workstation/:agentId/act", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const action = (req.body ?? {}) as WsAction;
    const r = await wsAct(agentId, action);
    if (!r.ok) return reply.code(400).send({ error: r.error });
    return r;
  });

  app.post("/api/workstation/:agentId/stop", async (req) => {
    const { agentId } = req.params as { agentId: string };
    await wsStop(agentId);
    return { ok: true };
  });

  // Give the agent a task; it operates its own desktop (computer-use loop). Runs
  // in the BACKGROUND (takes a minute+) — the UI watches the live stream and
  // polls /run-state for the action log.
  app.post("/api/workstation/:agentId/run", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const b = (req.body ?? {}) as { task?: string; maxSteps?: number };
    const task = (b.task ?? "").toString().trim();
    if (!task) return reply.code(400).send({ error: "task required" });
    if (runStates.get(agentId)?.running) return reply.code(409).send({ error: "A task is already running." });
    const steps = Math.min(30, Math.max(1, b.maxSteps ?? 14));
    const state: RunState = { running: true, task, log: [], startedAt: new Date().toISOString() };
    runStates.set(agentId, state);
    runComputerUse(orgId(req), agentId, task, steps, { sink: state.log })
      .then((r) => { state.running = false; if (!r.ok) state.error = r.error; })
      .catch((e) => { state.running = false; state.error = String(e); });
    return { started: true };
  });

  app.get("/api/workstation/:agentId/run-state", async (req) => {
    const { agentId } = req.params as { agentId: string };
    return runStates.get(agentId) ?? { running: false, task: "", log: [] };
  });
}
