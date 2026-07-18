import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { one } from "../db/pool.js";
import { getActiveProvider } from "../lib/providers.js";
import { getCompany } from "./company.js";
import { createCall, getCall, groundingFor, addTranscript, endCall } from "../lib/callstate.js";
import { orgId as callerOrg } from "../lib/auth.js";
import { wsStart, wsStop } from "../lib/workstation.js";
import { checkCapsForAgent, orgForAgent, recordLiveCallMinutes } from "../lib/metering.js";
import { runComputerUse } from "./workstation.js";

// The CONTROLLER — reconciles the two loops of the After Human live-call runtime:
//  • fast VOICE loop: an OpenAI Realtime session (in the client) that talks and
//    handles turn-taking/barge-in natively. It can call show_on_screen(request).
//  • slow OPERATOR loop: computer-use on the agent's E2B desktop, driven by
//    show_on_screen, writing committed state to the blackboard.
// The blackboard (callstate) keeps them in sync — voice narrates only confirmed
// state, and covers latency while the operator works.

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";
const DEMO_URL = (process.env.LIVE_DEMO_URL || "https://www.goperfect.com").replace(/\/$/, "");

// Run a bounded operator sub-task toward a request from the conversation.
function steer(org: string, callId: string, agentId: string, task: string) {
  runComputerUse(org, agentId, task, 8, { callId, confirmMode: "halt" }).catch(() => {});
}

async function voiceInstructions(org: string, callId: string, agentId: string): Promise<string> {
  const agent = await one<{ instructions: string | null; role: string | null; name: string | null }>(`SELECT instructions, role, name FROM agents WHERE id = $1 AND org_id = $2`, [agentId, org]);
  const c = await getCompany(org);
  const persona = agent?.instructions?.trim() || `You are ${agent?.name || "an AI teammate"}${agent?.role ? `, a ${agent.role}` : ""} at ${c.name}.`;
  return `${persona}

You are on a LIVE video call and you are SHARING A SCREEN that shows a real browser you can drive. A separate system actually moves the screen for you: whenever you want the customer to SEE something, call the tool show_on_screen with a short natural request (e.g. "open the pricing page", "scroll to the candidate pipeline section"). It takes a few seconds — cover that time naturally ("let me pull that up…") and only describe what's on screen once it's confirmed there. Never claim something is on screen if it isn't yet.

Behave like a real person: greet briefly, keep turns to 1-2 sentences, stop and listen, and if the customer talks, stop immediately. Company: ${c.name} — ${c.coreBusiness || c.industry}.

${groundingFor(callId)}`;
}

export default async function callRoutes(app: FastifyInstance) {
  // Start a live call session: blackboard + the agent's desktop, seeded to the demo.
  app.post("/api/call/start", async (req, reply) => {
    const b = (req.body ?? {}) as { agentId?: string; goal?: string; url?: string };
    const agentId = (b.agentId ?? "").trim();
    if (!agentId) return reply.code(400).send({ error: "agentId required" });
    // The agent must belong to the caller's org — no cross-tenant calls.
    const owned = await one<{ id: string }>(`SELECT id FROM agents WHERE id = $1 AND org_id = $2`, [agentId, callerOrg(req)]);
    if (!owned) return reply.code(404).send({ error: "agent not found" });
    const provider = await getActiveProvider(callerOrg(req));
    if (!provider?.api_key || !/openai\.com/i.test(provider.base_url || "")) return reply.code(400).send({ error: "OpenAI provider must be active in AI Core." });
    const url = (b.url ?? "").trim() || DEMO_URL;
    const cap = await checkCapsForAgent(agentId);
    if (!cap.allowed) return reply.code(429).send({ error: "Cost cap: " + cap.reason, capState: cap.state });
    const goal = (b.goal ?? "").trim() || "Give a warm, concise live product demo and answer questions.";
    const id = randomUUID();
    createCall(id, callerOrg(req), agentId, goal, url);

    const ws = await wsStart(callerOrg(req), agentId);
    if (!ws.ok) return reply.code(502).send({ error: ws.error });
    // Seed: operator opens the demo site so there's something to show immediately.
    steer(callerOrg(req), id, agentId, `Open the web browser and go to ${url}.`);
    return { ok: true, callId: id, streamUrl: ws.streamUrl };
  });

  app.get("/api/call/:id", async (req, reply) => {
    const s = getCall((req.params as { id: string }).id, callerOrg(req));
    if (!s) return reply.code(404).send({ error: "not found" });
    return s;
  });

  app.get("/api/call/:id/grounding", async (req) => {
    const s = getCall((req.params as { id: string }).id, callerOrg(req));
    return { grounding: s ? groundingFor(s.id) : "" };
  });

  // The voice loop asks to show something → hand it to the operator loop.
  app.post("/api/call/:id/show", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getCall(id, callerOrg(req));
    if (!s) return reply.code(404).send({ error: "not found" });
    const task = ((req.body as { request?: string })?.request ?? "").toString().trim();
    if (!task) return reply.code(400).send({ error: "request required" });
    steer(callerOrg(req), id, s.agentId, task);
    return { ok: true };
  });

  // Record a spoken line into the blackboard (customer or agent).
  app.post("/api/call/:id/transcript", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { who?: "customer" | "agent"; text?: string };
    if (!getCall(id, callerOrg(req))) return reply.code(404).send({ error: "not found" });
    addTranscript(id, b.who === "agent" ? "agent" : "customer", (b.text ?? "").toString());
    return { ok: true };
  });

  // Mint a grounded Realtime voice token (persona + goal + live blackboard state
  // + the show_on_screen tool). The client refreshes grounding via session.update.
  app.post("/api/call/:id/token", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getCall(id, callerOrg(req));
    if (!s) return reply.code(404).send({ error: "not found" });
    const provider = await getActiveProvider(callerOrg(req));
    if (!provider?.api_key) return reply.code(400).send({ error: "no provider" });
    const instructions = await voiceInstructions(callerOrg(req), id, s.agentId);
    const mkBody = (model: string) => JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime", model, instructions,
        tools: [{ type: "function", name: "show_on_screen", description: "Make the shared screen show something (navigate/scroll/click the live browser). Call whenever the customer should SEE something.", parameters: { type: "object", properties: { request: { type: "string", description: "Plain-English what to show, e.g. 'open the pricing page'." } }, required: ["request"] } }],
        tool_choice: "auto",
        audio: { input: { turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 200, silence_duration_ms: 300, create_response: true, interrupt_response: true } }, output: { voice: REALTIME_VOICE } },
      },
    });
    const models = REALTIME_MODEL === "gpt-realtime" ? ["gpt-realtime", "gpt-realtime-2"] : [REALTIME_MODEL, "gpt-realtime"];
    let last: { status: number; detail: string } | null = null;
    for (const model of models) {
      try {
        const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", { method: "POST", headers: { authorization: `Bearer ${provider.api_key}`, "content-type": "application/json" }, body: mkBody(model) });
        const j = (await r.json().catch(() => ({}))) as { value?: string; client_secret?: { value?: string } };
        if (r.ok) { const value = j.value || j.client_secret?.value; if (value) return { value, model, grounding: groundingFor(id) }; }
        last = { status: r.status, detail: JSON.stringify(j).slice(0, 200) };
      } catch (e) { last = { status: 0, detail: (e as Error).message }; }
    }
    return reply.code(502).send({ error: `realtime token failed (${last?.status})`, detail: last?.detail });
  });

  app.post("/api/call/:id/end", async (req) => {
    const { id } = req.params as { id: string };
    const s = getCall(id, callerOrg(req));
    if (s) {
      endCall(id);
      await wsStop(s.agentId);
      // Meter the billable live-call-minutes for this session (fail-open).
      const minutes = Math.max(0, (Date.now() - s.startedAt) / 60000);
      const orgId = await orgForAgent(s.agentId);
      void recordLiveCallMinutes({ orgId, agentId: s.agentId, callId: id }, minutes, { path: "call.ts" });
    }
    return { ok: true };
  });
}
