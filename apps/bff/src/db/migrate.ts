import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Apply the schema (idempotent: CREATE TABLE IF NOT EXISTS). */
export async function runMigrations(): Promise<void> {
  const sql = await readFile(resolve(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
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
