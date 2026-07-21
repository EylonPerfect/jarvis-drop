import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { orgId } from "../lib/auth.js";
import { hermes } from "../hermes.js";
import { config } from "../config.js";
import type { Integration, IntegrationField, IntegrationTestResult } from "@jarvis/shared";

// PLATFORM-PROVIDED infra integrations: an org that has not connected its own
// falls back to the platform's credential (the platform supplies voice + desktop
// as COGS, like the model provider — see lib/providers.ts getActiveProvider).
// Customer-OWNED connectors (notetaker, slack, gmail, …) NEVER fall back — those
// must be the customer's own account.
const PLATFORM_INTEGRATIONS = new Set(["e2b", "elevenlabs"]);
const PLATFORM_ORG = config.legacyOrgId;

// ============================================================
// Real integration credential store. Follows the ai_providers pattern:
// secrets live server-side in Postgres and are NEVER returned to the browser —
// only a masked hint (`detail`). The canonical catalog below defines each
// connector's fields + how to test it; the `integrations` table holds state.
// ============================================================

type CatalogEntry = Omit<Integration, "connected" | "status" | "detail"> & {
  // Given the stored form values, run a real credential test (or a presence check).
  test?: (v: Record<string, string>) => Promise<IntegrationTestResult>;
  // Build the masked hint shown to the browser once connected.
  detailOf?: (v: Record<string, string>) => string;
};

const last4 = (s?: string) => (s && s.length >= 4 ? s.slice(-4) : "••••");
const mask = (label: string, s?: string) => `${label} ••••${last4(s)}`;

async function googleToken(v: Record<string, string>): Promise<IntegrationTestResult> {
  const clientId = v.clientId?.trim();
  const clientSecret = v.clientSecret?.trim();
  const refreshToken = v.refreshToken?.trim();
  if (!clientId || !clientSecret || !refreshToken) return { ok: false, detail: "Missing client ID / secret / refresh token." };
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    if (r.ok) return { ok: true, detail: `Google OAuth OK${v.senderEmail ? ` · ${v.senderEmail}` : ""}` };
    const t = await r.text();
    return { ok: false, detail: `Google rejected the credentials (${r.status}): ${t.slice(0, 120)}` };
  } catch (e) {
    return { ok: false, detail: `Could not reach Google: ${(e as Error).message}` };
  }
}

const GOOGLE_FIELDS: IntegrationField[] = [
  { key: "clientId", label: "OAuth Client ID", placeholder: "xxxxx.apps.googleusercontent.com" },
  { key: "clientSecret", label: "OAuth Client Secret", secret: true },
  { key: "refreshToken", label: "Refresh Token", secret: true },
  { key: "senderEmail", label: "Account email", placeholder: "csm@goperfectmatch.com", optional: true },
];

const CATALOG: CatalogEntry[] = [
  {
    id: "gmail", label: "Gmail", category: "email", icon: "mail", authKind: "oauth", fields: GOOGLE_FIELDS,
    note: "Read & send email as the agent. Uses a Google OAuth client.",
    docsUrl: "https://console.cloud.google.com/apis/credentials",
    detailOf: (v) => v.senderEmail?.trim() || mask("client", v.clientId),
    test: googleToken,
  },
  {
    id: "google_calendar", label: "Google Calendar", category: "calendar", icon: "calendar", authKind: "oauth", fields: GOOGLE_FIELDS,
    note: "Read the calendar, schedule & join meetings. Same Google OAuth client as Gmail.",
    docsUrl: "https://console.cloud.google.com/apis/credentials",
    detailOf: (v) => v.senderEmail?.trim() || mask("client", v.clientId),
    test: googleToken,
  },
  {
    id: "slack", label: "Slack", category: "messaging", icon: "message-square", authKind: "token", hermesToolset: "slack",
    fields: [
      { key: "botToken", label: "Bot token", placeholder: "xoxb-…", secret: true },
      { key: "defaultChannel", label: "Default channel", placeholder: "#customer-success", optional: true },
    ],
    note: "Post to & read the right channels. Bot token with chat:write, channels:read, channels:history.",
    docsUrl: "https://api.slack.com/apps",
    detailOf: (v) => `bot ••••${last4(v.botToken)}${v.defaultChannel ? ` · ${v.defaultChannel}` : ""}`,
    test: async (v) => {
      const tok = v.botToken?.trim();
      if (!tok) return { ok: false, detail: "Missing bot token." };
      try {
        const r = await fetch("https://slack.com/api/auth.test", { method: "POST", headers: { authorization: `Bearer ${tok}` } });
        const j = (await r.json()) as { ok?: boolean; team?: string; user?: string; error?: string };
        return j.ok ? { ok: true, detail: `Connected to ${j.team} as ${j.user}` } : { ok: false, detail: `Slack: ${j.error ?? "auth failed"}` };
      } catch (e) { return { ok: false, detail: `Could not reach Slack: ${(e as Error).message}` }; }
    },
  },
  {
    id: "elevenlabs", label: "ElevenLabs (Voice)", category: "voice", icon: "mic", authKind: "apiKey", recommended: true, aiHub: true,
    fields: [
      { key: "apiKey", label: "API key", placeholder: "xi-…", secret: true },
      { key: "voiceId", label: "Voice ID", placeholder: "e.g. Rachel / 21m00…", optional: true },
    ],
    note: "Natural voice for live demos & calls. Recommended voice provider.",
    docsUrl: "https://elevenlabs.io/app/settings/api-keys",
    detailOf: (v) => `key ••••${last4(v.apiKey)}${v.voiceId ? ` · voice ${v.voiceId}` : ""}`,
    test: async (v) => {
      const key = v.apiKey?.trim();
      if (!key) return { ok: false, detail: "Missing API key." };
      try {
        const r = await fetch("https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": key } });
        if (r.ok) { const j = (await r.json()) as { subscription?: { tier?: string } }; return { ok: true, detail: `ElevenLabs OK${j.subscription?.tier ? ` · ${j.subscription.tier}` : ""}` }; }
        return { ok: false, detail: `ElevenLabs rejected the key (${r.status}).` };
      } catch (e) { return { ok: false, detail: `Could not reach ElevenLabs: ${(e as Error).message}` }; }
    },
  },
  {
    id: "notetaker", label: "Notetaker (Fathom / Fireflies / Otter / Gong)", category: "productivity", icon: "captions", authKind: "apiKey",
    fields: [
      { key: "provider", label: "Provider", placeholder: "fireflies | otter | gong | fathom" },
      { key: "apiKey", label: "API key", secret: true },
    ],
    note: "Ingest call transcripts so the agent learns how calls are run.",
    detailOf: (v) => `${v.provider || "notetaker"} ••••${last4(v.apiKey)}`,
  },
  {
    id: "crm", label: "CRM (HubSpot / Salesforce)", category: "crm", icon: "database", authKind: "apiKey",
    fields: [
      { key: "provider", label: "Provider", placeholder: "hubspot | salesforce" },
      { key: "apiKey", label: "API key / private-app token", secret: true },
    ],
    note: "Pipeline, accounts & health scores.",
    detailOf: (v) => `${v.provider || "crm"} ••••${last4(v.apiKey)}`,
  },
  {
    id: "notion", label: "Notion", category: "productivity", icon: "file-text", authKind: "token",
    fields: [{ key: "token", label: "Internal integration token", placeholder: "secret_…", secret: true }],
    note: "SOPs, playbooks & docs.",
    docsUrl: "https://www.notion.so/my-integrations",
    detailOf: (v) => `token ••••${last4(v.token)}`,
    test: async (v) => {
      const tok = v.token?.trim();
      if (!tok) return { ok: false, detail: "Missing token." };
      try {
        const r = await fetch("https://api.notion.com/v1/users/me", { headers: { authorization: `Bearer ${tok}`, "Notion-Version": "2022-06-28" } });
        return r.ok ? { ok: true, detail: "Notion connected." } : { ok: false, detail: `Notion rejected the token (${r.status}).` };
      } catch (e) { return { ok: false, detail: `Could not reach Notion: ${(e as Error).message}` }; }
    },
  },
  {
    id: "stripe", label: "Stripe (back office)", category: "payments", icon: "credit-card", authKind: "apiKey",
    fields: [{ key: "secretKey", label: "Secret key", placeholder: "sk_live_… / sk_test_…", secret: true }],
    note: "Billing & payments — every charge is gated by the agent's budget.",
    docsUrl: "https://dashboard.stripe.com/apikeys",
    detailOf: (v) => `key ••••${last4(v.secretKey)}`,
    test: async (v) => {
      const key = v.secretKey?.trim();
      if (!key) return { ok: false, detail: "Missing secret key." };
      try {
        const r = await fetch("https://api.stripe.com/v1/account", { headers: { authorization: `Bearer ${key}` } });
        if (r.ok) { const j = (await r.json()) as { id?: string }; return { ok: true, detail: `Stripe OK · ${j.id ?? "account"}` }; }
        return { ok: false, detail: `Stripe rejected the key (${r.status}).` };
      } catch (e) { return { ok: false, detail: `Could not reach Stripe: ${(e as Error).message}` }; }
    },
  },
  {
    id: "recall", label: "Recall.ai (meeting bot)", category: "voice", icon: "video", authKind: "apiKey", recommended: false, aiHub: true,
    fields: [
      { key: "apiKey", label: "API key", placeholder: "Recall.ai API key", secret: true },
      { key: "region", label: "Region", placeholder: "us-east-1 / eu-central-1 / us-west-2", optional: true },
    ],
    note: "Lets an agent JOIN a live Zoom/Meet/Teams call and speak (paired with the voice provider) to run demos.",
    docsUrl: "https://www.recall.ai/",
    detailOf: (v) => `${v.region || "region?"} · key ••••${last4(v.apiKey)}`,
    test: async (v) => {
      const key = v.apiKey?.trim();
      const region = (v.region?.trim() || "us-east-1").replace(/[^a-z0-9-]/gi, "");
      if (!key) return { ok: false, detail: "Missing API key." };
      try {
        const r = await fetch(`https://${region}.recall.ai/api/v1/bot/?limit=1`, { headers: { authorization: `Token ${key}` } });
        return r.ok ? { ok: true, detail: `Recall.ai connected (${region}).` } : { ok: false, detail: `Recall.ai rejected the key (${r.status}) — check the key and region.` };
      } catch (e) { return { ok: false, detail: `Could not reach Recall.ai: ${(e as Error).message}` }; }
    },
  },
  {
    id: "e2b", label: "E2B (Agent computers)", category: "runtime", icon: "monitor", authKind: "apiKey", recommended: true, aiHub: true,
    fields: [{ key: "apiKey", label: "API key", placeholder: "e2b_…", secret: true }],
    note: "Gives each agent its own virtual computer (Linux desktop) to operate — browse, use apps, do real work. Powers the Agent Workstation.",
    docsUrl: "https://e2b.dev/dashboard",
    detailOf: (v) => `key ••••${last4(v.apiKey)}`,
    test: async (v) => {
      const key = v.apiKey?.trim();
      if (!key) return { ok: false, detail: "Missing API key." };
      try {
        const r = await fetch("https://api.e2b.dev/templates", { headers: { "X-API-KEY": key } });
        if (r.ok) return { ok: true, detail: "E2B connected." };
        if (r.status === 401 || r.status === 403) return { ok: false, detail: `E2B rejected the key (${r.status}).` };
        return { ok: true, detail: `E2B key stored (status ${r.status}).` };
      } catch (e) { return { ok: false, detail: `Could not reach E2B: ${(e as Error).message}` }; }
    },
  },
  {
    id: "demo", label: "Product demo environment", category: "runtime", icon: "monitor-play", authKind: "basic",
    fields: [
      { key: "url", label: "Demo URL", placeholder: "https://demo.goperfectmatch.com" },
      { key: "username", label: "Login", placeholder: "demo user", optional: true },
      { key: "password", label: "Password", secret: true, optional: true },
    ],
    note: "The environment the agent opens in its browser to run a live demo.",
    detailOf: (v) => v.url?.trim() || "demo configured",
  },
  // Hermes-native capabilities — no credentials; available whenever Hermes is up.
  { id: "browser", label: "Headless browser", category: "runtime", icon: "globe", authKind: "none", fields: [], hermesToolset: "browser", note: "Per-agent web browser via Hermes / browserless." },
  { id: "web", label: "Web search", category: "runtime", icon: "search", authKind: "none", fields: [], hermesToolset: "web", note: "Live web search via Hermes." },
  { id: "memory", label: "Long-term memory", category: "runtime", icon: "brain", authKind: "none", fields: [], hermesToolset: "memory", note: "Persistent memory & context via Hermes." },
];

interface Row { id: string; values: Record<string, string>; connected: boolean; detail: string | null }

async function stateFor(org: string, id: string): Promise<Row | null> {
  return one<Row>(`SELECT id, values, connected, detail FROM integrations WHERE org_id = $1 AND id = $2`, [org, id]);
}

// Merge catalog metadata with stored state into a browser-safe Integration
// (secrets stripped; only masked `detail` survives).
function toIntegration(entry: CatalogEntry, row: Row | null, live: boolean): Integration {
  const connected = !!row?.connected;
  return {
    id: entry.id,
    label: entry.label,
    category: entry.category,
    icon: entry.icon,
    authKind: entry.authKind,
    fields: entry.fields,
    note: entry.note,
    recommended: entry.recommended,
    aiHub: entry.aiHub,
    hermesToolset: entry.hermesToolset,
    docsUrl: entry.docsUrl,
    live: entry.authKind === "none" ? live : undefined,
    connected,
    status: connected ? "connected" : "disconnected",
    detail: connected ? row?.detail ?? undefined : undefined,
  };
}

// Ids of an org's integrations that currently have a stored, connected credential.
export async function getConnectedIntegrationIds(org: string): Promise<Set<string>> {
  try {
    const rows = await query<{ id: string }>(`SELECT id FROM integrations WHERE org_id = $1 AND connected = true`, [org]);
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}

// Raw stored values for one of an org's integrations (server-side use only).
// Like getIntegrationValues, but also reports WHICH org's credential was used
// (viaOrg) — the org's own, or the platform (for whitelisted infra). Callers
// that create an external resource (e.g. an ElevenLabs cloned voice) record
// viaOrg so it can later be revoked with the SAME key that created it.
export async function getIntegrationSource(org: string, id: string): Promise<{ values: Record<string, string>; viaOrg: string } | null> {
  const row = await stateFor(org, id);
  if (row?.connected) return { values: row.values ?? {}, viaOrg: org };
  // Platform-provided infra: fall back to the platform's credential so a new
  // self-serve org gets voice/desktop out of the box (customer BYO key wins above).
  if (PLATFORM_INTEGRATIONS.has(id) && org !== PLATFORM_ORG) {
    const platform = await stateFor(PLATFORM_ORG, id);
    if (platform?.connected) return { values: platform.values ?? {}, viaOrg: PLATFORM_ORG };
  }
  return null;
}

export async function getIntegrationValues(org: string, id: string): Promise<Record<string, string> | null> {
  const s = await getIntegrationSource(org, id);
  return s ? s.values : null;
}

export default async function integrationsRoutes(app: FastifyInstance) {
  app.get("/api/integrations", async (req) => {
    const status = await hermes.get<{ version?: string }>("/api/status");
    const live = status.ok && !!status.data && typeof status.data === "object";
    const rows = await query<Row>(`SELECT id, values, connected, detail FROM integrations WHERE org_id = $1`, [orgId(req)]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return CATALOG.map((e) => toIntegration(e, byId.get(e.id) ?? null, live));
  });

  app.post("/api/integrations/:id/connect", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const entry = CATALOG.find((e) => e.id === id);
    if (!entry) return reply.code(404).send({ error: "unknown integration" });
    if (entry.authKind === "none") return reply.code(400).send({ error: "no credentials required" });
    const body = (req.body ?? {}) as { values?: Record<string, unknown> };
    const values: Record<string, string> = {};
    for (const f of entry.fields) {
      const raw = body.values?.[f.key];
      if (raw != null) values[f.key] = String(raw);
    }
    // Required (non-optional) fields must be present.
    const missing = entry.fields.filter((f) => !f.optional && !values[f.key]?.trim());
    if (missing.length) return reply.code(400).send({ error: `missing: ${missing.map((m) => m.label).join(", ")}` });
    const detail = entry.detailOf ? entry.detailOf(values) : "connected";
    const status = await hermes.get<{ version?: string }>("/api/status");
    const live = status.ok && !!status.data && typeof status.data === "object";
    await query(
      `INSERT INTO integrations (org_id, id, values, connected, detail, updated_at)
       VALUES ($4, $1, $2, true, $3, now())
       ON CONFLICT (org_id, id) DO UPDATE SET values = EXCLUDED.values, connected = true, detail = EXCLUDED.detail, updated_at = now()`,
      [id, JSON.stringify(values), detail, orgId(req)],
    );
    return toIntegration(entry, { id, values, connected: true, detail }, live);
  });

  app.post("/api/integrations/:id/test", async (req, reply): Promise<IntegrationTestResult> => {
    const id = (req.params as { id: string }).id;
    const entry = CATALOG.find((e) => e.id === id);
    if (!entry) { reply.code(404); return { ok: false, detail: "unknown integration" }; }
    const row = await stateFor(orgId(req), id);
    if (!row?.connected) return { ok: false, detail: "Not connected yet." };
    if (!entry.test) return { ok: true, detail: `${entry.label} credentials are stored. (No live test available — presence check passed.)` };
    return entry.test(row.values ?? {});
  });

  app.delete("/api/integrations/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    await query(`DELETE FROM integrations WHERE org_id = $1 AND id = $2`, [orgId(req), id]);
    return { ok: true };
  });
}
