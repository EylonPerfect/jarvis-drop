import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { hermesReachable } from "./hermes.js";
import { pool } from "./db/pool.js";
import { runMigrations, waitForDb } from "./db/migrate.js";
import { seed } from "./db/seed.js";

import agentsRoutes from "./routes/agents.js";
import tasksRoutes from "./routes/tasks.js";
import calendarRoutes from "./routes/calendar.js";
import memoryRoutes from "./routes/memory.js";
import knowledgeRoutes from "./routes/knowledge.js";
import toolsRoutes from "./routes/tools.js";
import workflowsRoutes from "./routes/workflows.js";
import aiCoreRoutes from "./routes/aicore.js";
import systemRoutes from "./routes/system.js";
import commandRoutes from "./routes/command.js";
import chatRoutes from "./routes/chat.js";
import adminRoutes from "./routes/admin.js";
import stateRoutes from "./routes/state.js";

const app = Fastify({ logger: true });

// Baseline security headers on every response.
app.addHook("onSend", async (_req, reply, payload) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-Frame-Options", "SAMEORIGIN");
  return payload;
});

// Auth gate. The BFF proxies into hermes' full toolset (terminal commands via
// /api/chat), so when a BFF_API_KEY is configured every /api request must carry
// it (X-API-Key or Bearer). Exempt the health probe and static/SPA GETs. When
// no key is set the gate is open — safe only because HOST defaults to loopback;
// a public deployment must set BFF_API_KEY and/or sit behind an auth proxy.
app.addHook("onRequest", async (req, reply) => {
  if (!config.bffApiKey) return;
  if (req.url === "/api/health") return;
  if (req.method === "GET" && !req.url.startsWith("/api")) return; // static / SPA
  const auth = req.headers["authorization"];
  const provided =
    (req.headers["x-api-key"] as string | undefined) ??
    (typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined);
  if (provided !== config.bffApiKey) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

await app.register(cors, { origin: config.webOrigin, credentials: true });

// BFF health (distinct from hermes health): reports DB + hermes reachability.
app.get("/api/health", async () => {
  let db = false;
  try {
    await pool.query("SELECT 1");
    db = true;
  } catch {
    db = false;
  }
  const hermes = await hermesReachable();
  return { ok: true, db, hermes, version: "3.0.0" };
});

await app.register(agentsRoutes);
await app.register(tasksRoutes);
await app.register(calendarRoutes);
await app.register(memoryRoutes);
await app.register(knowledgeRoutes);
await app.register(toolsRoutes);
await app.register(workflowsRoutes);
await app.register(aiCoreRoutes);
await app.register(systemRoutes);
await app.register(commandRoutes);
await app.register(chatRoutes);
await app.register(adminRoutes);
await app.register(stateRoutes);

// Optional single-process mode: serve the built web app + SPA fallback.
if (config.serveWeb) {
  if (existsSync(config.webDir)) {
    await app.register(fastifyStatic, { root: config.webDir, prefix: "/" });
    // SPA fallback: non-API, non-file GETs return index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      reply.code(404).send({ error: "not found" });
    });
    app.log.info(`Serving web build from ${config.webDir}`);
  } else {
    app.log.warn(`SERVE_WEB=true but web build not found at ${config.webDir}`);
  }
}

async function boot() {
  if (config.migrateOnBoot) {
    try {
      app.log.info("Waiting for database…");
      await waitForDb();
      app.log.info("Running migrations…");
      await runMigrations();
      // Clean slate by default: the DB starts EMPTY (no demo records). The
      // canonical demo data is loaded only when explicitly requested via
      // SEED_ON_BOOT=true (or `npm run seed` / the Admin "Load demo" button).
      if (config.seedOnBoot === "true") {
        app.log.info("SEED_ON_BOOT=true — loading demo data…");
        await seed({ force: true });
      }
    } catch (err) {
      // Don't crash at boot if the DB is briefly unavailable — the process
      // stays up so /api/health can report db:false and liveness probes pass.
      // NOTE: individual data routes do NOT have per-route DB fallbacks; while
      // the DB is unreachable they return HTTP 500. Only /api/health degrades.
      app.log.error({ err }, "DB boot lifecycle failed; continuing (data routes will 500 until DB is up)");
    }
  }

  if (config.host !== "127.0.0.1" && config.host !== "::1" && !config.bffApiKey) {
    app.log.warn(
      "BFF is bound to a non-loopback interface with no BFF_API_KEY set — it proxies into hermes' agent (terminal-capable). Set BFF_API_KEY and/or front it with an authenticating proxy.",
    );
  }

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`JARVIS BFF on ${config.host}:${config.port} → hermes ${config.hermes.baseUrl}${config.serveWeb ? " (serving web)" : ""}`);
}

boot().catch((err) => {
  app.log.error(err);
  process.exit(1);
});

// Graceful shutdown for containers.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    try {
      await app.close();
      await pool.end();
    } finally {
      process.exit(0);
    }
  });
}
