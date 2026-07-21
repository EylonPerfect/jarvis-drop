import type { FastifyInstance } from "fastify";
import { TOS_VERSION, hasAcceptedTos, recordTosAcceptance } from "../lib/legal.js";

// ============================================================================
// routes/legal.ts — Terms acceptance status + record. Gated by the default
// session/API-key hook. The FE blocking gate reads GET and writes POST.
// ============================================================================
export default async function legalRoutes(app: FastifyInstance) {
  // Current Terms version + whether the signed-in user has accepted it.
  // No user identity (access-code / demo) → accepted:true (operator not nagged).
  app.get("/api/legal/tos", async (req) => {
    const userId = req.user?.id ?? null;
    const accepted = await hasAcceptedTos(userId);
    return { version: TOS_VERSION, accepted, authenticated: !!userId };
  });

  // Record the signed-in user's affirmative acceptance (the "I agree" gate).
  app.post("/api/legal/tos/accept", async (req, reply) => {
    const userId = req.user?.id ?? null;
    if (!userId) return reply.code(401).send({ error: "must be signed in to accept" });
    const orgId = (req.org as { id?: string } | undefined)?.id ?? null;
    const ip = (req.ip || "").slice(0, 64) || null;
    const ua = (req.headers["user-agent"] as string | undefined) ?? null;
    await recordTosAcceptance(userId, orgId, ip, ua);
    return { ok: true, version: TOS_VERSION };
  });
}
