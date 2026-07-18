import type { FastifyInstance } from "fastify";
import { query, one } from "../db/pool.js";
import { requireSuperadmin } from "../lib/superadmin.js";

// ============================================================================
// PUBLIC STATUS PAGE (CLAUDE.md BATCH 4). A self-contained operational status
// surface, deliberately SEPARATE from the product screens (its own route, no
// shared components, no auth) so it can be linked publicly / from the trust
// page. GET /status = HTML; GET /api/status = JSON. Operators post/close
// incidents via the super-admin-gated write routes. If a hosted status page
// (e.g. the connected Statuspage) is later preferred, point DNS there and keep
// these routes as the JSON feed / fallback.
// Both public GETs are exempted from the BFF auth gate in index.ts.
// ============================================================================

type Incident = { id: string; title: string; body: string | null; severity: string; status: string; created_at: string; updated_at: string; resolved_at: string | null };

async function buildStatus() {
  const open = await query<Incident>(
    `SELECT id, title, body, severity, status, created_at, updated_at, resolved_at
       FROM status_incidents WHERE resolved_at IS NULL ORDER BY created_at DESC`,
  ).catch(() => []);
  const recent = await query<Incident>(
    `SELECT id, title, body, severity, status, created_at, updated_at, resolved_at
       FROM status_incidents WHERE resolved_at IS NOT NULL AND resolved_at > now() - interval '7 days'
      ORDER BY resolved_at DESC LIMIT 10`,
  ).catch(() => []);
  // A light live-signal: is the call pipeline currently erroring?
  const dbOk = await one(`SELECT 1 AS v`).then(() => true).catch(() => false);
  const stuck = await one<{ n: string }>(
    `SELECT COUNT(*) AS n FROM live_calls WHERE ended_at IS NULL AND phase='error'`,
  ).catch(() => null);
  const overall = open.some((i) => i.severity === "critical" || i.severity === "major")
    ? "major_outage"
    : open.length > 0 ? "partial_outage"
    : !dbOk ? "degraded"
    : "operational";
  return {
    overall,
    updatedAt: new Date().toISOString(),
    components: [
      { name: "API", status: dbOk ? "operational" : "down" },
      { name: "Live calls", status: Number(stuck?.n ?? 0) > 0 ? "degraded" : "operational" },
      { name: "Database", status: dbOk ? "operational" : "down" },
    ],
    openIncidents: open,
    recentlyResolved: recent,
  };
}

const OVERALL_COPY: Record<string, { label: string; color: string }> = {
  operational: { label: "All systems operational", color: "#16a34a" },
  degraded: { label: "Degraded performance", color: "#d97706" },
  partial_outage: { label: "Partial outage", color: "#d97706" },
  major_outage: { label: "Major outage", color: "#dc2626" },
};

function renderHtml(s: Awaited<ReturnType<typeof buildStatus>>): string {
  const esc = (x: unknown) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const head = OVERALL_COPY[s.overall] ?? OVERALL_COPY.operational;
  const comp = s.components.map((c) => `<li><span>${esc(c.name)}</span><b class="${c.status === "operational" ? "ok" : "bad"}">${esc(c.status)}</b></li>`).join("");
  const inc = s.openIncidents.length
    ? s.openIncidents.map((i) => `<div class="incident"><h3>${esc(i.title)} <em>${esc(i.severity)}</em></h3><p class="st">${esc(i.status)} · ${esc(i.created_at).slice(0, 16).replace("T", " ")}</p><p>${esc(i.body)}</p></div>`).join("")
    : `<p class="none">No incidents reported.</p>`;
  const res = s.recentlyResolved.map((i) => `<div class="resolved"><b>${esc(i.title)}</b> — resolved ${esc(i.resolved_at).slice(0, 16).replace("T", " ")}</div>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>After Human — Status</title>
<style>
:root{color-scheme:light dark}
body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:720px;margin:0 auto;padding:32px 20px;color:#111}
@media(prefers-color-scheme:dark){body{background:#0b0d10;color:#e6e8eb}.incident,.resolved{background:#14181d!important;border-color:#232a31!important}}
h1{font-size:20px;margin:0 0 4px}.sub{color:#888;font-size:13px;margin:0 0 24px}
.banner{padding:16px 18px;border-radius:12px;color:#fff;font-weight:600;margin-bottom:24px}
ul{list-style:none;padding:0;margin:0 0 28px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}
li{display:flex;justify-content:space-between;padding:12px 16px;border-top:1px solid #e5e7eb}li:first-child{border-top:0}
b.ok{color:#16a34a;font-weight:600}b.bad{color:#dc2626;font-weight:600}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#888;margin:28px 0 12px}
.incident{background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin-bottom:10px}
.incident h3{margin:0 0 4px;font-size:15px}.incident em{font-size:11px;text-transform:uppercase;color:#d97706;font-style:normal;margin-left:6px}
.incident .st{color:#888;font-size:12px;margin:0 0 6px}.none{color:#888}
.resolved{font-size:13px;color:#666;padding:8px 0;border-top:1px solid #eee}
footer{margin-top:36px;color:#aaa;font-size:12px}
</style></head><body>
<h1>After Human — Platform Status</h1>
<p class="sub">Live operational status. Updated ${esc(s.updatedAt).slice(0, 16).replace("T", " ")} UTC.</p>
<div class="banner" style="background:${head.color}">${esc(head.label)}</div>
<h2>Components</h2><ul>${comp}</ul>
<h2>Active incidents</h2>${inc}
${res ? `<h2>Recently resolved</h2>${res}` : ""}
<footer>This page is served independently of the product. For security disclosures see the trust page.</footer>
</body></html>`;
}

export default async function statusRoutes(app: FastifyInstance) {
  // Public JSON feed (exempted from auth in index.ts).
  app.get("/api/status", async () => buildStatus());

  // Public HTML status page (exempted from auth in index.ts).
  app.get("/status", async (_req, reply) => {
    const s = await buildStatus();
    reply.header("Content-Type", "text/html; charset=utf-8");
    reply.header("Cache-Control", "no-cache");
    return renderHtml(s);
  });

  // ---- operator writes (super-admin gated) ----
  app.post("/api/status/incidents", { preHandler: requireSuperadmin }, async (req, reply) => {
    const b = (req.body ?? {}) as { title?: string; body?: string; severity?: string; status?: string };
    if (!b.title) return reply.code(400).send({ error: "title required" });
    const id = `si_${Date.now().toString(36)}`;
    const inc = await one(
      `INSERT INTO status_incidents (id, title, body, severity, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, b.title, b.body ?? null, b.severity ?? "minor", b.status ?? "investigating"],
    );
    return reply.code(201).send({ incident: inc });
  });

  app.patch("/api/status/incidents/:id", { preHandler: requireSuperadmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { body?: string; status?: string; severity?: string; resolved?: boolean };
    const inc = await one(
      `UPDATE status_incidents
          SET body = COALESCE($2, body),
              status = COALESCE($3, status),
              severity = COALESCE($4, severity),
              resolved_at = CASE WHEN $5::boolean THEN now() ELSE resolved_at END,
              status = CASE WHEN $5::boolean THEN 'resolved' ELSE COALESCE($3, status) END,
              updated_at = now()
        WHERE id=$1 RETURNING *`,
      [id, b.body ?? null, b.status ?? null, b.severity ?? null, b.resolved ?? false],
    );
    if (!inc) return reply.code(404).send({ error: "incident not found" });
    return { incident: inc };
  });
}
