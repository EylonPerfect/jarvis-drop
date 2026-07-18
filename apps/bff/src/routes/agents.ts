import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { orgId } from "../lib/auth.js";
import { agentInOrg } from "../lib/tenancy.js";
import { purgeAgent } from "../lib/purge.js";
import { getSetting, setSetting, deleteSetting } from "../lib/settingsStore.js";
import { hermes } from "../hermes.js";
import { getActiveProvider, completeProviderChat } from "../lib/providers.js";
import { config } from "../config.js";
import { getCompany } from "./company.js";
import { getConnectedIntegrationIds } from "./integrations.js";
import { playbookToInstructions } from "@jarvis/shared";
import type { Agent, AgentRun, RuntimeStats, NewAgent, ConnectionCatalogItem, AgentRunResult, AgentRunRecord } from "@jarvis/shared";

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
    persona: r.persona && Object.keys(r.persona).length ? r.persona : undefined,
    golden_persona_id: r.golden_persona_id ?? undefined,
    voice_id: r.voice_id ?? undefined,
    createdAt: r.created_at,
  };
}

export default async function agentsRoutes(app: FastifyInstance) {
  // Roster (Postgres-owned orchestration config; each entry can reference a
  // hermes sub-agent / skill once the operator wires it).
  app.get("/api/agents", async (req) => {
    const rows = await query(`SELECT * FROM agents WHERE org_id = $1 ORDER BY sort, created_at`, [orgId(req)]);
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

    const active = await getActiveProvider(orgId(req));
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

    const active = await getActiveProvider(orgId(req));
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
    const company = await getCompany(orgId(req));
    const research = await researchCompany(company.domain);

    const subject =
      track === "clone"
        ? `an AI clone of an existing employee${name ? ` named ${name}` : ""}${title ? `, whose role is "${title}"` : ""}`
        : `a new AI agent for the role "${title || name || "unspecified"}"`;
    const sys =
      `You are onboarding ${subject}. Interview the operator ONE focused question at a time to reach a COMPLETE understanding, exactly like onboarding a new human hire. ` +
      `Cover: day-to-day work; the ACCESS they need (Slack, an email address, the demo environment, and anything else the role requires); who they report to (manager); which recurring company/team meetings they must join; the tools/systems they use; goals and what "great" looks like; and edge cases. ` +
      `Respond with ONLY minified JSON, no markdown: {"understanding":<0-100 int>,"done":<bool>,"nextQuestion":<string>,"suggestion":<string>,"summary":<string>,"profile":{"overview":<string>,"goals":[{"objective":<string>,"metric":<string>}],"reportsTo":{"name":<string>,"email":<string>},"meetings":[{"name":<string>,"cadence":<string>}],"access":[{"item":<string>,"status":"needed"|"pending"|"granted","note":<string>}],"connections":<string[]>,"tools":<string[]>,"routine":<string[]>,"evidenceRequests":[{"behavior":<string>,"ask":<string>,"assetType":"output"|"notetaker"|"policy"|"notion"|"calendar"|"email"|"crm"|"doc"|"other","connection":<string>}]}}. ` +
      `CRITICAL: "suggestion" MUST be a concrete recommended ANSWER to THIS exact "nextQuestion" (not a general role summary) — directly addressing what the question asks, tailored to ${company.name}, as a short list or 1–4 sentences the operator can accept or edit. If the question asks about goals/KPIs, suggestion lists the specific goals/KPIs; if it asks about access, suggestion lists the specific access; if it asks for an example artifact, suggestion says what a great example would contain. Keep "suggestion" tightly relevant to "nextQuestion" every turn. ` +
      `Add "evidenceAsk": when (and only when) "nextQuestion" is asking the operator to provide a concrete artifact/example (a recording, transcript, dashboard, scorecard, doc, screenshot, email, sample output, policy…), set it to a SHORT imperative telling them exactly what file to attach for THIS question (e.g. "Attach a notetaker recording of a strong demo, or a dashboard screenshot"). If the question is not requesting an artifact, set "evidenceAsk" to an empty string. Include "evidenceAsk" in the JSON. ` +
      `"understanding" starts low and grows as answers arrive. Set "done":true when understanding>=85 or the operator says they're finished. ` +
      `Always keep "access" seeded with at least Slack, an email address, and a demo environment, plus role-specific items. connections/tools are lowercase ids like email,calendar,slack,notetaker,crm,drive,browser,web,web_search,gmail. Ask exactly one question per turn. ` +
      `For the agent to actually LEARN the job, populate "evidenceRequests": for each key behavior, name the single most useful piece of real evidence to learn from and how to get it — a "notetaker" transcript of a great call, a "policy" doc, a "notion" SOP page, a "calendar" cadence screenshot, an "email" example, a "crm" record, or an "output" example of the ideal result. Set "connection" to the tool id that supplies it (notetaker,calendar,email,crm,drive,notion,slack) so clone hires get it automatically. In your nextQuestion, when it fits, ASK the operator to share one concrete example (e.g. "Can you drop in a notetaker transcript of a great discovery call, or a screenshot?"). ` +
      `This hire is for ${company.name}${company.domain ? ` (${company.domain})` : ""}${company.industry ? `, industry: ${company.industry}` : ""}${company.size ? `, size: ${company.size}` : ""}${company.coreBusiness ? `, core business: ${company.coreBusiness}` : ""}. Use what you know about this company PLUS the website snippet to PROACTIVELY RECOMMEND a tailored setup — suggest specific responsibilities, tools, connections, goals, access items and meetings that fit THIS company. Don't just ask: pre-fill the profile with concrete, company-specific recommendations the operator can accept or tweak. In "summary", state plainly WHAT YOU UNDERSTAND about this role so far, in 1–3 sentences and first person ("I understand this CSM will…") — BEFORE building anything, so the operator can confirm it. Then ask about genuine gaps, exactly one question per turn.` +
      (research ? ` Company website snippet (for grounding): """${research}"""` : "");
    const convo = transcript.length
      ? transcript.map((m) => `${m.role === "assistant" ? "INTERVIEWER" : "OPERATOR"}: ${m.content}`).join("\n")
      : "(no answers yet — ask your first question and return an initial profile skeleton)";

    const active = await getActiveProvider(orgId(req));
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
            suggestion: String(j.suggestion ?? ""),
            evidenceAsk: String(j.evidenceAsk ?? ""),
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
    // A suggested answer that matches each fallback question (kept relevant).
    const FALLBACK_SUGGESTION = [
      "Runs the core workflow end-to-end, handles inbound questions, drives adoption, and escalates risks.",
      "Slack, a dedicated email address, the demo environment, CRM, and calendar.",
      "Reports to the team lead; joins the weekly team sync, planning, and all-hands.",
      "Clear targets on activation, retention/renewal, response time, and quality of escalations.",
      "Never send anything customer-facing without review; never move money or change access.",
    ];
    const answered = transcript.filter((m) => m.role === "user").length;
    const qIdx = Math.min(answered, FALLBACK_Q.length - 1);
    return {
      understanding: Math.min(90, answered * 20),
      done: answered >= FALLBACK_Q.length,
      nextQuestion: FALLBACK_Q[qIdx],
      suggestion: FALLBACK_SUGGESTION[qIdx],
      evidenceAsk: qIdx === 3 ? "Optional: attach an example scorecard or dashboard that shows what “great” looks like." : "",
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
  app.get("/api/agents/draft", async (req) => {
    return { draft: (await getSetting(orgId(req), "agent_draft")) ?? null };
  });
  app.put("/api/agents/draft", async (req) => {
    const b = (req.body ?? {}) as { draft?: unknown };
    await setSetting(orgId(req), "agent_draft", b.draft ?? null);
    return { ok: true };
  });
  app.delete("/api/agents/draft", async (req) => {
    await deleteSetting(orgId(req), "agent_draft");
    return { ok: true };
  });

  // Catalog of connectable systems, mapped to real Hermes toolsets, with a live
  // vs. configured-pending flag. Runtime tools (web/browser/terminal/…) are live
  // when Hermes is reachable; messaging is live when the gateway is running;
  // email/calendar/notion/payments need credentials (pending) until connected.
  app.get("/api/agents/connection-catalog", async (req) => {
    const status = await hermes.get<any>("/api/status");
    const hermesUp = status.ok && !!status.data && typeof status.data === "object";
    const gatewayRunning = !!(status.data && status.data.gateway_running);
    // Which connectors have a real stored credential (Integrations screen).
    const connectedIds = await getConnectedIntegrationIds(orgId(req));
    // Map a wizard connector id → the integration id that credentials it.
    const credOf: Record<string, string> = {
      email: "gmail", calendar: "google_calendar", notetaker: "notetaker",
      drive: "drive", crm: "crm", notion: "notion", stripe: "stripe",
      slack: "slack", voice: "elevenlabs", demo: "demo",
    };
    const isConnected = (id: string) => connectedIds.has(credOf[id] ?? id);
    // A credential-backed connector; `live` once its credential is stored.
    const cred = (id: string, label: string, category: ConnectionCatalogItem["category"], note: string, hermesToolset?: string): ConnectionCatalogItem => {
      const connected = isConnected(id);
      return { id, label, category, hermesToolset, connected, live: connected, note: connected ? undefined : note };
    };
    const items: ConnectionCatalogItem[] = [
      // Hermes-native runtime — live whenever Hermes is reachable.
      { id: "web", label: "Web search", category: "runtime", hermesToolset: "web", live: hermesUp },
      { id: "browser", label: "Browser control", category: "runtime", hermesToolset: "browser", live: hermesUp, note: "Per-agent headless browser via Hermes" },
      { id: "terminal", label: "Terminal / shell", category: "runtime", hermesToolset: "terminal", live: hermesUp },
      { id: "code", label: "Code execution", category: "dev", hermesToolset: "code_execution", live: hermesUp },
      { id: "memory", label: "Long-term memory", category: "runtime", hermesToolset: "memory", live: hermesUp },
      { id: "cron", label: "Scheduling (cron)", category: "runtime", hermesToolset: "cron", live: hermesUp },
      // Credential-backed — live once connected on the Integrations screen.
      cred("email", "Email / Gmail", "email", "Connect Gmail in Integrations"),
      cred("calendar", "Google Calendar", "productivity", "Connect Google Calendar in Integrations"),
      cred("slack", "Slack", "messaging", "Connect Slack in Integrations", "slack"),
      cred("voice", "Voice (ElevenLabs)", "voice", "Connect ElevenLabs in Integrations"),
      cred("notetaker", "Notetaker (Fathom / Fireflies / Otter / Gong)", "productivity", "Connect a notetaker in Integrations"),
      cred("demo", "Product demo environment", "runtime", "Add the demo login in Integrations"),
      cred("crm", "CRM (HubSpot / Salesforce)", "productivity", "Connect a CRM in Integrations"),
      cred("notion", "Notion", "productivity", "Connect Notion in Integrations"),
      cred("drive", "Drive / Docs", "productivity", "Connect Google Drive in Integrations"),
      cred("stripe", "Stripe / payments (back office)", "payments", "Connect Stripe in Integrations; payments gated by budget"),
      { id: "policies", label: "Policies & SOPs", category: "productivity", live: false, note: "Upload or link policy docs in the Examples step" },
      // Messaging gateways handled by Hermes.
      { id: "whatsapp", label: "WhatsApp", category: "messaging", hermesToolset: "whatsapp", live: gatewayRunning, note: gatewayRunning ? undefined : "Start the Hermes gateway to enable" },
      { id: "telegram", label: "Telegram", category: "messaging", hermesToolset: "telegram", live: gatewayRunning },
      { id: "discord", label: "Discord", category: "messaging", hermesToolset: "discord", live: gatewayRunning },
    ];
    return items;
  });

  app.post("/api/agents", async (req, reply) => {
    const b = req.body as NewAgent;
    if (!b?.name?.trim() || !b?.role?.trim()) {
      return reply.code(400).send({ error: "name and role are required" });
    }
    const id = `ag_${Date.now().toString(36)}`;
    const org = orgId(req);
    const maxSort = await one<{ m: number }>(`SELECT COALESCE(MAX(sort), -1) + 1 AS m FROM agents WHERE org_id = $1`, [org]);

    // Clone-from-calls (AE/CS): when an approved call playbook is present, it is
    // the single source of truth for how this agent runs live calls — compile it
    // to instructions server-side (overriding any client-sent instructions) and
    // stash the storyboard under playbook.kind='calls' so the cockpit can show it.
    let instructions = b.instructions ?? null;
    let playbook = b.playbook ?? {};
    if (b.callPlaybook?.approved && Array.isArray(b.callPlaybook.stages) && b.callPlaybook.stages.length) {
      const company = await getCompany(orgId(req));
      instructions = playbookToInstructions(b.callPlaybook, b.name.trim(), company.name || "the company");
      playbook = { kind: "calls", name: `Call playbook · ${b.callPlaybook.stages.length} stages`, callPlaybook: b.callPlaybook };
    }
    await query(
      `INSERT INTO agents (id, org_id, icon, name, role, status, status_label, model, tools, collaborators, autonomy, instructions, plan, routine, budget, schedule, permissions, overview, playbook, weekly_plan, calendar_playbooks, connections, budget_config, build_track, clone_source, goals, evidence, onboarding, sort)
       VALUES ($1,$27,$2,$3,$4,'standby','Standby',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [
        id,
        b.icon || "bot",
        b.name.trim(),
        b.role.trim(),
        b.model ?? null,
        JSON.stringify(b.tools ?? []),
        JSON.stringify(b.collaborators ?? []),
        b.autonomy ?? "Ask before acting",
        instructions,
        b.plan ?? null,
        b.routine ?? null,
        b.budget ?? null,
        b.schedule ?? null,
        JSON.stringify(b.permissions ?? []),
        b.overview ?? null,
        JSON.stringify(playbook),
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
        org,
      ],
    );
    const row = await one(`SELECT * FROM agents WHERE id = $1 AND org_id = $2`, [id, org]);
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
    const newVoiceId = (b as { voiceId?: string }).voiceId;
    if (newVoiceId !== undefined) set("voice_id", newVoiceId);
    if (!sets.length) return reply.code(400).send({ error: "no fields to update" });
    const org = orgId(req);
    vals.push(id);
    vals.push(org);
    await query(`UPDATE agents SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND org_id = $${vals.length}`, vals);
    // A voice choice must land in BOTH homes: agents.voice_id AND the persona's
    // voice block — several consumers read the persona copy first, and a stale
    // one makes the picker (and the room's playback) revert to the old voice.
    if (newVoiceId !== undefined) {
      const cur = await one<{ persona: Record<string, unknown> | null }>(`SELECT persona FROM agents WHERE id = $1 AND org_id = $2`, [id, org]);
      if (cur?.persona && typeof cur.persona === "object") {
        const p = cur.persona as { voice?: Record<string, unknown> };
        p.voice = { ...(p.voice ?? {}), elevenlabs_voice_id: newVoiceId };
        await query(`UPDATE agents SET persona = $2 WHERE id = $1 AND org_id = $3`, [id, JSON.stringify(p), org]);
      }
    }
    const row = await one(`SELECT * FROM agents WHERE id = $1 AND org_id = $2`, [id, org]);
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
      `SELECT kind, COUNT(*)::int AS n FROM agent_activity WHERE agent_id = $1 AND org_id = $3 AND at >= now() - $2::interval GROUP BY kind`,
      [id, interval, orgId(req)],
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
    await query(`INSERT INTO agent_activity (agent_id, kind, org_id) VALUES ($1, $2, $3)`, [id, kind, orgId(req)]);
    return { ok: true };
  });

  // Latest Slack/email communications for an agent (cockpit block).
  app.get("/api/agents/:id/communications", async (req) => {
    const { id } = req.params as { id: string };
    const rows = await query<any>(
      `SELECT id, channel, party, subject, preview, at FROM agent_comms WHERE agent_id = $1 AND org_id = $2 ORDER BY at DESC LIMIT 20`,
      [id, orgId(req)],
    );
    return rows.map((r) => ({ id: Number(r.id), channel: r.channel, party: r.party ?? undefined, subject: r.subject ?? undefined, preview: r.preview ?? undefined, at: r.at }));
  });

  app.post("/api/agents/:id/communications", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body as { channel?: string; party?: string; subject?: string; preview?: string }) ?? {};
    if (b.channel !== "slack" && b.channel !== "email") {
      return reply.code(400).send({ error: "channel must be 'slack' or 'email'" });
    }
    await query(`INSERT INTO agent_comms (agent_id, channel, party, subject, preview, org_id) VALUES ($1,$2,$3,$4,$5,$6)`, [id, b.channel, b.party ?? null, b.subject ?? null, b.preview ?? null, orgId(req)]);
    return reply.code(201).send({ ok: true });
  });

  // Remove all agents (clear the roster) + their activity/comms.
  app.delete("/api/agents", async (req) => {
    // Clear child rows first (safe if a FK is ever added), then the agents.
    // Scoped to the caller's org so one tenant's "clear roster" never touches another.
    const org = orgId(req);
    await query(`DELETE FROM agent_activity WHERE org_id = $1`, [org]);
    await query(`DELETE FROM agent_comms WHERE org_id = $1`, [org]);
    await query(`DELETE FROM agent_runs WHERE org_id = $1`, [org]);
    await query(`DELETE FROM agents WHERE org_id = $1`, [org]);
    return { ok: true };
  });

  app.delete("/api/agents/:id", async (req) => {
    const { id } = req.params as { id: string };
    const org = orgId(req);
    // Ownership gate: only purge an agent that belongs to this org.
    if (!(await agentInOrg(id, org))) return { ok: true }; // idempotent no-op for other orgs
    // HARD purge (lib/purge.ts): the agent's whole footprint — runs, activity,
    // comms, call sources, persona history, calibration transcripts, debriefs,
    // live_calls, rehearsal grades, its per-agent settings (incl. demo creds) —
    // in one transaction, PLUS best-effort revoke of its cloned ElevenLabs voice,
    // e2b sandbox kill, and on-disk film removal, with an audit record. Not a
    // soft delete: we keep neither the voice likeness nor stored creds.
    const result = await purgeAgent(org, id, { actor: req.user?.id });
    return { ok: true, purged: result.deleted, external: result.external };
  });

  // Compile the agent's operating system prompt: its instructions + the concrete
  // capabilities/connections it may use (so it knows its toolset), grounded on
  // Hermes core (memory, context, web + headless browser).
  async function agentSystemPrompt(a: Agent, org: string): Promise<string> {
    const connected = await getConnectedIntegrationIds(org);
    const connLabels: Record<string, string> = {
      gmail: "Gmail (read/send email)", google_calendar: "Google Calendar", slack: "Slack",
      elevenlabs: "voice (ElevenLabs)", notetaker: "meeting notetaker", crm: "CRM",
      notion: "Notion", drive: "Drive/Docs", stripe: "Stripe", demo: "the product demo environment",
    };
    const credMap: Record<string, string> = { email: "gmail", calendar: "google_calendar", voice: "elevenlabs" };
    const tools = (a.connections ?? []).map((c) => {
      const credId = credMap[c] ?? c;
      const live = connected.has(credId);
      const label = connLabels[credId] ?? c;
      return `- ${label}${live ? "" : " (not yet connected — ask the operator to connect it)"}`;
    });
    return [
      a.instructions?.trim() || `You are ${a.name}, ${a.role}.`,
      a.overview?.trim() ? `Context: ${a.overview.trim()}` : "",
      a.goals?.length ? `Your goals:\n${a.goals.map((g) => `- ${g.objective}${g.metric ? ` (measure: ${g.metric})` : ""}`).join("\n")}` : "",
      tools.length ? `Systems you can use:\n${tools.join("\n")}` : "",
      "You run on the Hermes agent runtime: you have long-term memory, persistent context across runs, live web search, and a headless browser. Use them to actually do the work. Think step by step, take real actions with your tools, and report what you did and the result.",
      a.autonomy ? `Autonomy: ${a.autonomy}. When an action is irreversible or spends money, follow this setting.` : "",
    ].filter(Boolean).join("\n\n");
  }

  // Deploy: mark the agent live so it can be run. (Its runtime is Hermes; runs
  // are executed on demand / on schedule via /run.)
  app.post("/api/agents/:id/deploy", async (req, reply) => {
    const { id } = req.params as { id: string };
    const org = orgId(req);
    const row = await one(`SELECT * FROM agents WHERE id = $1 AND org_id = $2`, [id, org]);
    if (!row) return reply.code(404).send({ error: "not found" });
    await query(`UPDATE agents SET status = 'optimal', status_label = 'Deployed' WHERE id = $1 AND org_id = $2`, [id, org]);
    const updated = await one(`SELECT * FROM agents WHERE id = $1 AND org_id = $2`, [id, org]);
    return rowToAgent(updated);
  });

  // Run: execute a task AS this agent. Uses the Hermes agent (memory + tools) when
  // its chat endpoint is available, else the active AI Core provider. Returns the
  // agent's result and records the run.
  app.post("/api/agents/:id/run", async (req, reply): Promise<AgentRunResult> => {
    const { id } = req.params as { id: string };
    const org = orgId(req);
    const body = (req.body ?? {}) as { task?: string };
    const task = (body.task ?? "").toString().trim();
    const row = await one(`SELECT * FROM agents WHERE id = $1 AND org_id = $2`, [id, org]);
    if (!row) { reply.code(404); return { ok: false, output: "", detail: "agent not found", via: "none", at: new Date().toISOString() }; }
    if (!task) { reply.code(400); return { ok: false, output: "", detail: "task is required", via: "none", at: new Date().toISOString() }; }
    const agent = rowToAgent(row);
    const system = await agentSystemPrompt(agent, org);
    const at = new Date().toISOString();

    const record = async (fields: { taskId?: string | null; status: string; output?: string; via: string }) => {
      await query(
        `INSERT INTO agent_runs (agent_id, task_id, task, status, output, via, org_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, fields.taskId ?? null, task, fields.status, fields.output ?? null, fields.via, org],
      ).catch(() => {});
      await query(`INSERT INTO agent_activity (agent_id, kind, org_id) VALUES ($1, 'task', $2)`, [id, org]).catch(() => {});
    };

    // 1) Dispatch to the Hermes agent's kanban queue — REAL autonomous execution
    //    with its own tools, terminal, memory and skills. Poll briefly for the
    //    result; if it's still working past the window, return the task handle.
    try {
      const create = await hermes.post<any>("/api/plugins/kanban/tasks", {
        title: `${agent.name}: ${task.slice(0, 70)}`,
        body: `${system}\n\n--- TASK ---\n${task}\n\n--- OUTPUT REQUIREMENT ---\nWhen you finish, your completion summary MUST BE the full deliverable itself — the actual content requested (the email text, the bullet list, the answer, etc.), ready to use as-is. Do NOT return a description of what you did; return the work product.`,
        assignee: "default",
        max_runtime_seconds: 900,
      });
      const tid: string | undefined = create.data?.task?.id;
      if (create.ok && tid) {
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 4000));
          const g = await hermes.get<any>(`/api/plugins/kanban/tasks/${tid}`);
          const t = g.data?.task ?? g.data;
          const st: string | undefined = t?.status;
          if (st === "done") {
            const output = String(t.latest_summary || t.result || "Task complete.");
            await record({ taskId: tid, status: "done", output, via: "hermes" });
            return { ok: true, output, via: "hermes", at };
          }
          if (st === "blocked" || st === "failed" || st === "error") {
            const detail = `Hermes task ${st}: ${t?.latest_summary ?? "see the Hermes board"}`;
            await record({ taskId: tid, status: "failed", output: detail, via: "hermes" });
            return { ok: false, output: "", detail, via: "hermes", at };
          }
        }
        // Still running past the poll window — real autonomous work can take a while.
        await record({ taskId: tid, status: "running", via: "hermes" });
        return { ok: true, output: `Dispatched to the Hermes agent (task ${tid}) and it's running autonomously — this one is taking longer than 90s. It will finish in the background; watch Run history.`, via: "hermes", at };
      }
    } catch { /* fall through to provider */ }

    // 2) Fall back to the active AI Core provider (reasoning without Hermes tools).
    const active = await getActiveProvider(orgId(req));
    if (active) {
      const r = await completeProviderChat(active, [ { role: "system", content: system }, { role: "user", content: task } ]);
      if (r.ok && r.content) {
        await record({ status: "done", output: r.content, via: "provider" });
        return { ok: true, output: r.content, via: "provider", at };
      }
    }
    reply.code(502);
    return { ok: false, output: "", detail: "No runtime available — connect a model in AI Core, or start the Hermes gateway.", via: "none", at };
  });

  // Run history for one agent. Refreshes any still-running Hermes tasks from the
  // kanban board so completed work shows its result.
  app.get("/api/agents/:id/runs", async (req): Promise<AgentRunRecord[]> => {
    const { id } = req.params as { id: string };
    const org = orgId(req);
    const rows = await query<{ id: number; agent_id: string; task_id: string | null; task: string; status: string; output: string | null; via: string | null; created_at: string; updated_at: string }>(
      `SELECT * FROM agent_runs WHERE agent_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 30`,
      [id, org],
    );
    // Refresh in-flight Hermes runs.
    for (const r of rows.filter((x) => x.status === "running" && x.task_id)) {
      try {
        const g = await hermes.get<any>(`/api/plugins/kanban/tasks/${r.task_id}`);
        const t = g.data?.task ?? g.data;
        const st: string | undefined = t?.status;
        if (st === "done" || st === "blocked" || st === "failed" || st === "error") {
          const done = st === "done";
          const output = String(t.latest_summary || t.result || (done ? "Task complete." : `Task ${st}`));
          await query(`UPDATE agent_runs SET status = $1, output = $2, updated_at = now() WHERE id = $3`, [done ? "done" : "failed", output, r.id]).catch(() => {});
          r.status = done ? "done" : "failed";
          r.output = output;
        }
      } catch { /* leave as running */ }
    }
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      taskId: r.task_id ?? undefined,
      task: r.task,
      status: (r.status as AgentRunRecord["status"]) ?? "done",
      output: r.output ?? undefined,
      via: r.via ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });

  // Runtime executions. Prefer live hermes runs; fall back to the seeded log.
  app.get("/api/agents/runs", async (req) => {
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
    const seeded = await getSetting<AgentRun[]>(orgId(req), "runs");
    return seeded ?? [];
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

  app.get("/api/agents/runtime", async (req): Promise<RuntimeStats> => {
    const rows = await query<{ status: string }>(`SELECT status FROM agents WHERE org_id = $1`, [orgId(req)]);
    const active = rows.filter((r) => r.status === "optimal").length;
    const runs = (await getSetting<AgentRun[]>(orgId(req), "runs")) ?? [];
    const stepsToday = runs.reduce((n, r) => n + (r.steps?.length ?? 0), 0);
    const errors = runs.reduce((n, r) => n + (r.errCount ?? 0), 0);
    return { active, recentRuns: runs.length, stepsToday, errors };
  });
}
