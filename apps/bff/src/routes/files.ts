import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { orgId } from "../lib/auth.js";

// Real file store for evidence screenshots / uploaded docs. Bytes live in
// Postgres (persist across restarts via the db volume) and are served back by
// id. Uploads come as base64 JSON so we don't need a multipart dependency.

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per file
const ALLOWED = /^(image\/(png|jpeg|jpg|webp|gif)|application\/pdf)$/i;

export default async function filesRoutes(app: FastifyInstance) {
  // Upload: { filename, mime, dataBase64 }  → { id, url, mime, size }
  app.post("/api/files", { bodyLimit: 14 * 1024 * 1024 }, async (req, reply) => {
    const b = req.body as { filename?: string; mime?: string; dataBase64?: string };
    const mime = (b?.mime ?? "").trim();
    const dataBase64 = b?.dataBase64 ?? "";
    if (!mime || !dataBase64) return reply.code(400).send({ error: "mime and dataBase64 are required" });
    if (!ALLOWED.test(mime)) return reply.code(415).send({ error: "unsupported file type" });
    // Accept raw base64 or a data: URL.
    const base64 = dataBase64.includes(",") ? dataBase64.slice(dataBase64.indexOf(",") + 1) : dataBase64;
    let buf: Buffer;
    try {
      buf = Buffer.from(base64, "base64");
    } catch {
      return reply.code(400).send({ error: "invalid base64" });
    }
    if (!buf.length) return reply.code(400).send({ error: "empty file" });
    if (buf.length > MAX_BYTES) return reply.code(413).send({ error: `file too large (max ${MAX_BYTES} bytes)` });
    const id = `file_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const filename = (b?.filename ?? "upload").slice(0, 200);
    await query(`INSERT INTO files (id, filename, mime, size, data, org_id) VALUES ($1,$2,$3,$4,$5,$6)`, [id, filename, mime, buf.length, buf, orgId(req)]);
    return reply.code(201).send({ id, url: `/api/files/${id}`, mime, size: buf.length, filename });
  });

  // Serve raw bytes with the right content-type (used directly as an <img src>).
  app.get("/api/files/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await one<{ mime: string; data: Buffer; filename: string }>(`SELECT mime, data, filename FROM files WHERE id = $1 AND org_id = $2`, [id, orgId(req)]);
    if (!row) return reply.code(404).send({ error: "not found" });
    return reply
      .header("Content-Type", row.mime)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(row.data);
  });

  app.delete("/api/files/:id", async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM files WHERE id = $1 AND org_id = $2`, [id, orgId(req)]);
    return { ok: true };
  });
}
