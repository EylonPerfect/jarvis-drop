// node sbx_run.mjs <sandboxId> <command...> — run a shell command in the sandbox
import { Sandbox } from "@e2b/desktop";
import pg from "pg";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const _e2bRows = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows;
const e2b = (_e2bRows.find((r) => (r.values.apiKey || "").startsWith("e2b_")) || _e2bRows[0]).values.apiKey;
const d = await Sandbox.connect(process.argv[2], { apiKey: e2b });
try {
  const o = await d.commands.run(process.argv.slice(3).join(" "), { timeoutMs: 120000 });
  console.log(((o.stdout || "") + (o.stderr || "")).trim());
} catch (e) { console.log("ERR:" + ((e && e.stderr) || (e && e.message) || e)); }
await p.end();
process.exit(0);
