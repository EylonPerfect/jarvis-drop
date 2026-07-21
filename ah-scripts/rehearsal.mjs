import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import { execFileSync } from "node:child_process";

// REHEARSAL pipeline: everything a live call needs EXCEPT joining Zoom —
// sandbox -> audio graph -> chrome + GoPerfect login -> stream -> voice bridge
// (golden persona + nudge channel). Used by Demo Canvas / Director Console
// rehearsals and by the production end-to-end check.
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const _e2bRows = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows;
const e2b = (_e2bRows.find((r) => (r.values.apiKey || "").startsWith("e2b_")) || _e2bRows[0]).values.apiKey;

// Per-clone demo system: open THIS clone's product URL (default GoPerfect). The
// GoPerfect auto-login below only fires when the page lands on auth.goperfect.com,
// so a non-GoPerfect URL simply loads and the clone demonstrates / uses session.
const AGENT_ID = process.env.AH_AGENT_ID || "";
let DEMO_URL = "", DEMO_SYSTEM = "";
if (AGENT_ID) {
  try {
    const _r = await p.query("SELECT value FROM settings WHERE key = 'demo_login:' || $1", [AGENT_ID]);
    const _v = _r.rows[0] && _r.rows[0].value;
    if (_v) { DEMO_URL = (_v.url || "").trim(); DEMO_SYSTEM = (_v.system || "").trim(); }
  } catch { /* default to GoPerfect */ }
}
const START_URL = DEMO_URL || "https://doubl-e.goperfect.com/";
const IS_GP = /goperfect\.com/i.test(START_URL);
console.log("PHASE DEMO_SYSTEM " + (DEMO_SYSTEM || "GoPerfect") + " -> " + START_URL);

const d = await Sandbox.create({ apiKey: e2b, timeoutMs: parseInt(process.env.AH_SANDBOX_TIMEOUT_MS || "") || 55 * 60 * 1000 });
console.log("PHASE SANDBOX", d.sandboxId);
const run = async (c, t = 90000) => { try { const o = await d.commands.run(c, { timeoutMs: t }); return ((o.stdout||"")+(o.stderr||"")).trim(); } catch(e){ return "ERR:"+((e&&e.stderr)||(e&&e.message)||e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// audio graph (same as live: vmic/vspk/zout so the bridge routing works)
await run("pulseaudio --start --exit-idle-time=-1 || true");
await run("pactl load-module module-null-sink sink_name=vspk sink_properties=device.description=vspk || true");
await run("pactl load-module module-remap-source source_name=vmic master=vspk.monitor || true");
await run("pactl load-module module-null-sink sink_name=zout sink_properties=device.description=zout || true");
await run("pactl set-default-source vmic; pactl set-default-sink zout; echo ok");
console.log("PHASE AUDIO_READY");

await run("pip install -q websockets 2>&1 | tail -1; echo ok", 180000);
console.log("PHASE DEPS_READY");

await d.stream.start({ requireAuth: true }).catch(() => {});
try { const ak = await d.stream.getAuthKey(); console.log("PHASE STREAM", d.stream.getUrl({ authKey: ak })); } catch { /* ignore */ }

// chrome: restore profile snapshot if we have one, else fresh + login.
// GoPerfect demos reuse the logged-in gp-profile snapshot. A NON-GoPerfect demo
// system (IS_GP false) must boot a CLEAN, empty profile so no logged-in
// GoPerfect tab exists to smother the generic action layer (any-product proof).
if (IS_GP) {
  try {
    const fs = await import("node:fs");
    if (fs.existsSync("/app/ah/gp-profile.tgz")) {
      const bytes = fs.readFileSync("/app/ah/gp-profile.tgz");
      await d.files.write("/tmp/gp-profile.tgz", bytes);
      await run("cd /home/user && tar xzf /tmp/gp-profile.tgz 2>/dev/null; echo ok");
    } else { await run("mkdir -p /home/user/gp-profile"); }
  } catch { await run("mkdir -p /home/user/gp-profile"); }
} else {
  // non-GoPerfect: clean slate — never restore the GoPerfect profile
  await run("rm -rf /home/user/gp-profile 2>/dev/null; mkdir -p /home/user/gp-profile; echo ok");
}
const flags = "--no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --no-default-browser-check --disable-session-crashed-bubble --disable-infobars --password-store=basic --force-device-scale-factor=0.8 --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=/home/user/gp-profile --window-position=0,0 --window-size=1024,768 --kiosk";
await run("pkill -9 -f 'google[-]chrome' 2>/dev/null; sleep 1; rm -f /home/user/gp-profile/Singleton* 2>/dev/null; echo ok");
await d.commands.run(`DISPLAY=:0 dbus-launch google-chrome-stable ${flags} "${START_URL}" > /tmp/chrome.log 2>&1 &`, { background: true }).catch(() => {});
console.log("PHASE CHROME_LAUNCHED");
await sleep(9000);

const pageUrl = async () => run(`curl -s http://localhost:9222/json | python3 -c "import sys,json;print([t.get('url','') for t in json.load(sys.stdin) if t.get('type')=='page'][0])" 2>/dev/null`);
let u = await pageUrl();
if (u.includes("auth.goperfect.com")) {
  console.log("PHASE AUTO_LOGIN");
  // one transient rejection must not strand the session on the login page
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { execFileSync("node", ["/app/ah/gp_login.mjs", d.sandboxId], { stdio: "inherit", timeout: 180000 }); } catch (e) { console.log("auto-login issue:", (e && e.message) || e); }
    for (let i = 0; i < 24; i++) { await sleep(5000); u = await pageUrl(); if (u.includes("doubl-e.goperfect.com")) break; }
    if (u.includes("doubl-e.goperfect.com")) break;
    console.log(`login attempt ${attempt} failed${attempt < 2 ? " — retrying in 15s" : ""}`);
    if (attempt < 2) await sleep(15000);
  }
}
// NON-GoPerfect product: the clone may boot onto an access-code / login GATE.
// Pass it deterministically (like GoPerfect's auto-login) instead of relying on
// the realtime model to type_text. generic_gate.mjs is idempotent + safe: if no
// gate input exists (most products) it prints "no gate" and exits 0.
if (!IS_GP) {
  console.log("PHASE GENERIC_GATE");
  try { execFileSync("node", ["/app/ah/generic_gate.mjs", d.sandboxId], { stdio: "inherit", timeout: 120000 }); } catch (e) { console.log("generic-gate issue:", (e && e.message) || e); }
  u = await pageUrl();
}
const _loaded = IS_GP ? u.includes("doubl-e.goperfect.com") : (!!u && !u.startsWith("ERR"));
console.log(_loaded ? "PHASE LOGGED_IN " + u : "PHASE LOGIN_TIMEOUT — bridge still starts");

// voice bridge (golden auto-loads from settings inside duplexnav7)
try { execFileSync("node", ["/app/ah/duplexnav7.mjs", d.sandboxId, "nogreet"], { stdio: "inherit", timeout: 120000 }); } catch (e) { console.log("bridge start issue:", (e && e.message) || e); }
console.log("PHASE BRIDGE_UP");
console.log("PHASE READY", d.sandboxId);
await p.end();
