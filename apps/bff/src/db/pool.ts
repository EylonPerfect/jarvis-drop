import pg from "pg";
import { config } from "../config.js";

// Single shared pool. `ssl` is opt-in for managed Postgres that requires TLS.
export const pool = new pg.Pool({
  connectionString: config.db.url,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

// An idle pooled client can emit 'error' if the backend drops the connection
// (Postgres failover/restart, network blip, idle-timeout kill). Without a
// listener, node-postgres re-throws it as an uncaught exception and the process
// exits. Log and swallow so the pool recycles the bad client instead of crashing.
pool.on("error", (err) => {
  console.error("Unexpected idle Postgres client error; connection will be recycled:", err.message);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params as any[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
