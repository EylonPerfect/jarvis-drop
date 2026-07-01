import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { hermes } from "../hermes.js";
import type { AICoreState, ProviderKey } from "@jarvis/shared";

export default async function aiCoreRoutes(app: FastifyInstance) {
  app.get("/api/aicore", async (): Promise<AICoreState> => {
    const cfg = (await one<{ value: any }>(`SELECT value FROM settings WHERE key = 'ai_core'`))?.value ?? {};
    const providers: ProviderKey[] = (await query(`SELECT * FROM provider_keys ORDER BY sort`)).map((r: any) => ({
      id: r.id, name: r.name, tier: r.tier, tierTone: r.tier_tone, placeholder: r.placeholder, connected: r.connected,
    }));

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
      activeModel: cfg.activeModel ?? "hermes",
      connectedProviders: cfg.connectedProviders ?? `${providers.filter((p) => p.connected).length} ready`,
      fallbacks: cfg.fallbacks ?? "Use active model",
      savedKeys: cfg.savedKeys ?? `${providers.filter((p) => p.connected).length} of ${providers.length}`,
      providers,
      routing: cfg.routing ?? true,
      streaming: cfg.streaming ?? true,
      verification: cfg.verification ?? false,
      models,
    };
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

  app.patch("/api/aicore/providers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { connected?: boolean };
    const existing = await one(`SELECT * FROM provider_keys WHERE id = $1`, [id]);
    if (!existing) return reply.code(404).send({ error: "not found" });
    await query(`UPDATE provider_keys SET connected = COALESCE($2, connected) WHERE id = $1`, [id, b.connected ?? null]);
    return { ok: true };
  });
}
