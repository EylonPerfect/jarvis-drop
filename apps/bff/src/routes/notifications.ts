import type { FastifyInstance } from "fastify";
import { orgId } from "../lib/auth.js";
import { listNotifications, markRead } from "../lib/notify.js";

// ============================================================================
// routes/notifications.ts — the in-app notification center API (org-scoped).
// ============================================================================
export default async function notificationsRoutes(app: FastifyInstance) {
  app.get("/api/notifications", async (req) => await listNotifications(orgId(req)));

  app.post("/api/notifications/read", async (req) => {
    const b = (req.body ?? {}) as { id?: string; all?: boolean };
    await markRead(orgId(req), b.all ? undefined : b.id);
    return { ok: true };
  });
}
