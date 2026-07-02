import type { FastifyInstance } from "fastify";
import { request } from "undici";
import { query, one } from "../db/pool.js";
import type { KnowledgeSource, Collection, IndexStatus } from "@jarvis/shared";

function rowToSource(r: any): KnowledgeSource {
  return { id: r.id, icon: r.icon, title: r.title, kind: r.kind, chunks: r.chunks, status: r.status };
}

// Estimate the chunk count for a body of text (~800 chars/chunk).
function chunksFor(content: string): number {
  return Math.max(1, Math.ceil(content.length / 800));
}

export default async function knowledgeRoutes(app: FastifyInstance) {
  app.get("/api/knowledge/sources", async () => {
    const rows = await query(`SELECT * FROM knowledge_sources ORDER BY sort, created_at`);
    return rows.map(rowToSource);
  });

  app.post("/api/knowledge/sources", async (req, reply) => {
    const b = req.body as Partial<KnowledgeSource> & { content?: string };
    if (!b?.title?.trim()) return reply.code(400).send({ error: "title required" });
    const id = `ks_${Date.now().toString(36)}`;
    const maxSort = await one<{ m: number }>(`SELECT COALESCE(MAX(sort), -1) + 1 AS m FROM knowledge_sources`);
    // With content supplied we index it immediately; otherwise keep the manual defaults.
    const hasContent = typeof b.content === "string" && b.content.length > 0;
    const chunks = hasContent ? chunksFor(b.content!) : b.chunks ?? 0;
    const status: IndexStatus = hasContent ? "indexed" : (b.status as IndexStatus) ?? "indexing";
    await query(
      `INSERT INTO knowledge_sources (id, icon, title, kind, chunks, status, sort, content) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, b.icon || "file-text", b.title.trim(), b.kind ?? "Doc", chunks, status, maxSort?.m ?? 0, hasContent ? b.content : null],
    );
    return reply.code(201).send(rowToSource(await one(`SELECT * FROM knowledge_sources WHERE id = $1`, [id])));
  });

  // Import a Notion page as a knowledge source. The integration token stays
  // server-side; we fetch the page's block children + title and index the text.
  app.post("/api/knowledge/notion", async (req, reply) => {
    const b = (req.body ?? {}) as { token?: string; pageUrl?: string };
    const token = b.token?.trim();
    const pageUrl = b.pageUrl?.trim();
    if (!token || !pageUrl) return reply.code(400).send({ error: "token and pageUrl required" });

    // Notion page id: last 32 hex chars of the URL (dashes stripped).
    const hex = (pageUrl.replace(/-/g, "").match(/[0-9a-fA-F]{32}/g) ?? []).pop();
    if (!hex) return reply.code(400).send({ error: "could not parse Notion page id from URL" });
    const pageId = hex.toLowerCase();

    const headers = { authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" };
    try {
      const blocksRes = await request(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, { method: "GET", headers });
      const blocksJson = (await blocksRes.body.json()) as any;
      if (blocksRes.statusCode >= 400) {
        return reply.code(502).send({ error: blocksJson?.message || "Notion request failed" });
      }

      let title = "Notion page";
      try {
        const pageRes = await request(`https://api.notion.com/v1/pages/${pageId}`, { method: "GET", headers });
        const pageJson = (await pageRes.body.json()) as any;
        if (pageRes.statusCode < 400) {
          const props = pageJson?.properties ?? {};
          for (const key of Object.keys(props)) {
            const p = props[key];
            const t = p?.title?.[0]?.plain_text;
            if (typeof t === "string" && t.trim()) { title = t.trim(); break; }
          }
        }
      } catch {
        /* title is best-effort; fall back to the default */
      }

      const RICH_TEXT_BLOCKS = ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "to_do", "quote", "callout", "code"];
      const lines: string[] = [];
      for (const block of (blocksJson?.results ?? []) as any[]) {
        const type = block?.type;
        if (!type || !RICH_TEXT_BLOCKS.includes(type)) continue;
        const rich = block[type]?.rich_text ?? [];
        const text = rich.map((r: any) => r?.plain_text ?? "").join("").trim();
        if (text) lines.push(text);
      }
      const content = lines.join("\n");

      const id = `ks_${Date.now().toString(36)}`;
      const maxSort = await one<{ m: number }>(`SELECT COALESCE(MAX(sort), -1) + 1 AS m FROM knowledge_sources`);
      await query(
        `INSERT INTO knowledge_sources (id, icon, title, kind, chunks, status, sort, content) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, "book-open", title, "Notion", chunksFor(content), "indexed", maxSort?.m ?? 0, content],
      );
      return reply.code(201).send(rowToSource(await one(`SELECT * FROM knowledge_sources WHERE id = $1`, [id])));
    } catch (err: any) {
      return reply.code(502).send({ error: err?.message || "Notion request failed" });
    }
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
