import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import type { KnowledgeSource, Collection, IndexStatus } from "@jarvis/shared";

function rowToSource(r: any): KnowledgeSource {
  return { id: r.id, icon: r.icon, title: r.title, kind: r.kind, chunks: r.chunks, status: r.status };
}

export default async function knowledgeRoutes(app: FastifyInstance) {
  app.get("/api/knowledge/sources", async () => {
    const rows = await query(`SELECT * FROM knowledge_sources ORDER BY sort, created_at`);
    return rows.map(rowToSource);
  });

  app.post("/api/knowledge/sources", async (req, reply) => {
    const b = req.body as Partial<KnowledgeSource>;
    if (!b?.title?.trim()) return reply.code(400).send({ error: "title required" });
    const id = `ks_${Date.now().toString(36)}`;
    const maxSort = await one<{ m: number }>(`SELECT COALESCE(MAX(sort), -1) + 1 AS m FROM knowledge_sources`);
    await query(
      `INSERT INTO knowledge_sources (id, icon, title, kind, chunks, status, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, b.icon || "file-text", b.title.trim(), b.kind ?? "Doc", b.chunks ?? 0, (b.status as IndexStatus) ?? "indexing", maxSort?.m ?? 0],
    );
    return reply.code(201).send(rowToSource(await one(`SELECT * FROM knowledge_sources WHERE id = $1`, [id])));
  });

  app.delete("/api/knowledge/sources/:id", async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM knowledge_sources WHERE id = $1`, [id]);
    return { ok: true };
  });

  // Clear all knowledge sources.
  app.delete("/api/knowledge/sources", async () => {
    await query(`DELETE FROM knowledge_sources`);
    return { ok: true };
  });

  app.get("/api/knowledge/collections", async () => {
    const rows = await query(`SELECT * FROM collections ORDER BY sort`);
    return rows.map((r: any): Collection => ({ id: r.id, name: r.name, count: r.count, color: r.color }));
  });

  // Index stat block.
  app.get("/api/knowledge/stats", async () => {
    const sources = await query<{ chunks: number; status: string }>(`SELECT chunks, status FROM knowledge_sources`);
    const collections = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM collections`);
    const totalChunks = sources.reduce((n, s) => n + Number(s.chunks), 0);
    const indexing = sources.filter((s) => s.status === "indexing").length;
    return {
      sources: sources.length,
      chunks: totalChunks >= 1000 ? `${(totalChunks / 1000).toFixed(1)}k` : String(totalChunks),
      collections: collections?.n ?? 0,
      indexing,
    };
  });
}
