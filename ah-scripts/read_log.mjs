// Read a file from a running sandbox. Usage: node read_log.mjs <sandboxId> <cmd...>
import { Sandbox } from "@e2b/desktop";
import pg from "pg";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const e2b = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows[0].values.apiKey;
const d = await Sandbox.connect(process.argv[2], { apiKey: e2b });
const r = await d.commands.run(process.argv.slice(3).join(" ")).catch(e => ({ stdout: "", stderr: String(e) }));
console.log(r.stdout || r.stderr);
await p.end();
