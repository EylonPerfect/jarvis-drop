import type { FastifyInstance } from "fastify";
import { orgId } from "../lib/auth.js";
import { listForOrg, ensureRefCode, buildRefLink } from "../lib/referrals.js";

// ============================================================================
// routes/referrals.ts — authenticated, org-scoped PLG referral API.
// Gated by the default session/API-key onRequest hook (no exemption).
// ============================================================================
export default async function referralsRoutes(app: FastifyInstance) {
  // My referral code, share link, funnel stats, and earned rewards.
  app.get("/api/referrals/me", async (req) => {
    return await listForOrg(orgId(req));
  });

  // Mint an attributed share link for a given loop + channel (used by every
  // "invite" button across the three loops). Returns the link + the raw code.
  app.post("/api/referrals/share", async (req) => {
    const b = (req.body ?? {}) as { loop?: string; channel?: string; target?: "ava" | "signup" };
    const code = await ensureRefCode(orgId(req));
    return { code, link: buildRefLink(code, { loop: b.loop ?? "ava", channel: b.channel ?? "link", target: b.target }) };
  });
}
