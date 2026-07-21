import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

// FAST call path: node /app/ah/call_wake.mjs <meetingId>
// Resumes the paused standby (Zoom preinstalled) → join → auto-admission →
// login check + snapshot → bridge → share → unmute. Seconds, not minutes.
const MEETING = process.argv[2];
if (!MEETING) { console.log("usage: call_wake.mjs <meetingId>"); process.exit(1); }
const POS_URL = "https://doubl-e.goperfect.com/"; // start on the positions board — no example anchor

const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const e2b = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows[0].values.apiKey;

// Zoom display name follows the agent on this call (AH_AGENT_ID from live.ts)
let AGENT_NAME = "Maya";
try {
  if (process.env.AH_AGENT_ID) {
    const r = await p.query("SELECT name FROM agents WHERE id=$1", [process.env.AH_AGENT_ID]);
    if (r.rows[0]?.name) AGENT_NAME = String(r.rows[0].name).split(" ")[0];
  }
} catch { /* keep default */ }
const UNAME = encodeURIComponent(AGENT_NAME);

const standby = fs.readFileSync("/app/ah/standby.txt", "utf8").trim();
console.log("PHASE RESUMING", standby);
const d = await Sandbox.connect(standby, { apiKey: e2b });
await d.setTimeout(55 * 60 * 1000).catch(() => {});
fs.unlinkSync("/app/ah/standby.txt");
const run = async (c, t = 90000) => { try { const o = await d.commands.run(c, { timeoutMs: t }); return ((o.stdout||"")+(o.stderr||"")).trim(); } catch(e){ return "ERR:"+((e&&e.stderr)||(e&&e.message)||e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// audio daemon may need a nudge after resume
await run("pactl info >/dev/null 2>&1 || pulseaudio --start --exit-idle-time=-1; pactl set-default-source vmic; pactl set-default-sink zout; echo ok");
// full-call recording: mix clone (vspk) + guest (zout) into recmix, record it for the whole call.
await run("pactl load-module module-null-sink sink_name=recmix sink_properties=device.description=recmix || true");
await run("pactl load-module module-loopback source=vspk.monitor sink=recmix latency_msec=1 || true");
await run("pactl load-module module-loopback source=zout.monitor sink=recmix latency_msec=1 || true");
await d.commands.run("pacat --record --format=s16le --rate=24000 --channels=1 --device=recmix.monitor > /tmp/call_mix.raw 2>/dev/null", { background: true }).catch(() => {});
await d.stream.start({ requireAuth: true }).catch(() => {});
try { const ak = await d.stream.getAuthKey(); console.log("PHASE STREAM", d.stream.getUrl({ authKey: ak })); } catch { /* ignore */ }

// chrome — ALWAYS cold-launch (kiosk). The "warm" skip-relaunch optimization was
// removed: a long-lived kiosk Chrome window is override-redirect and sits on top
// of the Zoom share picker (share fails), and it opens on the previous position
// instead of home. A fresh launch shares reliably and opens on the board.
const flags = "--no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --no-default-browser-check --disable-session-crashed-bubble --disable-infobars --password-store=basic --force-device-scale-factor=0.8 --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=/home/user/gp-profile --window-position=0,0 --window-size=1024,768 --kiosk";
await run("pkill -9 -f 'google[-]chrome' 2>/dev/null; sleep 1; rm -f /home/user/gp-profile/Singleton* 2>/dev/null; rm -rf /home/user/gp-profile/Default/Sessions '/home/user/gp-profile/Default/Session Storage' 2>/dev/null; sed -i 's/\"exit_type\":\"[^\"]*\"/\"exit_type\":\"Normal\"/' /home/user/gp-profile/Default/Preferences 2>/dev/null; echo ok");
await d.commands.run(`DISPLAY=:0 dbus-launch google-chrome-stable ${flags} "${POS_URL}" > /tmp/chrome.log 2>&1 &`, { background: true }).catch(() => {});
console.log("PHASE CHROME_LAUNCHED");

// join
await d.commands.run(`DISPLAY=:0 QT_QPA_PLATFORM=xcb /usr/bin/zoom "zoommtg://zoom.us/join?action=join&confno=${MEETING}&uname=${UNAME}" > /tmp/zoom.log 2>&1 &`, { background: true, timeoutMs: 15000 }).catch(() => {});
let joined = false;
for (let i = 0; i < 30; i++) {
  await sleep(3000);
  const w = await run('DISPLAY=:0 xdotool search --name "Zoom Meeting" 2>/dev/null | head -1');
  if (w && !w.startsWith("ERR") && w.trim()) {
    await run(`DISPLAY=:0 sh -c 'for x in $(xdotool search --name "Zoom Meeting"); do xdotool windowmove $x 200 0; xdotool windowactivate $x; done'`);
    await sleep(1200);
    await d.leftClick(792, 559);
    console.log("PHASE JOIN_CLICKED");
    joined = true; break;
  }
}
if (!joined) console.log("PHASE JOIN_PREVIEW_NOT_FOUND — check STREAM");

console.log("PHASE WAITING_ADMISSION (admit After Human AI)");
let admitted = false;
for (let i = 0; i < 120; i++) {
  await sleep(5000);
  const so = await run("pactl list source-outputs short 2>/dev/null | grep -v pacat | wc -l");
  if (parseInt(so) >= 1) { admitted = true; break; }
}
console.log(admitted ? "PHASE ADMITTED" : "PHASE ADMISSION_TIMEOUT");

// login check (the profile snapshot is deferred until AFTER READY — see below —
// so the 95MB tar/read no longer sits on the critical path to going live).
const pageUrl = async () => run(`curl -s http://localhost:9222/json | python3 -c "import sys,json;print([t.get('url','') for t in json.load(sys.stdin) if t.get('type')=='page'][0])" 2>/dev/null`);
let u = await pageUrl();
if (u.includes("auth.goperfect.com")) {
  console.log("PHASE AUTO_LOGIN");
  // one transient rejection must not strand a REAL call on the login page
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { execFileSync("node", ["/app/ah/gp_login.mjs", d.sandboxId], { stdio: "inherit", timeout: 180000 }); } catch (e) { console.log("auto-login issue:", (e && e.message) || e); }
    for (let i = 0; i < 24; i++) { await sleep(5000); u = await pageUrl(); if (u.includes("doubl-e.goperfect.com")) break; }
    if (u.includes("doubl-e.goperfect.com")) break;
    console.log(`login attempt ${attempt} failed${attempt < 2 ? " — retrying in 15s" : ""}`);
    if (attempt < 2) await sleep(15000);
  }
}
const loggedIn = u.includes("doubl-e.goperfect.com");
console.log(loggedIn ? `PHASE LOGGED_IN ${u}` : "PHASE LOGIN_TIMEOUT — continuing anyway");

// Refresh the profile snapshot in the BACKGROUND (off the critical path). It only
// needs to land before the NEXT cold arm, not before this call goes live.
async function snapshotProfileAsync() {
  if (!loggedIn) return;
  try {
    await run("cd /home/user && tar czf /tmp/gp-profile.tgz --exclude='gp-profile/Default/Cache*' --exclude='gp-profile/Default/Code Cache' --exclude='gp-profile/Default/GPUCache' --exclude='gp-profile/Default/Service Worker' gp-profile 2>/dev/null; echo done", 180000);
    const bytes = await d.files.read("/tmp/gp-profile.tgz", { format: "bytes" });
    fs.writeFileSync("/app/ah/gp-profile.tgz", Buffer.from(bytes));
    console.log("PHASE SNAPSHOTTED", fs.statSync("/app/ah/gp-profile.tgz").size, "bytes (post-READY)");
  } catch (e) { console.log("snapshot save failed:", (e && e.message) || e); }
}

// bridge, share, unmute
try { execFileSync("node", ["/app/ah/duplexnav7.mjs", d.sandboxId], { stdio: "inherit", timeout: 120000 }); } catch (e) { console.log("bridge start issue:", (e && e.message) || e); }
console.log("PHASE BRIDGE_UP");

const winByName = async (n) => (await run(`DISPLAY=:0 xdotool search --name "${n}" 2>/dev/null | head -1`)).trim();
const mw = await winByName("^Meeting$");
if (mw && !mw.startsWith("ERR")) {
  await run(`DISPLAY=:0 xdotool windowsize ${mw} 1024 720; DISPLAY=:0 xdotool windowmove ${mw} 0 0; DISPLAY=:0 xdotool windowactivate --sync ${mw}; DISPLAY=:0 xdotool windowraise ${mw}`);
  await sleep(1000);
  // unmute FIRST (agent always joins muted): focus + Escape + Alt+A
  // share with VERIFICATION (as_toolbar window exists only while sharing)
  let shared = false;
  for (let a = 1; a <= 4 && !shared; a++) {
    let picker = await winByName("Select a window");
    if (!picker || picker.startsWith("ERR")) {            // only open if not already open (Alt+S toggles!)
      await run(`DISPLAY=:0 xdotool windowactivate --sync ${mw}`); await sleep(500);
      await d.press(["alt", "s"]); await sleep(3000);
      picker = await winByName("Select a window");
    }
    if (picker && !picker.startsWith("ERR")) {
      await sleep(1500);                                   // let the app-window tiles render
      await d.leftClick(135, 440); await sleep(1200);      // app-window tile
      await d.leftClick(511, 687); await sleep(4000);      // Share
    }
    const tb = await winByName("as_toolbar");
    if (tb && !tb.startsWith("ERR")) shared = true;
    else { await d.press("Escape"); await sleep(800); }    // close stray picker before retry
    console.log(`share attempt ${a}: picker=${picker && !picker.startsWith("ERR") ? "yes" : "no"} shared=${shared}`);
  }
  console.log(shared ? "PHASE SHARED_VERIFIED" : "PHASE SHARE_FAILED — check STREAM");
  // unmute AFTER share, with pixel verification (red slash in Audio icon)
  const isMuted = async () => {
    try {
      const shot = await d.screenshot();
      await run("sudo rm -f /tmp/mshot.png");
      await d.files.write("/tmp/mshot.png", Buffer.from(shot));
      const v = await run(`convert /tmp/mshot.png -crop 50x40+35+30 -format "%[fx:mean.r-mean.g]" info: 2>/dev/null || echo NOIM`);
      if (v.includes("NOIM") || v.startsWith("ERR")) return null;
      return parseFloat(v) > 0.03;
    } catch { return null; }
  };
  let muted = await isMuted();
  console.log("mute check:", muted);
  if (muted === null) { // no imagemagick — single blind toggle
    await d.moveMouse(512, 60); await sleep(400); await d.leftClick(60, 60); await sleep(1000);
    console.log("PHASE UNMUTE_BLIND_TOGGLE — verify on the tile");
  } else {
    for (let i = 0; i < 3 && muted; i++) {
      await d.moveMouse(512, 60); await sleep(400);
      await d.leftClick(60, 60); await sleep(1400);
      muted = await isMuted();
      console.log(`unmute attempt ${i + 1}: muted=${muted}`);
    }
    console.log(muted === false ? "PHASE UNMUTED_VERIFIED" : "PHASE UNMUTE_UNCERTAIN — check tile");
  }
} else {
  console.log("PHASE SHARE_SKIPPED — meeting window not found");
}
fs.writeFileSync("/app/ah/nlive.png", Buffer.from(await d.screenshot()));
console.log("PHASE READY", d.sandboxId);

// Now that Maya is live, refresh the profile snapshot in the background.
void snapshotProfileAsync();

for (let i = 0; i < 600; i++) {
  await sleep(5000);
  try { fs.writeFileSync("/app/ah/nlive.png", Buffer.from(await d.screenshot())); } catch { break; }
}
await p.end();
