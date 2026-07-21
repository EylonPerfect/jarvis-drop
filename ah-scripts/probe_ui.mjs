// Read-only UI probe: current URL + position/outreach links + tab labels.
// Usage: node /app/ah/probe_ui.mjs <sandboxId> [navUrl]
import { Sandbox } from "@e2b/desktop";
import pg from "pg";

const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const e2b = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows[0].values.apiKey;
const d = await Sandbox.connect(process.argv[2], { apiKey: e2b });

const expr = `JSON.stringify({
  url: location.href,
  heading: (document.querySelector('h1,h2,[class*=title],[class*=Title]')?.innerText || '').trim().slice(0,60),
  textLen: ((document.querySelector('main')||document.body).innerText||'').trim().length,
  snippet: ((document.querySelector('main')||document.body).innerText||'').trim().replace(/\\s+/g,' ').slice(0,320),
  links: [...document.querySelectorAll('a')].map(a=>({t:(a.innerText||'').trim().slice(0,28),h:a.getAttribute('href')})).filter(x=>x.h && /position|outreach/i.test(x.h)).slice(0,25),
  tabs: [...document.querySelectorAll('[role=tab],[class*=tab],[class*=Tab]')].map(e=>(e.innerText||'').trim().slice(0,24)).filter(Boolean).slice(0,15)
})`;

const py = `
import asyncio, json, os, urllib.request, websockets
data=json.loads(urllib.request.urlopen('http://localhost:9222/json',timeout=5).read())
ws_url=[t['webSocketDebuggerUrl'] for t in data if t.get('type')=='page'][0]
EXPR=os.environ['PROBE_EXPR']
NAV=os.environ.get('PROBE_NAV','')
async def main():
    async with websockets.connect(ws_url, max_size=None) as ws:
        async def call(i, method, params):
            await ws.send(json.dumps({'id':i,'method':method,'params':params}))
            while True:
                m=json.loads(await ws.recv())
                if m.get('id')==i: return m
        if NAV:
            await call(1,'Page.enable',{})
            await call(2,'Page.navigate',{'url':NAV})
            await asyncio.sleep(7)
        r=await call(3,'Runtime.evaluate',{'expression':EXPR,'returnByValue':True})
        print(r['result']['result'].get('value','{}'))
asyncio.run(main())
`;
const o = await d.commands.run("python3 - <<'PYEOF'\n" + py + "\nPYEOF", { timeoutMs: 40000, envs: { PROBE_EXPR: expr, PROBE_NAV: process.argv[3] || "" } });
console.log(((o.stdout || "") + (o.stderr || "")).trim());
await p.end();
process.exit(0);
