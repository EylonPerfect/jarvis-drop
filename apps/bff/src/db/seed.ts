import { pool } from "./pool.js";

// Mirrors the J.A.R.V.I.S. prototype mock data so every screen renders
// identically on first run. Idempotent: truncates then re-inserts.

const J = (v: unknown) => JSON.stringify(v);

const agents: Array<[string, string, string, string, string, string, number]> = [
  ["ag_coding", "code", "Coding Agent", "Writing code", "optimal", "Active", 0],
  ["ag_research", "search", "Research Agent", "Deep analysis", "optimal", "Active", 1],
  ["ag_memory", "database", "Memory Agent", "Idle", "standby", "Standby", 2],
  ["ag_browser", "globe", "Browser Agent", "Idle", "standby", "Standby", 3],
  ["ag_task", "list-checks", "Task Agent", "Idle", "standby", "Standby", 4],
  ["ag_system", "shield-check", "System Agent", "Monitoring", "optimal", "Active", 5],
];

const tasks: Array<[string, string, string, string, string[], string | null, number]> = [
  ["t1", "Design holographic onboarding tour", "todo", "high", ["ux", "onboarding", "hud"], "Unblocks 1", 0],
  ["t2", "Write voice pipeline integration tests", "todo", "medium", ["voice", "testing"], null, 1],
  ["t3", "Audit MSIX capability manifest for mic + camera", "todo", "critical", ["msix", "security", "store"], "Unblocks 2", 2],
  ["t4", "Refactor command-center weather provider failover", "todo", "low", ["command-center", "weather"], null, 3],
  ["t5", "Build unified /command_center/today endpoint", "progress", "critical", ["command-center", "api", "flagship"], "Unblocks 3", 0],
  ["t6", "Wire Kokoro + edge-tts cascading TTS fallback", "progress", "high", ["voice", "tts"], "Unblocks 1", 1],
  ["t7", "Reduce Electron cold-boot below 7 seconds", "progress", "medium", ["performance", "electron", "boot"], null, 2],
  ["t8", "Enable email verification in auth-api", "blocked", "high", ["auth", "email", "verification"], "Waiting on 2", 0],
  ["t9", "Ship Store trial + license enforcement gate", "blocked", "critical", ["store", "licensing", "billing"], "Waiting on 1", 1],
  ["t10", "Fix mic permission handler in Electron + MSIX", "done", "critical", ["voice", "permissions", "electron"], null, 0],
  ["t11", "Split system.py god object into 8 modules", "done", "high", ["refactor", "architecture"], null, 1],
  ["t12", "Reorganize core/ into 7 domain subpackages", "done", "medium", ["refactor", "core"], null, 2],
  ["t13", "Add admin error-reporting dashboard pipeline", "done", "high", ["admin", "observability"], null, 3],
  ["t14", "Migrate task schema to Alembic revision", "done", "low", ["database", "alembic", "tasks"], null, 4],
];

const reminders: Array<[string, string, string, string, number]> = [
  ["r1", "Reply to Sarah about Q3 roadmap", "13 Jun, 1:30 pm", "overdue", 0],
  ["r2", "Submit expense report for May", "12 Jun, 10:00 pm", "overdue", 1],
  ["r3", "Deep-work block: Voice pipeline", "13 Jun, 7:00 pm", "overdue", 2],
  ["r4", "Stand-up notes to Engineering Lead", "13 Jun, 9:30 pm", "overdue", 3],
  ["r5", "Renew TLS certificate on jarvis-core", "11 Jun, 2:00 pm", "overdue", 4],
  ["r6", "1:1 with Engineering Lead", "14 Jun, 3:00 pm", "overdue", 5],
  ["r7", "Back up local Postgres volume", "14 Jun, 2:00 am", "overdue", 6],
  ["r8", "Design freeze checkpoint", "15 Jun, 10:00 pm", "today", 0],
  ["r9", "Submit MSIX build to the Microsoft Store", "17 Jun, 2:00 pm", "upcoming", 0],
  ["r10", "Confirm v3.0.0 release date with PM", "18 Jun, 4:00 pm", "upcoming", 1],
];

const timeEntries: Array<[string, string, string, number, string, number]> = [
  ["te1", "Command Center V1 — HUD layout", "Jarvis Design", 142, "Design", 0],
  ["te2", "Voice pipeline latency profiling", "Jarvis Core", 90, "Core dev", 1],
  ["te3", "Design review prep", "Jarvis Design", 55, "Design", 2],
  ["te4", "Code review — PR #482", "Jarvis Core", 69, "Review", 3],
  ["te5", "Release notes for v3.0.0", "Jarvis Core", 35, "Docs", 4],
];

const memoryFacts: Array<[string, string, string, number, number]> = [
  ["mf1", "Role", "Founder-engineer building the Jarvis assistant", 98, 0],
  ["mf2", "Location", "Bhimber, Azad Kashmir, Pakistan", 96, 1],
  ["mf3", "Timezone", "Asia/Karachi (UTC+5)", 95, 2],
  ["mf4", "Focus", "Command Center V1 + cascading voice interface", 92, 3],
];

const styleProfiles: Array<[string, string, string, string, number]> = [
  ["sp1", "engineering", "formality 0.62 · vocab 0.71 · emoji 0.02", "684 msgs", 0],
  ["sp2", "design", "formality 0.48 · vocab 0.66 · emoji 0.04", "312 msgs", 1],
  ["sp3", "planning", "formality 0.55 · vocab 0.69 · emoji 0.01", "198 msgs", 2],
];

const knowledgeSources: Array<[string, string, string, string, number, string, number]> = [
  ["ks1", "file-text", "Product spec — Command Center V1", "Markdown", 42, "indexed", 0],
  ["ks2", "github", "jarvis-core repository", "Codebase · 1,204 files", 1204, "indexed", 1],
  ["ks3", "book-open", "Electron + MSIX packaging docs", "Web · 18 pages", 18, "indexed", 2],
  ["ks4", "database", "pgvector operations runbook", "Markdown", 9, "indexed", 3],
  ["ks5", "file-text", "Q3 roadmap & OKRs", "Doc", 6, "indexing", 4],
  ["ks6", "message-square", "Support transcripts (last 30d)", "Conversations", 214, "indexed", 5],
];

const collections: Array<[string, string, number, string, number]> = [
  ["c1", "Engineering", 3, "var(--jv-cyan)", 0],
  ["c2", "Design", 2, "var(--jv-violet)", 1],
  ["c3", "Operations", 2, "var(--jv-green)", 2],
  ["c4", "Product", 4, "var(--jv-amber)", 3],
];

const tools: Array<[string, string, string, string, string, boolean, string, number]> = [
  ["tl_github", "MCP Servers", "github", "GitHub", "Repos, PRs, issues", true, "optimal", 0],
  ["tl_whatsapp", "MCP Servers", "message-circle", "WhatsApp", "Messaging bridge", true, "warn", 1],
  ["tl_fs", "MCP Servers", "hard-drive", "Filesystem", "Local file access", true, "optimal", 2],
  ["tl_web", "MCP Servers", "globe", "Web Search", "Live web + fetch", true, "optimal", 3],
  ["tl_gcal", "MCP Servers", "calendar", "Google Calendar", "Events & reminders", false, "neutral", 4],
  ["tl_gmail", "MCP Servers", "mail", "Gmail", "Read & draft mail", false, "neutral", 5],
  ["tl_code", "Built-in Skills", "code", "Code Interpreter", "Run & test code", true, "optimal", 6],
  ["tl_docs", "Built-in Skills", "file-text", "Document Reader", "PDF / DOCX / PPTX", true, "optimal", 7],
  ["tl_vision", "Built-in Skills", "image", "Vision", "Screenshot analysis", true, "optimal", 8],
  ["tl_voice", "Built-in Skills", "mic", "Voice I/O", "STT + cascading TTS", true, "optimal", 9],
  ["tl_memory", "Built-in Skills", "database", "Memory Recall", "Vector retrieval", true, "optimal", 10],
  ["tl_shell", "Built-in Skills", "terminal", "Shell", "System commands", true, "warn", 11],
  ["tl_hubstaff", "Integrations", "clock", "Hubstaff", "Time tracking", true, "optimal", 12],
  ["tl_jira", "Integrations", "trello", "Jira", "Issue sync", false, "neutral", 13],
  ["tl_figma", "Integrations", "figma", "Figma", "Design handoff", false, "neutral", 14],
  ["tl_slack", "Integrations", "slack", "Slack", "Team notifications", true, "optimal", 15],
  ["tl_stripe", "Integrations", "credit-card", "Stripe", "Billing events", false, "neutral", 16],
  ["tl_notif", "Integrations", "bell", "Notifications", "Desktop alerts", true, "optimal", 17],
];

const providerKeys: Array<[string, string, string, string, string, boolean, number]> = [
  ["pk_groq", "Groq", "Free", "free", "gsk_…", true, 0],
  ["pk_openrouter", "OpenRouter", "Paid", "paid", "sk-or-…", false, 1],
  ["pk_gemini", "Gemini", "Free tier", "free tier", "AIza…", false, 2],
  ["pk_openai", "OpenAI", "Paid", "paid", "sk-…", false, 3],
  ["pk_claude", "Claude", "Paid", "paid", "sk-ant-…", false, 4],
];

const costs: Array<[string, number, number, number]> = [
  ["anthropic", 0.6112, 22140, 0],
  ["groq", 0.0934, 12880, 1],
  ["openai", 0.0375, 3430, 2],
];

const conversations = [
  { title: "Command Center V1 design pass", date: "13 Jun" },
  { title: "Voice pipeline latency debugging", date: "13 Jun" },
  { title: "MSIX Store submission checklist", date: "12 Jun" },
  { title: "Refactor loop.py god object", date: "12 Jun" },
  { title: "pgvector migration plan", date: "11 Jun" },
  { title: "Q3 roadmap brainstorm", date: "11 Jun" },
  { title: "Hubstaff integration spec", date: "10 Jun" },
  { title: "Onboarding wizard copy review", date: "10 Jun" },
  { title: "Accessibility audit of the HUD", date: "09 Jun" },
  { title: "Email verification failover chain", date: "09 Jun" },
  { title: "Trial + license enforcement design", date: "08 Jun" },
  { title: "Architecture audit follow-ups", date: "08 Jun" },
];

const runs = [
  {
    id: "run1",
    query: "Research the top 3 STT engines and benchmark latency on my hardware",
    ts: "13 jun, 1:42 pm",
    okCount: 3,
    errCount: 0,
    steps: [
      { agent: "Research Agent", detail: "web_search · 4 results", tone: "green" },
      { agent: "Coding Agent", detail: "wrote benchmark.py · 88 lines", tone: "green" },
      { agent: "Task Agent", detail: "created follow-up task", tone: "green" },
    ],
  },
  {
    id: "run2",
    query: "Draft and validate the Alembic migration to add a due_date column to jarvis_tasks",
    ts: "12 jun, 8:20 pm",
    okCount: 2,
    errCount: 1,
    steps: [
      { agent: "Research Agent", detail: "web_search · 4 results", tone: "green" },
      { agent: "Coding Agent", detail: "wrote migration.py · 62 lines", tone: "green" },
      { agent: "System Agent", detail: "verification failed · retrying", tone: "red" },
    ],
  },
  {
    id: "run3",
    query: "Summarize this week's admin error reports and propose the top fix",
    ts: "12 jun, 12:05 am",
    okCount: 2,
    errCount: 0,
    steps: [
      { agent: "Research Agent", detail: "read 3 reports", tone: "green" },
      { agent: "Coding Agent", detail: "proposed fix diff", tone: "green" },
    ],
  },
  {
    id: "run4",
    query: "Generate release notes for the 2026.6 desktop build and check the MSIX version",
    ts: "10 jun, 4:48 pm",
    okCount: 2,
    errCount: 0,
    steps: [
      { agent: "Coding Agent", detail: "collected 14 merged PRs", tone: "green" },
      { agent: "System Agent", detail: "verified MSIX version", tone: "green" },
    ],
  },
];

const settings: Array<[string, unknown]> = [
  [
    "vector_store",
    { status: "Ready", online: true, items: 3380, detail: "pgvector · 768-dim · 3,380 memories across 42 conversations" },
  ],
  [
    "personal_intelligence",
    {
      prose:
        "You are a hands-on founder-engineer building Jarvis, a local-first AI assistant for Windows. You think like a 30-year senior architect: you value honest, direct recommendations over agreement, and you push for enterprise-grade structure (strict line caps, Alembic migrations, layered modules). Your current focus is the Command Center V1 design pass and the cascading voice interface.",
      interactions: 1342,
      chunks: 287,
      tokens: 41280,
      coreFactsCount: 10,
      styleCount: 5,
    },
  ],
  [
    "ai_core",
    {
      activeModel: "claude-opus-4-8",
      connectedProviders: "4 ready",
      fallbacks: "Use active model",
      savedKeys: "4 of 5",
      routing: true,
      streaming: true,
      verification: false,
      models: ["claude-opus-4-8", "claude-sonnet-4-6", "groq/llama-3.3-70b", "gemini-2.0-flash"],
    },
  ],
  ["conversations", conversations],
  ["runs", runs],
  [
    "feed",
    [
      { icon: "calendar", tone: "info", title: "Design review with the product team", sub: "Meeting", tag: "INFO" },
      { icon: "alert-triangle", tone: "warn", title: '2 tasks are overdue — "Polish voic…"', sub: "Overdue", tag: "WARN" },
      { icon: "git-pull-request", tone: "info", title: "3 pull requests are awaiting your revi…", sub: "Github", tag: "TIP" },
      { icon: "lightbulb", tone: "info", title: "Your deep-work block is 2–4 PM. Noti…", sub: "Focus", tag: "TIP" },
      { icon: "activity", tone: "optimal", title: "CPU usage at 15%", sub: "System load nominal", tag: "LIVE" },
    ],
  ],
  [
    "ledger",
    [
      { tool: "web_search", status: "verified", duration: "412ms", tone: "green" },
      { tool: "fs.read", status: "verified", duration: "8ms", tone: "green" },
      { tool: "email.send", status: "fallback → retry", duration: "1.2s", tone: "amber" },
      { tool: "github.pr.list", status: "verified", duration: "301ms", tone: "green" },
      { tool: "memory.query", status: "verified", duration: "37ms", tone: "green" },
    ],
  ],
  [
    "slow_turns",
    {
      floor: "p95 7.20s + 2σ 700ms = 8.60s",
      turns: [
        { query: "Summarise my unread email and draft replies to the urgent ones", meta: "claude-opus-4-8 · 6 tools · 4 llm · req_d41c", duration: "14.82s" },
        { query: "Cross-reference my Jira board with this week's calendar", meta: "claude-opus-4-8 · 5 tools · 1 err · req_8810", duration: "11.23s" },
        { query: "Research pgvector vs Qdrant and recommend one", meta: "claude-sonnet-4-6 · 4 tools · 5 llm · req_44a0", duration: "9.87s" },
      ],
    },
  ],
  [
    "logs",
    [
      { ts: "07:32:01.482 pm", level: "INFO", module: "jarvis.agent.loop", message: "turn.completed conversation=c_8821 duration_ms=2841", req: "req_7f3a" },
      { ts: "07:31:59.140 pm", level: "INFO", module: "jarvis.tools.dispatch", message: "tool_completed name=web_search duration_ms=412 success=true", req: "req_7f3a" },
      { ts: "07:31:52.003 pm", level: "INFO", module: "jarvis.llm.router", message: "llm.response provider=anthropic model=claude-opus-4-8 tokens_out=612", req: "req_7f3a" },
      { ts: "07:31:48.771 pm", level: "DEBUG", module: "jarvis.memory.vector", message: "query.embedded dim=768 matches=12 latency_ms=37", req: "req_7f3a" },
      { ts: "07:31:40.218 pm", level: "WARN", module: "jarvis.tools.whatsapp", message: "rate_limit approaching window=60s used=54", req: "req_66b1" },
      { ts: "07:31:31.905 pm", level: "ERROR", module: "jarvis.tools.email", message: "smtp.timeout retrying attempt=2 host=smtp.gmail.com", req: "req_66b1" },
    ],
  ],
  [
    "workflows",
    [
      {
        id: "wf1", name: "Morning Briefing", trigger: "Every day · 8:00 am", status: "Enabled",
        steps: [
          { icon: "calendar", label: "Pull today's calendar" },
          { icon: "mail", label: "Summarize unread mail" },
          { icon: "list-checks", label: "List overdue tasks" },
          { icon: "mic", label: "Speak the briefing" },
        ],
      },
      {
        id: "wf2", name: "Release Notes", trigger: "On git tag push", status: "Enabled",
        steps: [
          { icon: "github", label: "Collect merged PRs" },
          { icon: "code", label: "Diff since last tag" },
          { icon: "file-text", label: "Draft notes" },
          { icon: "message-square", label: "Post to Slack" },
        ],
      },
      {
        id: "wf3", name: "Inbox Triage", trigger: "Every 2 hours", status: "Paused",
        steps: [
          { icon: "mail", label: "Fetch new mail" },
          { icon: "sparkles", label: "Classify + prioritize" },
          { icon: "list-checks", label: "Create tasks" },
        ],
      },
      {
        id: "wf4", name: "Nightly Backup", trigger: "Every day · 2:00 am", status: "Enabled",
        steps: [
          { icon: "database", label: "Dump Postgres" },
          { icon: "hard-drive", label: "Snapshot vectors" },
          { icon: "shield-check", label: "Verify integrity" },
        ],
      },
    ],
  ],
  [
    "workflow_runs",
    [
      { id: "wr1", name: "Morning Briefing", when: "8:00 am", tone: "optimal" },
      { id: "wr2", name: "Nightly Backup", when: "2:00 am", tone: "optimal" },
      { id: "wr3", name: "Release Notes", when: "yesterday", tone: "optimal" },
      { id: "wr4", name: "Inbox Triage", when: "paused", tone: "standby" },
    ],
  ],
];

// Sum of rows across every table seed() truncates — the true "is there any
// data here" signal (not just the agents table).
const COUNT_ALL = `SELECT (
  (SELECT COUNT(*) FROM agents)+(SELECT COUNT(*) FROM tasks)+
  (SELECT COUNT(*) FROM reminders)+(SELECT COUNT(*) FROM time_entries)+
  (SELECT COUNT(*) FROM memory_facts)+(SELECT COUNT(*) FROM style_profiles)+
  (SELECT COUNT(*) FROM knowledge_sources)+(SELECT COUNT(*) FROM collections)+
  (SELECT COUNT(*) FROM tool_toggles)+(SELECT COUNT(*) FROM provider_keys)+
  (SELECT COUNT(*) FROM cost_entries)+(SELECT COUNT(*) FROM settings)
)::int AS n`;

/**
 * Truncate and load the canonical demo data. Guarded so it never destroys live
 * data by accident: a transaction-scoped advisory lock serializes concurrent
 * boots, and (unless `force`) it re-checks emptiness under the lock and bails if
 * ANY table already holds rows. `force: true` (CLI / SEED_ON_BOOT=true) always
 * truncates + reseeds.
 */
export async function seed(opts: { force?: boolean } = {}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize across replicas/restarts; auto-released at COMMIT/ROLLBACK.
    await client.query("SELECT pg_advisory_xact_lock($1)", [4815162342]);
    if (!opts.force) {
      const r = await client.query<{ n: number }>(COUNT_ALL);
      if (Number(r.rows[0]?.n ?? 0) > 0) {
        await client.query("COMMIT");
        return; // already has data — never auto-wipe
      }
    }
    await client.query(
      `TRUNCATE agents, tasks, reminders, time_entries, memory_facts, style_profiles,
       knowledge_sources, collections, tool_toggles, provider_keys, cost_entries, settings`,
    );

    for (const [id, icon, name, role, status, label, sort] of agents) {
      await client.query(
        `INSERT INTO agents (id, icon, name, role, status, status_label, model, autonomy, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, icon, name, role, status, label, "claude-opus-4-8", "Ask before acting", sort],
      );
    }
    for (const [id, title, col, priority, tags, link, position] of tasks) {
      await client.query(
        `INSERT INTO tasks (id, title, col, priority, tags, link, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, title, col, priority, J(tags), link, position],
      );
    }
    for (const [id, text, time, grp, sort] of reminders) {
      await client.query(`INSERT INTO reminders (id, text, time, grp, sort) VALUES ($1,$2,$3,$4,$5)`, [id, text, time, grp, sort]);
    }
    for (const [id, title, project, minutes, category, sort] of timeEntries) {
      await client.query(`INSERT INTO time_entries (id, title, project, minutes, category, sort) VALUES ($1,$2,$3,$4,$5,$6)`, [id, title, project, minutes, category, sort]);
    }
    for (const [id, label, value, confidence, sort] of memoryFacts) {
      await client.query(`INSERT INTO memory_facts (id, label, value, confidence, sort) VALUES ($1,$2,$3,$4,$5)`, [id, label, value, confidence, sort]);
    }
    for (const [id, name, stats, msgs, sort] of styleProfiles) {
      await client.query(`INSERT INTO style_profiles (id, name, stats, msgs, sort) VALUES ($1,$2,$3,$4,$5)`, [id, name, stats, msgs, sort]);
    }
    for (const [id, icon, title, kind, chunks, status, sort] of knowledgeSources) {
      await client.query(`INSERT INTO knowledge_sources (id, icon, title, kind, chunks, status, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, icon, title, kind, chunks, status, sort]);
    }
    for (const [id, name, count, color, sort] of collections) {
      await client.query(`INSERT INTO collections (id, name, count, color, sort) VALUES ($1,$2,$3,$4,$5)`, [id, name, count, color, sort]);
    }
    for (const [id, grp, icon, name, descr, enabled, tone, sort] of tools) {
      await client.query(`INSERT INTO tool_toggles (id, grp, icon, name, descr, enabled, status_tone, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, grp, icon, name, descr, enabled, tone, sort]);
    }
    for (const [id, name, tier, tone, placeholder, connected, sort] of providerKeys) {
      await client.query(`INSERT INTO provider_keys (id, name, tier, tier_tone, placeholder, connected, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, name, tier, tone, placeholder, connected, sort]);
    }
    for (const [provider, cost, tokens, sort] of costs) {
      await client.query(`INSERT INTO cost_entries (provider, cost, tokens, sort) VALUES ($1,$2,$3,$4)`, [provider, cost, tokens, sort]);
    }
    for (const [key, value] of settings) {
      await client.query(`INSERT INTO settings (key, value) VALUES ($1,$2)`, [key, J(value)]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// True if ANY seeded table holds rows. Matches seed()'s destructive scope so a
// partially-emptied DB (e.g. all agents deleted) is never treated as unseeded.
export async function isSeeded(): Promise<boolean> {
  try {
    const r = await pool.query<{ n: number }>(COUNT_ALL);
    return Number(r.rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

// CLI entrypoint: `npm run seed` (explicit → force truncate + reseed)
if (import.meta.url === `file://${process.argv[1]}`) {
  seed({ force: true })
    .then(() => {
      console.log("Seed complete.");
      return pool.end();
    })
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
