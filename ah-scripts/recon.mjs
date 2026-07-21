import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import { execFileSync } from "node:child_process";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const e2b = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows[0].values.apiKey;
const d = await Sandbox.create({ apiKey: e2b, timeoutMs: 40 * 60 * 1000 });
console.log("RECON_SANDBOX", d.sandboxId);
const run = async (c, t = 90000) => { try { const o = await d.commands.run(c, { timeoutMs: t }); return ((o.stdout||"")+(o.stderr||"")).trim(); } catch(e){ return "ERR:"+((e&&e.stderr)||(e&&e.message)||e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const fs = await import("node:fs");
  if (fs.existsSync("/app/ah/gp-profile.tgz")) {
    const bytes = fs.readFileSync("/app/ah/gp-profile.tgz");
    await d.files.write("/tmp/gp-profile.tgz", bytes);
    await run("cd /home/user && tar xzf /tmp/gp-profile.tgz 2>/dev/null; echo ok");
  } else { await run("mkdir -p /home/user/gp-profile"); }
} catch { await run("mkdir -p /home/user/gp-profile"); }
const flags = "--no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --no-default-browser-check --disable-session-crashed-bubble --disable-infobars --password-store=basic --force-device-scale-factor=0.8 --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=/home/user/gp-profile --window-position=0,0 --window-size=1024,768 --kiosk";
await run("pkill -9 -f 'google[-]chrome' 2>/dev/null; sleep 1; rm -f /home/user/gp-profile/Singleton* 2>/dev/null; echo ok");
await d.commands.run(`DISPLAY=:0 dbus-launch google-chrome-stable ${flags} "https://doubl-e.goperfect.com/" > /tmp/chrome.log 2>&1 &`, { background: true }).catch(() => {});
await sleep(9000);
await run("pip install -q websockets 2>&1 | tail -1; echo ok", 180000);
const pageUrl = async () => run(`curl -s http://localhost:9222/json | python3 -c "import sys,json;print([t.get('url','') for t in json.load(sys.stdin) if t.get('type')=='page'][0])" 2>/dev/null`);
let u = await pageUrl();
if (u.includes("auth.goperfect.com")) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { execFileSync("node", ["/app/ah/gp_login.mjs", d.sandboxId], { stdio: "inherit", timeout: 180000 }); } catch (e) { console.log("login issue:", (e&&e.message)||e); }
    for (let i = 0; i < 24; i++) { await sleep(5000); u = await pageUrl(); if (u.includes("doubl-e.goperfect.com")) break; }
    if (u.includes("doubl-e.goperfect.com")) break;
    if (attempt < 2) await sleep(15000);
  }
}
console.log("RECON_READY", u);
await p.end();
