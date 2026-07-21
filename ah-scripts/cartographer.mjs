import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

// THE CARTOGRAPHER v2 — read-only crawler that explores the logged-in GoPerfect
// demo account and writes a SITE MAP the voice bridge can trust (settings key
// `site_map`). v2 fixes the v1 quality traps and adapts to the app's AGENTIC
// nature (chat surfaces render differently per conversation, so text
// fingerprints break by design — structure signatures verify those):
//   · stability-wait reader (no fixed settle; two equal innerText reads)
//   · catch-all detection by PROBED fingerprint (visit an invalid route first),
//     not the "same signature seen 3x" heuristic that ate slow real pages
//   · second-chance pass re-visits every skipped route before finalizing
//   · ALL 24-hex ids generalized ({positionId} / {id}) in urls and keys
//   · curated core allowlist + ~20 destination cap
//   · per-destination screenshot + structure signature + dynamic flag +
//     state prerequisites (requires)
//
// Usage: node /app/ah/cartographer.mjs      (spawned by POST /api/cartographer/run)
// Env:   CARTO_TS — ISO timestamp for generatedAt (defaults to now).

const BASE = "https://doubl-e.goperfect.com";
const MAX_KEPT = 20;
const MAX_DEPTH = 3;
const BFS_CAP_MS = 7 * 60 * 1000;        // main crawl budget; rescue+revisit run after
const NAV_BLACKLIST = /log\s*-?\s*out|sign\s*-?\s*out|delete|remove|archive/i;
const GENERIC_LINE = /loading|welcome|copyright|cookie|privacy|terms|all rights|log ?out|sign ?out|getting started|learn more|contact us|help center|\bupgrade\b/i;
// what the demo actually needs — these are flagged core and never dropped by the cap
const CORE_PATTERNS = [
  /^\/$/,
  /^\/positions\/\{positionId\}$/,
  /^\/positions\/\{positionId\}\/matches$/,
  /^\/positions\/\{positionId\}\/outreach-agent(\/settings)?$/,
  /^\/positions\/\{positionId\}\/outreach\/conversations(\/\{id\})?$/,
  /^\/positions\/\{positionId\}\/outreach\/analytics$/,
  /^\/outreach-analytics$/,
  /inbound/i,
  /candidates|pipeline/i,
  /^\/settings/,
];

const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const e2b = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows[0].values.apiKey;
const GENERATED_AT = process.env.CARTO_TS || new Date().toISOString();

let d = null; // the sandbox — killed in finally, ALWAYS (no leaked sandboxes)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- sandbox-side CDP probe ----
// Modes: PREP (auth observer + first position + bundle route mining), or
// NAV/TAB page read. The reader is STABILITY-WAITED: it polls innerText length
// every ~1.5s until two consecutive reads are equal and non-zero (cap ~25s) —
// hydration-proof, no fixed settle. CARTO_SHOT=<path> also captures a PNG.
const PROBE_PY = `
import asyncio, json, os, time, base64, urllib.request, websockets
NAV = os.environ.get("CARTO_NAV", "")
TAB = os.environ.get("CARTO_TAB", "")
PREP = os.environ.get("CARTO_PREP", "")
SHOT = os.environ.get("CARTO_SHOT", "")
WRAP_JS = ("(function(){if(window.__cartoWrap)return;window.__cartoWrap=1;window.__authByHost={};"
 "function rec(u,a){if(a&&/Bearer/i.test(a)){try{window.__authByHost[new URL(u,location.href).host]=a}catch(e){}}}"
 "var of=window.fetch;window.fetch=function(input,init){try{var u=(typeof input==='string')?input:((input&&input.url)||'');var h={};"
 "if(init&&init.headers){if(init.headers.forEach)init.headers.forEach(function(v,k){h[k]=v});else Object.assign(h,init.headers)}"
 "rec(u,h.authorization||h.Authorization);}catch(e){}return of.apply(this,arguments);};"
 "var oo=XMLHttpRequest.prototype.open, osr=XMLHttpRequest.prototype.setRequestHeader;"
 "XMLHttpRequest.prototype.open=function(m,u){this.__u=u;return oo.apply(this,arguments);};"
 "XMLHttpRequest.prototype.setRequestHeader=function(k,v){try{if(String(k).toLowerCase()==='authorization')rec(this.__u||'',v);}catch(e){}return osr.apply(this,arguments);};"
 "})();")
PREP_JS = r"""(async()=>{
  for(let i=0;i<15;i++){ if((window.__authByHost||{})['api.goperfect.com'])break; await new Promise(r=>setTimeout(r,1000)); }
  const out={posId:null,posTitle:'',routes:[]};
  const a=(window.__authByHost||{})['api.goperfect.com'];
  if(a){ try{
    const r=await fetch('https://api.goperfect.com/services/application-gateway/api/v1/positions',{headers:{authorization:a}});
    const j=await r.json(); const arr=Array.isArray(j)?j:(j.positions||j.data||j.items||[]);
    if(Array.isArray(arr)&&arr[0]&&arr[0].id){ out.posId=String(arr[0].id); out.posTitle=String(arr[0].jobTitle||arr[0].title||''); }
  }catch(e){} }
  const srcs=[...new Set(performance.getEntriesByType('resource').map(r=>r.name).filter(n=>/goperfect\\.com\\/assets\\/.*\\.js$/.test(n)))];
  let hits=[];
  const tfetch=(u)=>Promise.race([fetch(u).then(r=>r.text()), new Promise((_,rej)=>setTimeout(()=>rej(new Error('slow')),6000))]);
  for(const s of srcs){ try{ const t=await tfetch(s);
    const m=t.match(/["'][\\/][a-z0-9:_\\/-]{2,60}["']/g)||[];
    hits.push(...m.map(x=>x.slice(1,-1)));
  }catch(e){} }
  out.routes=[...new Set(hits)].slice(0,600);
  return JSON.stringify(out);
})()"""
LEN_JS = "((document.querySelector('main')||document.body).innerText||'').trim().length"
READ_JS = r"""(()=>{
  const m=document.querySelector('main')||document.body;
  const t=(m.innerText||'').trim();
  const vis=(e)=>{try{return e.getClientRects().length>0}catch(err){return true}};
  const lab=(e)=>((e.innerText||e.getAttribute('aria-label')||'').trim().replace(/\\s+/g,' '));
  const isTabClass=(e)=>{const c=String(e.className||'');return /tab(?!le)/i.test(c)};
  const tabEls=[...document.querySelectorAll('[role=tab]')];
  for(const e of document.querySelectorAll('div,span,button,li')){ if(tabEls.length>=40)break; if(isTabClass(e)&&!tabEls.includes(e))tabEls.push(e); }
  const html=document.body.innerHTML||'';
  const routes=[...new Set((html.match(/\\/(positions|analytics|outreach|settings|inbox|reports|dashboard|talent|candidates|home)[A-Za-z0-9\\/_-]*/g)||[]))].slice(0,120);
  const buttons=[...document.querySelectorAll('button,[role=button]')].filter(vis).map(e=>lab(e).slice(0,44)).filter(Boolean);
  const inputs=[...document.querySelectorAll('input,textarea,select')].filter(vis)
    .map(e=>e.getAttribute('placeholder')||e.getAttribute('aria-label')||e.getAttribute('name')||'').map(s=>s.trim()).filter(Boolean).slice(0,10);
  const landmarks=[...document.querySelectorAll('h1,h2')].filter(vis).map(e=>lab(e).slice(0,60)).filter(Boolean).slice(0,5);
  const msgs=document.querySelectorAll('[class*=essage],[class*=chat-],[class*=Chat]').length;
  const hasChat=!!document.querySelector('textarea')&&msgs>0;
  let cards=null;
  for(const s of ['[class*=card]','[class*=Card]','[role=listitem]','li']){
    const c=[...document.querySelectorAll(s)].filter(vis).length;
    if(c>=3&&(!cards||c>cards.count))cards={selector:s,count:c};
  }
  const tabs=[...new Set(tabEls.filter(vis).map(e=>lab(e).slice(0,40)).filter(s=>s&&s.length>=2&&s.length<=26))].slice(0,14);
  return JSON.stringify({
    url: location.href,
    heading: ((document.querySelector('h1,h2,[class*=Title],[class*=title]')||{}).innerText||'').trim().replace(/\\s+/g,' ').slice(0,80),
    textLen: t.length,
    lines: t.split('\\n').map(s=>s.trim().replace(/\\s+/g,' ')).filter(s=>s.length>=15&&s.length<=90).slice(0,40),
    links: [...document.querySelectorAll('a[href]')].filter(vis).map(a=>({label:lab(a).slice(0,48),href:a.getAttribute('href')})).filter(x=>x.href).slice(0,80),
    tabs: tabs,
    routes: routes,
    buttons: [...new Set(buttons)].slice(0,60),
    structure: { inputs: inputs, tabs: tabs, buttons: [...new Set(buttons)].slice(0,10), landmarks: landmarks, hasChat: hasChat, cards: cards }
  });
})()"""
def tab_js(label):
    return ("(()=>{const want=%s.toLowerCase().trim();"
            "const isTabClass=(e)=>{const c=String(e.className||'');return /tab(?!le)/i.test(c)};"
            "const tabs=[...document.querySelectorAll('[role=tab]')];"
            "for(const e of document.querySelectorAll('div,span,button,li')){ if(tabs.length>=60)break; if(isTabClass(e)&&!tabs.includes(e))tabs.push(e); }"
            "const el=tabs.find(e=>((e.innerText||'').trim().toLowerCase()===want))||tabs.find(e=>((e.innerText||'').trim().toLowerCase().includes(want)));"
            "if(!el)return 'notab';el.scrollIntoView({block:'center'});el.click();return 'clicked';})()") % json.dumps(label)
async def main():
    data = json.loads(urllib.request.urlopen('http://localhost:9222/json', timeout=5).read())
    pages = [t for t in data if t.get('type')=='page' and t.get('webSocketDebuggerUrl')]
    pages.sort(key=lambda t: (0 if 'goperfect' in (t.get('url') or '') else 1))
    async with websockets.connect(pages[0]['webSocketDebuggerUrl'], max_size=None) as ws:
        rid = [0]
        async def call(method, params):
            rid[0] += 1; my = rid[0]
            await ws.send(json.dumps({'id':my,'method':method,'params':params}))
            while True:
                # generous: PREP's in-page eval alone can run 20s+ (auth wait + bundle fetches)
                m = json.loads(await asyncio.wait_for(ws.recv(), timeout=90))
                if m.get('id') == my: return m
        async def evaljs(expr):
            r = await call('Runtime.evaluate', {'expression':expr,'returnByValue':True,'awaitPromise':True})
            return r.get('result',{}).get('result',{}).get('value')
        if PREP:
            await call('Page.enable', {})
            await call('Page.addScriptToEvaluateOnNewDocument', {'source':WRAP_JS})
            await call('Runtime.evaluate', {'expression':WRAP_JS})
            await call('Page.navigate', {'url':'https://doubl-e.goperfect.com/'})
            await asyncio.sleep(7)
            print(await evaljs(PREP_JS) or '{}')
            return
        if NAV:
            await call('Page.enable', {})
            await call('Page.navigate', {'url':NAV})
            await asyncio.sleep(2)
        if TAB:
            r = await evaljs(tab_js(TAB))
            if r != 'clicked':
                print(json.dumps({'tabError':'no tab matching label'})); return
            await asyncio.sleep(2)
        # STABILITY WAIT: two consecutive equal, non-zero innerText lengths (cap ~25s)
        prev = -1; t0 = time.time()
        while time.time() - t0 < 25:
            try: ln = int(await evaljs(LEN_JS) or 0)
            except Exception: ln = 0
            if ln > 0 and ln == prev:
                break
            prev = ln
            await asyncio.sleep(1.5)
        raw = await evaljs(READ_JS) or '{}'
        if SHOT:
            try:
                r = await call('Page.captureScreenshot', {'format':'png','captureBeyondViewport':False})
                data64 = r.get('result',{}).get('data')
                if data64:
                    with open(SHOT, 'wb') as f:
                        f.write(base64.b64decode(data64))
            except Exception as e:
                print('shot err', str(e)[:80])
        print(raw)
asyncio.run(main())
`;

async function run(cmd, opts = {}) {
  try {
    const o = await d.commands.run(cmd, { timeoutMs: 90000, ...opts });
    return ((o.stdout || "") + (o.stderr || "")).trim();
  } catch (e) { return "ERR:" + ((e && e.stderr) || (e && e.message) || e); }
}

async function probe({ nav = "", tab = "", shot = "" } = {}) {
  const out = await run("python3 /tmp/carto_probe.py", { envs: { CARTO_NAV: nav, CARTO_TAB: tab, CARTO_SHOT: shot }, timeoutMs: 150000 });
  const line = out.split("\n").reverse().find((l) => l.trim().startsWith("{"));
  if (!line) { console.log("probe failed:", out.slice(0, 200)); return null; }
  try { return JSON.parse(line); } catch { return null; }
}

// ---- URL + key helpers ----
let POSID = null; // the ONE representative position id
const normalize = (href, cur) => {
  try {
    const u = new URL(href, cur || BASE);
    if (u.origin !== BASE) return null;
    let path = u.pathname.replace(/\/+$/, "");
    return BASE + (path || "/");
  } catch { return null; }
};
// generalize ALL 24-hex ids: the representative position → {positionId}, any other → {id}
const patternize = (url) => {
  let u = POSID ? url.split(POSID).join("{positionId}") : url;
  return u.replace(/[a-f0-9]{24}/gi, "{id}");
};
const posIdOf = (url) => { const m = url.match(/\/positions\/([a-f0-9]{24})(\/|$)/i); return m ? m[1] : null; };
function keyFor(pattern, heading) {
  let path = pattern.slice(BASE.length).replace(/^\/+|\/+$/g, "");
  if (!path) return "home";
  let segs = path.split("/").filter(Boolean).filter((s) => s !== "{id}"); // ids never leak into keys
  if (segs[0] === "positions" && segs[1] === "{positionId}") segs = ["position", ...segs.slice(2)];
  let key = segs.join("-").replace(/[{}]/g, "").replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  if (!key) key = (heading || "page").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "page";
  return key;
}
const pathOf = (pattern) => pattern.slice(BASE.length) || "/";
const isCore = (pattern) => CORE_PATTERNS.some((re) => re.test(pathOf(pattern)));
const structItems = (s) => [...new Set([...(s?.inputs || []), ...(s?.tabs || []), ...(s?.buttons || []), ...(s?.landmarks || [])].map((x) => String(x).toLowerCase()))];
const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
};

try {
  // ---- sandbox + chrome + login (proven rehearsal.mjs blocks) ----
  d = await Sandbox.create({ apiKey: e2b, timeoutMs: 20 * 60 * 1000 }); // auto-dies even if kill fails
  console.log("PHASE SANDBOX", d.sandboxId);
  try {
    if (fs.existsSync("/app/ah/gp-profile.tgz")) {
      const bytes = fs.readFileSync("/app/ah/gp-profile.tgz");
      await d.files.write("/tmp/gp-profile.tgz", bytes);
      await run("cd /home/user && tar xzf /tmp/gp-profile.tgz 2>/dev/null; echo ok");
    } else { await run("mkdir -p /home/user/gp-profile"); }
  } catch { await run("mkdir -p /home/user/gp-profile"); }
  const flags = "--no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --no-default-browser-check --disable-session-crashed-bubble --disable-infobars --password-store=basic --force-device-scale-factor=0.8 --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=/home/user/gp-profile --window-position=0,0 --window-size=1024,768 --kiosk";
  await run("pkill -9 -f 'google[-]chrome' 2>/dev/null; sleep 1; rm -f /home/user/gp-profile/Singleton* 2>/dev/null; echo ok");
  await d.commands.run(`DISPLAY=:0 dbus-launch google-chrome-stable ${flags} "${BASE}/" > /tmp/chrome.log 2>&1 &`, { background: true }).catch(() => {});
  console.log("PHASE CHROME_LAUNCHED");
  await sleep(9000);
  await run("pip install -q websockets 2>&1 | tail -1; mkdir -p /tmp/carto_shots; echo ok", { timeoutMs: 180000 });
  await d.files.write("/tmp/carto_probe.py", PROBE_PY);

  const pageUrl = async () => run(`curl -s http://localhost:9222/json | python3 -c "import sys,json;print([t.get('url','') for t in json.load(sys.stdin) if t.get('type')=='page'][0])" 2>/dev/null`);
  let u = await pageUrl();
  if (u.includes("auth.goperfect.com")) {
    console.log("PHASE AUTO_LOGIN");
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { execFileSync("node", ["/app/ah/gp_login.mjs", d.sandboxId], { stdio: "inherit", timeout: 180000 }); } catch (e) { console.log("auto-login issue:", (e && e.message) || e); }
      for (let i = 0; i < 24; i++) { await sleep(5000); u = await pageUrl(); if (u.includes("doubl-e.goperfect.com")) break; }
      if (u.includes("doubl-e.goperfect.com")) break;
      console.log(`login attempt ${attempt} failed${attempt < 2 ? " — retrying in 15s" : ""}`);
      if (attempt < 2) await sleep(15000);
    }
  }
  if (!u.includes("doubl-e.goperfect.com")) throw new Error("login failed — cannot crawl the product");
  console.log("PHASE LOGGED_IN", u);

  // ---- catch-all fingerprint: probe a deliberately-invalid route FIRST ----
  const catchall = await probe({ nav: `${BASE}/zz-not-a-real-route-zz` });
  const caSig = catchall ? { heading: catchall.heading || "", line0: (catchall.lines || [])[0] || "", len: catchall.textLen || 0 } : null;
  console.log("PHASE CATCHALL", JSON.stringify(caSig));
  const matchesCatchall = (page) => {
    if (!caSig) return false;
    const lenClose = Math.abs((page.textLen || 0) - caSig.len) <= Math.max(60, caSig.len * 0.15);
    return (page.heading || "") === caSig.heading && ((page.lines || [])[0] || "") === caSig.line0 && lenClose;
  };

  // ---- PREP: representative position + the SPA's own route table (2 attempts) ----
  let prep = { posId: null, posTitle: "", routes: [] };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prepRaw = await run("python3 /tmp/carto_probe.py", { envs: { CARTO_PREP: "1", CARTO_NAV: "", CARTO_TAB: "", CARTO_SHOT: "" }, timeoutMs: 150000 });
    try {
      const line = prepRaw.split("\n").reverse().find((l) => l.trim().startsWith("{"));
      if (line) prep = JSON.parse(line);
    } catch { /* fall through */ }
    if (prep.posId && (prep.routes || []).length) break;
    console.log(`PREP attempt ${attempt} incomplete (posId=${prep.posId ? "yes" : "no"}, routes=${(prep.routes || []).length}); raw tail: ${prepRaw.slice(-220).replace(/\n/g, " | ")}`);
    if (attempt < 2) await sleep(5000);
  }
  if (prep.posId) { POSID = String(prep.posId); console.log("PHASE POSITION", POSID, prep.posTitle || ""); }
  else console.log("PHASE POSITION none found via API — will rely on DOM discovery");
  const API_PREFIX = /^\/(services|identity|team|tenants|subscriptions|integrations|reports|directory|webhook|oauth|audits|notification|event|flags|vendors|account|payments|api|assets|fonts)\b/;
  const appRoutes = [...new Set((prep.routes || [])
    .filter((r) => typeof r === "string" && /^\/[a-z]/.test(r) && !API_PREFIX.test(r))
    .filter((r) => !/\.(js|css|svg|png|jpg|woff2?|json|ico|ts)$/.test(r) && r.split("/").length <= 5)
    .map((r) => (POSID ? r.replace(/:positionId/g, POSID) : r))
    .filter((r) => !r.includes(":") && !NAV_BLACKLIST.test(r)))]
    .sort((a, b) => a.split("/").length - b.split("/").length);
  console.log("PHASE ROUTES", appRoutes.length, "mined from the app bundle");

  // ---- BFS crawl (budget starts NOW — boot/login/PREP don't eat it) ----
  const bfsDeadline = Date.now() + BFS_CAP_MS;
  const destinations = [];
  const byPattern = new Map();
  const queued = new Set();
  const skipped = [];              // catch-all hits, re-tried in the second-chance pass
  const queue = [{ url: BASE + "/", depth: 0, clickPath: [], tab: "" }];
  queued.add(BASE + "/");
  const seed = (u2, label, depth = 1) => {
    const nu = normalize(u2, BASE);
    if (!nu || NAV_BLACKLIST.test(nu)) return;
    const pat = patternize(nu);
    if (queued.has(pat)) return;
    queued.add(pat);
    queue.push({ url: nu, depth, clickPath: [label], tab: "" });
  };
  if (POSID) {
    seed(`${BASE}/positions/${POSID}/matches`, "(position tab)");
    seed(`${BASE}/positions/${POSID}/outreach-agent`, "(position tab)");
    seed(`${BASE}/positions/${POSID}`, "(position)");
  }
  for (const r of appRoutes.slice(0, 45)) seed(BASE + r, "(app route)");

  const record = (page, item, actualUrl) => {
    const pattern = patternize(actualUrl);
    if (byPattern.has(pattern)) return null;
    const rec = {
      key: "",
      url: pattern,
      core: isCore(pattern),
      clickPath: item.clickPath,
      verify: {
        heading: page.heading || "",
        snippets: [],
        minText: Math.floor((page.textLen || 0) * 0.4),
      },
      structure: page.structure || { inputs: [], tabs: [], buttons: [], landmarks: [], hasChat: false, cards: null },
      dynamic: !!(page.structure && page.structure.hasChat), // refined in the revisit pass
      ...(pattern.includes("{positionId}") ? { requires: { state: "open_position", satisfyWith: "new_position" } } : {}),
      actions: [...new Set([...(page.buttons || []), ...((page.links || []).map((l) => l.label))].map((s) => (s || "").trim()).filter((s) => s.length >= 2 && s.length <= 44))].slice(0, 20),
      emptyLooking: (page.textLen || 0) < 120,
      _lines: (page.lines || []).filter((s) => !GENERIC_LINE.test(s)),
    };
    let key = keyFor(pattern, page.heading);
    let n = 2; while (destinations.some((r) => r.key === key)) key = `${keyFor(pattern, page.heading)}-${n++}`;
    rec.key = key;
    byPattern.set(pattern, rec);
    destinations.push(rec);
    return rec;
  };

  const visit = async (item) => {
    const page = await probe({ nav: item.url, tab: item.tab, shot: "/tmp/carto_shot.png" });
    if (!page || page.tabError || !page.url) { console.log("skip (unreadable):", patternize(item.url)); return null; }
    const actualUrl = normalize(page.url, BASE);
    if (!actualUrl) { console.log("skip (left app):", page.url); return null; }
    if (!POSID) POSID = posIdOf(actualUrl);
    return { page, actualUrl };
  };

  while (queue.length && destinations.length < MAX_KEPT + 5 && Date.now() < bfsDeadline) {
    const item = queue.shift();
    if (!item.tab && byPattern.has(patternize(item.url))) continue;
    const v = await visit(item);
    if (!v) continue;
    const { page, actualUrl } = v;
    const pattern = patternize(actualUrl);
    if (byPattern.has(pattern)) { if (item.tab) console.log("tab duplicate:", item.tab, "->", pattern); continue; }
    if (matchesCatchall(page)) { skipped.push({ item, pattern }); console.log("skip (catch-all):", pattern); continue; }
    const rec = record(page, item, actualUrl);
    if (!rec) continue;
    await run(`mv /tmp/carto_shot.png /tmp/carto_shots/${rec.key}.png 2>/dev/null; echo ok`);
    console.log(`PHASE CRAWL ${destinations.length} ${rec.key} ${pattern}${rec.core ? " [core]" : ""}${rec.emptyLooking ? " (EMPTY-LOOKING)" : ""}`);

    if (item.depth >= MAX_DEPTH) continue;
    const enqueue = (candidate, label) => {
      const nu = normalize(candidate, actualUrl);
      if (!nu || NAV_BLACKLIST.test(nu)) return;
      const linkPos = posIdOf(nu);
      if (linkPos && !POSID) POSID = linkPos;
      if (linkPos && POSID && linkPos !== POSID) return;
      const pat = patternize(nu);
      if (byPattern.has(pat) || queued.has(pat)) return;
      queued.add(pat);
      queue.push({ url: nu, depth: item.depth + 1, clickPath: [...item.clickPath, label], tab: "" });
    };
    for (const l of page.links || []) {
      const label = (l.label || "").trim();
      if (NAV_BLACKLIST.test(label)) continue;
      enqueue(l.href, label || "(link)");
    }
    for (const r of page.routes || []) enqueue(r, "(route)");
    for (const t of page.tabs || []) {
      if (!t || NAV_BLACKLIST.test(t)) continue;
      const tabKey = patternize(actualUrl) + "#tab:" + t.toLowerCase();
      if (queued.has(tabKey)) continue;
      queued.add(tabKey);
      queue.push({ url: actualUrl, depth: item.depth + 1, clickPath: [...item.clickPath, t], tab: t });
    }
  }
  if (Date.now() >= bfsDeadline) console.log("PHASE TIME_CAP main crawl budget reached");

  // ---- second-chance pass: every catch-all skip gets ONE patient re-visit ----
  let rescued = 0;
  const retryList = skipped.slice(0, 15);
  for (const s of retryList) {
    if (byPattern.has(s.pattern)) continue;
    const v = await visit(s.item);
    if (!v) continue;
    const { page, actualUrl } = v;
    if (matchesCatchall(page)) continue;                     // still the catch-all — genuinely junk
    if (byPattern.has(patternize(actualUrl))) continue;
    const rec = record(page, s.item, actualUrl);
    if (rec) {
      rescued++;
      await run(`mv /tmp/carto_shot.png /tmp/carto_shots/${rec.key}.png 2>/dev/null; echo ok`);
      console.log(`PHASE RESCUED ${rec.key} ${rec.url}`);
    }
  }
  console.log(`PHASE RESCUE ${rescued} rescued of ${retryList.length} re-visited (${skipped.length} skipped total)`);

  // ---- cap: core destinations always survive, then BFS order ----
  const core = destinations.filter((r) => r.core);
  const rest = destinations.filter((r) => !r.core);
  const kept = [...core, ...rest].slice(0, MAX_KEPT);
  destinations.length = 0; destinations.push(...kept);

  // ---- dynamic detection: re-visit CORE pages once; text drift + stable structure = dynamic ----
  for (const rec of destinations.filter((r) => r.core).slice(0, 8)) {
    const url = rec.url.split("{positionId}").join(POSID || "");
    if (url.includes("{")) continue; // unresolved {id} — cannot revisit deterministically
    const page = await probe({ nav: url });
    if (!page || !page.url) continue;
    const textSim = jaccard(rec._lines, (page.lines || []).filter((s) => !GENERIC_LINE.test(s)));
    const structSim = jaccard(structItems(rec.structure), structItems(page.structure));
    const drifted = textSim < 0.7 && structSim >= 0.6;
    if (drifted || (page.structure && page.structure.hasChat)) rec.dynamic = true;
    console.log(`PHASE REVISIT ${rec.key} textSim=${textSim.toFixed(2)} structSim=${structSim.toFixed(2)}${rec.dynamic ? " [dynamic]" : ""}`);
  }

  // ---- snippets: distinctive lines (appear on exactly one crawled page) ----
  const lineCount = new Map();
  for (const r of destinations) for (const s of new Set(r._lines)) lineCount.set(s, (lineCount.get(s) || 0) + 1);
  for (const r of destinations) {
    const uniq = r._lines.filter((s) => lineCount.get(s) === 1);
    const shared = r._lines.filter((s) => lineCount.get(s) > 1).sort((a, b) => lineCount.get(a) - lineCount.get(b));
    r.verify.snippets = [...new Set([...uniq, ...shared])].slice(0, 3);
    delete r._lines;
  }

  // ---- pull the screenshots out of the sandbox BEFORE killing it ----
  try {
    fs.rmSync("/app/ah/sitemap-shots", { recursive: true, force: true });
    fs.mkdirSync("/app/ah/sitemap-shots", { recursive: true });
    let shots = 0;
    for (const r of destinations) {
      try {
        const bytes = await d.files.read(`/tmp/carto_shots/${r.key}.png`, { format: "bytes" });
        if (bytes && bytes.length > 1000) { fs.writeFileSync(`/app/ah/sitemap-shots/${r.key}.png`, Buffer.from(bytes)); shots++; }
      } catch { /* no shot for this one */ }
    }
    console.log("PHASE SHOTS", shots, "screenshots saved to /app/ah/sitemap-shots");
  } catch (e) { console.log("shots pull issue:", (e && e.message) || e); }

  // ---- store: site_map (+ diff vs previous) ----
  const prevRow = await p.query("SELECT value FROM settings WHERE key='site_map'");
  const prev = prevRow.rows[0] ? prevRow.rows[0].value : null;
  const map = { generatedAt: GENERATED_AT, base: BASE, destinations };
  await p.query(
    "INSERT INTO settings (key, value) VALUES ('site_map', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [JSON.stringify(map)],
  );
  if (prev && Array.isArray(prev.destinations)) {
    const prevBy = new Map(prev.destinations.map((r) => [r.key, r]));
    const curBy = new Map(destinations.map((r) => [r.key, r]));
    const diff = {
      generatedAt: GENERATED_AT,
      added: destinations.filter((r) => !prevBy.has(r.key)).map((r) => r.key),
      removed: prev.destinations.filter((r) => !curBy.has(r.key)).map((r) => r.key),
      changed: destinations.filter((r) => {
        const o = prevBy.get(r.key);
        return o && (o.url !== r.url || (o.verify && o.verify.heading) !== r.verify.heading);
      }).map((r) => r.key),
    };
    await p.query(
      "INSERT INTO settings (key, value) VALUES ('site_map_diff', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [JSON.stringify(diff)],
    );
    console.log("PHASE DIFF", JSON.stringify({ added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length }));
  }
  console.log("PHASE STORED", destinations.length, "destinations,", destinations.filter((r) => r.core).length, "core,", destinations.filter((r) => r.dynamic).length, "dynamic");
  console.log(JSON.stringify(map, null, 2));
  console.log("PHASE DONE");
} catch (e) {
  console.error("PHASE ERROR", (e && e.stack) || e);
  process.exitCode = 1;
} finally {
  try { if (d) { await d.kill(); console.log("sandbox killed", d.sandboxId); } } catch (e) { console.log("sandbox kill issue:", (e && e.message) || e); }
  try { await p.end(); } catch { /* ignore */ }
}
