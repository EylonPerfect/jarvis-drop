import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import fs from "node:fs";

// Resume: share product window + unmute against an ALREADY-JOINED sandbox.
// usage: node call_share.mjs <sandboxId>
const SB = process.argv[2];
if (!SB) { console.log("usage: call_share.mjs <sandboxId>"); process.exit(1); }
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const _e2bRows = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows;
const e2b = (_e2bRows.find((r) => (r.values.apiKey || "").startsWith("e2b_")) || _e2bRows[0]).values.apiKey;
const d = await Sandbox.connect(SB, { apiKey: e2b });
const run = async (c, t = 90000) => { try { const o = await d.commands.run(c, { timeoutMs: t }); return ((o.stdout||"")+(o.stderr||"")).trim(); } catch(e){ return "ERR:"+((e&&e.stderr)||(e&&e.message)||e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const winByName = async (n) => (await run(`DISPLAY=:0 xdotool search --name "${n}" 2>/dev/null | head -1`)).trim();

const mw = await winByName("^Meeting$");
if (mw && !mw.startsWith("ERR")) {
  await run(`DISPLAY=:0 xdotool windowsize ${mw} 1024 720; DISPLAY=:0 xdotool windowmove ${mw} 0 0; DISPLAY=:0 xdotool windowactivate --sync ${mw}; DISPLAY=:0 xdotool windowraise ${mw}`);
  await sleep(1000);
  let shared = false;
  for (let a = 1; a <= 4 && !shared; a++) {
    let picker = await winByName("Select a window");
    if (!picker || picker.startsWith("ERR")) {
      await run(`DISPLAY=:0 xdotool windowactivate --sync ${mw}`); await sleep(500);
      await d.press(["alt", "s"]); await sleep(3000);
      picker = await winByName("Select a window");
    }
    if (picker && !picker.startsWith("ERR")) {
      await sleep(1500);
      await d.leftClick(135, 440); await sleep(1200);
      await d.leftClick(511, 687); await sleep(4000);
    }
    const tb = await winByName("as_toolbar");
    if (tb && !tb.startsWith("ERR")) shared = true;
    else { await d.press("Escape"); await sleep(800); }
    console.log(`share attempt ${a}: picker=${picker && !picker.startsWith("ERR") ? "yes" : "no"} shared=${shared}`);
  }
  console.log(shared ? "PHASE SHARED_VERIFIED" : "PHASE SHARE_FAILED — check STREAM");
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
  if (muted === null) {
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
console.log("PHASE READY", SB);
await p.end();
