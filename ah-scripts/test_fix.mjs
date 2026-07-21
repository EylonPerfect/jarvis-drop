import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import { execFileSync } from "node:child_process";

// End-to-end regression for the call that failed: reproduce the exact scenario
// with the GOLDEN persona loaded, through the REAL tools, and assess the log.
const SID = process.argv[2];
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const e2b = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows[0].values.apiKey;
const d = await Sandbox.connect(SID, { apiKey: e2b });
const sh = async (c, t = 30000) => { try { const o = await d.commands.run(c, { timeoutMs: t }); return ((o.stdout||"")+(o.stderr||"")).trim(); } catch(e){ return "ERR:"+((e&&e.stderr)||(e&&e.message)||e); } };

const TURNS = [
  "Hey, how are you?",
  "We're a twenty person AI recruiting startup from Israel. We hire three to five classic tech roles a month, mostly outbound, using LinkedIn Recruiter Lite and Greenhouse.",
  "Let's look for a full-stack developer in Tel Aviv.",
  "The core stack is React and Node.js, and we're after mid to senior level.",
  "__WAIT__:90",
  "Great — how many candidates did you find? Show me the matches.",
  "__WAIT__:20",
  "Perfect, thanks.",
];

// fresh start: navigate chrome to the home board (mirror a fresh call — no leftover card)
const navpy = `
import json,urllib.request,asyncio,websockets
def u():
    d=json.load(urllib.request.urlopen("http://localhost:9222/json"))
    return [t for t in d if t.get("type")=="page"][0]["webSocketDebuggerUrl"]
async def m():
    async with websockets.connect(u(),max_size=None) as ws:
        await ws.send(json.dumps({"id":1,"method":"Page.navigate","params":{"url":"https://doubl-e.goperfect.com/"}}))
        await ws.recv()
asyncio.run(m())
`;
await d.files.write("/home/user/nav.py", navpy);
await sh("python3 /home/user/nav.py 2>&1; sleep 6; true");
await sh("pkill -9 -f 'duplexnav7[.]py' 2>/dev/null; rm -f /tmp/duplexnav7.log; sleep 1; true");
console.log("launching scripted bridge (golden auto-loads from settings)…");
try {
  execFileSync("node", ["/app/ah/duplexnav7.mjs", SID, "nogreet"], {
    env: { ...process.env, TEST_SCRIPT_JSON: JSON.stringify(TURNS) },
    timeout: 60000, stdio: "inherit",
  });
} catch (e) { /* .mjs returns after ~8s; python keeps running in the sandbox */ }

// poll the sandbox bridge log until SCRIPT DONE (or timeout)
let log = "";
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  log = await sh("cat /tmp/duplexnav7.log 2>/dev/null");
  if (/SCRIPT DONE/.test(log)) break;
}
console.log("\n================ BRIDGE LOG ================\n");
console.log(log);
console.log("\n================ ASSESSMENT ================\n");
const aq = (log.match(/TOOLCALL answer_question/g) || []).length;
const noq = (log.match(/No multiple-choice question is on screen/g) || []).length;
const stop = (log.match(/STOP — there is NO/g) || []).length;
const collide = (log.match(/conversation_already_has_active_response/g) || []).length;
const created = /TOOLRESULT new_position POSITION CREATED/.test(log);
const asked = /TOOLRESULT ask_perfect DELIVERED/.test(log);
const answered = (log.match(/TOOLRESULT answer_question Answered \(/g) || []).length;
const eli = (log.match(/\bEliezer\b|I'?m Eli\b|call me Eli/gi) || []);
// Real candidate evidence (NOT the "Match/Outreach" tab label): a matches count like
// "44 / 109", explicit "N candidates/matches", shortlist/skip affordances, or % match.
const reached = /\d{1,3}\s*\/\s*\d{2,}|\b\d{1,3}\s+(candidates?|matches|profiles)\b|found\s+\d{1,3}|add to shortlist|% match|skip candidate/i.test(log);
console.log("--- read_screen / SAY excerpts ---");
for (const line of log.split("\n")) if (/^SAY |TOOLRESULT read_screen|TOOLRESULT start_matching/.test(line)) console.log("  " + line.slice(0, 260));
console.log("----------------------------------");
console.log("position created:      ", created ? "YES" : "NO");
console.log("brief delivered:       ", asked ? "YES" : "NO");
console.log("cards answered:        ", answered, answered >= 1 ? "(good)" : "(none)");
console.log("answer_question calls: ", aq);
console.log("response collisions:   ", collide, collide === 0 ? "(good)" : "(BAD)");
console.log("identity leaks (Eli):  ", eli.length, eli.length ? JSON.stringify(eli.slice(0,3)) : "(none)");
console.log("reached candidates:    ", reached ? "YES" : "NO");
// Cards are a FALLBACK — the happy path (complete brief) needs none. Success = reached
// candidates cleanly, no collisions, no identity leak, and no phantom answer_question loop.
const pass = created && asked && collide === 0 && eli.length === 0 && reached && aq <= 6;
console.log("\nVERDICT:", pass ? "PASS ✅" : "NEEDS-WORK ❌");
await p.end();
