import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import fs from "node:fs";

// Deterministic GENERIC gate-pass for NON-GoPerfect product demos.
// At boot, if the clone's product opens onto an access-code / login GATE, pass it
// deterministically here — instead of hoping the realtime model uses type_text.
//
// Strategy:
//   PRIMARY  — TOKEN INJECTION: write the credential into local + session storage
//              under common access-token keys (jv.access = After Human's key) and
//              reload. Deterministic for SPA token gates; no fragile field typing.
//   FALLBACK — FIELD TYPING: only if the token gate didn't clear. Native-setter
//              value set + input/change dispatch; the field is CLEARED before each
//              attempt so a retry never doubles the input.
//   VERIFY   — DOM-based: gate is PASSED when the gate is GONE from the DOM (no
//              visible password input, no 'access code' text, no lone gate input).
//              URL is ignored (After Human's gate is a full-screen overlay at
//              /#/echo, so the URL never changes while gated).
// Idempotent + safe: if no gate is present (most products) it prints "no gate"
// and exits 0.
//
// Gate credential = the clone's demo-login PASSWORD (settings demo_login:<AH_AGENT_ID>),
// mirroring gp_login's resolution; falls back to /app/ah/gp-login.json.
// LAW-18: the embedded-Python CDP JS uses single quotes only, ZERO backslashes,
// ZERO backticks, ZERO ${ } — values are injected with json.dumps.

const HARD_LIMIT = setTimeout(() => { console.log("gate timeout — exiting 0"); process.exit(0); }, 110000);
HARD_LIMIT.unref();

const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const _e2bRows = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows;
const e2b = (_e2bRows.find((r) => (r.values.apiKey || "").startsWith("e2b_")) || _e2bRows[0]).values.apiKey;
const d = await Sandbox.connect(process.argv[2], { apiKey: e2b });

// resolve the gate credential exactly like gp_login (per-agent demo_login, else file)
let code = null;
const AID = process.env.AH_AGENT_ID || "";
if (AID) {
  try {
    const _r = await p.query("SELECT value FROM settings WHERE key = 'demo_login:' || $1", [AID]);
    const _v = _r.rows[0] && _r.rows[0].value;
    if (_v && _v.password) code = _v.password;
  } catch { /* fall back to the global file */ }
}
if (!code) {
  try { code = JSON.parse(fs.readFileSync("/app/ah/gp-login.json", "utf8")).password; } catch { /* none */ }
}
// The gate credential must be the value the app BFF accepts as X-API-Key. After
// Human's login gate stores it in localStorage['jv.access'] and, on ANY 401,
// clears it and bounces back to the gate (apps/web/src/api/client.ts →
// onUnauthorized). A demo_login password encrypted at rest (enc:v1:...) is
// ciphertext, not the access code — injecting it makes the first authed request
// 401 and the gate reappear. For the platform's own gate, BFF_API_KEY (present
// in this bff container's env) IS the real access code; prefer it over an
// unusable ciphertext, or when no credential resolved at all.
if ((!code || /^enc:v1:/.test(code)) && process.env.BFF_API_KEY) {
  code = process.env.BFF_API_KEY;
}
if (!code) { console.log("no gate — no credential available"); await p.end(); process.exit(0); }

// Org-scope hint: the demo app must render THIS agent's own org (e.g. the
// Northwind demo tenant), not the platform legacy org. The app forwards
// localStorage['jv.serviceorg'] as X-Service-Org (apps/web/src/api/client.ts),
// which the BFF service path honours (valid BFF_API_KEY required). Inject the
// agent's org so the demo shows the curated tenant, never real legacy data.
let svcOrg = "";
if (AID) {
  try { const _o = await p.query("SELECT org_id FROM agents WHERE id = $1", [AID]); svcOrg = (_o.rows[0] && _o.rows[0].org_id) || ""; } catch { /* none */ }
}

const run = async (c, envs) => { try { const o = await d.commands.run(c, { timeoutMs: 90000, envs }); return ((o.stdout||"")+(o.stderr||"")).trim(); } catch(e){ return "ERR:"+((e&&e.stderr)||(e&&e.message)||e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const py = `
import asyncio, json, os, urllib.request, websockets
CODE = os.environ["GATE_CODE"]
SVCORG = os.environ.get("GATE_SVCORG", "")
data = json.loads(urllib.request.urlopen("http://localhost:9222/json", timeout=5).read())
pages = [t["webSocketDebuggerUrl"] for t in data if t.get("type")=="page"]
if not pages:
    print("no gate"); raise SystemExit(0)
ws_url = pages[0]

# TARGET: an IIFE returning the gate input element (or null). Prefer a visible
# password field; else the single visible text-ish input on a minimal gate page.
TARGET = "(function(){var vis=function(el){if(!el)return false;var r=el.getClientRects();if(!r||!r.length)return false;var b=el.getBoundingClientRect();var s=window.getComputedStyle(el);return s.visibility!=='hidden'&&s.display!=='none'&&b.width>1&&b.height>1;};var pw=document.querySelector('input[type=password]');if(pw&&vis(pw))return pw;var cand=[].slice.call(document.querySelectorAll('input')).filter(function(x){var t=(x.getAttribute('type')||'text').toLowerCase();return t!=='hidden'&&t!=='submit'&&t!=='button'&&t!=='checkbox'&&t!=='radio'&&t!=='file'&&vis(x);});return cand.length===1?cand[0]:null;})()"

# GATE_PRESENT: DOM-based gate detector (URL-independent — After Human's gate is
# a full-screen overlay at /#/echo, so location never changes while gated).
# Present when a visible password input exists, OR the visible 'access code' text
# is on screen, OR there is a lone visible text input (a minimal gate page).
GATE_PRESENT = "(function(){var vis=function(el){if(!el)return false;var r=el.getClientRects();if(!r||!r.length)return false;var b=el.getBoundingClientRect();var s=window.getComputedStyle(el);return s.visibility!=='hidden'&&s.display!=='none'&&b.width>1&&b.height>1;};var pw=document.querySelector('input[type=password]');if(pw&&vis(pw))return true;var txt=(document.body&&document.body.innerText)||'';if(/access[ -]?code/i.test(txt))return true;var cand=[].slice.call(document.querySelectorAll('input')).filter(function(x){var t=(x.getAttribute('type')||'text').toLowerCase();return t!=='hidden'&&t!=='submit'&&t!=='button'&&t!=='checkbox'&&t!=='radio'&&t!=='file'&&vis(x);});return cand.length===1;})()"

# PRIMARY: write the credential into local + session storage under the common
# access-token keys (jv.access is After Human's exact key), then reload. This is
# deterministic for SPA token gates and needs no field typing.
INJECT_JS = "(function(){var keys=['jv.access','access','accessKey','apiKey','token','auth'];var v=" + json.dumps(CODE) + ";var so=" + json.dumps(SVCORG) + ";var n=0;keys.forEach(function(k){try{localStorage.setItem(k,v);n++;}catch(e){}try{sessionStorage.setItem(k,v);}catch(e){}});if(so){try{localStorage.setItem('jv.serviceorg',so);}catch(e){}try{sessionStorage.setItem('jv.serviceorg',so);}catch(e){}}return 'injected '+n+' keys svcorg='+(so?'1':'0');})()"

FIND_JS = "(function(){var el=" + TARGET + ";if(!el)return 'nofield';return ((el.getAttribute('type')||'').toLowerCase()==='password')?'password':'single';})()"

# CLEAR before every set so a retry never appends (fixes the doubled-input bug).
CLEAR_JS = "(function(){var el=" + TARGET + ";if(!el)return 'nofield';var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');var s=d&&d.set;el.focus();if(s){s.call(el,'');}else{el.value='';}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return 'cleared';})()"

SET_JS = "(function(){var el=" + TARGET + ";if(!el)return 'nofield';var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');var s=d&&d.set;el.focus();if(s){s.call(el," + json.dumps(CODE) + ");}else{el.value=" + json.dumps(CODE) + ";}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return 'set';})()"

CLICK_JS = "(function(){var re=/continue|enter|sign ?in|log ?in|submit|unlock|verify/i;var vis=function(el){var r=el.getClientRects();if(!r||!r.length)return false;var b=el.getBoundingClientRect();var s=window.getComputedStyle(el);return s.visibility!=='hidden'&&s.display!=='none'&&b.width>1&&b.height>1;};var btns=[].slice.call(document.querySelectorAll('button,[role=button],input[type=submit],input[type=button],a')).filter(vis);var b=btns.find(function(x){return re.test(((x.innerText||x.value||'')+'').trim());});if(!b)return 'nobutton';b.click();return 'clicked '+((b.innerText||b.value||'')+'').trim();})()"

ENTER_JS = "(function(){var el=" + TARGET + ";if(!el)return 'noinput';var o={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true};el.dispatchEvent(new KeyboardEvent('keydown',o));el.dispatchEvent(new KeyboardEvent('keypress',o));el.dispatchEvent(new KeyboardEvent('keyup',o));var f=el.closest('form');if(f&&f.requestSubmit){f.requestSubmit();return 'submitted-form';}return 'submitted-key';})()"

async def ev(ws, i, expr):
    await ws.send(json.dumps({"id":i,"method":"Runtime.evaluate","params":{"expression":expr,"returnByValue":True}}))
    while True:
        r = json.loads(await asyncio.wait_for(ws.recv(), timeout=12))
        if r.get("id")==i: return r.get("result",{}).get("result",{}).get("value")

async def main():
    ws = await websockets.connect(ws_url, max_size=None)
    i = [1]
    async def E(expr):
        i[0]+=1
        return await ev(ws, i[0], expr)
    if not await E(GATE_PRESENT):
        print("no gate"); return
    print("gate present")
    passed = False

    # PRIMARY: token injection into web storage, then reload.
    print("inject:", await E(INJECT_JS))
    # Navigate to the app ROOT (not reload) so App.tsx re-runs with the injected
    # jv.serviceorg/jv.access and auths via the service path — in password mode a
    # plain reload can land on /site#/signin (a login form), never scoping the app.
    await E("location.href = location.origin + '/'")
    for _ in range(5):
        await asyncio.sleep(1)
        try:
            if not await E(GATE_PRESENT):
                passed = True; break
        except Exception:
            pass  # reload navigation window — retry next tick
    print("after token injection:", "PASSED" if passed else "still gated")

    # FALLBACK: real form login. Clear the field first so retries never double up.
    if not passed:
        for attempt in range(2):
            if (await E(FIND_JS)) == "nofield":
                print("fallback: no field to type into"); break
            print("clear:", await E(CLEAR_JS))
            await asyncio.sleep(0.2)
            print("set:", await E(SET_JS))
            await asyncio.sleep(0.6)
            b = await E(CLICK_JS)
            print("submit:", b)
            if b == "nobutton":
                print("enter:", await E(ENTER_JS))
            for _ in range(4):
                await asyncio.sleep(1)
                if not await E(GATE_PRESENT):
                    passed = True; break
            if passed: break
            print("still gated — retrying once" if attempt == 0 else "still gated after retry")

    print("GATE_OK" if passed else "GATE_PENDING")

asyncio.run(main())
`;

try {
  await run("sudo rm -f /tmp/genericgate.py");
  await d.files.write("/tmp/genericgate.py", py);
  console.log(await run("python3 /tmp/genericgate.py", { GATE_CODE: code, GATE_SVCORG: svcOrg }));
  await run("sudo rm -f /tmp/genericgate.py");
  await sleep(1000);
  try { fs.writeFileSync("/app/ah/ngate.png", Buffer.from(await d.screenshot())); } catch { /* best-effort */ }
} finally { await p.end(); clearTimeout(HARD_LIMIT); }
