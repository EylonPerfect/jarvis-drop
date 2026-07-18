import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { orgId } from "../lib/auth.js";
import { purgeOrg } from "../lib/purge.js";
import { seed } from "../db/seed.js";
import { config } from "../config.js";

// Every tenant table a reset clears — scoped to the caller's org (a "clear" must
// NEVER wipe another tenant's data). Order is child-before-parent-ish but since
// each DELETE is org-scoped and FKs are org_id→orgs, order doesn't matter here.
const TENANT_TABLES = [
  "agents", "tasks", "reminders", "time_entries", "memory_facts", "style_profiles",
  "knowledge_sources", "collections", "tool_toggles", "provider_keys", "files", "cost_entries",
  "approvals", "settings", "agent_activity", "agent_comms", "agent_runs", "meetings",
  "integrations", "persona_versions", "calibration_sessions", "calibration_turns",
  "clone_sources", "debriefs", "live_calls", "rehearsal_grades", "company_people", "ai_providers",
];

// Dev/admin utility: wipe THIS org's BFF-owned data so the operator can start
// from a clean slate (or, in the legacy org only, restore the canonical demo data).
//   mode: "clear" → delete every tenant table row for the caller's org
//   mode: "seed"  → reload the canonical demo data (legacy org only)
export default async function adminRoutes(app: FastifyInstance) {
  app.post("/api/admin/reset", async (req, reply) => {
    const org = orgId(req);
    const mode = ((req.body as { mode?: string } | undefined)?.mode ?? "clear").toLowerCase();
    if (mode === "seed") {
      // seed() writes single-tenant demo rows that land in the legacy org; only
      // allow it there so a real tenant can't dump demo data into (or over) itself.
      if (org !== config.legacyOrgId) {
        return reply.code(403).send({ error: "demo seed is only available for the legacy org" });
      }
      await seed({ force: true });
      return { ok: true, mode: "seed" };
    }
    if (mode === "clear") {
      for (const t of TENANT_TABLES) {
        await query(`DELETE FROM ${t} WHERE org_id = $1`, [org]).catch(() => { /* table may be empty/absent */ });
      }
      return { ok: true, mode: "clear", scope: org };
    }
    return reply.code(400).send({ error: "mode must be 'clear' or 'seed'" });
  });

  // Self-serve account deletion: HARD-purge the caller's OWN org (customer
  // leaves). Owner-only, and the target MUST be the caller's active org — this
  // route can never reach across tenants (cross-org purge is a future
  // super-admin surface with its own authz). See lib/purge.ts + the audit_log.
  app.delete("/api/admin/org/:orgId", async (req, reply) => {
    const org = orgId(req);
    const target = (req.params as { orgId: string }).orgId;
    if (target !== org) return reply.code(403).send({ error: "can only purge your own org" });
    if (config.auth.mode === "password" && req.org?.role !== "owner") {
      return reply.code(403).send({ error: "only an org owner can delete the org" });
    }
    if (org === config.legacyOrgId) {
      return reply.code(400).send({ error: "the legacy org cannot be self-purged via this route" });
    }
    const result = await purgeOrg(org, { actor: req.user?.id });
    return { ok: true, purged: result.deleted, external: result.external };
  });
}
