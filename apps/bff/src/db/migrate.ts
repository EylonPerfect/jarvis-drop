import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Apply the base schema, then every incremental migration in `migrations/` in
 * filename order. Everything is idempotent (CREATE ... IF NOT EXISTS /
 * CREATE OR REPLACE VIEW / ALTER ... ADD COLUMN IF NOT EXISTS), so re-running is
 * safe — this is applied on every boot.
 */
export async function runMigrations(): Promise<void> {
  // 1) Base single-tenant schema (creates every tenant table).
  const base = await readFile(resolve(__dirname, "schema.sql"), "utf8");
  await pool.query(base);
  // 2) Phase-2 multi-tenancy: orgs/users/memberships/sessions, org_id on every
  //    tenant table, and the legacy backfill. Runs AFTER the base schema so all
  //    tenant tables exist, and BEFORE the numbered migrations so their org_id
  //    columns/FKs resolve. Idempotent, so it is safe on every boot.
  const tenancy = await readFile(resolve(__dirname, "tenancy.sql"), "utf8");
  await pool.query(tenancy);
  // 3) Additive numbered migrations (usage ledger, etc.). Applied in filename
  //    order after tenancy so anything referencing org_id resolves.
  const migrationsDir = resolve(__dirname, "migrations");
  let files: string[] = [];
  try {
    files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    // no migrations dir yet — base + tenancy schema is enough
    return;
  }
  for (const f of files) {
    const body = await readFile(resolve(migrationsDir, f), "utf8");
    await pool.query(body);
  }
}

/** Wait for Postgres to accept connections (for container start ordering). */
export async function waitForDb(attempts = 30, delayMs = 1000): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// CLI entrypoint: `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    console.log("Waiting for database…");
    await waitForDb();
    console.log("Applying schema…");
    await runMigrations();
    console.log("Schema applied.");
    await pool.end();
  })().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
