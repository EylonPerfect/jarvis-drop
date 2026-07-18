import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { orgId } from "../lib/auth.js";
import { getSetting } from "../lib/settingsStore.js";
import { hermes } from "../hermes.js";
import type { MemoryFact, StyleProfile, VectorStoreStatus, SessionCost, Conversation, ChatMessage } from "@jarvis/shared";

// Map an arbitrary hermes/stored message shape onto the UI's ChatMessage.
// The UI thread only distinguishes "you" (the operator) from "jarvis" (agent).
function toChatMessages(raw: unknown): ChatMessage[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.messages)
      ? (raw as any).messages
      : Array.isArray((raw as any)?.turns)
        ? (raw as any).turns
        : [];
  return (arr as any[])
    .map((m): ChatMessage | null => {
      const role = String(m?.role ?? m?.who ?? m?.author ?? "").toLowerCase();
      const content = m?.content ?? m?.text ?? m?.message ?? "";
      const text = typeof content === "string" ? content : JSON.stringify(content);
      if (!text) return null;
      const who: ChatMessage["who"] = role === "user" || role === "you" || role === "human" ? "you" : "jarvis";
      return { who, text };
    })
    .filter((m): m is ChatMessage => m !== null);
}

export default async function memoryRoutes(app: FastifyInstance) {
  app.get("/api/memory/vector-store", async (req): Promise<VectorStoreStatus> => {
    const s = await getSetting<VectorStoreStatus>(orgId(req), "vector_store");
    return s ?? { status: "Unknown", online: false, items: 0, detail: "" };
  });

  // Session cost ledger — also feeds the top-bar "Team cost · today" chip.
  app.get("/api/memory/cost", async (req): Promise<SessionCost> => {
    const rows = await query<{ provider: string; cost: string; tokens: number }>(
      `SELECT provider, cost, tokens FROM cost_entries WHERE org_id = $1 ORDER BY sort`,
      [orgId(req)],
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

  app.get("/api/memory/facts", async (req): Promise<{ facts: MemoryFact[]; styles: StyleProfile[]; profile: any }> => {
    const org = orgId(req);
    const facts = (await query(`SELECT * FROM memory_facts WHERE org_id = $1 ORDER BY sort`, [org])).map((r: any) => ({
      id: r.id, label: r.label, value: r.value, confidence: r.confidence,
    }));
    const styles = (await query(`SELECT * FROM style_profiles WHERE org_id = $1 ORDER BY sort`, [org])).map((r: any) => ({
      id: r.id, name: r.name, stats: r.stats, msgs: r.msgs,
    }));
    const profile = (await getSetting<any>(org, "personal_intelligence")) ?? {};
    return { facts, styles, profile };
  });

  app.post("/api/memory/facts", async (req, reply) => {
    const b = req.body as Partial<MemoryFact>;
    const label = b?.label?.trim();
    const value = b?.value?.trim();
    if (!label || !value) return reply.code(400).send({ error: "label and value required" });
    const id = `mf_${Date.now().toString(36)}`;
    const confidence = Math.max(0, Math.min(100, Math.round(Number(b.confidence ?? 90))));
    const org = orgId(req);
    const maxSort = await one<{ m: number }>(`SELECT COALESCE(MAX(sort), -1) + 1 AS m FROM memory_facts WHERE org_id = $1`, [org]);
    await query(
      `INSERT INTO memory_facts (id, label, value, confidence, sort, org_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, label, value, confidence, maxSort?.m ?? 0, org],
    );
    const r = await one<any>(`SELECT * FROM memory_facts WHERE id = $1 AND org_id = $2`, [id, org]);
    return reply.code(201).send({ id: r.id, label: r.label, value: r.value, confidence: r.confidence });
  });

  app.delete("/api/memory/facts/:id", async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM memory_facts WHERE id = $1 AND org_id = $2`, [id, orgId(req)]);
    return { ok: true };
  });

  // Clear all memory facts.
  app.delete("/api/memory/facts", async (req) => {
    await query(`DELETE FROM memory_facts WHERE org_id = $1`, [orgId(req)]);
    return { ok: true };
  });

  // Recent conversations: prefer live hermes sessions, else seeded fallback.
  app.get("/api/memory/conversations", async (req): Promise<Conversation[]> => {
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
    const seeded = (await getSetting<Conversation[]>(orgId(req), "conversations")) ?? [];
    // Give seeded rows a stable id AND sessionId so selection has something to fetch.
    return seeded.map((c, i) => {
      const id = c.id ?? `c_${i}`;
      return { id, title: c.title, date: c.date, sessionId: c.sessionId ?? id };
    });
  });

  // Transcript for a single conversation. Live hermes sessions are relayed and
  // mapped to ChatMessage[]; seeded conversations may carry their own messages
  // in settings. Missing per-message data returns 200 [] so the UI never errors.
  app.get("/api/memory/conversations/:id", async (req): Promise<ChatMessage[]> => {
    const { id } = req.params as { id: string };

    // 1. Try live hermes session detail (mirrors the list's hermes source).
    if (/^[A-Za-z0-9_-]+$/.test(id)) {
      const live = await hermes.get<any>(`/api/sessions/${encodeURIComponent(id)}`);
      if (live.ok && live.data) {
        const msgs = toChatMessages(live.data.session ?? live.data);
        if (msgs.length) return msgs;
      }
    }

    // 2. Fall back to any seeded per-conversation messages stored in settings.
    const seeded = (await getSetting<Conversation[]>(orgId(req), "conversations")) ?? [];
    const hit = seeded.find((c, i) => (c.id ?? `c_${i}`) === id || c.sessionId === id);
    if (hit && (hit as any).messages) return toChatMessages((hit as any).messages);

    // 3. No per-message store — return empty gracefully.
    return [];
  });
}
