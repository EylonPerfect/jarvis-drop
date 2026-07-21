import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import fs from "node:fs";

// Auto-login to the Perfect demo account in the sandbox browser.
// Credentials come from /app/ah/gp-login.json (owner-authorized; never logged).
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const e2b = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows[0].values.apiKey;
const d = await Sandbox.connect(process.argv[2], { apiKey: e2b });
let creds = null;
const AID = process.env.AH_AGENT_ID || "";
if (AID) {
  try {
    const _r = await p.query("SELECT value FROM settings WHERE key = 'demo_login:' || $1", [AID]);
    const _v = _r.rows[0] && _r.rows[0].value;
    if (_v && _v.email && _v.password) creds = { email: _v.email, password: _v.password };
  } catch { /* fall back to the global file */ }
}
if (!creds) creds = JSON.parse(fs.readFileSync("/app/ah/gp-login.json", "utf8"));
const run = async (c, envs) => { try { const o = await d.commands.run(c, { timeoutMs: 90000, envs }); return ((o.stdout||"")+(o.stderr||"")).trim(); } catch(e){ return "ERR:"+((e&&e.stderr)||(e&&e.message)||e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const py = `
import asyncio, json, os, urllib.request, websockets
EMAIL = os.environ["GP_EMAIL"]; PASS = os.environ["GP_PASS"]
data = json.loads(urllib.request.urlopen("http://localhost:9222/json", timeout=5).read())
ws_url = [t["webSocketDebuggerUrl"] for t in data if t.get("type")=="page"][0]
def setval(sel_js, val):
    return """(()=>{const i=%s;if(!i)return 'nofield';
      const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      s.call(i,%s);i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();return 'set';})()""" % (sel_js, json.dumps(val))
CLICK = """(()=>{const b=[...document.querySelectorAll('button,[role=button],input[type=submit]')].find(x=>/continue|log ?in|sign ?in/i.test((x.innerText||x.value||'')));if(!b)return 'nobutton';b.click();return 'clicked '+(b.innerText||b.value||'').trim();})()"""
EMAIL_SEL = "document.querySelector('input[type=email]')||[...document.querySelectorAll('input')].find(x=>/email/i.test((x.placeholder||'')+(x.name||'')))"
PASS_SEL = "document.querySelector('input[type=password]')"
async def ev(ws, i, expr):
    await ws.send(json.dumps({"id":i,"method":"Runtime.evaluate","params":{"expression":expr,"returnByValue":True}}))
    while True:
        r = json.loads(await asyncio.wait_for(ws.recv(), timeout=12))
        if r.get("id")==i: return r.get("result",{}).get("result",{}).get("value")
ENTER = """(()=>{const i=document.querySelector('input[type=password]');if(!i)return 'nopass';
  const o={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true};
  i.dispatchEvent(new KeyboardEvent('keydown',o));i.dispatchEvent(new KeyboardEvent('keyup',o));
  const f=i.closest('form');if(f&&f.requestSubmit)f.requestSubmit();return 'submitted';})()"""
async def main():
    ws = await websockets.connect(ws_url, max_size=None)
    i = [1]
    async def E(expr):
        i[0]+=1
        return await ev(ws, i[0], expr)
    # reset to a clean login form (recovers from stray SSO redirects)
    await E("location.href='https://auth.goperfect.com/'")
    await asyncio.sleep(5)
    print("email:", await E(setval(EMAIL_SEL, EMAIL)))
    await asyncio.sleep(0.6)
    print("btn1:", await E(CLICK))
    for _ in range(20):
        await asyncio.sleep(1.5)
        if (await E("!!" + PASS_SEL)): break
    print("pass:", await E(setval(PASS_SEL, PASS)))
    await asyncio.sleep(0.6)
    b = await E(CLICK)
    print("btn2:", b)
    if b == 'nobutton':
        print("enter:", await E(ENTER))
    stable = 0
    for _ in range(30):
        await asyncio.sleep(2)
        u = await E("location.href") or ""
        if "doubl-e.goperfect.com" in u:
            stable += 1
            if stable >= 2:
                print("LOGIN_OK", u); return
        else:
            stable = 0
    print("LOGIN_PENDING — check screen")
asyncio.run(main())
`;
try {
  await run("sudo rm -f /tmp/gplogin.py");
  await d.files.write("/tmp/gplogin.py", py);
  console.log(await run("python3 /tmp/gplogin.py", { GP_EMAIL: creds.email, GP_PASS: creds.password }));
  await run("sudo rm -f /tmp/gplogin.py");
  await sleep(1500);
  fs.writeFileSync("/app/ah/nlive.png", Buffer.from(await d.screenshot()));
} finally { await p.end(); }
