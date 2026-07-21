import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

// ONE-SHOT call pipeline: node /app/ah/call_up.mjs <meetingId>
// Does everything: sandbox → (zoom install ∥ chrome+session ∥ deps) → join →
// auto-detect admission via PulseAudio → login check → snapshot → bridge →
// share → unmute. Prints PHASE lines for progress.
const MEETING = process.argv[2];
if (!MEETING) { console.log("usage: call_up.mjs <meetingId>"); process.exit(1); }
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

const d = await Sandbox.create({ apiKey: e2b, timeoutMs: 55 * 60 * 1000 });
console.log("PHASE SANDBOX", d.sandboxId);
const run = async (c, t = 90000) => { try { const o = await d.commands.run(c, { timeoutMs: t }); return ((o.stdout||"")+(o.stderr||"")).trim(); } catch(e){ return "ERR:"+((e&&e.stderr)||(e&&e.message)||e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- parallel prep ----
const audioSetup = (async () => {
  await run("pulseaudio --start --exit-idle-time=-1 || true");
  await run("pactl load-module module-null-sink sink_name=vspk sink_properties=device.description=vspk || true");
  await run("pactl load-module module-remap-source master=vspk.monitor source_name=vmic || true");
  await run("pactl load-module module-null-sink sink_name=zout sink_properties=device.description=zout || true");
  await run("pactl set-default-source vmic || true; pactl set-default-sink zout || true");
  // full-call recording: mix clone (vspk) + guest (zout) into recmix, record it for the whole call.
  await run("pactl load-module module-null-sink sink_name=recmix sink_properties=device.description=recmix || true");
  await run("pactl load-module module-loopback source=vspk.monitor sink=recmix latency_msec=1 || true");
  await run("pactl load-module module-loopback source=zout.monitor sink=recmix latency_msec=1 || true");
  await d.commands.run("pacat --record --format=s16le --rate=24000 --channels=1 --device=recmix.monitor > /tmp/call_mix.raw 2>/dev/null", { background: true }).catch(() => {});
  await run("mkdir -p ~/.config && printf '[General]\\nenableAutoJoinVoIP=true\\nenableTestMicWhenJoin=false\\nenableMiniWindow=false\\n' > ~/.config/zoomus.conf || true");
  console.log("PHASE AUDIO_READY");
})();
const zoomInstall = (async () => {
  await audioSetup; // zoomus.conf must exist before zoom launches
  const r = await run("curl -sL -o /tmp/zoom.deb https://zoom.us/client/latest/zoom_amd64.deb && sudo apt-get update -y >/tmp/apt.log 2>&1 && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/zoom.deb imagemagick ffmpeg >>/tmp/apt.log 2>&1; dpkg -l | grep -c 'ii  zoom'", 300000);
  console.log("PHASE ZOOM_INSTALLED", r.slice(-4));
})();
const chromeUp = (async () => {
  try {
    const tgz = fs.readFileSync("/app/ah/gp-profile.tgz");
    await d.files.write("/home/user/gp-profile.tgz", tgz);
    await run("cd /home/user && rm -rf gp-profile && tar xzf gp-profile.tgz && rm -f gp-profile/SingletonLock gp-profile/SingletonCookie gp-profile/SingletonSocket; echo ok", 120000);
  } catch { console.log("no profile snapshot — fresh chrome"); await run("mkdir -p /home/user/gp-profile"); }
  const flags = "--no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --no-default-browser-check --disable-session-crashed-bubble --disable-infobars --password-store=basic --force-device-scale-factor=0.8 --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=/home/user/gp-profile --window-position=0,0 --window-size=1024,768 --kiosk";
  await d.commands.run(`DISPLAY=:0 dbus-launch google-chrome-stable ${flags} "${POS_URL}" > /tmp/chrome.log 2>&1 &`, { background: true }).catch(() => {});
  console.log("PHASE CHROME_LAUNCHED");
})();
const deps = (async () => { await run("pip install -q websockets 2>&1 | tail -1; echo ok", 180000); console.log("PHASE DEPS_READY"); })();

await d.stream.start({ requireAuth: true }).catch(() => {});
try { const ak = await d.stream.getAuthKey(); console.log("PHASE STREAM", d.stream.getUrl({ authKey: ak })); } catch { /* ignore */ }

await Promise.all([zoomInstall, chromeUp, deps]);

// ---- join ----
await d.commands.run(`DISPLAY=:0 QT_QPA_PLATFORM=xcb /usr/bin/zoom "zoommtg://zoom.us/join?action=join&confno=${MEETING}&uname=${UNAME}" > /tmp/zoom.log 2>&1 &`, { background: true, timeoutMs: 15000 }).catch(() => {});
// wait for the join-preview window, move it into view, click Join
let joined = false;
for (let i = 0; i < 30; i++) {
  await sleep(3000);
  const w = await run('DISPLAY=:0 xdotool search --name "Zoom Meeting" 2>/dev/null | head -1');
  if (w && !w.startsWith("ERR")) {
    await run(`DISPLAY=:0 sh -c 'for x in $(xdotool search --name "Zoom Meeting"); do xdotool windowmove $x 200 0; xdotool windowactivate $x; done'`);
    await sleep(1200);
    await d.leftClick(792, 559);
    console.log("PHASE JOIN_CLICKED");
    joined = true; break;
  }
}
if (!joined) console.log("PHASE JOIN_PREVIEW_NOT_FOUND — check STREAM");

// ---- auto-detect admission: Zoom opens a mic stream once actually in-meeting ----
console.log("PHASE WAITING_ADMISSION (admit After Human AI in Zoom)");
let admitted = false;
for (let i = 0; i < 120; i++) {
  await sleep(5000);
  const so = await run("pactl list source-outputs short 2>/dev/null | grep -v pacat | wc -l");
  if (parseInt(so) >= 1) { admitted = true; break; }
  const invalid = await run('DISPLAY=:0 xdotool search --name "Leave meeting" 2>/dev/null | head -1');
  if (invalid && !invalid.startsWith("ERR") && invalid.trim()) { console.log("PHASE MEETING_ERROR — possibly invalid/ended meeting, check STREAM"); }
}
console.log(admitted ? "PHASE ADMITTED" : "PHASE ADMISSION_TIMEOUT");

// ---- login check + immediate snapshot ----
const pageUrl = async () => run(`curl -s http://localhost:9222/json | python3 -c "import sys,json;print([t.get('url','') for t in json.load(sys.stdin) if t.get('type')=='page'][0])" 2>/dev/null`);
let u = await pageUrl();
if (u.includes("auth.goperfect.com")) {
  console.log("PHASE AUTO_LOGIN");
  // GoPerfect sometimes rejects a first login transiently ("we're facing some
  // difficulties") — one failed attempt must not strand a REAL call on the
  // login page, so try twice before giving up.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { execFileSync("node", ["/app/ah/gp_login.mjs", d.sandboxId], { stdio: "inherit", timeout: 180000 }); } catch (e) { console.log("auto-login issue:", (e && e.message) || e); }
    for (let i = 0; i < 24; i++) { await sleep(5000); u = await pageUrl(); if (u.includes("doubl-e.goperfect.com")) break; }
    if (u.includes("doubl-e.goperfect.com")) break;
    console.log(`login attempt ${attempt} failed${attempt < 2 ? " — retrying in 15s" : ""}`);
    if (attempt < 2) await sleep(15000);
  }
}
if (u.includes("doubl-e.goperfect.com")) {
  console.log("PHASE LOGGED_IN", u);
  // trimmed snapshot (no caches) — immediately, so token rotation never strands us
  await run("cd /home/user && tar czf /tmp/gp-profile.tgz --exclude='gp-profile/Default/Cache*' --exclude='gp-profile/Default/Code Cache' --exclude='gp-profile/Default/GPUCache' --exclude='gp-profile/Default/Service Worker' gp-profile 2>/dev/null; ls -la /tmp/gp-profile.tgz | awk '{print $5}'", 180000);
  try {
    const bytes = await d.files.read("/tmp/gp-profile.tgz", { format: "bytes" });
    fs.writeFileSync("/app/ah/gp-profile.tgz", Buffer.from(bytes));
    console.log("PHASE SNAPSHOTTED", fs.statSync("/app/ah/gp-profile.tgz").size, "bytes");
  } catch (e) { console.log("snapshot save failed:", (e && e.message) || e); }
  // make sure we're on the demo position (fresh logins land on home)
  if (!u.includes("/positions/")) {
    await run(`curl -s http://localhost:9222/json | python3 -c "import sys,json;print([t['id'] for t in json.load(sys.stdin) if t.get('type')=='page'][0])" | xargs -I{} curl -s "http://localhost:9222/json/activate/{}" >/dev/null 2>&1; true`);
  }
} else {
  console.log("PHASE LOGIN_TIMEOUT — bridge will still start; agent can guide");
}

// ---- voice bridge (v6) ----
try { execFileSync("node", ["/app/ah/duplexnav7.mjs", d.sandboxId], { stdio: "inherit", timeout: 120000 }); } catch (e) { console.log("bridge start issue:", (e && e.message) || e); }
console.log("PHASE BRIDGE_UP");

// ---- share the product window (verified), unmute first ----
const winByName = async (n) => (await run(`DISPLAY=:0 xdotool search --name "${n}" 2>/dev/null | head -1`)).trim();
const mw = await winByName("^Meeting$");
if (mw && !mw.startsWith("ERR")) {
  await run(`DISPLAY=:0 xdotool windowsize ${mw} 1024 720; DISPLAY=:0 xdotool windowmove ${mw} 0 0; DISPLAY=:0 xdotool windowactivate --sync ${mw}; DISPLAY=:0 xdotool windowraise ${mw}`);
  await sleep(1000);
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

// keep a light screenshot loop so /app/ah/nlive.png stays fresh for spot checks
for (let i = 0; i < 600; i++) {
  await sleep(5000);
  try { fs.writeFileSync("/app/ah/nlive.png", Buffer.from(await d.screenshot())); } catch { /* sandbox gone */ break; }
}
await p.end();
