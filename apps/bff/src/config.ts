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

const num = (name: string, fallback: number): number => {
  const v = process.env[name];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

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

  // Phase-2 auth. mode="access-code" (default) keeps the single shared-secret
  // gate and pins every request to the legacy org — nothing changes pre-cutover.
  // mode="password" activates real email+password + session-cookie auth and
  // requires a valid session on every /api request.
  auth: {
    mode: (process.env.AUTH_MODE ?? "access-code") as "access-code" | "password",
    cookieName: process.env.SESSION_COOKIE ?? "ah_session",
    sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
    // Secure cookies in prod by default (require HTTPS). Override for local http.
    cookieSecure: (process.env.COOKIE_SECURE ?? (isProd ? "true" : "false")) === "true",
    // Set false to lock down public signup once orgs are provisioned by invite.
    allowSignup: (process.env.AUTH_ALLOW_SIGNUP ?? "true") === "true",
  },
  // The org all pre-existing single-tenant rows were backfilled into, and the org
  // every request is pinned to while in access-code mode. Matches tenancy.sql.
  legacyOrgId: process.env.LEGACY_ORG_ID ?? "org_legacy",

  // App-layer encryption-at-rest key for stored credentials (demo_login
  // passwords). 32 bytes as 64-hex or base64, or any passphrase (hashed to 32B).
  // Sourced from the environment/secret store — NEVER the DB or the repo. When
  // unset, credential secrets are stored as plaintext and a warning is logged at
  // boot (fine for local dev; production MUST set it — see runbook).
  credEncKey: process.env.CRED_ENC_KEY,

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
    // The dashboard's login-submit endpoint. The Hostinger template's login form
    // is JS-driven (data-provider="basic") and POSTs JSON to /auth/password-login
    // (verified against the live template). Overridable in case it changes.
    loginPath: process.env.HERMES_LOGIN_PATH ?? "/auth/password-login",
  },

  db: {
    url: required("DATABASE_URL", "postgres://jarvis:jarvis@127.0.0.1:5432/jarvis"),
    ssl: (process.env.DATABASE_SSL ?? "false") === "true",
  },

  // Real server-side headless Chrome (browserless) the Command Center drives.
  browserless: {
    url: (process.env.BROWSERLESS_URL ?? "http://browserless:3000").replace(/\/$/, ""),
    token: process.env.BROWSERLESS_TOKEN ?? "lsbrowser",
  },

  // Model tiers (Phase 3, task 4). The live realtime call keeps the high-quality
  // model; non-live back-office work (extraction, persona-compile, verify,
  // redteam, playbook analysis) routes to the cheaper tier when set. Empty ⇒
  // fall back to the active provider's own configured model (no behavior change).
  models: {
    cheapTier: (process.env.CHEAP_MODEL_TIER ?? "").trim(), // e.g. "gpt-4o-mini"
  },

  // Phase 3 — metering & cost safety. All thresholds/rates are config-driven so
  // they can be tuned per environment without a code change. Rates are USD and
  // are ESTIMATES seeded from COST-MODEL.md (current public list prices); the
  // ledger stores the actual computed cost per event either way.
  metering: {
    // ---- unit COGS rates (USD) ----
    sandboxUsdPerMin: num("METER_SANDBOX_USD_PER_MIN", 0.003),  // e2b desktop (~2 vCPU/4 GiB = $0.166/hr)
    ttsUsdPerChar: num("METER_TTS_USD_PER_CHAR", 0.00005),     // ElevenLabs Turbo/Flash (~$0.05 / 1k chars)
    llmUsdPer1kInput: num("METER_LLM_USD_PER_1K_IN", 0.0025),   // blended default (tool/back-office model)
    llmUsdPer1kOutput: num("METER_LLM_USD_PER_1K_OUT", 0.01),
    // live_call_minute is the BILLABLE unit; unit_cost recorded on the event is
    // the fully-loaded COGS floor per minute (see COST-MODEL.md).
    liveCallUsdPerMin: num("METER_LIVE_CALL_USD_PER_MIN", 0.15),

    // ---- hybrid caps (defaults; per-org overrides live in org_billing_config) ----
    includedMinutesDefault: num("METER_INCLUDED_MINUTES", 500),   // SOFT cap / allowance per org / month
    hardCapMinutesDefault: num("METER_HARD_CAP_MINUTES", 750),    // HARD cap per org / month (pauses new calls)
    overagePerMinDefault: num("METER_OVERAGE_PER_MIN", 1.50),     // billed price per overage minute

    // ---- global runaway-spend circuit breaker ----
    // If total COGS across ALL orgs in the trailing window exceeds the limit,
    // new calls/sandboxes are refused platform-wide until it clears or the
    // operator resets. 0 disables the breaker.
    runawayWindowMinutes: num("METER_RUNAWAY_WINDOW_MIN", 60),
    runawayUsdLimit: num("METER_RUNAWAY_USD_LIMIT", 100),
  },

  // BILLING (Lemon Squeezy — merchant-of-record, handles global tax/VAT). All
  // optional: when apiKey is unset the billing routes return a clean "billing
  // not configured" and orgCanGoLive reads DB state only. `variants` are the
  // per-plan LS Variant ids the operator creates (Starter = a tiered/graduated
  // variant: 1st clone ~\$2000 then ~\$1500/ea; Growth = flat ~\$1500/unit);
  // the checkout quantity = certified/live clone slots.
  // Transactional email (Resend). Platform infra — the app sends on its own
  // behalf from a verified domain, NOT per-org. INERT until apiKey + from are set
  // (a verified sending domain in Resend), like billing/demo. Swappable provider:
  // lib/email.ts is the only place that talks to Resend's HTTP API.
  email: {
    apiKey: process.env.RESEND_API_KEY ?? "",
    from: process.env.EMAIL_FROM ?? "AfterHuman <notifications@after-human.com>",
    appUrl: (process.env.APP_PUBLIC_URL ?? "https://afterhuman.srv1797540.hstgr.cloud").replace(/\/$/, ""),
  },
  billing: {
    apiKey: process.env.LEMONSQUEEZY_API_KEY,
    storeId: process.env.LEMONSQUEEZY_STORE_ID,
    webhookSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET,
    variants: {
      starter: process.env.LEMONSQUEEZY_VARIANT_STARTER,
      growth: process.env.LEMONSQUEEZY_VARIANT_GROWTH,
    },
    // The free->paid LIVE gate (lib/billing.ts orgCanGoLive). Default OFF so the
    // patch is INERT on the existing legacy tenant until the operator turns
    // billing on (set up Lemon Squeezy + assign plans), then flips this true.
    gateEnforced: (process.env.BILLING_GATE_ENFORCED ?? "false") === "true",
    // FREE-TIER REHEARSAL CAP: lifetime rehearsal runs a FREE (no active paid
    // plan) org may launch before it must go live to keep rehearsing (E2B cost
    // control). Paid orgs are uncapped. Only enforced when gateEnforced is true,
    // so the whole funnel stays unlimited/no-paywall until billing is turned on.
    freeRehearsalCap: num("FREE_REHEARSAL_CAP", 10),
    // Optional explicit Checkout/Portal redirect overrides (else derived from the
    // request Origin / WEB_ORIGIN).
    successUrl: process.env.BILLING_SUCCESS_URL,
    cancelUrl: process.env.BILLING_CANCEL_URL,
    portalReturnUrl: process.env.BILLING_PORTAL_RETURN_URL,
  },

  // Super-admin control plane (cross-org). PRIMARY active gate = IP allowlist.
  superadmin: {
    // Comma-separated IPv4/CIDR or exact IPs. EMPTY = allow all (dev default) —
    // MUST be set in production. e.g. "203.0.113.4,10.0.0.0/8".
    ipAllowlist: (process.env.SUPERADMIN_IP_ALLOWLIST ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean),
    // Short session TTL (minutes) by design.
    sessionTtlMinutes: Number(process.env.SUPERADMIN_SESSION_TTL_MIN ?? 30),
    // Time-box for an "enter org" impersonation grant (minutes).
    impersonationTtlMinutes: Number(process.env.SUPERADMIN_IMPERSONATION_TTL_MIN ?? 30),
    // Dormant TOTP MFA. Default OFF; do NOT require. Set "on" to enable.
    mfa: (process.env.SUPERADMIN_MFA ?? "off").toLowerCase() === "on",
    // First-run bootstrap identity. Prefer a scrypt hash in prod; plaintext is a
    // dev convenience (hashed on bootstrap, must be strong).
    bootstrapEmail: process.env.SUPERADMIN_EMAIL,
    bootstrapPasswordHash: process.env.SUPERADMIN_PASSWORD_HASH,
    bootstrapPassword: process.env.SUPERADMIN_PASSWORD,
    cookieName: process.env.SUPERADMIN_COOKIE ?? "sa_session",
    cookieSecure: (process.env.SUPERADMIN_COOKIE_SECURE ?? String(isProd)) === "true",
  },


  // ---- Public "Talk to Ava" demo (warm E2B pool + unauthenticated API). ----
  // Warming is OFF unless DEMO_POOL_ENABLED=true so a build/import never touches
  // E2B. DEMO_AGENT_ID/DEMO_ORG_ID are supplied by the coordinator (the fixed
  // demo clone + tenant the warm sandboxes boot against).
  demo: {
    poolEnabled: (process.env.DEMO_POOL_ENABLED ?? "false") === "true",
    poolSize: num("DEMO_POOL_SIZE", 3),
    maxSandboxes: num("DEMO_MAX_SANDBOXES", 6),   // HARD cap: pool + in-use
    agentId: (process.env.DEMO_AGENT_ID ?? "").trim(),
    orgId: (process.env.DEMO_ORG_ID ?? process.env.LEGACY_ORG_ID ?? "org_legacy").trim(),
    sessionSec: num("DEMO_SESSION_SEC", 360),     // hard session timeout
    slotTtlSec: num("DEMO_SLOT_TTL_SEC", 1500),   // recycle idle ready slots (< 55m e2b cap)
    bootTimeoutSec: num("DEMO_BOOT_TIMEOUT_SEC", 300),
    perIpActive: num("DEMO_PER_IP_ACTIVE", 1),    // concurrent active sessions / IP
    perIpHour: num("DEMO_PER_IP_HOUR", 5),        // session starts / IP / hour
  },
};

export type Config = typeof config;
