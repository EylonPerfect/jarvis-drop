// Generic read-only CDP eval: node gp_eval.mjs <sandboxId>
// env: EXPR (required) · NAV (optional url) · WRAP=1 (install auth-capture before nav)
import { Sandbox } from "@e2b/desktop";
import pg from "pg";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const _e2bRows = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows;
const e2b = (_e2bRows.find((r) => (r.values.apiKey || "").startsWith("e2b_")) || _e2bRows[0]).values.apiKey;
const d = await Sandbox.connect(process.argv[2], { apiKey: e2b });
const py = `
import asyncio, json, os, urllib.request, websockets
data=json.loads(urllib.request.urlopen('http://localhost:9222/json',timeout=5).read())
ws_url=[t['webSocketDebuggerUrl'] for t in data if t.get('type')=='page'][0]
EXPR=os.environ['EXPR']
NAV=os.environ.get('NAV','')
WRAP=os.environ.get('WRAP','')
WRAP_JS = "(function(){if(window.__perfWrap)return;window.__perfWrap=1;window.__lastAuth=null;window.__authByHost={};function rec(u,a){if(a&&/Bearer/i.test(a)){window.__lastAuth=a;try{window.__authByHost[new URL(u,location.href).host]=a}catch(e){}}}var of=window.fetch;window.fetch=function(input,init){try{var u=(typeof input==='string')?input:((input&&input.url)||'');var h={};if(init&&init.headers){if(init.headers.forEach)init.headers.forEach(function(v,k){h[k]=v});else Object.assign(h,init.headers)}rec(u,h.authorization||h.Authorization);}catch(e){}return of.apply(this,arguments);};var oo=XMLHttpRequest.prototype.open, os=XMLHttpRequest.prototype.setRequestHeader;XMLHttpRequest.prototype.open=function(m,u){this.__u=u;return oo.apply(this,arguments);};XMLHttpRequest.prototype.setRequestHeader=function(k,v){try{if(String(k).toLowerCase()==='authorization')rec(this.__u||'',v);}catch(e){}return os.apply(this,arguments);};})();"
async def main():
    async with websockets.connect(ws_url, max_size=None) as ws:
        rid=[0]
        async def call(method, params):
            rid[0]+=1; my=rid[0]
            await ws.send(json.dumps({'id':my,'method':method,'params':params}))
            while True:
                m=json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                if m.get('id')==my: return m
        await call('Page.enable',{})
        if WRAP:
            await call('Page.addScriptToEvaluateOnNewDocument',{'source':WRAP_JS})
            await call('Runtime.evaluate',{'expression':WRAP_JS})
        if NAV:
            await call('Page.navigate',{'url':NAV})
            await asyncio.sleep(7)
        r=await call('Runtime.evaluate',{'expression':EXPR,'returnByValue':True,'awaitPromise':True})
        v=r['result']['result'].get('value')
        print(v if isinstance(v,str) else json.dumps(v))
asyncio.run(main())
`;
const o = await d.commands.run("python3 - <<'PYEOF'\n" + py + "\nPYEOF", { timeoutMs: 90000, envs: { EXPR: process.env.EXPR || "location.href", NAV: process.env.NAV || "", WRAP: process.env.WRAP || "" } });
console.log(((o.stdout || "") + (o.stderr || "")).trim());
await p.end();
process.exit(0);
