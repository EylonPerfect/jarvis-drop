import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { hermes } from "../hermes.js";
import type { MemoryFact, StyleProfile, VectorStoreStatus, SessionCost, Conversation } from "@jarvis/shared";

export default async function memoryRoutes(app: FastifyInstance) {
  app.get("/api/memory/vector-store", async (): Promise<VectorStoreStatus> => {
    const s = await one<{ value: VectorStoreStatus }>(`SELECT value FROM settings WHERE key = 'vector_store'`);
    return s?.value ?? { status: "Unknown", online: false, items: 0, detail: "" };
  });

  // Session cost ledger — also feeds the top-bar "Team cost · today" chip.
  app.get("/api/memory/cost", async (): Promise<SessionCost> => {
    const rows = await query<{ provider: string; cost: string; tokens: number }>(
      `SELECT provider, cost, tokens FROM cost_entries ORDER BY sort`,
    );
    const total = rows.reduce((n, r) => n + Number(r.cost), 0);
    return {
      total: `$${total.toFixed(4)}`,
      entries: rows.map((r) => ({
        provider: r.provider,
        cost: `$${Number(r.cost).toFixed(4)}`,
        tokens: `${Number(r.tokens).toLocaleString()} tok`,
      })),
    };
  });

  app.get("/api/memory/facts", async (): Promise<{ facts: MemoryFact[]; styles: StyleProfile[]; profile: any }> => {
    const facts = (await query(`SELECT * FROM memory_facts ORDER BY sort`)).map((r: any) => ({
      id: r.id, label: r.label, value: r.value, confidence: r.confidence,
    }));
    const styles = (await query(`SELECT * FROM style_profiles ORDER BY sort`)).map((r: any) => ({
      id: r.id, name: r.name, stats: r.stats, msgs: r.msgs,
    }));
    const profile = (await one<{ value: any }>(`SELECT value FROM settings WHERE key = 'personal_intelligence'`))?.value ?? {};
    return { facts, styles, profile };
  });

  // Recent conversations: prefer live hermes sessions, else seeded fallback.
  app.get("/api/memory/conversations", async (): Promise<Conversation[]> => {
    const live = await hermes.get<any>("/api/sessions");
    const list = Array.isArray(live.data) ? live.data : live.data?.sessions;
    if (live.ok && Array.isArray(list) && list.length) {
      return list.map((s: any, i: number) => ({
        id: s.id ?? `s_${i}`,
        title: s.title ?? s.name ?? "Untitled",
        date: s.updated_at ?? s.created_at ?? "",
        sessionId: s.id,
      }));
    }
    const seeded = (await one<{ value: Conversation[] }>(`SELECT value FROM settings WHERE key = 'conversations'`))?.value ?? [];
    return seeded.map((c, i) => ({ id: `c_${i}`, title: c.title, date: c.date }));
  });
}
