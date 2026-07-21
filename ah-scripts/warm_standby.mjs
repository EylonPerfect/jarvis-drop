import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

// Pre-warm the standby so call_wake skips resume + chrome launch + login:
// resume it, make sure Chrome is up and logged in on the product, and LEAVE IT
// RUNNING. Trade-off: a running sandbox costs while warm (auto-stops at the
// timeout below). Re-run to re-warm. call_wake falls back to a cold path if the
// standby has since paused or logged out, so this is purely an accelerator.

const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const e2b = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows[0].values.apiKey;
const standby = process.argv[2] || fs.readFileSync("/app/ah/standby.txt", "utf8").trim();
const WARM_MIN = parseInt(process.argv[3] || "60", 10);
const POS_URL = "https://doubl-e.goperfect.com/";

const d = await Sandbox.connect(standby, { apiKey: e2b });
await d.setTimeout(WARM_MIN * 60 * 1000).catch(() => {});
const run = async (c, t = 90000) => { try { const o = await d.commands.run(c, { timeoutMs: t }); return ((o.stdout || "") + (o.stderr || "")).trim(); } catch (e) { return "ERR:" + ((e && e.stderr) || (e && e.message) || e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pageUrl = async () => run(`curl -s http://localhost:9222/json 2>/dev/null | python3 -c "import sys,json;print([t.get('url','') for t in json.load(sys.stdin) if t.get('type')=='page'][0])" 2>/dev/null`);

console.log("WARM RESUMING", standby, `(timeout ${WARM_MIN}m)`);
await run("pactl info >/dev/null 2>&1 || pulseaudio --start --exit-idle-time=-1; pactl set-default-source vmic; pactl set-default-sink zout; echo ok");

let u = await pageUrl();
if (!u.includes("doubl-e.goperfect.com")) {
  console.log("WARM launching chrome…");
  const flags = "--no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --no-default-browser-check --disable-session-crashed-bubble --disable-infobars --password-store=basic --force-device-scale-factor=0.8 --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=/home/user/gp-profile --window-position=0,0 --window-size=1024,768 --kiosk";
  await run("pkill -9 -f 'google[-]chrome' 2>/dev/null; rm -f /home/user/gp-profile/Singleton* 2>/dev/null; rm -rf /home/user/gp-profile/Default/Sessions '/home/user/gp-profile/Default/Session Storage' 2>/dev/null; sed -i 's/\"exit_type\":\"[^\"]*\"/\"exit_type\":\"Normal\"/' /home/user/gp-profile/Default/Preferences 2>/dev/null; echo ok");
  await d.commands.run(`DISPLAY=:0 dbus-launch google-chrome-stable ${flags} "${POS_URL}" > /tmp/chrome.log 2>&1 &`, { background: true }).catch(() => {});
  for (let i = 0; i < 12; i++) { await sleep(2500); u = await pageUrl(); if (u) break; }
}
if (u.includes("auth.goperfect.com")) {
  console.log("WARM auto-login…");
  try { execFileSync("node", ["/app/ah/gp_login.mjs", d.sandboxId], { stdio: "inherit", timeout: 180000 }); } catch (e) { console.log("login issue:", (e && e.message) || e); }
  for (let i = 0; i < 24; i++) { await sleep(5000); u = await pageUrl(); if (u.includes("doubl-e.goperfect.com")) break; }
}
// make sure we're parked on the home board, not a leftover position
await run(`curl -s http://localhost:9222/json 2>/dev/null >/dev/null; true`);
console.log(u.includes("doubl-e.goperfect.com") ? "WARM_READY " + standby : "WARM_NOT_LOGGED_IN " + u);
await p.end();
