// ============================================================
// Seed the "Talk to Ava" demo tenant (Northwind Staffing).
//
// Runnable via the repo's ts runner:  tsx src/scripts/seedDemoTenant.ts
// (add `"seed:demo": "tsx src/scripts/seedDemoTenant.ts"` to package.json if a
// named script is wanted). All logic lives in lib/demoTenant.ts so the warm-pool
// reset path and this seed stay one implementation.
//
// SAFETY: only ever writes to DEMO_ORG_ID (org_demo_northwind). It can never
// touch the real org_legacy tenant — demoTenant.assertDemoOrg() throws first.
// Never point this at the prod `jarvis` DB; use a throwaway DB to validate.
// ============================================================
import { pool } from "../db/pool.js";
import { runMigrations, waitForDb } from "../db/migrate.js";
import { seedDemoTenant, DEMO_ORG_ID, DEMO_AGENT_ID, DEMO_CLONE_IDS } from "../lib/demoTenant.js";

async function main(): Promise<void> {
  // On a fresh throwaway DB the tenant tables won't exist yet; ensure the schema
  // is present first. Idempotent, so it's a no-op against an already-migrated DB.
  if (process.env.MIGRATE_FIRST !== "false") {
    console.log("Waiting for database…");
    await waitForDb();
    console.log("Applying schema (idempotent)…");
    await runMigrations();
  }

  console.log(`Seeding demo tenant ${DEMO_ORG_ID}…`);
  const summary = await seedDemoTenant();

  console.log("Demo tenant seeded:");
  console.log(`  org            = ${summary.orgId}`);
  console.log(`  demo agent     = ${DEMO_AGENT_ID} (Ava — flagship host clone)`);
  console.log(`  clone ids      = ${Object.values(DEMO_CLONE_IDS).join(", ")}`);
  console.log(`  clones         = ${summary.clones} (golden/live: ${summary.goldenClones})`);
  console.log(`  call sources   = ${summary.sources}`);
  console.log(`  persona vers   = ${summary.personaVersions}`);
  console.log(`  past calls     = ${summary.liveCalls}`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error("Demo-tenant seed failed:", err);
    process.exit(1);
  });
