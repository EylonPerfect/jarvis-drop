import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { hermes } from "../hermes.js";
import { getActiveProvider, completeProviderChat } from "../lib/providers.js";
import { config } from "../config.js";
import { getCompany } from "./company.js";
import type { Agent, AgentRun, RuntimeStats, NewAgent, ConnectionCatalogItem } from "@jarvis/shared";

// Live company research: fetch the company website (via the server-side Chrome)
// and return a text snippet, so the AI discovery can ground its recommendations
// in who the company actually is. Cached per-domain for an hour.
const researchCache = new Map<string, { text: string; at: number }>();
async function researchCompany(domain: string): Promise<string> {
  const d = (domain || "").trim();
  if (!d) return "";
  const cached = researchCache.get(d);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.text;
  try {
    const url = /^https?:\/\//i.test(d) ? d : `https://${d}`;
    const r = await fetch(`${config.browserless.url}/content?token=${encodeURIComponent(config.browserless.token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return "";
    const html = await r.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2500);
    researchCache.set(d, { text, at: Date.now() });
    return text;
  } catch {
    return "";
  }
}

// Pull a JSON object out of an LLM reply (tolerates ```json fences / prose).
function parseJson<T = any>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return typeof j === "object" && j ? (j as T) : null;
  } catch {
    return null;
  }
}

// Deterministic fallback when no provider is connected (or the LLM reply can't
// be parsed) — still role-aware so the autofill is never empty.
function fallbackSpec(name: string, role: string): { overview: string; plan: string; routine: string; instructions: string } {
  const who = name || "This agent";
  return {
    overview: `${who} is responsible for ${role}. It works like a dedicated teammate for this function — it understands the goal, follows the playbook, takes the routine actions, and asks for a human decision on anything irreversible or outside its budget.`,
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
    overview: r.overview ?? undefined,
    playbook: r.playbook && Object.keys(r.playbook).length ? r.playbook : undefined,
    weeklyPlan: r.weekly_plan && Object.keys(r.weekly_plan).length ? r.weekly_plan : undefined,
    calendarPlaybooks: Array.isArray(r.calendar_playbooks) ? r.calendar_playbooks : [],
    connections: Array.isArray(r.connections) ? r.connections : [],
    budgetConfig: r.budget_config && Object.keys(r.budget_config).length ? r.budget_config : undefined,
    buildTrack: r.build_track ?? undefined,
    cloneSource: r.clone_source && Object.keys(r.clone_source).length ? r.clone_source : undefined,
    goals: Array.isArray(r.goals) ? r.goals : [],
    evidence: Array.isArray(r.evidence) ? r.evidence : [],
    onboarding: r.onboarding && Object.keys(r.onboarding).length ? r.onboarding : undefined,
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
        'Respond with ONLY minified JSON, no markdown, exactly: {"overview":string,"plan":string,"routine":string,"instructions":string}. ' +
        "overview = 2-3 sentences a manager would say to explain what this role is about. " +
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
        const spec = r.ok && r.content ? parseJson<{ overview?: string; plan?: string; routine?: string; instructions?: string }>(r.content) : null;
        if (spec && (spec.plan || spec.routine || spec.instructions || spec.overview)) {
          const fb = fallbackSpec(name, role);
          return {
            overview: (spec.overview ?? fb.overview).toString(),
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

  // Draft a calendar-triggered playbook from a scenario description. Returns
  // {name, trigger, steps[]} for step 3 of the wizard. LLM-backed with a
  // sensible fallback.
  app.post("/api/agents/suggest-playbook", async (req, reply) => {
    const b = req.body as { role?: string; scenario?: string };
    const role = (b?.role ?? "").trim();
    const scenario = (b?.scenario ?? "").trim();
    if (!scenario) return reply.code(400).send({ error: "scenario is required" });

    const active = await getActiveProvider();
    if (active) {
      const sys =
        "You design calendar-triggered playbooks for an AI agent. Given the agent's role and a scenario, " +
        'respond with ONLY minified JSON: {"name":string,"trigger":string,"steps":string[]}. ' +
        "name = short scenario name. trigger = a lowercase keyword to match against calendar events (e.g. 'meeting','demo','onboarding'). " +
        "steps = 3-7 concrete ordered actions the agent should take, phrased as imperatives. No text outside the JSON.";
      const user = `Agent role: ${role || "(unspecified)"}\nScenario: ${scenario}`;
      try {
        const r = await completeProviderChat(active, [
          { role: "system", content: sys },
          { role: "user", content: user },
        ]);
        const pb = r.ok && r.content ? parseJson<{ name?: string; trigger?: string; steps?: string[] }>(r.content) : null;
        if (pb && Array.isArray(pb.steps) && pb.steps.length) {
          return { name: pb.name || scenario.slice(0, 60), trigger: (pb.trigger || "meeting").toLowerCase(), steps: pb.steps.map(String), source: "ai" as const };
        }
      } catch {
        /* fall through */
      }
    }
    return {
      name: scenario.slice(0, 60),
      trigger: "meeting",
      steps: [
        "Join the meeting on time and confirm who's attending",
        "Present the product and walk through the key value points",
        "Screen-share the system and give a live demo",
        "Answer questions and handle objections",
        "Send a Stripe payment link from the back office and confirm next steps",
      ],
      source: "template" as const,
    };
  });

  // AI discovery ("breathing artifact"): the active AI Core model interviews the
  // operator one question at a time to reach a COMPLETE understanding of the
  // employee (clone) or role (scratch). Returns an understanding score, the next
  // question, and a progressively-refined profile that pre-fills the wizard —
  // including the onboarding access checklist, manager, and meetings.
  app.post("/api/agents/discover", async (req, reply) => {
    const b = req.body as { name?: string; title?: string; track?: string; transcript?: Array<{ role: string; content: string }> };
    const name = (b?.name ?? "").trim();
    const title = (b?.title ?? "").trim();
    const track = b?.track === "scratch" ? "scratch" : "clone";
    const transcript = Array.isArray(b?.transcript) ? b.transcript.filter((m) => m && typeof m.content === "string") : [];

    // Company context (set-once profile) + live website research → tailored recs.
    const company = await getCompany();
    const research = await researchCompany(company.domain);

    const subject =
      track === "clone"
        ? `an AI clone of an existing employee${name ? ` named ${name}` : ""}${title ? `, whose role is "${title}"` : ""}`
        : `a new AI agent for the role "${title || name || "unspecified"}"`;
    const sys =
      `You are onboarding ${subject}. Interview the operator ONE focused question at a time to reach a COMPLETE understanding, exactly like onboarding a new human hire. ` +
      `Cover: day-to-day work; the ACCESS they need (Slack, an email address, the demo environment, and anything else the role requires); who they report to (manager); which recurring company/team meetings they must join; the tools/systems they use; goals and what "great" looks like; and edge cases. ` +
      `Respond with ONLY minified JSON, no markdown: {"understanding":<0-100 int>,"done":<bool>,"nextQuestion":<string>,"summary":<string>,"profile":{"overview":<string>,"goals":[{"objective":<string>,"metric":<string>}],"reportsTo":{"name":<string>,"email":<string>},"meetings":[{"name":<string>,"cadence":<string>}],"access":[{"item":<string>,"status":"needed"|"pending"|"granted","note":<string>}],"connections":<string[]>,"tools":<string[]>,"routine":<string[]>,"evidenceRequests":[{"behavior":<string>,"ask":<string>,"assetType":"output"|"notetaker"|"policy"|"notion"|"calendar"|"email"|"crm"|"doc"|"other","connection":<string>}]}}. ` +
      `"understanding" starts low and grows as answers arrive. Set "done":true when understanding>=85 or the operator says they're finished. ` +
      `Always keep "access" seeded with at least Slack, an email address, and a demo environment, plus role-specific items. connections/tools are lowercase ids like email,calendar,slack,notetaker,crm,drive,browser,web,web_search,gmail. Ask exactly one question per turn. ` +
      `For the agent to actually LEARN the job, populate "evidenceRequests": for each key behavior, name the single most useful piece of real evidence to learn from and how to get it — a "notetaker" transcript of a great call, a "policy" doc, a "notion" SOP page, a "calendar" cadence screenshot, an "email" example, a "crm" record, or an "output" example of the ideal result. Set "connection" to the tool id that supplies it (notetaker,calendar,email,crm,drive,notion,slack) so clone hires get it automatically. In your nextQuestion, when it fits, ASK the operator to share one concrete example (e.g. "Can you drop in a notetaker transcript of a great discovery call, or a screenshot?"). ` +
      `This hire is for ${company.name}${company.domain ? ` (${company.domain})` : ""}${company.industry ? `, industry: ${company.industry}` : ""}${company.size ? `, size: ${company.size}` : ""}${company.coreBusiness ? `, core business: ${company.coreBusiness}` : ""}. Use what you know about this company PLUS the website snippet to PROACTIVELY RECOMMEND a tailored setup — suggest specific responsibilities, tools, connections, goals, access items and meetings that fit THIS company. Don't just ask: pre-fill the profile with concrete, company-specific recommendations the operator can accept or tweak, and put a short rationale (why these fit ${company.name}) in "summary". Still confirm and ask about genuine gaps.` +
      (research ? ` Company website snippet (for grounding): """${research}"""` : "");
    const convo = transcript.length
      ? transcript.map((m) => `${m.role === "assistant" ? "INTERVIEWER" : "OPERATOR"}: ${m.content}`).join("\n")
      : "(no answers yet — ask your first question and return an initial profile skeleton)";

    const active = await getActiveProvider();
    if (active) {
      try {
        const r = await completeProviderChat(active, [
          { role: "system", content: sys },
          { role: "user", content: `Company: ${company.name} — ${company.industry || "industry n/a"} (${company.size || "size n/a"})\nAgent name: ${name || "(unknown)"}\nTitle: ${title || "(unknown)"}\nTrack: ${track}\n\nConversation so far:\n${convo}` },
        ]);
        const j = r.ok && r.content ? parseJson<any>(r.content) : null;
        if (j && typeof j === "object" && j.nextQuestion) {
          return {
            understanding: Math.max(0, Math.min(100, Math.round(Number(j.understanding) || 0))),
            done: !!j.done,
            nextQuestion: String(j.nextQuestion ?? ""),
            summary: String(j.summary ?? ""),
            profile: j.profile && typeof j.profile === "object" ? j.profile : {},
            source: "ai" as const,
          };
        }
      } catch {
        /* fall through to scripted interview */
      }
    }
    // Fallback: a scripted onboarding interview (works with no provider).
    const FALLBACK_Q = [
      "What does this person actually do day-to-day — the 3–4 things that fill most of their week?",
      "Which systems and accounts do they need access to? (Slack, email, the demo environment, CRM, calendar…)",
      "Who do they report to, and which recurring meetings must they join?",
      "What does a great week look like — the goals and numbers you'd hold them to?",
      "Any edge cases or 'never do this' rules I should bake in?",
    ];
    const answered = transcript.filter((m) => m.role === "user").length;
    return {
      understanding: Math.min(90, answered * 20),
      done: answered >= FALLBACK_Q.length,
      nextQuestion: FALLBACK_Q[Math.min(answered, FALLBACK_Q.length - 1)],
      summary: "",
      profile: {
        overview: name ? `${name}${title ? ` — ${title}` : ""}` : title,
        access: [
          { item: "Slack", status: "needed", note: "Workspace + relevant channels" },
          { item: "Email address", status: "needed", note: "Dedicated mailbox" },
          { item: "Demo environment", status: "needed", note: "Login to the product demo / back office" },
        ],
        connections: ["slack", "email", "calendar"],
        evidenceRequests: [
          { behavior: "Handle a core task well", ask: "Share one example of the ideal output — paste it, attach a screenshot, or link a doc.", assetType: "output" },
          { behavior: "Run a call / meeting", ask: "Add a notetaker transcript of a great call, or a screenshot of one.", assetType: "notetaker", connection: "notetaker" },
          { behavior: "Follow the rules", ask: "Attach the policy or guardrails doc this role must follow.", assetType: "policy", connection: "drive" },
        ],
      },
      source: "template" as const,
    };
  });

  // Wizard draft — persists the in-progress "Hire an Agent" wizard so each step
  // survives a refresh / navigation. Stored as one JSON blob in settings under
  // 'agent_draft'. The client saves on every step change; clears on deploy.
  app.get("/api/agents/draft", async () => {
    const row = await one<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'agent_draft'`);
    return { draft: row?.value ?? null };
  });
  app.put("/api/agents/draft", async (req) => {
    const b = (req.body ?? {}) as { draft?: unknown };
    await query(
      `INSERT INTO settings (key, value) VALUES ('agent_draft', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(b.draft ?? null)],
    );
    return { ok: true };
  });
  app.delete("/api/agents/draft", async () => {
    await query(`DELETE FROM settings WHERE key = 'agent_draft'`);
    return { ok: true };
  });

  // Catalog of connectable systems, mapped to real Hermes toolsets, with a live
  // vs. configured-pending flag. Runtime tools (web/browser/terminal/…) are live
  // when Hermes is reachable; messaging is live when the gateway is running;
  // email/calendar/notion/payments need credentials (pending) until connected.
  app.get("/api/agents/connection-catalog", async () => {
    const status = await hermes.get<any>("/api/status");
    const hermesUp = status.ok && !!status.data && typeof status.data === "object";
    const gatewayRunning = !!(status.data && status.data.gateway_running);
    const items: ConnectionCatalogItem[] = [
      { id: "web", label: "Web search", category: "runtime", hermesToolset: "web", live: hermesUp },
      { id: "browser", label: "Browser control", category: "runtime", hermesToolset: "browser", live: hermesUp, note: "Full headless browser via Hermes" },
      { id: "terminal", label: "Terminal / shell", category: "runtime", hermesToolset: "terminal", live: hermesUp },
      { id: "code", label: "Code execution", category: "dev", hermesToolset: "code_execution", live: hermesUp },
      { id: "memory", label: "Long-term memory", category: "runtime", hermesToolset: "memory", live: hermesUp },
      { id: "cron", label: "Scheduling (cron)", category: "runtime", hermesToolset: "cron", live: hermesUp },
      { id: "notetaker", label: "Notetaker (Fathom / Otter / Gong)", category: "productivity", live: false, note: "Meeting recorder — learns how calls are run; connect the recorder" },
      { id: "drive", label: "Drive / Docs", category: "productivity", live: false, note: "Needs Google/Docs connection" },
      { id: "crm", label: "CRM (HubSpot / Salesforce)", category: "productivity", live: false, note: "Needs CRM connection" },
      { id: "policies", label: "Policies & SOPs", category: "productivity", live: false, note: "Upload or link policy docs in the Playbook step" },
      { id: "slack", label: "Slack", category: "messaging", hermesToolset: "slack", live: gatewayRunning, note: gatewayRunning ? undefined : "Start the Hermes gateway to enable" },
      { id: "whatsapp", label: "WhatsApp", category: "messaging", hermesToolset: "whatsapp", live: gatewayRunning, note: gatewayRunning ? undefined : "Start the Hermes gateway to enable" },
      { id: "telegram", label: "Telegram", category: "messaging", hermesToolset: "telegram", live: gatewayRunning },
      { id: "discord", label: "Discord", category: "messaging", hermesToolset: "discord", live: gatewayRunning },
      { id: "email", label: "Email / Gmail", category: "email", live: false, note: "Needs mailbox connection" },
      { id: "calendar", label: "Calendar", category: "productivity", live: false, note: "Needs calendar connection" },
      { id: "notion", label: "Notion", category: "productivity", live: false, note: "Connect in the Playbook step" },
      { id: "stripe", label: "Stripe / payments (back office)", category: "payments", live: false, note: "Needs Stripe connection; payments gated by budget" },
    ];
    return items;
  });

  app.post("/api/agents", async (req, reply) => {
    const b = req.body as NewAgent;
    if (!b?.name?.trim() || !b?.role?.trim()) {
      return reply.code(400).send({ error: "name and role are required" });
    }
    const id = `ag_${Date.now().toString(36)}`;
    const maxSort = await one<{ m: number }>(`SELECT COALESCE(MAX(sort), -1) + 1 AS m FROM agents`);
    await query(
      `INSERT INTO agents (id, icon, name, role, status, status_label, model, tools, collaborators, autonomy, instructions, plan, routine, budget, schedule, permissions, overview, playbook, weekly_plan, calendar_playbooks, connections, budget_config, build_track, clone_source, goals, evidence, onboarding, sort)
       VALUES ($1,$2,$3,$4,'standby','Standby',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
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
        b.overview ?? null,
        JSON.stringify(b.playbook ?? {}),
        JSON.stringify(b.weeklyPlan ?? {}),
        JSON.stringify(b.calendarPlaybooks ?? []),
        JSON.stringify(b.connections ?? []),
        JSON.stringify(b.budgetConfig ?? {}),
        b.buildTrack ?? null,
        JSON.stringify(b.cloneSource ?? {}),
        JSON.stringify(b.goals ?? []),
        JSON.stringify(b.evidence ?? []),
        JSON.stringify(b.onboarding ?? {}),
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
    if (b.overview !== undefined) set("overview", b.overview);
    if (b.playbook !== undefined) set("playbook", JSON.stringify(b.playbook));
    if (b.weeklyPlan !== undefined) set("weekly_plan", JSON.stringify(b.weeklyPlan));
    if (b.calendarPlaybooks !== undefined) set("calendar_playbooks", JSON.stringify(b.calendarPlaybooks));
    if (b.connections !== undefined) set("connections", JSON.stringify(b.connections));
    if (b.budgetConfig !== undefined) set("budget_config", JSON.stringify(b.budgetConfig));
    if (b.buildTrack !== undefined) set("build_track", b.buildTrack);
    if (b.cloneSource !== undefined) set("clone_source", JSON.stringify(b.cloneSource));
    if (b.goals !== undefined) set("goals", JSON.stringify(b.goals));
    if (b.evidence !== undefined) set("evidence", JSON.stringify(b.evidence));
    if (b.onboarding !== undefined) set("onboarding", JSON.stringify(b.onboarding));
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
    // Clear child rows first (safe if a FK is ever added), then the agents.
    await query(`DELETE FROM agent_activity`);
    await query(`DELETE FROM agent_comms`);
    await query(`DELETE FROM agents`);
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
