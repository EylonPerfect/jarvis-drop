import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load the repo-root .env (../../../.env from apps/bff/src).
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

const isProd = process.env.NODE_ENV === "production";

export const config = {
  port: Number(process.env.PORT ?? 8787),
  // Fail-safe: bind loopback by default. Containers/compose set HOST=0.0.0.0
  // explicitly (the BFF is only reachable on the compose network, not published).
  host: process.env.HOST ?? "127.0.0.1",
  webOrigin: (process.env.WEB_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Optional shared secret guarding the BFF. When set, inbound /api requests
  // must carry it (X-API-Key or Bearer). The BFF proxies into hermes' full
  // toolset (terminal), so a public deployment MUST set this and/or sit behind
  // an authenticating reverse proxy. See index.ts auth hook.
  bffApiKey: process.env.BFF_API_KEY,

  // Single-process mode: serve the built web app from the BFF (SPA fallback).
  serveWeb: (process.env.SERVE_WEB ?? "false") === "true",
  // Absolute path to apps/web/dist (defaults to the sibling build output).
  webDir: process.env.WEB_DIR ?? resolve(__dirname, "../../web/dist"),

  // Run schema migration on boot; seed only when empty (or SEED_ON_BOOT=true).
  migrateOnBoot: (process.env.MIGRATE_ON_BOOT ?? "true") === "true",
  seedOnBoot: process.env.SEED_ON_BOOT, // "true" | "false" | undefined (auto: seed if empty)

  hermes: {
    baseUrl: (process.env.HERMES_BASE_URL ?? "http://127.0.0.1:8642").replace(/\/$/, ""),
    // In production, fail fast rather than booting with the placeholder key.
    apiKey: isProd ? required("HERMES_API_KEY") : process.env.HERMES_API_KEY ?? "change-me",
    sessionKey: process.env.HERMES_SESSION_KEY ?? "operator-primary",
    // Default to Claude (hermes routes it via its configured provider, e.g. Nexos).
    model: process.env.HERMES_MODEL ?? "claude-sonnet-4-6",
    // Hostinger Hermes dashboard uses a session-cookie login (no bearer key).
    // When these are set, the BFF logs in and authenticates /v1/* with the cookie.
    dashUser: process.env.HERMES_DASH_USER,
    dashPass: process.env.HERMES_DASH_PASS,
  },

  db: {
    url: required("DATABASE_URL", "postgres://jarvis:jarvis@127.0.0.1:5432/jarvis"),
    ssl: (process.env.DATABASE_SSL ?? "false") === "true",
  },
};

export type Config = typeof config;
