import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";
import { openSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { orgId } from "../lib/auth.js";
import { getSetting, setSetting } from "../lib/settingsStore.js";

// The Cartographer — read-only product crawler (/app/ah/cartographer.mjs) that
// writes the `site_map` settings key the voice bridge's goto tool verifies
// against. This route spawns it detached (same idiom live.ts uses for call
// scripts) and mirrors its PHASE lines into settings `site_map_status`.

const AH = "/app/ah";
const LOG = `${AH}/cartographer.log`;
const STALE_MS = 15 * 60_000; // a "running" older than this is a crashed run

async function setStatus(org: string, v: Record<string, unknown>): Promise<void> {
  await setSetting(org, "site_map_status", v);
}

export default async function cartographerRoutes(app: FastifyInstance) {
  app.post("/api/cartographer/run", async (req, reply) => {
    const org = orgId(req);
    const s = await getSetting<{ state?: string; startedAt?: string }>(org, "site_map_status");
    if (s?.state === "running" && s.startedAt && Date.now() - new Date(s.startedAt).getTime() < STALE_MS) {
      return reply.code(409).send({ error: "a crawl is already running", startedAt: s.startedAt });
    }
    const startedAt = new Date().toISOString();
    await setStatus(org, { state: "running", phase: "starting", startedAt });
    writeFileSync(LOG, `[cartographer.ts] run at ${startedAt}\n`);
    const out = openSync(LOG, "a");
    // Detached with FILE stdio (not a pipe): the crawl finishes and stores the
    // map on its own even if the bff restarts mid-run.
    const child = spawn("node", [`${AH}/cartographer.mjs`], {
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env, CARTO_TS: startedAt },
    });
    child.unref();
    app.log.info({ pid: child.pid }, "cartographer spawned");

    // Mirror the script's PHASE lines into site_map_status while we're alive.
    const t0 = Date.now();
    const timer = setInterval(() => {
      void (async () => {
        let tail = "";
        try { tail = readFileSync(LOG, "utf8").slice(-12000); } catch { return; }
        const phases = tail.split("\n").filter((l) => l.startsWith("PHASE "));
        const last = phases[phases.length - 1] ?? "";
        const phase = last.slice(6, 166).trim();
        if (phase.startsWith("DONE")) {
          clearInterval(timer);
          await setStatus(org, { state: "done", phase: "done", startedAt, endedAt: new Date().toISOString() });
        } else if (phase.startsWith("ERROR")) {
          clearInterval(timer);
          await setStatus(org, { state: "error", phase, startedAt, endedAt: new Date().toISOString() });
        } else if (Date.now() - t0 > STALE_MS) {
          clearInterval(timer);
          await setStatus(org, { state: "error", phase: phase || "timed out", startedAt, endedAt: new Date().toISOString() });
        } else if (phase) {
          await setStatus(org, { state: "running", phase, startedAt });
        }
      })().catch(() => { /* next tick retries */ });
    }, 3000);
    // Belt-and-braces: a clean exit also finalizes status (covers a crash
    // before any PHASE DONE/ERROR line reaches the log).
    child.on("exit", (code) => {
      setTimeout(() => {
        void (async () => {
          const cur = await getSetting<{ state?: string }>(org, "site_map_status");
          if (cur?.state === "running") {
            clearInterval(timer);
            await setStatus(org, { state: code === 0 ? "done" : "error", phase: code === 0 ? "done" : `exit ${code}`, startedAt, endedAt: new Date().toISOString() });
          }
        })().catch(() => { /* ignore */ });
      }, 4000);
    });
    return reply.code(202).send({ ok: true, startedAt });
  });

  app.get("/api/cartographer/map", async (req) => {
    const org = orgId(req);
    const m = await getSetting<unknown>(org, "site_map");
    const df = await getSetting<unknown>(org, "site_map_diff");
    const st = await getSetting<unknown>(org, "site_map_status");
    return { map: m ?? null, diff: df ?? null, status: st ?? null };
  });

  // Screenshot of a crawled destination (saved by cartographer.mjs before the
  // sandbox dies). Authed like every /api route; key is strictly sanitized.
  app.get("/api/cartographer/shot/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    if (!/^[a-z0-9-]{1,80}$/.test(key)) return reply.code(400).send({ error: "bad key" });
    const path = `${AH}/sitemap-shots/${key}.png`;
    if (!existsSync(path)) return reply.code(404).send({ error: "no screenshot for that destination" });
    reply.header("content-type", "image/png").header("cache-control", "no-store");
    return reply.send(readFileSync(path));
  });

  // Human curation: drop one destination from the stored map (the crawl is a
  // draft; pruning is a human act). Also removes its screenshot.
  app.post("/api/cartographer/remove", async (req, reply) => {
    const b = (req.body ?? {}) as { key?: string };
    const key = (b.key ?? "").trim();
    if (!/^[a-z0-9-]{1,80}$/.test(key)) return reply.code(400).send({ error: "key required" });
    const org = orgId(req);
    const map = await getSetting<{ destinations?: { key: string }[] }>(org, "site_map");
    if (!map || !Array.isArray(map.destinations)) return reply.code(404).send({ error: "no site map stored" });
    const before = map.destinations.length;
    map.destinations = map.destinations.filter((r) => r.key !== key);
    if (map.destinations.length === before) return reply.code(404).send({ error: `no destination '${key}' in the map` });
    await setSetting(org, "site_map", map);
    try { rmSync(`${AH}/sitemap-shots/${key}.png`, { force: true }); } catch { /* ignore */ }
    app.log.info({ key }, "site-map destination removed by operator");
    return { ok: true, removed: key, destinations: map.destinations.length };
  });
}
