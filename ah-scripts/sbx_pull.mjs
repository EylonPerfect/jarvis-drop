// node sbx_pull.mjs <sandboxId> <remotePath> <localPath> — copy a file out of the sandbox
import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import fs from "node:fs";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const e2b = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows[0].values.apiKey;
const d = await Sandbox.connect(process.argv[2], { apiKey: e2b });
const bytes = await d.files.read(process.argv[3], { format: "bytes" });
fs.writeFileSync(process.argv[4], Buffer.from(bytes));
console.log("pulled", process.argv[4], fs.statSync(process.argv[4]).size, "bytes");
await p.end();
process.exit(0);
