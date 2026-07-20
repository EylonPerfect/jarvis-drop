import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { hermesReachable } from "./hermes.js";
import { resolveRequestAuth } from "./lib/auth.js";
import { encryptExistingDemoLogins } from "./lib/tenancy.js";
import { encryptionEnabled } from "./lib/cryptoCreds.js";
import { pool } from "./db/pool.js";
import { runMigrations, waitForDb } from "./db/migrate.js";
import usageRoutes from "./routes/usage.js";
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
import approvalsRoutes from "./routes/approvals.js";
import adminRoutes from "./routes/admin.js";
import stateRoutes from "./routes/state.js";
import filesRoutes from "./routes/files.js";
import browserRoutes from "./routes/browser.js";
import companyRoutes from "./routes/company.js";
import integrationsRoutes from "./routes/integrations.js";
import voiceRoutes from "./routes/voice.js";
import artifactsRoutes from "./routes/artifacts.js";
import meetingsRoutes from "./routes/meetings.js";
import presentRoutes from "./routes/present.js";
import workstationRoutes from "./routes/workstation.js";
import callRoutes from "./routes/call.js";
import cloneCallsRoutes from "./routes/cloneCalls.js";
import studioRoutes from "./routes/studio.js";
import liveRoutes from "./routes/live.js";
import fathomRoutes from "./routes/fathom.js";
import voicechatRoutes from "./routes/voicechat.js";
import cartographerRoutes from "./routes/cartographer.js";
import coachRoutes from "./routes/coach.js";
import readinessRoutes from "./routes/readiness.js";
import fidelityRoutes from "./routes/fidelity.js";
import pipelineRoutes from "./routes/pipeline.js";
import authRoutes from "./routes/auth.js";
import schedulingRoutes, { startScheduler } from "./routes/scheduling.js";
import metricsRoutes from "./routes/metrics.js";
import securityRoutes from "./routes/security.js";
import statusRoutes from "./routes/status.js";
import reportsRoutes from "./routes/reports.js";
import onboardingRoutes from "./routes/onboarding.js";
import superadminRoutes from "./routes/superadmin.js";
import retentionRoutes from "./routes/retention.js";
import billingRoutes from "./routes/billing.js";
import referralsRoutes from "./routes/referrals.js";
import legalRoutes from "./routes/legal.js";
import notificationsRoutes from "./routes/notifications.js";
import demoRoutes from "./routes/demo.js";
import { startDemoPool, drainDemoPool } from "./lib/demoPool.js";
import { startSandboxReaper } from "./lib/sandboxReaper.js";
import { runDailyDigest } from "./lib/digest.js";

// trustProxy: behind Traefik, X-Forwarded-For must be trusted so req.ip / the
// super-admin new-IP alert see the real client IP (CLAUDE.md deploy note).
const app = Fastify({ logger: true, trustProxy: process.env.TRUST_PROXY === "true" });

// Preserve the RAW request body on req.rawBody while still JSON-parsing it, so
// the billing (Lemon Squeezy) webhook can verify its signature over the exact bytes. Applies to
// application/json only; empty bodies parse to {} to keep bodyless POSTs working
// (the web client omits Content-Type when there is no body -- those skip this).
app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  (req as unknown as { rawBody?: string }).rawBody = body as string;
  if (!body || (body as string).trim() === "") return done(null, {});
  try {
    done(null, JSON.parse(body as string));
  } catch (err) {
    (err as Error & { statusCode?: number }).statusCode = 400;
    done(err as Error, undefined);
  }
});

// Baseline security headers on every response.
app.addHook("onSend", async (_req, reply, payload) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-Frame-Options", "SAMEORIGIN");
  return payload;
});

// Auth gate. Two modes, chosen by AUTH_MODE (config.auth.mode):
//
//  access-code (default, pre-cutover): the legacy single shared-secret gate —
//  when BFF_API_KEY is set every /api request must carry it (X-API-Key/Bearer).
//  Every request is pinned to the legacy org so org-scoped queries behave exactly
//  like today's single tenant. Nothing changes for existing clients.
//
//  password (post-cutover): real email+password auth. Every /api request must
//  carry a valid session cookie, which resolves req.user + req.org; unauthenticated
//  requests are rejected (except the login/signup endpoints).
//
// Either way, the BFF proxies into hermes' full toolset (terminal), so a public
// deployment MUST run one of these modes (and sit behind TLS in password mode).
app.addHook("onRequest", async (req, reply) => {
  // Best-effort populate req.user/req.org/req.orgId for EVERY request:
  //  - access-code mode → pinned to the legacy org
  //  - password mode   → resolved from the session cookie when one is present
  // This runs even for the exempt endpoints below so that a cookie-bearing
  // operator-browser call to GET /api/live/* still gets its org. (Cookieless
  // Recall calls fall back to the legacy org — see TENANCY-SCOPING.md.)
  const authed = await resolveRequestAuth(req);

  // Always-open endpoints.
  if (req.url === "/api/health") return;
  // Public: the FE reads the auth mode before choosing a login gate.
  if (req.method === "GET" && req.url === "/api/auth/mode") return;
  // Public status page + its JSON feed (operational transparency; read-only).
  if (req.method === "GET" && (req.url === "/status" || req.url.startsWith("/api/status"))) return;
  // Super-admin surface enforces its own gate (IP allowlist + session +
  // password + role); it is authoritative there, so bypass the shared BFF key.
  if (req.url.startsWith("/api/superadmin")) return;
  // Public "Talk to Ava" demo — unauthenticated by design; it self-rate-limits
  // (per-IP + warm-pool hard cap) inside routes/demo.ts. Mirror superadmin bypass.
  if (req.url.startsWith("/api/demo")) return;
  if (req.method === "GET" && !req.url.startsWith("/api")) return; // static / SPA
  // Presenter page runs inside Recall's headless browser (no login). Its GET
  // endpoints are authorized by the unguessable session id in the URL.
  if (req.method === "GET" && req.url.startsWith("/api/present/")) return;
  // Recall posts real-time transcription here; authorized by the ?t token.
  if (req.method === "POST" && req.url.startsWith("/api/meetings/webhook")) return;
  // Lemon Squeezy posts subscription events here; authorized by the X-Signature
  // HMAC (verifyWebhookSignature), so it bypasses the shared BFF key.
  if (req.method === "POST" && req.url.startsWith("/api/billing/webhook")) return;
  // Real-time voice agent page runs inside Recall's browser (no login). Its GET
  // config/screenshot and the POST token-mint are authorized by the unguessable
  // session id in the URL (same model as /present).
  if (req.method === "GET" && req.url.startsWith("/api/live/")) return;
  if (req.method === "POST" && req.url.startsWith("/api/live/") && (req.url.endsWith("/token") || req.url.endsWith("/act"))) return;

  if (config.auth.mode === "password") {
    // Public: obtaining a session.
    if (req.method === "POST" && (req.url === "/api/auth/login" || req.url === "/api/auth/signup")) return;
    if (!authed.ok) return reply.code(401).send({ error: "unauthorized", reason: authed.reason });
    return;
  }

  // access-code mode: the legacy shared-secret check (open when no key is set —
  // safe only behind loopback / an auth proxy).
  if (!config.bffApiKey) return;
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
await app.register(approvalsRoutes);
await app.register(adminRoutes);
await app.register(usageRoutes);
await app.register(stateRoutes);
await app.register(filesRoutes);
await app.register(browserRoutes);
await app.register(companyRoutes);
await app.register(integrationsRoutes);
await app.register(voiceRoutes);
await app.register(artifactsRoutes);
await app.register(meetingsRoutes);
await app.register(presentRoutes);
await app.register(workstationRoutes);
await app.register(callRoutes);
await app.register(cloneCallsRoutes);
await app.register(studioRoutes);
await app.register(liveRoutes);
await app.register(fathomRoutes);
await app.register(voicechatRoutes);
await app.register(cartographerRoutes);
await app.register(coachRoutes);
await app.register(readinessRoutes);
await app.register(fidelityRoutes);
await app.register(pipelineRoutes);
await app.register(authRoutes);
await app.register(schedulingRoutes);
await app.register(metricsRoutes);
await app.register(securityRoutes);
await app.register(statusRoutes);
await app.register(reportsRoutes);
await app.register(onboardingRoutes);
await app.register(superadminRoutes);
await app.register(retentionRoutes);
await app.register(billingRoutes);
await app.register(referralsRoutes);
await app.register(legalRoutes);
await app.register(notificationsRoutes);
await app.register(demoRoutes);

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
      // Credential encryption at rest: warn loudly if no key, else run the
      // one-time (idempotent) backfill that encrypts any legacy plaintext
      // demo_login passwords in place.
      if (!encryptionEnabled()) {
        app.log.warn("CRED_ENC_KEY is not set — demo_login passwords are stored as PLAINTEXT. Set it in production (see MIGRATION runbook).");
      } else {
        try {
          const n = await encryptExistingDemoLogins();
          if (n > 0) app.log.info(`Encrypted ${n} legacy plaintext demo_login password(s) at rest.`);
        } catch (e) {
          app.log.error({ err: String(e) }, "demo_login credential encryption backfill failed");
        }
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

  // Clone calendar-watch + due-call scheduler (calendar-driven pre-warm + launch,
  // gated by readiness >=70). Timers are unref'd so they never hold the process.
  try { startScheduler(); app.log.info("Clone calendar-watch scheduler started"); }
  catch (err) { app.log.error({ err }, "scheduler failed to start"); }

  // Daily digest: an hourly tick that composes each active org's once-a-day
  // in-app digest around the target hour (notifyOnce dedupes to once/org/day).
  try {
    const digestTimer = setInterval(() => {
      if (new Date().getUTCHours() === 14) void runDailyDigest();
    }, 60 * 60 * 1000);
    (digestTimer as { unref?: () => void }).unref?.();
  } catch (err) { app.log.error({ err }, "daily digest scheduler failed to start"); }

  // Warm-pool for the public "Talk to Ava" demo. NO-OP unless DEMO_POOL_ENABLED=true
  // (so this never warms E2B during a build) — the coordinator flips the flag.
  try { startDemoPool(); }
  catch (err) { app.log.error({ err }, "demo warm-pool failed to start"); }

  // Periodic sandbox reaper: reclaims LEAKED E2B sandboxes (abandoned demos +
  // stale live calls past the 55-min cap) so the account never drifts to the
  // concurrency cap. Conservative -- never touches an active session.
  try { startSandboxReaper(); app.log.info("Sandbox reaper started"); }
  catch (err) { app.log.error({ err }, "sandbox reaper failed to start"); }
}

boot().catch((err) => {
  app.log.error(err);
  process.exit(1);
});

// Graceful shutdown for containers.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    try {
      await drainDemoPool().catch(() => {}); // kill warm sandboxes so a restart never orphans them (E2B cap)
      await app.close();
      await pool.end();
    } finally {
      process.exit(0);
    }
  });
}
