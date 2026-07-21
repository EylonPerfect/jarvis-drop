import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import fs from "node:fs";

// Prepare a fully-provisioned sandbox (Zoom installed, session profile staged,
// deps ready) and PAUSE it. call_wake.mjs resumes it in seconds for a call.
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const e2b = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows[0].values.apiKey;
const d = await Sandbox.create({ apiKey: e2b, timeoutMs: 30 * 60 * 1000 });
console.log("PHASE SANDBOX", d.sandboxId);
const run = async (c, t = 90000) => { try { const o = await d.commands.run(c, { timeoutMs: t }); return ((o.stdout||"")+(o.stderr||"")).trim(); } catch(e){ return "ERR:"+((e&&e.stderr)||(e&&e.message)||e); } };

// audio + zoom config
await run("pulseaudio --start --exit-idle-time=-1 || true");
await run("pactl load-module module-null-sink sink_name=vspk sink_properties=device.description=vspk || true");
await run("pactl load-module module-remap-source master=vspk.monitor source_name=vmic || true");
await run("pactl load-module module-null-sink sink_name=zout sink_properties=device.description=zout || true");
await run("pactl set-default-source vmic || true; pactl set-default-sink zout || true");
await run("mkdir -p ~/.config && printf '[General]\\nenableAutoJoinVoIP=true\\nenableTestMicWhenJoin=false\\nenableMiniWindow=false\\n' > ~/.config/zoomus.conf || true");
console.log("PHASE AUDIO_READY");

// zoom install (the slow part — done here, never on the call)
console.log("PHASE ZOOM_INSTALLING");
console.log("install:", (await run("curl -sL -o /tmp/zoom.deb https://zoom.us/client/latest/zoom_amd64.deb && sudo apt-get update -y >/tmp/apt.log 2>&1 && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/zoom.deb imagemagick >>/tmp/apt.log 2>&1; dpkg -l | grep -c 'ii  zoom'", 300000)).slice(-4));

// profile staged (may be stale — call_wake handles login + fresh snapshot)
try {
  const tgz = fs.readFileSync("/app/ah/gp-profile.tgz");
  await d.files.write("/home/user/gp-profile.tgz", tgz);
  await run("cd /home/user && rm -rf gp-profile && tar xzf gp-profile.tgz && rm -f gp-profile/SingletonLock gp-profile/SingletonCookie gp-profile/SingletonSocket; echo ok", 120000);
  console.log("PHASE PROFILE_STAGED");
} catch { console.log("PHASE NO_PROFILE (fresh login will be needed)"); }

await run("pip install -q websockets 2>&1 | tail -1; echo ok", 180000);
console.log("PHASE DEPS_READY");

await d.betaPause();
// Headless hand-off (join / calendar-watch scheduler, no operator in the loop):
// publish the paused sandbox id ATOMICALLY so a concurrent call_wake /
// warm_standby read can never observe a half-written id. Write to a temp file
// then rename — rename is atomic within a filesystem.
const STANDBY_TXT = "/app/ah/standby.txt";
fs.writeFileSync(STANDBY_TXT + ".tmp", d.sandboxId);
fs.renameSync(STANDBY_TXT + ".tmp", STANDBY_TXT);
console.log("PHASE STANDBY_PUBLISHED", d.sandboxId);
console.log("PHASE STANDBY_PAUSED", d.sandboxId);
await p.end();
