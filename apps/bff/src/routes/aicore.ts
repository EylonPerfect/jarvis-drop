import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { hermes } from "../hermes.js";
import { testConnection, type AiProviderRow } from "../lib/providers.js";
import type { AICoreState, ProviderKey, AiProvider, NewAiProvider } from "@jarvis/shared";

// Never leak the raw key to the browser — expose only its last 4 chars.
function rowToProvider(r: AiProviderRow): AiProvider {
  return {
    id: r.id,
    name: r.name,
    baseUrl: r.base_url,
    model: r.model,
    active: r.active,
    hasKey: !!r.api_key,
    keyLast4: r.api_key ? r.api_key.slice(-4) : "",
  };
}

export default async function aiCoreRoutes(app: FastifyInstance) {
  app.get("/api/aicore", async (): Promise<AICoreState> => {
    const cfg = (await one<{ value: any }>(`SELECT value FROM settings WHERE key = 'ai_core'`))?.value ?? {};
    const providers: ProviderKey[] = (await query(`SELECT * FROM provider_keys ORDER BY sort`)).map((r: any) => ({
      id: r.id, name: r.name, tier: r.tier, tierTone: r.tier_tone, placeholder: r.placeholder, connected: r.connected,
    }));

    // Operator-added OpenAI-compatible providers (the ones the chat actually uses).
    const aiProviders = await query<AiProviderRow>(`SELECT * FROM ai_providers ORDER BY created_at`);
    const active = aiProviders.find((p) => p.active);

    // Prefer live model list from hermes /v1/models.
    let models: string[] = cfg.models ?? [];
    const live = await hermes.models();
    const data = live.data as any;
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : null;
    if (live.ok && arr?.length) {
      const ids = arr.map((m: any) => m.id ?? m.name).filter(Boolean);
      if (ids.length) models = ids;
    }

    return {
      activeModel: active ? `${active.model} · ${active.name}` : cfg.activeModel ?? "None",
      connectedProviders: `${aiProviders.length} connected`,
      fallbacks: active ? "Direct provider" : "hermes gateway",
      savedKeys: `${aiProviders.length}`,
      providers,
      routing: cfg.routing ?? true,
      streaming: cfg.streaming ?? true,
      verification: cfg.verification ?? false,
      models,
    };
  });

  // ---- Operator-added AI providers (OpenAI-compatible) --------------------
  app.get("/api/aicore/providers", async (): Promise<AiProvider[]> => {
    const rows = await query<AiProviderRow>(`SELECT * FROM ai_providers ORDER BY created_at`);
    return rows.map(rowToProvider);
  });

  app.post("/api/aicore/providers", async (req, reply) => {
    const b = req.body as Partial<NewAiProvider>;
    const name = b.name?.trim();
    const baseUrl = b.baseUrl?.trim();
    const apiKey = b.apiKey?.trim();
    const model = b.model?.trim();
    if (!name || !baseUrl || !apiKey || !model) {
      return reply.code(400).send({ error: "name, baseUrl, apiKey and model are all required" });
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      return reply.code(400).send({ error: "baseUrl must start with http:// or https://" });
    }
    const id = `prov_${Date.now().toString(36)}`;
    // First provider added becomes active automatically.
    const existing = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ai_providers`);
    const active = (existing?.n ?? 0) === 0;
    await query(
      `INSERT INTO ai_providers (id, name, base_url, api_key, model, active) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, name, baseUrl, apiKey, model, active],
    );
    const row = await one<AiProviderRow>(`SELECT * FROM ai_providers WHERE id = $1`, [id]);
    return reply.code(201).send(rowToProvider(row!));
  });

  app.patch("/api/aicore/providers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as Partial<NewAiProvider> & { active?: boolean };
    const existing = await one<AiProviderRow>(`SELECT * FROM ai_providers WHERE id = $1`, [id]);
    if (!existing) return reply.code(404).send({ error: "not found" });

    // Setting one active deactivates the rest (single active provider).
    if (b.active === true) await query(`UPDATE ai_providers SET active = false`);

    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => {
      sets.push(`${col} = $${sets.length + 1}`);
      vals.push(v);
    };
    if (b.name !== undefined) set("name", b.name.trim());
    if (b.baseUrl !== undefined) set("base_url", b.baseUrl.trim());
    if (b.model !== undefined) set("model", b.model.trim());
    if (b.apiKey !== undefined && b.apiKey.trim()) set("api_key", b.apiKey.trim());
    if (b.active !== undefined) set("active", b.active);
    if (sets.length) {
      vals.push(id);
      await query(`UPDATE ai_providers SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
    }
    const row = await one<AiProviderRow>(`SELECT * FROM ai_providers WHERE id = $1`, [id]);
    return rowToProvider(row!);
  });

  app.delete("/api/aicore/providers/:id", async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM ai_providers WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.delete("/api/aicore/providers", async () => {
    await query(`DELETE FROM ai_providers`);
    return { ok: true };
  });

  // Live credential/connectivity check against the provider's /models endpoint.
  app.post("/api/aicore/providers/:id/test", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await one<AiProviderRow>(`SELECT * FROM ai_providers WHERE id = $1`, [id]);
    if (!row) return reply.code(404).send({ error: "not found" });
    return testConnection(row);
  });

  // Persist advanced toggles. NOTE: provider *keys* live in ~/.hermes/.env on
  // the VPS — they cannot be written over this HTTP API. The UI marks a
  // provider connected and stores that intent; actual keys are set on the box.
  app.patch("/api/aicore", async (req) => {
    const b = req.body as Partial<AICoreState>;
    const cur = (await one<{ value: any }>(`SELECT value FROM settings WHERE key = 'ai_core'`))?.value ?? {};
    const next = {
      ...cur,
      ...(b.activeModel !== undefined ? { activeModel: b.activeModel } : {}),
      ...(b.routing !== undefined ? { routing: b.routing } : {}),
      ...(b.streaming !== undefined ? { streaming: b.streaming } : {}),
      ...(b.verification !== undefined ? { verification: b.verification } : {}),
    };
    // Upsert so a missing row is created (GET tolerates a missing row; the
    // write path must too).
    await query(
      `INSERT INTO settings (key, value) VALUES ('ai_core', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(next)],
    );
    return next;
  });
}
