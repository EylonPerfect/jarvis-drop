import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { hermes } from "../hermes.js";
import { getActiveProvider, completeProviderChat } from "../lib/providers.js";
import type { Agent, AgentRun, RuntimeStats, NewAgent } from "@jarvis/shared";

// Pull a JSON object out of an LLM reply (tolerates ```json fences / prose).
function parseSpec(text: string): { plan?: string; routine?: string; instructions?: string } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return typeof j === "object" && j ? j : null;
  } catch {
    return null;
  }
}

// Deterministic fallback when no provider is connected (or the LLM reply can't
// be parsed) — still role-aware so the autofill is never empty.
function fallbackSpec(name: string, role: string): { plan: string; routine: string; instructions: string } {
  const who = name || "This agent";
  return {
    plan: `Own everything related to ${role}. Deliver dependable outcomes end-to-end and escalate anything that needs a human decision. "Done" means the work is completed accurately and logged.`,
    routine: `1. Review new inputs and requests relevant to ${role}\n2. Decide the next action; draft it for approval if it's irreversible\n3. Execute the action or hand off to a teammate\n4. Log what was done to the ledger and surface any blockers\n5. Report a short summary`,
    instructions: `You are ${who}, responsible for ${role}. Be concise, accurate, and proactive. Think step by step and show brief reasoning. Ask before any irreversible action, cite your sources, and never fabricate results. Stay strictly within your role and hand off when a task belongs to another agent.`,
  };
}

function rowToAgent(r: any): Agent {
  return {
    id: r.id,
    icon: r.icon,
    name: r.name,
    role: r.role,
    status: r.status,
    statusLabel: r.status_label,
    model: r.model ?? undefined,
    tools: r.tools ?? [],
    collaborators: r.collaborators ?? [],
    autonomy: r.autonomy ?? undefined,
    instructions: r.instructions ?? undefined,
    plan: r.plan ?? undefined,
    routine: r.routine ?? undefined,
    budget: r.budget ?? undefined,
    schedule: r.schedule ?? undefined,
    permissions: r.permissions ?? [],
    createdAt: r.created_at,
  };
}

export default async function agentsRoutes(app: FastifyInstance) {
  // Roster (Postgres-owned orchestration config; each entry can reference a
  // hermes sub-agent / skill once the operator wires it).
  app.get("/api/agents", async () => {
    const rows = await query(`SELECT * FROM agents ORDER BY sort, created_at`);
    return rows.map(rowToAgent);
  });

  // Autofill the agent builder from a role: generate a plan, routine and system
  // instructions via the active AI Core provider. Falls back to a role-aware
  // template if no provider is connected or the reply can't be parsed.
  app.post("/api/agents/suggest", async (req, reply) => {
    const b = req.body as { name?: string; role?: string };
    const role = (b?.role ?? "").trim();
    const name = (b?.name ?? "").trim();
    if (!role) return reply.code(400).send({ error: "role is required" });

    const active = await getActiveProvider();
    if (active) {
      const sys =
        "You design autonomous AI agents. Given an agent's name and role, write its operating spec. " +
        'Respond with ONLY minified JSON, no markdown, exactly: {"plan":string,"routine":string,"instructions":string}. ' +
        "plan = 1-2 sentences on the agent's goal and what 'done' looks like. " +
        "routine = 3-6 numbered recurring steps it follows, each on its own line (use \\n). " +
        "instructions = 2-4 sentence system prompt for how it should think, its tone, guardrails and style. " +
        "Be specific to the role. No text outside the JSON.";
      const user = `Agent name: ${name || "(unnamed)"}\nRole: ${role}`;
      try {
        const r = await completeProviderChat(active, [
          { role: "system", content: sys },
          { role: "user", content: user },
        ]);
        const spec = r.ok && r.content ? parseSpec(r.content) : null;
        if (spec && (spec.plan || spec.routine || spec.instructions)) {
          const fb = fallbackSpec(name, role);
          return {
            plan: (spec.plan ?? fb.plan).toString(),
            routine: (spec.routine ?? fb.routine).toString(),
            instructions: (spec.instructions ?? fb.instructions).toString(),
            source: "ai" as const,
          };
        }
      } catch {
        /* fall through to template */
      }
    }
    return { ...fallbackSpec(name, role), source: "template" as const };
  });

  app.post("/api/agents", async (req, reply) => {
    const b = req.body as NewAgent;
    if (!b?.name?.trim() || !b?.role?.trim()) {
      return reply.code(400).send({ error: "name and role are required" });
    }
    const id = `ag_${Date.now().toString(36)}`;
    const maxSort = await one<{ m: number }>(`SELECT COALESCE(MAX(sort), -1) + 1 AS m FROM agents`);
    await query(
      `INSERT INTO agents (id, icon, name, role, status, status_label, model, tools, collaborators, autonomy, instructions, plan, routine, budget, schedule, permissions, sort)
       VALUES ($1,$2,$3,$4,'standby','Standby',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        b.icon || "bot",
        b.name.trim(),
        b.role.trim(),
        b.model ?? null,
        JSON.stringify(b.tools ?? []),
        JSON.stringify(b.collaborators ?? []),
        b.autonomy ?? "Ask before acting",
        b.instructions ?? null,
        b.plan ?? null,
        b.routine ?? null,
        b.budget ?? null,
        b.schedule ?? null,
        JSON.stringify(b.permissions ?? []),
        maxSort?.m ?? 0,
      ],
    );
    const row = await one(`SELECT * FROM agents WHERE id = $1`, [id]);
    return reply.code(201).send(rowToAgent(row));
  });

  // Update an existing agent (rename, re-role, change model/autonomy, status).
  app.patch("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as Partial<NewAgent> & { status?: string; statusLabel?: string };
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => {
      sets.push(`${col} = $${sets.length + 1}`);
      vals.push(v);
    };
    if (b.name !== undefined) set("name", b.name);
    if (b.role !== undefined) set("role", b.role);
    if (b.icon !== undefined) set("icon", b.icon);
    if (b.model !== undefined) set("model", b.model);
    if (b.autonomy !== undefined) set("autonomy", b.autonomy);
    if (b.instructions !== undefined) set("instructions", b.instructions);
    if (b.plan !== undefined) set("plan", b.plan);
    if (b.routine !== undefined) set("routine", b.routine);
    if (b.budget !== undefined) set("budget", b.budget);
    if (b.schedule !== undefined) set("schedule", b.schedule);
    if (b.permissions !== undefined) set("permissions", JSON.stringify(b.permissions));
    if (b.status !== undefined) set("status", b.status);
    if (b.statusLabel !== undefined) set("status_label", b.statusLabel);
    if (b.tools !== undefined) set("tools", JSON.stringify(b.tools));
    if (b.collaborators !== undefined) set("collaborators", JSON.stringify(b.collaborators));
    if (!sets.length) return reply.code(400).send({ error: "no fields to update" });
    vals.push(id);
    await query(`UPDATE agents SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
    const row = await one(`SELECT * FROM agents WHERE id = $1`, [id]);
    if (!row) return reply.code(404).send({ error: "not found" });
    return rowToAgent(row);
  });

  // Per-agent performance box (cockpit): counts of completed goals/tasks/
  // routine/scheduled/workflow within the selected window. Real counts from the
  // activity log (0 until the agent logs work) — never fabricated.
  app.get("/api/agents/:id/performance", async (req) => {
    const { id } = req.params as { id: string };
    const q = (req.query as { period?: string }) ?? {};
    const period = q.period === "weekly" ? "weekly" : q.period === "monthly" ? "monthly" : "daily";
    const interval = period === "weekly" ? "7 days" : period === "monthly" ? "30 days" : "1 day";
    const rows = await query<{ kind: string; n: number }>(
      `SELECT kind, COUNT(*)::int AS n FROM agent_activity WHERE agent_id = $1 AND at >= now() - $2::interval GROUP BY kind`,
      [id, interval],
    );
    const by: Record<string, number> = {};
    for (const r of rows) by[r.kind] = Number(r.n);
    return { period, goals: by.goal ?? 0, tasks: by.task ?? 0, routine: by.routine ?? 0, scheduled: by.scheduled ?? 0, workflow: by.workflow ?? 0 };
  });

  // Log one unit of agent activity. Called as the agent does work (and usable
  // for testing the Performance box). kind ∈ goal|task|routine|scheduled|workflow.
  app.post("/api/agents/:id/activity", async (req, reply) => {
    const { id } = req.params as { id: string };
    const kind = (req.body as { kind?: string })?.kind;
    if (!kind || !["goal", "task", "routine", "scheduled", "workflow"].includes(kind)) {
      return reply.code(400).send({ error: "kind must be one of goal|task|routine|scheduled|workflow" });
    }
    await query(`INSERT INTO agent_activity (agent_id, kind) VALUES ($1, $2)`, [id, kind]);
    return { ok: true };
  });

  // Latest Slack/email communications for an agent (cockpit block).
  app.get("/api/agents/:id/communications", async (req) => {
    const { id } = req.params as { id: string };
    const rows = await query<any>(
      `SELECT id, channel, party, subject, preview, at FROM agent_comms WHERE agent_id = $1 ORDER BY at DESC LIMIT 20`,
      [id],
    );
    return rows.map((r) => ({ id: Number(r.id), channel: r.channel, party: r.party ?? undefined, subject: r.subject ?? undefined, preview: r.preview ?? undefined, at: r.at }));
  });

  app.post("/api/agents/:id/communications", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body as { channel?: string; party?: string; subject?: string; preview?: string }) ?? {};
    if (b.channel !== "slack" && b.channel !== "email") {
      return reply.code(400).send({ error: "channel must be 'slack' or 'email'" });
    }
    await query(`INSERT INTO agent_comms (agent_id, channel, party, subject, preview) VALUES ($1,$2,$3,$4,$5)`, [id, b.channel, b.party ?? null, b.subject ?? null, b.preview ?? null]);
    return reply.code(201).send({ ok: true });
  });

  // Remove all agents (clear the roster) + their activity/comms.
  app.delete("/api/agents", async () => {
    await query(`DELETE FROM agents`);
    await query(`DELETE FROM agent_activity`);
    await query(`DELETE FROM agent_comms`);
    return { ok: true };
  });

  app.delete("/api/agents/:id", async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM agents WHERE id = $1`, [id]);
    return { ok: true };
  });

  // Runtime executions. Prefer live hermes runs; fall back to the seeded log.
  app.get("/api/agents/runs", async () => {
    const live = await hermes.get<any>("/v1/runs");
    // Accept a bare array or the OpenAI-style {data:[...]} / {runs:[...]} envelope.
    const list = Array.isArray(live.data) ? live.data : live.data?.data ?? live.data?.runs;
    if (live.ok && Array.isArray(list)) {
      const runs: AgentRun[] = list.map((r: any, i: number) => ({
        id: r.run_id ?? r.id ?? `run_${i}`,
        query: r.input ?? r.query ?? r.prompt ?? "(run)",
        ts: r.created_at ?? "",
        okCount: r.ok_count ?? r.steps_ok ?? 0,
        errCount: r.error_count ?? r.errors ?? 0,
        steps: Array.isArray(r.events)
          ? r.events.map((e: any) => ({
              agent: e.agent ?? e.tool ?? "agent",
              detail: e.detail ?? e.message ?? "",
              tone: e.error ? "red" : "green",
            }))
          : [],
        state: r.state,
      }));
      if (runs.length) return runs;
    }
    const seeded = await one<{ value: AgentRun[] }>(`SELECT value FROM settings WHERE key = 'runs'`);
    return seeded?.value ?? [];
  });

  // Recent Hermes runtime sessions (cockpit center pane). These are the agent
  // runtime's own sessions from the deployed Hermes dashboard — NOT tied to any
  // one app-agent id, so they're presented honestly as runtime-wide sessions.
  // Relays hermes GET /api/sessions; returns [] when hermes is unreachable.
  app.get("/api/agents/sessions", async () => {
    const res = await hermes.get<any>("/api/sessions");
    // Accept a bare array or the {sessions:[...]} / {data:[...]} envelope.
    const list = Array.isArray(res.data)
      ? res.data
      : res.data?.sessions ?? res.data?.data;
    if (!res.ok || !Array.isArray(list)) return [];
    return list.map((s: any, i: number) => ({
      id: String(s.id ?? s.session_id ?? `session_${i}`),
      model: s.model ?? s.model_config?.model ?? undefined,
      source: s.source ?? undefined,
      messages: s.messages ?? s.message_count ?? undefined,
      iterations: s.iterations ?? s.iteration_count ?? undefined,
    }));
  });

  app.get("/api/agents/runtime", async (): Promise<RuntimeStats> => {
    const rows = await query<{ status: string }>(`SELECT status FROM agents`);
    const active = rows.filter((r) => r.status === "optimal").length;
    const runs = (await one<{ value: AgentRun[] }>(`SELECT value FROM settings WHERE key = 'runs'`))?.value ?? [];
    const stepsToday = runs.reduce((n, r) => n + (r.steps?.length ?? 0), 0);
    const errors = runs.reduce((n, r) => n + (r.errCount ?? 0), 0);
    return { active, recentRuns: runs.length, stepsToday, errors };
  });
}
