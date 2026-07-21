import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import fs from "node:fs";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const _e2bRows = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows;
const e2b = (_e2bRows.find((r) => (r.values.apiKey || "").startsWith("e2b_")) || _e2bRows[0]).values.apiKey;
const d = await Sandbox.connect(process.argv[2], { apiKey: e2b });
const run = async (c) => { try { const o = await d.commands.run(c, { timeoutMs: 120000 }); return ((o.stdout||"")+(o.stderr||"")).trim(); } catch(e){ return "ERR:"+((e&&e.message)||e); } };
try {
  // Snapshot the logged-in Chrome profile (cookies + storage) for reuse in future sandboxes.
  console.log("tar:", await run("cd /home/user && tar czf /tmp/gp-profile.tgz gp-profile 2>/dev/null; ls -la /tmp/gp-profile.tgz | awk '{print $5}'"));
  const bytes = await d.files.read("/tmp/gp-profile.tgz", { format: "bytes" });
  fs.writeFileSync("/app/ah/gp-profile.tgz", Buffer.from(bytes));
  console.log("saved /app/ah/gp-profile.tgz", fs.statSync("/app/ah/gp-profile.tgz").size, "bytes");
  fs.writeFileSync("/app/ah/nlive.png", Buffer.from(await d.screenshot()));
  console.log("shot ok");
} finally { await p.end(); }
