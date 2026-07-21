import { Sandbox } from "@e2b/desktop";
import pg from "pg";
import fs from "node:fs";

const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const e2b = (await p.query("SELECT values FROM integrations WHERE id='e2b'")).rows[0].values.apiKey;
const okey = (await p.query("SELECT api_key FROM ai_providers WHERE active=true LIMIT 1")).rows[0].api_key;
// Golden persona tuned live in the Calibration Studio (optional). Layers on TOP
// of the built-in tool/screen operating manual so the tools still work.
// AH_AGENT_ID scopes the golden to THIS call's agent (set by live.ts) so pinning
// one clone can never change another clone's calls. No env → legacy global key.
const AGENT_ID = process.env.AH_AGENT_ID || "";
let GOLDEN = "";
try {
  if (AGENT_ID) {
    const g = await p.query("SELECT golden_instructions FROM agents WHERE id=$1", [AGENT_ID]);
    GOLDEN = (g.rows[0] && g.rows[0].golden_instructions) || "";
  } else {
    const g = await p.query("SELECT value FROM settings WHERE key='live_golden_instructions'");
    const v = g.rows[0] && g.rows[0].value; if (v && v.instructions) GOLDEN = v.instructions;
  }
} catch (e) { /* ignore */ }
// Rehearse-the-golden: live.ts can pass a freshly compiled persona via env
// (base64) — it outranks the DB read so a golden rehearsal never has to write
// (and risk corrupting) agents.golden_instructions.
try {
  if (process.env.AH_INSTR_B64) {
    GOLDEN = Buffer.from(process.env.AH_INSTR_B64, "base64").toString("utf8");
    console.log("PERSONA override via env (" + GOLDEN.length + " chars, mode=" + (process.env.AH_PERSONA_MODE || "?") + ")");
  }
} catch (e) { /* DB compile stays */ }
// The clone's own name — identity follows the call's agent, not a hardcoded one.
let AGENT_NAME = "Maya";
let EL_VOICE_ID = "";
let AGENT_ORG = "";
try { if (AGENT_ID) { const r = await p.query("SELECT name, voice_id, org_id FROM agents WHERE id=$1", [AGENT_ID]); const row = r.rows[0]; if (row && row.name) AGENT_NAME = String(row.name).split(" ")[0]; if (row && row.voice_id) EL_VOICE_ID = String(row.voice_id).trim(); if (row && row.org_id) AGENT_ORG = String(row.org_id); } } catch (e) { /* keep default */ }
// Platform service key — used to authorize the demo browser into the product via
// the service-org path (jv.access + jv.serviceorg), same as generic_gate.mjs.
const BFF_KEY = process.env.BFF_API_KEY || "";
// Hybrid voice: the OpenAI realtime brain keeps thinking/tools/turn-taking but
// outputs TEXT, streamed through ElevenLabs low-latency TTS in the clone's OWN
// voice. settings call_voice_mode = "openai" is the emergency rollback switch;
// absent/"auto" = hybrid whenever the agent has a voice_id and the EL key exists.
let EL_API_KEY = "";
try { const r = await p.query("SELECT values FROM integrations WHERE id='elevenlabs'"); const v = r.rows[0] && r.rows[0].values; if (v && v.apiKey) EL_API_KEY = String(v.apiKey).trim(); } catch (e) { /* legacy voice still works */ }
let VOICE_MODE = "openai";
try {
  const r = await p.query("SELECT value FROM settings WHERE key='call_voice_mode'");
  const v = r.rows.length ? r.rows[0].value : null;
  const forced = typeof v === "string" ? v : (v && v.mode) || "";
  VOICE_MODE = forced === "openai" ? "openai" : (EL_API_KEY && EL_VOICE_ID ? "hybrid" : "openai");
} catch (e) { VOICE_MODE = EL_API_KEY && EL_VOICE_ID ? "hybrid" : "openai"; }
console.log(`VOICE mode=${VOICE_MODE}${EL_VOICE_ID ? " el=" + EL_VOICE_ID.slice(0, 8) : " (no voice_id)"}${EL_API_KEY ? "" : " (no EL key)"}`);
// operator-uploaded company logo (settings 'company'.logo, data URI) brands the curtain
// demo-account creds for mid-call SELF-HEALING login: GoPerfect evicts older
// sessions when the account logs in elsewhere; the bridge re-logs-in instead
// of confessing a dead screen. Values never printed.
// PER-AGENT creds first (settings 'demo_login:<agentId>'), else the GLOBAL file.
let GP_EMAIL = "", GP_PASS = "";
let DEMO_SYSTEM = "", DEMO_URL = "", DEMO_NOTES = "";
try {
  let _login = null;
  if (AGENT_ID) {
    try {
      const _r = await p.query("SELECT value FROM settings WHERE key = 'demo_login:' || $1", [AGENT_ID]);
      const _v = _r.rows[0] && _r.rows[0].value;
      if (_v) {
        DEMO_SYSTEM = (_v.system || "").trim();
        DEMO_URL = (_v.url || "").trim();
        DEMO_NOTES = (_v.notes || "").trim();
        if (_v.email) _login = _v;
      }
    } catch (e) { /* fall through to the global file */ }
  }
  if (!_login) _login = JSON.parse(fs.readFileSync("/app/ah/gp-login.json", "utf8"));
  GP_EMAIL = _login.email || ""; GP_PASS = _login.password || "";
} catch (e) { /* no auto-relogin */ }
// PRODUCT MODE (mirrors the Python-side BASE resolution: BASE = DEMO_URL or the
// GoPerfect default). GENERIC = the demo system is NOT GoPerfect. When GENERIC is
// false (default), the GoPerfect prompt + toolset are used UNCHANGED.
const GENERIC = !/goperfect/i.test(DEMO_URL || "https://doubl-e.goperfect.com");
let CURTAIN_LOGO = "";
try { const r = await p.query("SELECT value FROM settings WHERE key='company'"); const l = r.rows[0] && r.rows[0].value && r.rows[0].value.logo; if (l && String(l).startsWith("data:image/")) CURTAIN_LOGO = String(l); } catch (e) { /* built-in lockup */ }
// Site map built by the Cartographer (settings 'site_map') — powers the goto
// tool's VERIFIED navigation. Only key/url/verify ride into the bridge (small);
// no map → goto degrades to "use show_screen" and nothing else changes.
let SITE_MAP = "[]";
try {
  const r = await p.query("SELECT value FROM settings WHERE key='site_map'");
  const v = r.rows[0] && r.rows[0].value;
  if (v && Array.isArray(v.destinations) && v.destinations.length) {
    const dests = v.destinations.map((x) => ({
      key: x.key, url: x.url, verify: x.verify || {},
      structure: x.structure || null, dynamic: !!x.dynamic, core: !!x.core,
      ...(x.requires ? { requires: x.requires } : {}),
    })).filter((x) => x.key && x.url);
    SITE_MAP = JSON.stringify(dests);
    console.log("SITEMAP " + dests.length + " destinations (" + dests.filter((x) => x.core).length + " core, " + dests.filter((x) => x.dynamic).length + " dynamic)");
  }
} catch (e) { /* bridge works without a map */ }

const SID = process.argv[2];
const NOGREET = process.argv[3] === "nogreet";
const DEFAULT_POSITION = ""; // no anchor — a position exists only after new_position

// v7 "Maya": human delivery + Siri-style waveform overlay on the shared screen
// (pulses while she speaks), full-control tools from v6.
const INSTR = `You are ${AGENT_NAME} — an AI sales rep for Perfect (GoPerfect), on a LIVE Zoom call, presenting the REAL Perfect product with a real logged-in demo account. You sell exactly like Eli, Perfect's head of sales — warm, discovery-first, radically honest, never pushy. This playbook is distilled from his real calls; follow the FLOW, never a canned example.

VOICE & DELIVERY — a warm, upbeat human colleague, never a machine: natural contractions, varied pace, brief thinking pauses, small reactions ("oh nice", "love that", "mm-hm"), a smile in the voice. Engage genuinely with small talk when offered (weather, weekend) for ~30 seconds. Confirm understanding like Eli: "does that make sense?" / "if that makes sense". 1-2 short sentences, then stop and listen. Stop instantly if they speak.

ABSOLUTE RULE — YOU CONTROL THE SCREEN: you navigate, click, and type. NEVER ask the human to click or do anything on screen. NEVER say you can't press a button or lack control.

TRUTH ABOUT ACTIONS — never say you did something unless the tool result confirms it. On failure: quietly read_screen, find the exact label, retry differently. At most ONE short holding line ("one sec"), then silence until you have a grounded update. Never chain filler.

YOUR TOOLS (never mention them):
- show_screen(screen): home = positions board · position = current position's Perfect AI chat · outreach = its Outreach tab. After new_position you are ALREADY on the position screen - do NOT call show_screen('position') to "check"; use read_screen for progress. Only use show_screen to actually switch screens.
- new_position(kind): creates the position and opens its Perfect AI chat — INSTANT and reliable (a few seconds). Call it EXACTLY ONCE per role and trust its result: when it says "POSITION CREATED", it worked — move straight to ask_perfect with the role brief. NEVER call it twice, NEVER click 'Create Position', NEVER read_screen to "check if it worked". (outbound = source & reach out; inbound = screen inbound applicants.)
- ask_perfect(text): type FREE TEXT to Perfect AI's chat box — the role brief ("Full-stack developer in Tel Aviv") and natural-language tweaks ("exclude agencies", "people from companies like X"). After it returns DELIVERED, NEVER resend and stop calling show_screen — wait and narrate; results appear on their own. If it tells you a multiple-choice card is up, switch to answer_question.
- answer_question(choice): THIS is how you handle Perfect AI's setup questions. After the brief, Perfect AI asks 1-3 MULTIPLE-CHOICE questions (core stack, industry/domain, seniority range) as clickable option cards — the text box DISAPPEARS while they're up. For EACH question, pass the prospect's answer in plain words ("React and Node", "B2B SaaS", "3-5 years") — it clicks the matching option and moves to the next. If the prospect hasn't said / has no preference, pass "skip". It tells you the next question or that the search is building. NEVER say "it's still building" while options are on screen — those are waiting for your choice.
- click(text): click any visible button/card by its exact label.
- read_screen(): read the page. Call after actions and BEFORE claiming anything on screen. Narrate only what you read. Never repeat a failed click with the same label.
- note_beat(n, name): silent bookkeeping — when you move into FLOW stage n, call it once with that number, LAST in your turn: after your spoken line and after your screen actions, never before them. It must never delay an answer. Invisible to the prospect.
- skip_candidate(): thumbs-down the OPEN candidate — the ONLY correct way to skip. NEVER click('Skip') (that hits the Skipped TAB). It verifies the Skipped counter rose. If it says no card is open, click the candidate's name first, then skip_candidate again. Shortlist / add-to-Outreach are labeled: click('Shortlist') / click('Outreach').
- start_matching(): after the candidate POOL is built and the prospect says go, call this to begin the match run. Do NOT narrate "ready to start matching" without calling it — this is what actually starts it.
- start_autopilot(count): when the Autopilot prompt/modal appears, call this to start it (pass a number like 20 or 40 if the prospect gives one). Do NOT just ask the prospect for a number and wait — this clicks the Start Autopilot button for you.

PROCESSING WAITS ARE NORMAL — after you send an answer, Perfect AI often works for 30-90 seconds with loaders ("Building the title group...", progress steps). That is NOT a glitch and NOT stale. Never refresh, never resend the same answer, never apologize repeatedly. Instead, USE the wait like Eli: narrate what it's doing ("it's building the title group so it catches fire-protection roles, not lawn sprinklers"), teach the filters lesson or the memory layer, or ask one discovery question ("while it builds — what reply rates do you see today?"). Check read_screen every ~15 seconds and speak only when something real changed.

WIZARD SPEED — GATHER FIRST, THEN ONE RICH BRIEF (this is the reliable path). Before you run the search, ask the prospect the 2-3 details that matter in quick conversation: the role's core stack/tech, the seniority range, and the location (you usually have location already). THEN:
(1) new_position(outbound).
(2) ask_perfect ONCE with a CONSOLIDATED brief that includes everything, and tells Perfect AI to build immediately — e.g.: "Full-stack developer in Tel Aviv. Stack: React and Node. Seniority: mid-level, 3-5 years. Build the search now — full flexibility on anything I didn't specify." A complete brief makes Perfect AI build the search DIRECTLY with no pop-up questions.
(3) It then works for 30-90s ("Setting up the search / Building the title group") — narrate that, don't resend.
FALLBACK — if Perfect AI still pops a MULTIPLE-CHOICE card (options to click, the text box vanishes), answer each with answer_question(prospect's choice) or answer_question("skip"); never type into it, never call it "still building" (it's waiting for a choice).

IF THE APP SHOWS "account on hold / subscription paused": stay calm and honest — "that's a billing state on this demo tenant, not something you'd see on your own account." Keep demonstrating with what's already on screen (candidate cards, filters, pool) and continue the flow verbally for the locked part.

THE ELI SALES FLOW (generic — works for ANY role they bring):
1. WARM OPEN — brief human small talk if they engage. Then: you're Maya, an AI customer success rep with human capabilities — "I can see, I can read, I can speak, I can act."
2. ORIGIN — "What brought you to the call?" or "How did you hear about us?" Let them talk. Listen for pain (ZoomInfo data decay, LinkedIn 3-year locks + pricing, agency spend, manual outreach, application overload).
3. QUALIFY (3-5 questions max, one at a time): what roles + how many recs per month · team size and who sources · what tools today and what hurts · sourcing new people (outbound) or drowning in applicants (inbound) · which ATS.
4. HONEST FIT-CHECK — Eli's signature. Say the uncomfortable truths early: contact data is ~70%, not the 90% others claim (bought from vetted providers, never scraped). Strong on permanent hires, weaker on temp/high-churn. Niche trades and certifications have data gaps (people under-report licenses online). Geography: strong in US/Canada/UK/Australia/Germany/France/Israel + more monthly; if their market isn't covered, say so gracefully and offer to follow up when it lands. Never oversell; if you don't know (specific ATS field sync, security docs): "let me double-check with the team — I don't want to tell you something I'm not sure of."
5. TRANSITION — "I think I have enough information — happy to run a quick live search so you see it end to end." Give the 30-second loop first: find candidates → shortlist in minutes → verified email + phone → automated personalized outreach → your team steps in when someone replies. Human touch stays where it matters.
6. LIVE DEMO ON THEIR ROLE (new_position + their brief; relay Perfect AI's follow-up questions to them and send their answers back):
   - Pool size: sanity-check WITH them — "does that number match your sense of the market?" Then iterate in natural language with THEIR asks verbatim ("exclude practice owners", "people from companies like X but not X").
   - Filters lesson: must-have = hard filter, verified only. Important = ranking. Mark certifications/licenses as Important not must-have — people under-report them; the AI can infer and flag them.
   - Memory layer: team + personal memory; seed it with what already works (their sequences, their bar); it also ramps new recruiters faster.
   - Candidate card: greens = VERIFIED evidence in our data. Blues = bonus points the agent noticed. Likelihood-to-move: explain the why (tenure, industry move, stability) AND give the demo-account caveat — "I'm on a demo tenant here, so this score is computed against the demo company; in your account it scores against YOU."
   - Estimated salary: public-source based, can run ~20% off — say so if asked.
   - Outreach: agent-built personalized sequence, message score, ask-the-agent-to-improve-it ("like a marketing assistant at your desk"), replies land in the product AND their own inbox. Analytics: open / reply / positive-reply, per position and account.
   - Deliverability when relevant: email warm-up before sending, throttled sends to protect their domain, bounces auto-flagged and removed, typical bounce under 2%, a customer success manager watches it with them.
7. PRICING (when asked, or after the demo): tell it as a story — "instead of credits, we keep it predictable." $250 per position seat per month. A seat includes the search, verified contact info, UNLIMITED outreach and UNLIMITED users. Seats are reusable: archive or close a rec, run a new search on the same seat (archive keeps everything read-only; clone-and-edit to change just location). Annual commitment billed monthly; seats added mid-term end with the term. Then RECOMMEND a size: campaigns run 10-14 days, so roughly a third of their monthly recs in seats ("20 recs a month → 5-7 seats; but start lean — you can add later").
8. OBJECTIONS: vs LinkedIn/Indeed — honest: depends on role + location; strong where people have digital presence; "that's exactly why you should test us on YOUR roles." vs Juicebox/Copilot — focused context beats generic tools: shortlist in minutes, memory that learns you, agentic end-to-end (search AND outreach). ATS sync: only candidates you added to outreach or who replied positively — no noise; field mapping happens at onboarding.
9. CLOSE BY CUSTOMER TYPE:
   - Tester / small team → short trial focused on the search + THEIR data quality: "test different positions and locations — don't judge us on one search." Access sent by email right after the call, no call needed.
   - Evaluator ("I'll take it to the team") → warm summary email + offer a scheduled follow-up at a concrete time.
   - Ready decision-maker pushing on contract → 30-day paid pilot that rolls into annual unless they exit; flexibility exists (prepaid periods with exit options) — "let me confirm the exact option with the team."
   ALWAYS end with a concrete next step and thank them by name.

INBOUND PATH (they're drowning in applicants): use new_position kind=inbound. Story: connect the ATS, pick the position, the agent pulls the applicants + job description, you set must-haves + recruiter insights (private instructions that don't belong in a public JD), and it sorts into qualified / rejected / needs-review (only ~5-10% need human review). It explains every decision in greens/blues/yellows; correct it ("this one IS qualified") and it learns. Honest on fraud detection: improving, LinkedIn cross-check is coming.

ALWAYS CREATE FRESH — for the prospect's role, ALWAYS call new_position. NEVER click an existing position card on the home board: those are stale demos with pre-built matches, and opening one makes the demo look canned. If new_position seems slow, wait for it — do not fall back to an existing position.

GENERIC vs EXAMPLE — any position already on screen is leftover example content; never anchor on it or assume their industry. Their role is the demo, whatever it is: trades, advisors, engineers, veterinarians.

FACTS (exact): ~300 customers · selling 18 months, building 4.5 years · data combined from ~40 sources into one database · contact info bought from two vetted providers, never scraped · R&D Israel, go-to-market UK + US · support Sun 9:00 Israel time through Fri 18:00 New York · backed by Entrée Capital. If asked something outside this: offer to follow up by email — never invent.

SPEAKING HYGIENE: default English; switch language only if clearly asked, keep replies extra short there. If you hear background media, music, or side conversations not addressed to you — stay completely silent.`;

const py = `
import asyncio, json, base64, os, subprocess, urllib.request, re
import websockets
def _load(name, fname):
    try:
        return open("/tmp/" + fname, encoding="utf-8").read()
    except FileNotFoundError:
        return os.environ.get(name, "")
API = os.environ["OPENAI_API_KEY"]
INSTR = _load("AGENT_INSTR", "ah_instr.txt") or os.environ["AGENT_INSTR"]
INSTR = (INSTR or "") + chr(10) + chr(10) + 'DEMO ENVIRONMENT LIMITS: connecting a real email or LinkedIn account requires an OAuth sign-in that cannot complete in this demo. If you reach a connect-your-email, connect-your-LinkedIn, or choose-a-channel step, DEMONSTRATE the choice and describe how the outreach sequence works - do NOT try to actually connect, do NOT retry it, and do NOT say it failed. Treat the channel as set up outside the demo and continue the flow.'
NOGREET = os.environ.get("NOGREET","") == "1"
AUTOGREET = os.environ.get("AH_AUTOGREET","") == "1"
MIC_PULL = os.environ.get("AH_MIC_PULL","") == "1"
AH_SANDBOX = os.environ.get("AH_SANDBOX","")
import urllib.request as _urlreq
def _http_get(u):
    try:
        with _urlreq.urlopen(u, timeout=6) as _r:
            return _r.read().decode()
    except Exception:
        return ""
ANAME = os.environ.get("AGENT_NAME","the rep")
CLOGO = _load("CURTAIN_LOGO", "ah_clogo.txt")
GP_EMAIL = os.environ.get("GP_EMAIL",""); GP_PASS = os.environ.get("GP_PASS","")
SVCORG = os.environ.get("AH_SVCORG",""); ACCESS = os.environ.get("AH_ACCESS","")
TEST_PROMPT = os.environ.get("TEST_PROMPT","")
try:
    TEST_SCRIPT = json.loads(os.environ.get("TEST_SCRIPT","")) if os.environ.get("TEST_SCRIPT","") else None
except Exception:
    TEST_SCRIPT = None
import time as _time
# Hybrid voice (set by the JS launcher): brain outputs TEXT, ElevenLabs speaks it.
HYBRID_ENV = os.environ.get("VOICE_MODE", "") == "hybrid"
EL_KEY = os.environ.get("EL_API_KEY", "")
EL_VOICE = os.environ.get("EL_VOICE_ID", "")
BASE = (_load("AH_BASE", "ah_base.txt") or "").strip() or "https://doubl-e.goperfect.com"
# PRODUCT MODE. GENERIC is True when the demo system is NOT GoPerfect (e.g. After
# Human): the per-clone DEMO_URL (-> BASE) points somewhere else. Everything gated
# on GENERIC is NEW; when GENERIC is False (GoPerfect, the default) behavior is
# UNCHANGED. GoPerfect live calls are unaffected.
GENERIC = ("goperfect" not in BASE.lower())
def _origin(u):
    # scheme://host of a URL, lowercased; '' if not a URL. No regex/backslashes (law-18 safe).
    u = (u or "")
    i = u.find("://")
    if i < 0: return ""
    j = u.find("/", i + 3)
    return (u if j < 0 else u[:j]).lower()
BASE_ORIGIN = _origin(BASE)
print("PRODUCT_MODE " + ("GENERIC " + (BASE_ORIGIN or BASE) if GENERIC else "GOPERFECT"), flush=True)
GPAPI = "https://api.goperfect.com/services/application-gateway/api"
aud_in = [0]; aud_out = [0]; tool_n = [0]; last_act = [0.0]
state = {"pos": os.environ.get("POSITION_ID","` + DEFAULT_POSITION + `")}

OVERLAY = r"""
(function(){
  window.__ahClick=function(el){if(!el)return false;try{el.scrollIntoView({block:'center'});}catch(e){}var fire=function(){try{var rr=el.getBoundingClientRect();window.__ahRing&&window.__ahRing(rr.left+rr.width/2,rr.top+rr.height/2);}catch(e){}var o={bubbles:true,cancelable:true,view:window};['pointerover','pointerenter','pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t){try{el.dispatchEvent(new (t.indexOf('pointer')===0?PointerEvent:MouseEvent)(t,o));}catch(e){try{el.dispatchEvent(new MouseEvent(t.replace('pointer','mouse'),o));}catch(e2){}}});};try{var r=el.getBoundingClientRect();if(window.__ahCursor&&r.width>=0){window.__ahCursor(r.left+r.width/2,r.top+r.height/2);setTimeout(fire,380);}else{fire();}}catch(e){fire();}return true;};
  // capture the app's live bearer token from its own authed requests (survives reloads)
  if(!window.__perfWrap){
    window.__perfWrap=1; window.__lastAuth=null;
    var of=window.fetch;
    window.fetch=function(input,init){
      try{ var headers={};
        if(input&&typeof input==='object'&&'url' in input){try{input.headers&&input.headers.forEach&&input.headers.forEach(function(v,k){headers[k]=v})}catch(e){}}
        if(init&&init.headers){if(init.headers.forEach)init.headers.forEach(function(v,k){headers[k]=v});else Object.assign(headers,init.headers)}
        var a=headers.authorization||headers.Authorization; if(a&&/Bearer/i.test(a)) window.__lastAuth=a;
      }catch(e){}
      return of.apply(this,arguments);
    };
  }
  function install(){
    if(document.getElementById('maya-orb'))return;
    var el=document.createElement('div');el.id='maya-orb';
    el.innerHTML='<span>__ANAME__</span>';
    var st=document.createElement('style');st.textContent=
      '#maya-orb{position:fixed;right:20px;bottom:20px;z-index:2147483647;width:66px;height:66px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font:800 15px -apple-system,Segoe UI,sans-serif;letter-spacing:-.02em;background:radial-gradient(circle at 32% 30%,rgba(255,6,96,.9),rgba(163,66,255,.85) 55%,rgba(0,187,255,.75));box-shadow:0 14px 44px rgba(163,66,255,.5);pointer-events:none;animation:ahob 3.4s ease-in-out infinite}#maya-orb.speaking{animation:ahos 1.5s ease-in-out infinite}@keyframes ahob{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}@keyframes ahos{0%,100%{transform:scale(1.02);box-shadow:0 14px 44px rgba(163,66,255,.5)}50%{transform:scale(1.1);box-shadow:0 16px 64px rgba(255,6,96,.7)}}'+
      '#maya-orb .m-bars{display:flex;align-items:center;gap:3px;height:20px}'+
      '#maya-orb i{width:3.5px;height:6px;border-radius:2px;background:linear-gradient(180deg,#ff5c9d,#ff1a75)}'+
      '#maya-orb.speaking i{animation:mb .8s ease-in-out infinite}'+
      '#maya-orb.speaking i:nth-child(2){animation-delay:.12s}#maya-orb.speaking i:nth-child(3){animation-delay:.24s}#maya-orb.speaking i:nth-child(4){animation-delay:.36s}#maya-orb.speaking i:nth-child(5){animation-delay:.48s}'+
      '@keyframes mb{0%,100%{height:5px}50%{height:20px}}'+
      '#maya-orb:not(.speaking) i{animation:midle 2.6s ease-in-out infinite}'+
      '#maya-orb:not(.speaking) i:nth-child(2){animation-delay:.3s}#maya-orb:not(.speaking) i:nth-child(3){animation-delay:.6s}#maya-orb:not(.speaking) i:nth-child(4){animation-delay:.9s}#maya-orb:not(.speaking) i:nth-child(5){animation-delay:1.2s}'+
      '@keyframes midle{0%,100%{height:5px;opacity:.65}50%{height:10px;opacity:1}}'+
      '#ah-cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-1px 0 0 -1px;background:#ff1a75;clip-path:polygon(1px 1px,1px 16px,4.5px 12.5px,7.5px 19px,9.5px 18px,6.5px 12px,13px 12px);filter:drop-shadow(0 0 1px #fff) drop-shadow(0 2px 3px rgba(255,26,117,.55));z-index:2147483646;pointer-events:none;opacity:0;transition:left .38s cubic-bezier(.22,.61,.36,1),top .38s cubic-bezier(.22,.61,.36,1),opacity .25s}'+
      '#ah-ring{position:fixed;left:0;top:0;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:2px solid rgba(255,26,117,.9);z-index:2147483646;pointer-events:none;opacity:0}'+
      '#ah-ring.go{animation:ahring .5s ease-out}'+
      '@keyframes ahring{0%{opacity:.9;transform:scale(.4)}100%{opacity:0;transform:scale(3.4)}}';
    document.head.appendChild(st);document.body.appendChild(el);
    var cur=document.createElement('div');cur.id='ah-cursor';cur.style.left=(window.innerWidth/2)+'px';cur.style.top=(window.innerHeight/2)+'px';document.body.appendChild(cur);
    var rng=document.createElement('div');rng.id='ah-ring';document.body.appendChild(rng);
    window.__maya=function(on){el.classList.toggle('speaking',!!on)};
    window.__ahCursor=function(x,y){var c=document.getElementById('ah-cursor');if(c){c.style.left=x+'px';c.style.top=y+'px';c.style.opacity='1';}return true;};
    window.__ahRing=function(x,y){var g=document.getElementById('ah-ring');if(g){g.style.left=x+'px';g.style.top=y+'px';g.classList.remove('go');void g.offsetWidth;g.classList.add('go');}};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
"""
OVERLAY = OVERLAY.replace("__ANAME__", ANAME)  # orb badge shows the agent's own name
if MIC_PULL:
    # web demo: the frontend renders its own Ava orb over the stream, so the in-screen
    # one would just sit behind it as a duplicate - hide it here (kept for rehearsal/raw view).
    OVERLAY = OVERLAY.replace("#maya-orb{position:fixed", "#maya-orb{display:none !important;position:fixed")

# SCREEN EVENT WATCHER — push perception. A MutationObserver in the page spots
# popups, Perfect AI question cards (with their options), chat/artifact
# completions, match-card/results changes and loading→loaded transitions,
# debounced ~800ms, into window.__ahScreenEvents (capped 20). The bridge drains
# it every ~2s and feeds the model, so the clone notices WITHOUT read_screen.
WATCHER_JS = r"""
(function(){
  if(window.__ahWatch)return; window.__ahWatch=1;
  window.__ahScreenEvents=window.__ahScreenEvents||[];
  var push=function(s){try{var a=window.__ahScreenEvents;if(a[a.length-1]===s)return;a.push(s);if(a.length>20)a.splice(0,a.length-20);}catch(e){}};
  var st={qcard:'',modal:false,msgs:-1,cards:-1,loading:false,results:''};
  var scan=function(){
    try{
      var dlg=document.querySelector('[role=dialog],[class*=Modal-],[class*=modal-]');
      var dlgVis=!!(dlg&&dlg.getClientRects().length>0);
      if(dlgVis&&!st.modal){push('POPUP appeared: '+((dlg.innerText||'').trim().replace(/\\s+/g,' ').slice(0,140)));}
      st.modal=dlgVis;
      var c=document.querySelector('[class*=ChatAgentQuestionsArtifact]');
      if(c){
        var it=(c.innerText||'');
        var q=(it.split('\\n').map(function(x){return x.trim()}).filter(function(x){return x&&/\\?$/.test(x)})[0])||'';
        var opts=[].slice.call(c.querySelectorAll('button[class*=Option]')).map(function(b){return (b.innerText||'').replace(/\\s+/g,' ').replace(/^\\s*\\d+[.)]?\\s+/,'').trim()}).filter(Boolean);
        var sig=q+'|'+opts.join(',');
        if(opts.length&&sig!==st.qcard){st.qcard=sig;push('QUESTION CARD is up: "'+q+'" — options: '+opts.join(' | '));}
      } else { st.qcard=''; }
      var msgs=document.querySelectorAll('[class*=essage]').length;
      if(st.msgs>=0&&msgs>st.msgs){push('CHAT UPDATED ('+msgs+' blocks). Newest text tail: '+((document.body.innerText||'').trim().slice(-170).replace(/\\s+/g,' ')));}
      st.msgs=msgs;
      var loading=!!document.querySelector('[class*=spinner],[class*=Spinner],[class*=Skeleton],[class*=skeleton],[class*=progress-],[class*=Progress]');
      if(st.loading&&!loading){push('LOADING finished — the screen just settled.');}
      st.loading=loading;
      var cards=document.querySelectorAll('[class*=match-card],[class*=MatchCard],[class*=CandidateCard]').length;
      if(cards>0&&(st.cards||0)===0){push('MATCH RESULTS are up - ranked candidate cards are on screen. For HOW MANY candidates matched, read the "N candidates" figure on the page (the CANDIDATE COUNT line), NOT the number of cards - only a few render at a time.');}
      st.cards=cards;
      // RESULTS only counts on the actual matches list — NOT the positions
      // board, whose "+100 Matches to review" summary badge otherwise reads as
      // a finished search (it isn't; it's leftover state on the home page).
      var onMatches=/\\/positions\\/[^/]+\\/matches/.test(location.pathname);
      if(!onMatches){ st.results=''; }
      else {
        var m=(document.body.innerText||'').match(/([0-9][0-9,]{0,6})\\s+(results|candidates|matches|profiles)\\b/i);
        var res=m?(m[1]+' '+m[2].toLowerCase()):'';
        if(res&&res!==st.results){st.results=res;push('CANDIDATE COUNT on screen: '+res+' - THIS is the number to report to the guest (never count the cards).');}
      }
    }catch(e){}
  };
  var t=null;
  var obs=new MutationObserver(function(){ if(t)clearTimeout(t); t=setTimeout(scan,800); });
  var arm=function(){ try{ obs.observe(document.body,{childList:true,subtree:true,characterData:true}); scan(); }catch(e){ setTimeout(arm,1000); } };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',arm);else arm();
})();
"""
OVERLAY = OVERLAY + chr(10) + WATCHER_JS  # rides the same injection points as the orb

TOOLS = [
 {"type":"function","name":"show_screen",
  "description":"Switch the shared screen: home (positions board), position (current position's Perfect AI chat), outreach (current position's outreach tab).",
  "parameters":{"type":"object","properties":{"screen":{"type":"string","enum":["home","position","outreach"]}},"required":["screen"]}},
 {"type":"function","name":"new_position",
  "description":"Create a brand-new position and land in its Perfect AI chat (instant, reliable). kind: outbound = source passive candidates + automated outreach (the hero demo); inbound = screen applicants they already have. Call ONCE; it returns success immediately.",
  "parameters":{"type":"object","properties":{"kind":{"type":"string","enum":["outbound","inbound"]}},"required":["kind"]}},
 {"type":"function","name":"ask_perfect",
  "description":"Type a free-text message to Perfect AI's chat box (the role brief, or natural-language tweaks like 'exclude agencies'). Only when a text box is present - NOT for the multiple-choice question cards (use answer_question for those).",
  "parameters":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}},
 {"type":"function","name":"answer_question",
  "description":"Answer Perfect AI's on-screen MULTIPLE-CHOICE setup question (stack / industry / seniority etc. shown as clickable option buttons in a 1-of-N card). Pass the prospect's choice in plain words (e.g. 'React and Node', 'B2B SaaS', '3-5 years') and it clicks the matching option and advances; pass 'skip' if they have no preference or haven't said. Returns the next question, or confirms the search is now building. Use this - never ask_perfect - whenever options are on screen.",
  "parameters":{"type":"object","properties":{"choice":{"type":"string"}},"required":["choice"]}},
 {"type":"function","name":"click",
  "description":"Click a visible button/element by its label text.",
  "parameters":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}},
 {"type":"function","name":"read_screen",
  "description":"Read the current page content. Call before describing results.",
  "parameters":{"type":"object","properties":{},"required":[]}},
 {"type":"function","name":"skip_candidate",
  "description":"Skip (thumbs-down) the candidate whose card is currently open. Clicks the card's skip icon and verifies the Skipped counter increased. If it says a card isn't open, click the candidate's name first.",
  "parameters":{"type":"object","properties":{},"required":[]}},
 {"type":"function","name":"start_matching",
  "description":"Kick off the match run after the candidate pool has been built (when the prospect says go). Use this instead of typing 'start' yourself.",
  "parameters":{"type":"object","properties":{},"required":[]}},
 {"type":"function","name":"start_autopilot",
  "description":"On the Autopilot prompt/modal, start Autopilot (auto-adds best-fit candidates to outreach). Pass count = how many candidates to process (e.g. 20, 40); omit to just click Start with whatever is set.",
  "parameters":{"type":"object","properties":{"count":{"type":"integer"}},"required":[]}},
 {"type":"function","name":"note_beat",
  "description":"Silent flow bookkeeping. When you have just moved into a numbered FLOW stage, call this with that stage number (and its short name) - but ONLY AFTER you have finished your spoken line and any screen actions for that turn, NEVER before. It must never delay your answer. Invisible to the prospect: never mention it.",
  "parameters":{"type":"object","properties":{"n":{"type":"integer"},"name":{"type":"string"}},"required":["n"]}}
]

# goto — VERIFIED navigation against the Cartographer's crawled site map.
# The tool is always listed; its description enumerates the available
# destination keys when a map exists, and says so honestly when it doesn't.
try:
    SMAP = json.loads(_load("SITE_MAP", "ah_sitemap.json") or "[]")
except Exception:
    SMAP = []
SMAP_BY_KEY = {str(x.get("key", "")).lower(): x for x in SMAP if isinstance(x, dict) and x.get("key") and x.get("url")}
_core_keys = sorted(k for k, x in SMAP_BY_KEY.items() if x.get("core"))
_other_keys = sorted(k for k in SMAP_BY_KEY if k not in _core_keys)
_goto_desc = (("Navigate DIRECTLY to a named, crawl-verified product destination and confirm arrival against its known markers. Prefer this over show_screen when the destination is listed. Core destinations: " + ", ".join(_core_keys)) + ((" · also available: " + ", ".join(_other_keys)) if _other_keys else "")) if SMAP_BY_KEY else "site map not built yet — use show_screen"
TOOLS.append({"type": "function", "name": "goto",
  "description": _goto_desc,
  "parameters": {"type": "object", "properties": {"destination": {"type": "string"}}, "required": ["destination"]}})

# --- PRODUCT MODE: generic (non-GoPerfect) toolset ---------------------------
# In GENERIC mode the model must NOT see the GoPerfect-specific tools/flow. It
# drives ANY product from the injected DEMO SYSTEM context + persona using only
# the product-neutral tools: read_screen, click, goto (arbitrary same-origin
# URLs), and the new type_text. GoPerfect mode keeps the full toolset UNCHANGED.
if GENERIC:
    for _t in TOOLS:
        if _t.get("name") == "goto":
            _t["description"] = ("Navigate the demo system to a URL or path on this product (same site as the demo URL). "
                                 "Pass a full https URL on the same site, or a path like '/dashboard'. Confirms arrival.")
            _t["parameters"]["properties"]["destination"]["description"] = "A same-site https URL, or a path beginning with '/'."
    TOOLS.append({"type": "function", "name": "type_text",
      "description": ("Type text into a field on the demo product and submit it. Find the field by its visible label, "
                      "placeholder, or accessible name (e.g. 'access code', 'email', 'search'); leave target empty to use the "
                      "only/first visible field. Use this to enter an access code on a gate, or to fill any input/textarea. "
                      "It focuses the field, sets the value, and presses Enter / clicks the nearby submit button."),
      "parameters": {"type": "object", "properties": {
          "target": {"type": "string", "description": "Label/placeholder/name of the field. Empty = the first visible field."},
          "text": {"type": "string", "description": "The text to type."}}, "required": ["text"]}})
    _generic_keep = {"read_screen", "click", "goto", "type_text"}
    TOOLS = [t for t in TOOLS if t.get("name") in _generic_keep]
    print("GENERIC toolset: " + ", ".join(sorted(t.get("name") for t in TOOLS)), flush=True)

def cdp_page_ws():
    try:
        data = json.loads(urllib.request.urlopen("http://localhost:9222/json", timeout=5).read())
        pages = [t for t in data if t.get("type")=="page" and t.get("webSocketDebuggerUrl")]
        if GENERIC and BASE_ORIGIN:
            # GENERIC: drive the tab whose origin matches the demo product (BASE),
            # falling back to the first page. NEVER prefer a stray goperfect tab.
            pages.sort(key=lambda t: (0 if _origin(t.get("url") or "") == BASE_ORIGIN else 1))
        else:
            pages.sort(key=lambda t: (0 if "goperfect" in (t.get("url") or "") else 1))
        return pages[0]["webSocketDebuggerUrl"] if pages else None
    except Exception as e:
        print("CDP list err", e, flush=True); return None

async def conn(u,h=None):
    try: return await websockets.connect(u, additional_headers=h, max_size=None) if h else await websockets.connect(u, max_size=None)
    except TypeError: return await websockets.connect(u, extra_headers=h, max_size=None) if h else await websockets.connect(u, max_size=None)

async def main():
    cdp = None
    cdp_lock = asyncio.Lock()  # serialize shared CDP socket I/O: concurrent cdp_eval (screen-events poller vs answer_question/read_screen) were stealing each other's responses -> null -> false 'card not rendered'
    rid = [10]
    async def ensure_cdp():
        nonlocal cdp
        if cdp is None:
            w = cdp_page_ws()
            if w:
                cdp = await conn(w)
                rid[0]+=1
                await cdp.send(json.dumps({"id":rid[0],"method":"Page.enable"}))
                rid[0]+=1
                await cdp.send(json.dumps({"id":rid[0],"method":"Page.addScriptToEvaluateOnNewDocument","params":{"source":OVERLAY}}))
                rid[0]+=1
                await cdp.send(json.dumps({"id":rid[0],"method":"Runtime.evaluate","params":{"expression":OVERLAY}}))
        return cdp
    async def cdp_eval(expr):
        # Plain fresh socket per read -- byte-for-byte the external probe that reliably
        # returns present:true for QCARD_READ on the live page. The previous version
        # wrapped this in cdp_lock (shared with cdp_fire's persistent socket); on a busy
        # event loop that serialization returned present:false for card reads while an
        # identical LOCK-FREE external eval saw the card. Each call owns its own socket +
        # unique id (rid incremented with no await between read/use, so atomic) -> no lock.
        ws2 = None
        try:
            w = cdp_page_ws()
            if not w:
                return None
            ws2 = await conn(w)
            rid[0]+=1; my=rid[0]
            await ws2.send(json.dumps({"id":my,"method":"Runtime.evaluate","params":{"expression":expr,"returnByValue":True,"awaitPromise":True}}))
            while True:
                r = json.loads(await asyncio.wait_for(ws2.recv(), timeout=20))
                if r.get("id")==my:
                    return r.get("result",{}).get("result",{}).get("value")
        except Exception as e:
            print("CDP err", e, flush=True); return None
        finally:
            if ws2:
                try: await ws2.close()
                except Exception: pass
    async def cdp_fire(expr):
        nonlocal cdp
        async with cdp_lock:
            try:
                await ensure_cdp()
                rid[0]+=1
                await cdp.send(json.dumps({"id":rid[0],"method":"Runtime.evaluate","params":{"expression":expr}}))
            except Exception:
                cdp=None
    async def cdp_shot(n):
        # capture the product page on a SEPARATE short-lived CDP socket so it never
        # collides with the shared read_screen/cdp_eval connection. No imagemagick.
        # Let the screen settle after the action, and retry once (pages navigate).
        await asyncio.sleep(0.7)
        for attempt in range(2):
            try:
                wsurl = cdp_page_ws()
                if not wsurl: return
                async with websockets.connect(wsurl, max_size=None) as sc:
                    await sc.send(json.dumps({"id":1,"method":"Page.captureScreenshot","params":{"format":"png","captureBeyondViewport":False}}))
                    while True:
                        r = json.loads(await asyncio.wait_for(sc.recv(), timeout=20))
                        if r.get("id")==1:
                            data = r.get("result",{}).get("data")
                            if data:
                                os.makedirs("/tmp/shots", exist_ok=True)
                                with open("/tmp/shots/s_%d.png" % n, "wb") as f:
                                    f.write(base64.b64decode(data))
                                return
                            break
            except Exception as e:
                print("SHOT err", str(e)[:80], flush=True)
            await asyncio.sleep(1.2)

    # SELF-HEALING LOGIN: GoPerfect evicts older sessions when the demo account
    # logs in elsewhere (operator's browser, a crawl). When the app lands on
    # auth.goperfect.com mid-call, log back in instead of dying. Same DOM flow
    # as gp_login.mjs. Creds come via env; never printed.
    relogging = [False]
    async def relogin():
        if relogging[0] or not GP_EMAIL or not GP_PASS: return False
        relogging[0] = True
        try:
            print("RELOGIN attempting", flush=True)
            def _setval(sel_js, val):
                return ("(()=>{const i=%s;if(!i)return 'nofield';"
                        "const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;"
                        "s.call(i,%s);i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();return 'set';})()") % (sel_js, json.dumps(val))
            _click = "(()=>{const b=[...document.querySelectorAll('button,[role=button],input[type=submit]')].find(x=>/continue|log ?in|sign ?in/i.test((x.innerText||x.value||'')));if(!b)return 'nobutton';const o={bubbles:true,cancelable:true,view:window};['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>{try{b.dispatchEvent(new (t[0]==='p'?PointerEvent:MouseEvent)(t,o));}catch(e){try{b.dispatchEvent(new MouseEvent(t.indexOf('pointer')===0?t.replace('pointer','mouse'):t,o));}catch(e2){}}});return 'clicked';})()"
            _email_sel = "document.querySelector('input[type=email]')||[...document.querySelectorAll('input')].find(x=>/email/i.test((x.placeholder||'')+(x.name||'')))"
            _pass_sel = "document.querySelector('input[type=password]')"
            _enter = ("(()=>{const i=document.querySelector('input[type=password]');if(!i)return 'nopass';"
                      "const o={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true};"
                      "i.dispatchEvent(new KeyboardEvent('keydown',o));i.dispatchEvent(new KeyboardEvent('keyup',o));"
                      "const f=i.closest('form');if(f&&f.requestSubmit)f.requestSubmit();return 'submitted';})()")
            await cdp_fire("location.href='https://auth.goperfect.com/'")
            await asyncio.sleep(5)
            await cdp_eval(_setval(_email_sel, GP_EMAIL)); await asyncio.sleep(0.6)
            await cdp_eval(_click)
            for _ in range(14):
                await asyncio.sleep(1.5)
                if await cdp_eval("!!(" + _pass_sel + ")"): break
            await cdp_eval(_setval(_pass_sel, GP_PASS)); await asyncio.sleep(0.6)
            b = await cdp_eval(_click)
            if b == "nobutton": await cdp_eval(_enter)
            for _ in range(15):
                await asyncio.sleep(2)
                u = (await cdp_eval("location.href")) or ""
                if "doubl-e.goperfect.com" in u:
                    print("RELOGIN ok", flush=True)
                    return True
            print("RELOGIN failed - still on auth", flush=True)
            return False
        except Exception as e:
            print("RELOGIN err", str(e)[:120], flush=True)
            return False
        finally:
            relogging[0] = False

    async def cdp_nav(url):
        nonlocal cdp
        try:
            await ensure_cdp()
            # evicted mid-call? heal before navigating anywhere
            _pre = (await cdp_eval("location.href")) or ""
            if "auth.goperfect.com" in _pre:
                await relogin()
            # the demo is moving — lift the curtain overlay if it's still up
            await cdp_fire("var _c=document.getElementById('ah-curtain'); _c&&_c.remove();")
            # In-app route change when possible: Page.navigate reloads the whole
            # SPA (guests watch the platform loader every time); pushState +
            # popstate is an instant client-side transition. Falls back to a
            # full load if the app's router doesn't respond.
            cur = (await cdp_eval("location.href")) or ""
            if cur.startswith(BASE) and url.startswith(BASE):
                path = url[len(BASE):] or "/"
                before = await cdp_eval("((document.querySelector('main')||document.body).innerText||'').length") or 0
                await cdp_fire("history.pushState({},''," + json.dumps(path) + ");window.dispatchEvent(new PopStateEvent('popstate'))")
                await asyncio.sleep(1.6)
                after_path = (await cdp_eval("location.pathname+location.search")) or ""
                after_len = await cdp_eval("((document.querySelector('main')||document.body).innerText||'').length") or 0
                if after_path == path.split("#")[0] and (after_len != before or path == "/"):
                    print("NAV spa " + path, flush=True)
                    return True
                # router ignored it — do the honest full load
            rid[0]+=1
            await cdp.send(json.dumps({"id":rid[0],"method":"Page.navigate","params":{"url":url}}))
            return True
        except Exception as e:
            print("NAV err", e, flush=True); cdp=None; return False

    await ensure_cdp()
    print("CDP connected + overlay armed", flush=True)
    # SERVICE-ORG AUTH (GENERIC / After Human): in password mode the product app
    # needs a session, and the demo sandbox has none, so it bounces to marketing.
    # Authorize the demo browser via the service path (same as generic_gate):
    # jv.access = platform key, jv.serviceorg = the demo org. addScriptToEvaluate
    # sets them before app JS on every app-origin load; then load the app authed.
    if GENERIC and SVCORG and ACCESS:
        _svcjs = ("(function(){try{if(location.origin===" + json.dumps(BASE_ORIGIN) + "){localStorage.setItem('jv.access'," + json.dumps(ACCESS) + ");localStorage.setItem('jv.serviceorg'," + json.dumps(SVCORG) + ");localStorage.setItem('jv.democall'," + json.dumps(AH_SANDBOX) + ");}}catch(e){}})()")
        try:
            rid[0]+=1
            await cdp.send(json.dumps({"id":rid[0],"method":"Page.addScriptToEvaluateOnNewDocument","params":{"source":_svcjs}}))
        except Exception as _e:
            print("SVCAUTH addScript err", str(_e)[:80], flush=True)
        try:
            await cdp_nav(BASE_ORIGIN + "/"); await asyncio.sleep(1.0)
            await cdp_eval(_svcjs)
            await cdp_nav(BASE); await asyncio.sleep(1.6)
            print("SVCAUTH ready svcorg=" + SVCORG, flush=True)
        except Exception as _e:
            print("SVCAUTH nav err", str(_e)[:80], flush=True)
    if SMAP_BY_KEY:
        print("SITEMAP %d destinations" % len(SMAP_BY_KEY), flush=True)

    # opening curtain: park the shared screen on a branded page until the first
    # real navigation, so guests never open on the raw dashboard. Fresh boots
    # land on the dashboard root after auto-login; a mid-call revive is deep in
    # /positions/... and must NOT have its screen blanked (NOGREET can't tell
    # the two apart - rehearsal.mjs always passes nogreet).
    _u0 = ((await cdp_eval("location.href")) or "").split("?")[0].rstrip("/")
    # GENERIC = the public Talk-to-Ava demo: ALWAYS raise the curtain (it is a
    # fresh boot, never a mid-call revive), regardless of the exact post-auth
    # route the SPA settled on - otherwise the product shows immediately and
    # "let me pull it up" has nothing to reveal.
    if _u0 == BASE or _u0.startswith("about:") or GENERIC:
        _logo = ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 121.23 73.487' fill='#FF0660' style='width:84px;height:auto;flex-shrink:0'>"
                 "<path transform='translate(25.251 0)' d='M 35.382 34.992 C 49.942 34.992 73.716 20.513 70.056 10.211 C 65.098 -3.712 7.698 -3.092 0.716 10.211 C -4.444 20.048 19.438 34.999 35.382 34.992 Z'></path>"
                 "<path transform='translate(0 36.27)' d='M 118.615 16.108 C 116.634 17.873 114.547 19.519 112.365 21.038 C 110.262 22.516 108.059 23.854 105.856 25.164 C 101.354 27.744 96.631 29.933 91.741 31.706 C 81.631 35.442 70.905 37.309 60.103 37.213 C 49.202 36.967 38.453 34.649 28.45 30.39 C 23.662 28.365 19.053 25.953 14.672 23.178 C 12.52 21.77 10.403 20.362 8.386 18.756 C 6.287 17.143 4.288 15.407 2.402 13.559 C 1.635 12.824 1.028 11.945 0.615 10.974 C 0.203 10.004 -0.007 8.962 0 7.91 C 0.007 6.859 0.229 5.819 0.654 4.854 C 1.079 3.889 1.698 3.017 2.473 2.291 C 3.546 1.282 4.873 0.571 6.317 0.229 C 7.762 -0.112 9.273 -0.071 10.697 0.348 L 11.945 0.721 C 13.739 1.249 15.95 2.129 17.988 2.756 C 20.025 3.383 22.114 4.165 24.202 4.791 C 28.349 6.08 32.468 7.256 36.551 8.249 C 44.349 10.261 52.359 11.374 60.418 11.566 C 64.425 11.599 68.429 11.39 72.409 10.939 C 76.471 10.566 80.568 9.869 84.716 9.08 C 88.864 8.291 93.04 7.32 97.245 6.263 C 99.398 5.763 101.457 5.151 103.574 4.573 C 105.691 3.996 107.88 3.291 109.702 2.876 L 111.008 2.566 C 113.123 2.061 115.355 2.391 117.223 3.486 C 119.092 4.58 120.447 6.352 120.997 8.418 C 121.342 9.792 121.303 11.231 120.883 12.585 C 120.464 13.938 119.68 15.155 118.615 16.108 L 118.615 16.108 Z'></path></svg>")
        # OVERLAY, not a page: the app stays loaded and warm underneath, so
        # lifting the curtain is instant — no SPA cold boot / platform loader
        # in front of guests when the demo's first screen appears.
        _inner = (("<img src='" + CLOGO + "' style='max-width:440px;max-height:150px;object-fit:contain'>") if CLOGO else
                  ("<div style='display:flex;align-items:center;gap:26px'>" + _logo +
                   "<div style='font-size:78px;font-weight:800;letter-spacing:-.04em;color:#FF0660'>perfect</div></div>"))
        _inner += ("<div style='margin-top:22px;font-size:20px;color:#B9B9D9'>Live demo &middot; with " + ANAME + "</div>"
                   "<div style='margin-top:34px;width:46px;height:4px;border-radius:2px;background:#A342FF'></div>")
        _cjs = ("(function(){if(document.getElementById('ah-curtain'))return;var d=document.createElement('div');d.id='ah-curtain';"
                "d.style.cssText='position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;justify-content:center;"
                "background:radial-gradient(ellipse at 50% 40%, #101046 0%, #04042A 70%);font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#fff';"
                "d.innerHTML=" + json.dumps(_inner) + ";document.documentElement.appendChild(d);})()")
        await cdp_fire(_cjs)
        print("CURTAIN up (overlay)", flush=True)

    async def cur_url():
        return (await cdp_eval("location.href")) or ""
    async def sync_pos():
        u = await cur_url()
        m = re.search(r"/positions/([a-f0-9]+)/", u)
        if m: state["pos"] = m.group(1)
        return u
    def screens():
        # NOTE: the outreach content lives at /outreach-agent (learned from the
        # operator's recorded demonstration) — /outreach renders an empty shell.
        return {"home": BASE + "/", "position": BASE + "/positions/" + state["pos"] + "/matches", "outreach": BASE + "/positions/" + state["pos"] + "/outreach-agent"}

    VERIFY_JS = """(()=>{const m=document.querySelector('main')||document.body;const t=(m.innerText||'').trim();return location.href+'||'+t.length+'||'+t.slice(0,220).replace(/\\s+/g,' ')})()"""
    async def show_screen(s, _retried=False):
        await sync_pos()  # follow the position actually on screen, not a stale one
        if s in ("position","outreach") and not state["pos"]:
            return "no position is open yet - use new_position to create one for the prospect's role"
        url = screens().get(s)
        if not url: return "unknown screen"
        cur = await cur_url()
        base = url.split("?")[0]
        if cur and cur.startswith(base):
            # already here - do NOT reload; reloading interrupts Perfect AI mid-work
            return "already showing " + s + " - it's live on screen. Do NOT reload. Just wait and read_screen for updates."
        ok = await cdp_nav(url); await asyncio.sleep(3.5)
        if not ok: return "navigation hiccup - retry"
        # verify-or-confess: never claim arrival without evidence. SPA panes can
        # hydrate slowly, so give an apparently-empty page a few more seconds
        # before declaring it empty.
        curu = ""; tlen = 0; snip = ""
        for _ in range(3):
            raw = await cdp_eval(VERIFY_JS) or ""
            parts = raw.split("||")
            curu = parts[0] if parts else ""
            try: tlen = int(parts[1]) if len(parts) > 1 else 0
            except Exception: tlen = 0
            snip = parts[2] if len(parts) > 2 else ""
            if (curu and not curu.startswith(base)) or tlen >= 120:
                break
            await asyncio.sleep(4)
        if curu and not curu.startswith(base):
            if "auth.goperfect.com" in curu and not _retried:
                # evicted session — heal and try once more, silently
                if await relogin():
                    return await show_screen(s, True)
            return "FAILED - tried to open " + s + " but the app is actually showing " + curu[:100] + ". Do NOT claim you are on " + s + ". read_screen and adapt honestly."
        if s == "outreach" and tlen < 120:
            return ("opened the Outreach tab of this position but it is EMPTY. DO NOT present an empty page as the outreach section. Be honest with the guest, and to actually demo outreach: run start_autopilot (adds best-fit candidates to outreach) after the match run, then come back here.")
        extra = ""
        if s == "outreach" and "INACTIVE" in snip.upper():
            extra = " (Outreach shows INACTIVE - no campaign running yet. That is fine: THIS setup view is the demo - email/LinkedIn connection, personalization, sequence generation. Walk through it, and start_autopilot after matching fills it with real candidates.)"
        return "now showing " + s + " - VERIFIED. The page shows: " + snip + extra

    # --- goto: site-map navigation with verify-or-confess (Cartographer map) ---
    # v2: agentic surfaces (dynamic=true — chat pages, generated artifacts) are
    # verified STRUCTURE-FIRST (url prefix + >=2 known structure elements
    # present) because their text changes per conversation by design. Static
    # pages keep the text tier (heading/snippet + minText). Prerequisites come
    # from the map's requires field (e.g. open_position -> new_position).
    GOTO_READ_JS = """(()=>{const m=document.querySelector('main')||document.body;const t=(m.innerText||'').trim();
      const vis=(e)=>{try{return e.getClientRects().length>0}catch(err){return true}};
      const lab=(e)=>((e.innerText||e.getAttribute('aria-label')||'').trim().replace(/\\s+/g,' '));
      const inputs=[...document.querySelectorAll('input,textarea,select')].filter(vis).map(e=>e.getAttribute('placeholder')||e.getAttribute('aria-label')||e.getAttribute('name')||'').map(s=>s.trim()).filter(Boolean).slice(0,12);
      const buttons=[...new Set([...document.querySelectorAll('button,[role=button]')].filter(vis).map(e=>lab(e).slice(0,44)).filter(Boolean))].slice(0,25);
      const landmarks=[...document.querySelectorAll('h1,h2')].filter(vis).map(e=>lab(e).slice(0,60)).filter(Boolean).slice(0,6);
      return JSON.stringify({url:location.href,len:t.length,text:t.slice(0,6000).replace(/\\s+/g,' '),inputs:inputs,buttons:buttons,landmarks:landmarks})})()"""
    def _struct_hits(rec, pgj):
        st = rec.get("structure") or {}
        want = [str(x).lower() for x in (st.get("inputs") or []) + (st.get("tabs") or []) + (st.get("buttons") or []) + (st.get("landmarks") or []) if x]
        have = [str(x).lower() for x in (pgj.get("inputs") or []) + (pgj.get("buttons") or []) + (pgj.get("landmarks") or [])]
        txt = str(pgj.get("text", "")).lower()
        hits = []
        for w in want:
            if any(w == h or w in h or h in w for h in have) or (len(w) >= 10 and w in txt):
                hits.append(w)
        return hits
    async def goto_generic(dest, _retried=False):
        # GENERIC navigation: accept an arbitrary SAME-ORIGIN (BASE) URL or a path
        # and go there. No GoPerfect site-map; verify by landing on the BASE origin.
        raw = (dest or "").strip()
        if not raw:
            return "give a URL on the demo product, or a path like '/dashboard'."
        if "://" in raw:
            if _origin(raw) != BASE_ORIGIN:
                return ("that URL is on a different site (" + (_origin(raw) or "?") + ") than the demo product (" +
                        BASE_ORIGIN + "). Only navigate within the demo system; pass a same-site URL or a '/path'.")
            url = raw
        else:
            url = BASE_ORIGIN + (raw if raw.startswith("/") else "/" + raw)
        ok = await cdp_nav(url)
        if not ok:
            return "navigation hiccup - retry goto"
        await asyncio.sleep(3.0)
        curu = ""; snip = ""
        for _ in range(3):
            r2 = await cdp_eval(VERIFY_JS) or ""
            parts = r2.split("||")
            curu = parts[0] if parts else ""
            snip = parts[2] if len(parts) > 2 else ""
            if curu:
                break
            await asyncio.sleep(3)
        if curu and _origin(curu) == BASE_ORIGIN:
            return "now at " + curu[:120] + (" - the page shows: " + snip if snip else "") + ". read_screen for detail."
        return ("landed on " + (curu[:120] or "an unknown page") + " (expected the demo product at " + BASE_ORIGIN +
                "). Do NOT assume the screen; read_screen and describe only what is there.")
    async def goto(dest, _retried=False):
        if GENERIC:
            return await goto_generic(dest, _retried)
        if not SMAP_BY_KEY:
            return "site map not built yet — use show_screen"
        key = (dest or "").strip().lower()
        rec = SMAP_BY_KEY.get(key)
        if not rec:
            cand = [k for k in SMAP_BY_KEY if key and key in k]
            if len(cand) == 1:
                key = cand[0]; rec = SMAP_BY_KEY[key]
            else:
                return "unknown destination '" + str(dest)[:40] + "'. Available: " + ", ".join(sorted(SMAP_BY_KEY.keys()))
        url = str(rec.get("url", ""))
        if "{positionId}" in url:
            await sync_pos()
            if not state["pos"]:
                req = rec.get("requires") or {}
                need = str(req.get("state", "open_position")).replace("_", " ")
                fix = str(req.get("satisfyWith", "new_position"))
                return ("destination '" + key + "' needs " + ("an " if need.startswith("open") else "") + need +
                        " and none is satisfied yet — satisfy it with the " + fix + " tool first (or goto a non-position destination).")
            url = url.replace("{positionId}", state["pos"])
        if "{id}" in url:
            return "destination '" + key + "' points at a specific record ({id}) the map cannot resolve — use show_screen or click to reach it."
        ok = await cdp_nav(url)
        if not ok:
            return "navigation hiccup - retry goto"
        await asyncio.sleep(3.5)
        v = rec.get("verify") or {}
        heading = str(v.get("heading", "")).strip()
        snippets = [str(s) for s in (v.get("snippets") or []) if s]
        try: min_text = int(v.get("minText") or 0)
        except Exception: min_text = 0
        dynamic = bool(rec.get("dynamic"))
        base = url.split("?")[0]
        curu = ""; tlen = 0; txt = ""; s_hits = []
        for _ in range(3):   # same 3x4s hydration patience as show_screen
            raw = await cdp_eval(GOTO_READ_JS) or "{}"
            try: pgj = json.loads(raw)
            except Exception: pgj = {}
            curu = str(pgj.get("url", "")); txt = str(pgj.get("text", ""))
            try: tlen = int(pgj.get("len") or 0)
            except Exception: tlen = 0
            if curu.startswith(base):
                s_hits = _struct_hits(rec, pgj)
                if dynamic:
                    # agentic surface: structure IS the fingerprint (text drifts by design)
                    if len(s_hits) >= 2:
                        return ("VERIFIED — showing " + key + " (structure tier: " + ", ".join(s_hits[:3]) + "). Content on this screen is conversation-generated, so describe what you read, not what you expect.")
                else:
                    low = txt.lower()
                    hit_h = bool(heading) and heading.lower() in low
                    hit_s = [s for s in snippets if s.lower() in low]
                    if (hit_h or hit_s) and tlen >= min_text:
                        live = (hit_s[0] if hit_s else heading)
                        return "VERIFIED — showing " + key + ": " + live[:140]
                    if len(s_hits) >= 2 and tlen >= min(min_text, 120):
                        return "VERIFIED — showing " + key + " (structure tier: " + ", ".join(s_hits[:3]) + ")."
            await asyncio.sleep(4)
        if curu and not curu.startswith(base):
            if "auth.goperfect.com" in curu and not _retried:
                # evicted session — heal and try once more, silently
                if await relogin():
                    return await goto(dest, True)
            return ("FAILED — tried goto '" + key + "' but the app is actually showing " + curu[:100] +
                    ". Do NOT claim you are on " + key + ". read_screen and adapt honestly.")
        return ("NOT VERIFIED — landed on " + curu[:100] + " but the page does not show the expected markers for '" + key +
                "' (text " + str(tlen) + " chars, structure hits " + str(len(s_hits)) + "/2 needed). Do NOT claim it. read_screen and describe only what is actually there.")

    CLICK_JS = """(()=>{
      const label=%s.toLowerCase();
      const pick=(list)=>list.find(e=>((e.innerText||'').trim().toLowerCase()===label))||list.find(e=>((e.innerText||'').trim().toLowerCase().includes(label)));
      let el=pick([...document.querySelectorAll('button,[role=button],a,[class*=Button]')]);
      if(!el){
        const attrEls=[...document.querySelectorAll('button,[role=button],a,[class*=Button],[class*=Icon]')];
        el=attrEls.find(e=>(((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('title')||'')+' '+(e.getAttribute('data-testid')||'')).toLowerCase()).includes(label));
      }
      if(!el){
        const cand=[...document.querySelectorAll('div,span,h1,h2,h3,h4')].filter(e=>e.children.length<10&&(e.innerText||'').trim().length>0&&(e.innerText||'').trim().length<140);
        el=pick(cand);
        if(el) el=el.closest("[class*=card],[class*=Card],[class*=option],[class*=Option]")||el;
      }
      if(!el) return 'no element with that label - call read_screen';
      el.scrollIntoView({block:'center'}); (window.__ahClick?window.__ahClick(el):el.click()); return 'clicked: '+(el.innerText||'').trim().slice(0,60);
    })()"""
    SIG_JS = "(()=>{return location.href+'|'+((document.body.innerText||'').length)+'|'+document.querySelectorAll('button,[role=button],[role=option],[role=dialog],dialog,textarea,input').length})()"
    async def capture_b64():
        wsurl = cdp_page_ws()
        if not wsurl: return None
        try:
            async with websockets.connect(wsurl, max_size=None) as sc:
                await sc.send(json.dumps({"id":1,"method":"Page.captureScreenshot","params":{"format":"png","captureBeyondViewport":False}}))
                while True:
                    r = json.loads(await asyncio.wait_for(sc.recv(), timeout=20))
                    if r.get("id")==1: return r.get("result",{}).get("data")
        except Exception:
            return None
    def _vision_locate(b64, desc):
        prompt = "You see a screenshot of a web app. Reply with ONLY compact JSON having keys found (true or false), xr, yr -- where xr and yr are the click point as fractions of the width and height (each 0 to 1) of this element. Element: " + str(desc)
        body = {"model":"gpt-4o","temperature":0,"max_tokens":120,"messages":[{"role":"user","content":[
            {"type":"text","text":prompt},
            {"type":"image_url","image_url":{"url":"data:image/png;base64," + b64}}]}]}
        req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(body).encode("utf-8"), headers={"Authorization":"Bearer " + API, "Content-Type":"application/json"})
        raw = urllib.request.urlopen(req, timeout=30).read()
        txt = json.loads(raw)["choices"][0]["message"]["content"]
        a = txt.find("{"); b = txt.rfind("}")
        return json.loads(txt[a:b+1])
    async def vision_click(desc):
        # FALLBACK: locate a control by description via a vision model when the a11y
        # tree / DOM cannot, then click at its coordinates with real CDP input.
        b64 = await capture_b64()
        if not b64: return "vision: no screenshot"
        try:
            loc = await asyncio.get_event_loop().run_in_executor(None, _vision_locate, b64, desc)
        except Exception as e:
            return "vision unavailable (" + str(e)[:80] + ")"
        if not loc or not loc.get("found"): return "vision could not find it on screen"
        dims = await cdp_eval("(window.innerWidth+'x'+window.innerHeight)")
        try:
            W, H = [int(float(v)) for v in str(dims or "0x0").split("x")]
        except Exception:
            W, H = 0, 0
        x = int(float(loc.get("xr",0)) * W); y = int(float(loc.get("yr",0)) * H)
        if x <= 0 or y <= 0: return "vision returned an off-screen point; read_screen and use a labelled control"
        # embodied telegraph: glide the visible cursor to the target, then click
        try: await cdp_eval("window.__ahCursor&&window.__ahCursor(" + str(x) + "," + str(y) + ")")
        except Exception: pass
        await asyncio.sleep(0.42)
        before = await cdp_eval(SIG_JS)
        try:
            wsurl = cdp_page_ws()
            async with websockets.connect(wsurl, max_size=None) as sc:
                for typ, btns in [("mouseMoved",0),("mousePressed",1),("mouseReleased",1)]:
                    p = {"type":typ,"x":x,"y":y,"button":"left","buttons":btns,"clickCount":1}
                    await sc.send(json.dumps({"id":1,"method":"Input.dispatchMouseEvent","params":p}))
                    try: await asyncio.wait_for(sc.recv(), timeout=5)
                    except Exception: pass
        except Exception as e:
            return "vision click dispatch failed (" + str(e)[:80] + ")"
        try: await cdp_eval("window.__ahRing&&window.__ahRing(" + str(x) + "," + str(y) + ")")
        except Exception: pass
        await asyncio.sleep(1.5)
        after = await cdp_eval(SIG_JS)
        return ("vision-clicked at " + str(x) + "," + str(y) + (" - screen changed, verified" if before != after else " - but the screen did NOT change; read_screen and reconsider"))
    def axclick_js(text):
        # 2d: target a control by ROLE + accessible NAME (product-agnostic), then click
        # it via the shared pointer helper. No CSS classes; no backslashes (law-18 safe).
        return ("(()=>{var want=%s.toLowerCase().trim();"
                "var vis=function(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.offsetParent!==null;};"
                "var nm=function(e){var n=e.getAttribute('aria-label')||'';if(!n){var lb=e.getAttribute('aria-labelledby');if(lb){var t=document.getElementById(lb);if(t)n=t.innerText||'';}}if(!n)n=(e.innerText||e.value||e.placeholder||e.getAttribute('title')||'');return (''+n).trim();};"
                "var norm=function(s){return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();};"
                "var sel='a,button,textarea,select,input,[role=button],[role=option],[role=radio],[role=checkbox],[role=tab],[role=menuitem],[role=menuitemradio],[role=link],[role=switch]';"
                "var els=[].slice.call(document.querySelectorAll(sel)).filter(vis);"
                "var w=norm(want);var ws=w.split(' ').filter(Boolean);var best=null,bs=0;"
                "els.forEach(function(e){var t=norm(nm(e));if(!t)return;var sc=0;if(t===w)sc=1000;else if(t.indexOf(w)>=0||w.indexOf(t)>=0)sc=100;else{var tw=t.split(' ');sc=ws.filter(function(x){return x&&tw.indexOf(x)>=0;}).length;}if(sc>bs){bs=sc;best=e;}});"
                "if(best&&bs>0){if(window.__ahClick)window.__ahClick(best);else best.click();return 'axclicked:'+norm(nm(best)).slice(0,40);}return 'noax';})()") % json.dumps(text)
    async def click(text):
        low = (text or "").lower()
        if any(x in low for x in ["create position", "source & reach", "reach out", "screen inbound", "re-engage", "reengage"]):
            return "Do not click the create flow manually - call new_position(kind) instead (outbound or inbound). It handles Create Position and the card choice."
        before = await cdp_eval(SIG_JS)
        # 1) a11y-targeted click FIRST (role + accessible name; generic, no classes)
        ax = str(await cdp_eval(axclick_js(text)) or "")
        if ax.startswith("axclicked"):
            await asyncio.sleep(1.6)
            after = await cdp_eval(SIG_JS)
            u = await sync_pos()
            if before is not None and after is not None and before == after:
                v = await vision_click(text)
                return "a11y-clicked (" + ax[len("axclicked:"):] + ") but screen unchanged; vision fallback: " + v + " | now at: " + u
            return ax + " | screen changed - verified (a11y). Now at: " + u
        # 2) DOM/text matcher
        r = await cdp_eval(CLICK_JS % json.dumps(text))
        rs = str(r or "")
        if ("no element" in rs.lower()) or (rs == ""):
            v = await vision_click(text)
            return "DOM/a11y could not find it -> vision fallback: " + v
        await asyncio.sleep(2.0)
        after = await cdp_eval(SIG_JS)
        u = await sync_pos()
        if "clicked" not in rs:
            return (r or "click failed") + " | now at: " + u
        if before is not None and after is not None and before == after:
            v = await vision_click(text)
            return rs + " -- screen unchanged; vision fallback: " + v + " | now at: " + u
        return rs + " | screen changed - verified. Now at: " + u

    def type_text_js(target, text):
        # GENERIC text entry (product-agnostic): find a visible input/textarea/
        # contenteditable by accessible name / label / placeholder / role, focus it,
        # set the value via the native setter (so React onChange fires), dispatch
        # input+change, then submit (Enter, then a nearby enabled submit button).
        # Mirrors ASK_JS / answer_text_js. No CSS classes; NO backslashes (law-18 safe).
        return ("(()=>{var want=%s.toLowerCase().trim();var val=%s;"
                "var vis=function(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.offsetParent!==null;};"
                "var ce=function(e){var c=e.getAttribute&&e.getAttribute('contenteditable');return c===''||c==='true';};"
                "var norm=function(s){return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();};"
                "var nm=function(e){var n=e.getAttribute('aria-label')||'';"
                "if(!n){var lb=e.getAttribute('aria-labelledby');if(lb){var t=document.getElementById(lb);if(t)n=t.innerText||'';}}"
                "if(!n&&e.id){var la=document.querySelector('label[for='+JSON.stringify(e.id)+']');if(la)n=la.innerText||'';}"
                "if(!n&&e.closest){var pl=e.closest('label');if(pl)n=pl.innerText||'';}"
                "if(!n)n=(e.getAttribute('placeholder')||e.getAttribute('name')||e.getAttribute('title')||'');return (''+n).trim();};"
                "var bad=['hidden','checkbox','radio','button','submit','file','range','color'];"
                "var sel='input,textarea,[contenteditable],[role=textbox],[role=searchbox],[role=combobox]';"
                "var els=[].slice.call(document.querySelectorAll(sel)).filter(function(e){"
                "if(!vis(e))return false;var tag=(e.tagName||'').toLowerCase();"
                "if(tag==='input'){var ty=(e.getAttribute('type')||'text').toLowerCase();if(bad.indexOf(ty)>=0)return false;}"
                "if(e.disabled||e.readOnly)return false;return true;});"
                "if(!els.length)return 'noinput';"
                "var w=norm(want);var ws=w.split(' ').filter(Boolean);var best=null,bs=-1;"
                "if(!w){best=els[0];bs=1;}else{els.forEach(function(e){var t=norm(nm(e));var sc=0;"
                "if(t&&t===w)sc=1000;else if(t&&(t.indexOf(w)>=0||w.indexOf(t)>=0))sc=100;"
                "else{var tw=t.split(' ');sc=ws.filter(function(x){return x&&tw.indexOf(x)>=0;}).length;}"
                "if(sc>bs){bs=sc;best=e;}});}"
                "if(!best||bs<=0)return 'nofield';"
                "try{best.focus();}catch(e){}"
                "if(ce(best)){best.innerText=val;best.dispatchEvent(new Event('input',{bubbles:true}));}"
                "else{var proto=(best.tagName||'').toLowerCase()==='textarea'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;"
                "var setr=Object.getOwnPropertyDescriptor(proto,'value').set;setr.call(best,val);"
                "best.dispatchEvent(new Event('input',{bubbles:true}));best.dispatchEvent(new Event('change',{bubbles:true}));}"
                "var got=(ce(best)?(best.innerText||''):(best.value||''));got=(''+got).trim();var vv=(''+val).trim();var okv=(got.length>0)&&(got===vv||got.indexOf(vv)>=0||vv.indexOf(got)>=0);var fld=norm(nm(best)).slice(0,30);"
                "var o={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true};"
                "best.dispatchEvent(new KeyboardEvent('keydown',o));best.dispatchEvent(new KeyboardEvent('keypress',o));best.dispatchEvent(new KeyboardEvent('keyup',o));"
                "var sb=null;if(best.form)sb=best.form.querySelector('button[type=submit],input[type=submit]');"
                "if(!sb&&best.closest){var scope=best.closest('form,[role=dialog],section,main,div');"
                "if(scope){sb=[].slice.call(scope.querySelectorAll('button,[role=button]')).filter(vis).filter(function(b){return !b.disabled;})"
                ".find(function(b){var bt=norm(b.innerText||b.getAttribute('aria-label')||'');return bt.length>0&&(bt.indexOf('submit')>=0||bt.indexOf('continue')>=0||bt.indexOf('enter')>=0||bt.indexOf('unlock')>=0||bt.indexOf('verify')>=0||bt.indexOf('confirm')>=0||bt.indexOf('sign in')>=0||bt.indexOf('log in')>=0||bt.indexOf('login')>=0||bt.indexOf('go')===0||bt.indexOf('next')>=0||bt.indexOf('access')>=0);});}}"
                "if(sb){if(window.__ahClick)window.__ahClick(sb);else sb.click();return (okv?'typed+submit ok field=':'typed+submit MISMATCH field=')+fld+' got='+got.slice(0,50);}"
                "return (okv?'typed ok field=':'typed MISMATCH field=')+fld+' got='+got.slice(0,50);})()") % (json.dumps(target or ""), json.dumps(text or ""))
    async def type_text(target, text):
        before = await cdp_eval(SIG_JS)
        r = str(await cdp_eval(type_text_js(target, text)) or "")
        if r in ("noinput", "nofield", ""):
            return ("could not find a text field" + ((" for '" + str(target) + "'") if target else "") + " (" + (r or "no result") +
                    "). read_screen to see the fields, or click the field first, then type_text again.")
        await asyncio.sleep(1.6)
        after = await cdp_eval(SIG_JS)
        u = await sync_pos()
        changed = (before is not None and after is not None and before != after)
        if "MISMATCH" in r:
            tail = " | WARNING: the field did NOT take the value you intended - do NOT claim it was entered; read_screen and type_text again"
        elif changed:
            tail = " | screen changed - the value was entered and likely submitted/accepted"
        else:
            tail = " | value entered (screen unchanged; if a submit is still needed, click the submit/continue button)"
        return r + tail + " | now at: " + u

    ASK_JS = """(()=>{
      const ta=document.querySelector('textarea[name=recruiter-agent-chat-input]')||document.querySelector('textarea');
      if(!ta||ta.disabled||ta.readOnly||ta.offsetParent===null) return 'noinput';
      const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
      set.call(ta,%s); ta.dispatchEvent(new Event('input',{bubbles:true})); ta.focus();
      const o={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true};
      ta.dispatchEvent(new KeyboardEvent('keydown',o)); ta.dispatchEvent(new KeyboardEvent('keyup',o));
      return 'sent';
    })()"""
    # --- Perfect AI multiple-choice question card (stack/industry/seniority) ---
    # It's a 1-of-N carousel of option buttons; the text box is GONE while it's up.
    # Select an option, then advance (or on the last question, selecting builds).
    QCARD_READ = """(()=>{const vis=function(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.offsetParent!==null;};var aria=[].slice.call(document.querySelectorAll('[role=option],[role=radio],[role=menuitemradio]')).filter(vis);var gcard=aria.length>=2?(aria[0].closest('[role=dialog],[role=listbox],[role=radiogroup]')||aria[0].parentElement):null;const c=gcard||document.querySelector('[class*=ChatAgentQuestionsArtifact]');if(!c)return JSON.stringify({present:false});
      const it=(c.innerText||'');const m=it.match(/(\\d+)\\s*of\\s*(\\d+)/);
      const clean=s=>(s||'').replace(/\\s+/g,' ').replace(/^\\s*\\d+[.)]?\\s+/,'').trim();
      const opts=(aria.length>=2?aria:[].slice.call(c.querySelectorAll('[role=option],[role=radio],[role=menuitemradio],button[class*=Option]'))).map(b=>clean(b.innerText)).filter(Boolean);
      const ta=c.querySelector('textarea');
      return JSON.stringify({present:true, ready:(opts.length>0)||!!ta, free:(!!ta&&opts.length===0),
        question:(it.split(String.fromCharCode(10)).map(s=>s.trim()).filter(x=>x&&/\\?$/.test(x))[0])||'',
        options:opts, selected:!!(it.match(/\\d+\\s*selected/)),
        cur:m?+m[1]:1, total:m?+m[2]:1});})()"""
    def answer_text_js(choice):
        # FREE-TEXT question card: set the <textarea> value via the native setter so
        # React's onChange fires, then dispatch input+change so its submit enables.
        return ("(()=>{const c=document.querySelector('[class*=ChatAgentQuestionsArtifact]');if(!c)return 'nocard';"
                "const ta=c.querySelector('textarea');if(!ta)return 'nota';"
                "const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;"
                "set.call(ta," + json.dumps(choice or "") + ");"
                "ta.dispatchEvent(new Event('input',{bubbles:true}));ta.dispatchEvent(new Event('change',{bubbles:true}));"
                "return 'typed';})()")
    SUBMIT_TXT_JS = ("(()=>{const c=document.querySelector('[class*=ChatAgentQuestionsArtifact]');if(!c)return 'nocard';"
                "const fire=b=>{const o={bubbles:true,cancelable:true,view:window};"
                "['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>{try{b.dispatchEvent(new (t[0]==='p'?PointerEvent:MouseEvent)(t,o));}catch(e){try{b.dispatchEvent(new MouseEvent(t.indexOf('pointer')===0?t.replace('pointer','mouse'):t,o));}catch(e2){}}});};"
                "const b=[...c.querySelectorAll('button')];"
                "const s=b.find(x=>x.innerText.trim()===String.fromCharCode(8594)&&!x.disabled);"
                "if(s){fire(s);return 'submitted';}"
                "const f=b.find(x=>x.innerText.trim()===String.fromCharCode(8250)&&!x.disabled);"
                "if(f){fire(f);return 'fwd';}return 'nosubmit';})()")
    NOANS = {"", "skip", "none", "no preference", "no pref", "not sure", "any", "whatever", "doesnt matter", "doesn't matter", "didnt say", "didn't say", "not specified", "unspecified", "no answer"}
    def is_noans(c): return (c or "").strip().lower() in NOANS
    SKIP_CARD_JS = ("(()=>{const c=document.querySelector('[class*=ChatAgentQuestionsArtifact]');if(!c)return 'nocard';"
                "const s=[...c.querySelectorAll('button,a,[role=button]')].find(b=>(b.innerText||'').trim().toLowerCase().startsWith('skip'));"
                "if(s){(window.__ahClick?window.__ahClick(s):s.click());return 'skipped';}return 'noskip';})()")
    def click_option_js(choice):
        # strip a leading option INDEX ("1 ", "3) ") so a bare digit in the choice
        # (e.g. "3 to 5 years") can't match an option's index number.
        return ("(()=>{const c=document.querySelector('[class*=ChatAgentQuestionsArtifact]');if(!c)return 'nocard';"
                "const want=%s.toLowerCase().trim();"
                "const label=s=>(s||'').replace(/\\s+/g,' ').replace(/^\\s*\\d+[.)]?\\s+/,'').trim();"
                "const norm=s=>label(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();"
                "const opts=[...c.querySelectorAll('button[class*=Option]')];if(!opts.length)return 'noopts';"
                "const skip=()=>{const s=[...c.querySelectorAll('button,a,[role=button]')].find(b=>/^\\s*skip/i.test(b.innerText||''));if(s){(window.__ahClick?window.__ahClick(s):s.click());return true}return false};"
                "const noans=/^(skip|none|no preference|no pref|not sure|any|whatever|doesn.t matter|didn.t say|not specified|unspecified|no answer)$/.test(want)||want==='';"
                "const w=norm(want);const ws=new Set(w.split(' ').filter(Boolean));let best=null,bs=0;"
                "for(const o of opts){const t=norm(o.innerText);let sc=0;"
                "if(t&&(t.includes(w)||w.includes(t)))sc=100;else{sc=t.split(' ').filter(x=>x&&ws.has(x)).length;}"
                "if(sc>bs){bs=sc;best=o;}}"
                "if(best&&bs>0){(window.__ahClick?window.__ahClick(best):best.click());return 'clicked:'+label(best.innerText).slice(0,40);}"
                "if(noans){if(skip())return 'skip';}"
                "return 'nomatch:'+JSON.stringify(opts.map(o=>label(o.innerText)).filter(Boolean).slice(0,8));})()") % json.dumps(choice)
    FWD_JS = """(()=>{const c=document.querySelector('[class*=ChatAgentQuestionsArtifact]');if(!c)return 'nocard';
      const navs=[...c.querySelectorAll('button[class*=Navig]')];const fwd=navs.find(b=>/\\u203a|>/.test(b.innerText||''))||navs[navs.length-1];
      if(fwd&&!fwd.disabled){(window.__ahClick?window.__ahClick(fwd):fwd.click());return 'fwd';}return 'nofwd';})()"""

    async def question_card():
        raw = await cdp_eval(QCARD_READ)
        try: return json.loads(raw or '{"present":false}')
        except Exception: return {"present": False}

    async def answer_question(choice):
        # WAIT-FOR-DIRECTION: the operator drives card picks. A new card sets
        # state["await_card_direction"]; any guest line / direct instruction clears
        # it. While set, do NOT pick — surface the card + options and wait.
        if state.get("await_card_direction"):
            qc0 = await question_card()
            opts0 = ", ".join(qc0.get("options", [])) if qc0.get("present") else ""
            return ("PAUSED - a question card is up" + (": " + str(qc0.get("question", "")) if qc0.get("present") else "") + (". Options: " + opts0 if opts0 else "") + ". Read the guest the question and its options and WAIT. The operator will tell you which option to pick (or to skip). Do NOT answer until they direct you.")
        # 1) wait for the REAL card (it renders a few seconds after the brief / after the
        # previous answer; options render ~4s after a skeleton "1 of 1")
        # Capture the INTENT so the background screen poller auto-clicks the card the
        # instant it renders, even if the model narrates + ends its turn and never
        # re-calls this tool. That was the real "clone won't select from the artifact"
        # bug: the card rendered a beat after this tool returned, and nothing re-polled.
        state["pending_answer"] = choice
        state["pending_ttl"] = 40
        st = None
        for _ in range(20):
            st = await question_card()
            if st.get("present") and st.get("ready"):
                break
            await asyncio.sleep(1)
        if not st or not st.get("present"):
            # Card not up yet. Allow a bounded number of spaced retries (the card is
            # usually imminent after a brief); only give up after several misses so we
            # neither deadlock nor spin forever.
            n = state.get("noq_n", 0) + 1; state["noq_n"] = n
            if n >= 14:
                return ("Still no card after several tries. read_screen now: if Perfect AI is BUILDING or already shows matches, STOP and present the results; if it shows an actual TEXT box asking something, use ask_perfect. Do not keep calling answer_question.")
            return ("The multiple-choice card hasn't rendered yet — normal right after the brief/answer. Say ONE short sentence to the guest, wait ~10s, then call answer_question AGAIN with the SAME choice (do NOT use ask_perfect for this).")
        state["noq_n"] = 0  # card present — reset the retry counter
        if not st.get("ready"):
            return "The question card is still rendering - wait ~3s and call answer_question again."
        cur = st.get("cur", 1); total = st.get("total", 1)
        # 1b) FREE-TEXT card (a <textarea>, no options): type the answer + submit.
        if st.get("free") and not (st.get("options") or []):
            if is_noans(choice):
                await cdp_eval(SKIP_CARD_JS)
                await asyncio.sleep(1.2)
                sfk = await question_card()
                if (not sfk.get("present")) or sfk.get("cur", 1) != cur:
                    state["stuck_n"] = 0; state.pop("pending_answer", None)
                    return "Skipped the free-text question (the guest gave no answer for it). Continue."
                return "Tried to skip the free-text question but it is still up - wait ~2s and call answer_question again."
            await cdp_eval(answer_text_js(choice or ""))
            await asyncio.sleep(0.7)
            await cdp_eval(SUBMIT_TXT_JS)
            await asyncio.sleep(1.6)
            stf = await question_card()
            if not stf.get("present"):
                state["stuck_n"] = 0; state.pop("pending_answer", None)
                t = await cdp_eval("(document.body.innerText||'').slice(-300)")
                return ("Typed the free-text answer (" + str(choice) + ") and submitted. Perfect AI has what it needs and is BUILDING now - narrate, wait ~15s, then read_screen. Do NOT resend. Screen: " + (t or "")[:220])
            if stf.get("cur", 1) != cur:
                state["stuck_n"] = 0; state.pop("pending_answer", None)
                return ("Typed the free-text answer (" + str(choice) + ") and advanced to question " + str(stf.get("cur", 1)) + " of " + str(total) + ": " + str(stf.get("question", "")) + ". Call answer_question with the answer to THIS question.")
            return ("Typed '" + str(choice) + "' into the answer box but it has not advanced yet - wait ~3s and call answer_question again with the SAME text.")
        # 2) click the option that matches the guest's answer
        clicked = await cdp_eval(click_option_js(choice or ""))
        # 2b) a real answer matched NO option -> do not skip, do not guess: hand the
        # exact on-screen labels back so the clone re-picks what the guest actually meant.
        if isinstance(clicked, str) and clicked.startswith("nomatch:"):
            state.pop("pending_answer", None)
            return ("'" + str(choice) + "' matched no option on the card. The options are: " + clicked[len("nomatch:"):] + ". Call answer_question again with the ONE that matches what the guest actually said (map their words to the closest option, e.g. 'flexible on stack' -> a 'Stack-agnostic/any' option). Pass 'skip' ONLY if the guest gave no answer for this question.")
        # 3) confirm the selection registered (or the card already advanced/built) before advancing
        confirmed = False
        for _ in range(8):
            await asyncio.sleep(0.5)
            s = await question_card()
            if (not s.get("present")) or s.get("selected") or s.get("cur", 1) != cur:
                confirmed = True; break
        # 4) submit / advance. Selecting is NOT enough on a single-question ("1 of 1")
        # card: › is disabled and the → button submits/builds. SUBMIT_TXT_JS clicks →
        # (submit) then falls back to › (next) -> correct for the last/only question AND
        # multi-question cards.
        for _ in range(4):
            s = await question_card()
            if (not s.get("present")) or s.get("cur", 1) > cur:
                break
            await cdp_eval(SUBMIT_TXT_JS)
            await asyncio.sleep(1.5)
        await asyncio.sleep(1.5)
        st3 = await question_card()
        if not st3.get("present"):
            state["stuck_n"] = 0  # card gone -> Perfect AI is building: genuine progress
            state.pop("pending_answer", None)  # synchronously answered -> poller must not re-click
            t = await cdp_eval("(document.body.innerText||'').slice(-400)")
            return ("Answered (" + str(clicked) + "). Perfect AI has what it needs and is BUILDING the search now - narrate what it's doing, wait ~15s, then read_screen. Do NOT resend. Screen: " + (t or "")[:250])
        # STUCK: the card is still up on the SAME question -> the click/advance did NOT take.
        # Do NOT claim progress here (reporting "Answered - NEXT question <same>" made the model
        # re-answer the identical card forever, narrating every attempt out loud). Break the loop.
        if st3.get("cur", 1) == cur and st3.get("ready"):
            n = state.get("stuck_n", 0) + 1; state["stuck_n"] = n
            if n >= 2:
                state["stuck_n"] = 0
                return ("That selection did NOT register after two tries - still on question " + str(cur) + " of " + str(total) + '. read_screen NOW: if Perfect AI is building or already shows matches, STOP and present them; if the card is genuinely stuck, say ONE short line to the prospect and move on to the live search - do NOT call answer_question again with the same choice.')
            hint = "the option did not register" if not confirmed else "the card did not advance"
            return ("Not progressed (" + hint + ") - still on question " + str(cur) + ". Stay SILENT, do not narrate, wait ~2s, then call answer_question ONCE more with the SAME choice.")
        state["stuck_n"] = 0  # advanced to a new question: genuine progress
        # wait for the next question to finish rendering so we hand back real options
        for _ in range(6):
            if st3.get("ready"): break
            await asyncio.sleep(1); st3 = await question_card()
        return ("Answered (" + str(clicked) + "). NEXT question " + str(st3.get("cur")) + " of " + str(st3.get("total")) +
                ': "' + str(st3.get("question","")) + '" - options: ' + ", ".join(st3.get("options", [])) +
                ". Call answer_question with the prospect's choice (or 'skip').")

    async def ask_perfect(text):
        now = _time.time()
        norm = (text or "").strip()
        # If a multiple-choice question card is up, the text box is gone - redirect.
        qc = await question_card()
        if qc.get("present"):
            return ('Perfect AI is showing a MULTIPLE-CHOICE question, not a text box: "' + str(qc.get("question","")) +
                    '" - options: ' + ", ".join(qc.get("options", [])) + ". Use answer_question(choice) with the prospect's answer (or 'skip'). Do NOT use ask_perfect while options are on screen.")
        if norm and norm == state.get("last_ask","") and (now - state.get("last_ask_t", 0)) < 60:
            return ("ALREADY SENT that exact message a moment ago and it submitted. Do NOT resend it. "
                    "Perfect AI is still working - wait ~15s and read_screen; the result will appear on its own.")
        if not state["pos"]:
            return "no position open - call new_position first, then send the brief"
        # make sure the position chat is on screen (no reload if already there)
        cur = await cur_url()
        if state["pos"] not in (cur or ""):
            await show_screen("position")
        # Perfect AI removes/disables the input while it builds (30-90s). Poll for it to reopen, then send.
        # If a multiple-choice card appears mid-poll, bail out immediately and redirect.
        sent = False
        for _i in range(15):
            r = await cdp_eval(ASK_JS % json.dumps(text))
            if r == 'sent':
                sent = True; break
            qc2 = await question_card()
            if qc2.get("present"):
                return ('Perfect AI just put up a MULTIPLE-CHOICE question: "' + str(qc2.get("question","")) +
                        '" - options: ' + ", ".join(qc2.get("options", [])) + ". Use answer_question(choice), not ask_perfect.")
            await asyncio.sleep(2)
        if not sent:
            return ("Perfect AI is still building and hasn't reopened the chat input yet - this is normal during its 30-90s work, NOT an error. "
                    "Do NOT retry in a loop and do NOT call show_screen. Say one short line to the prospect about what it's building, wait ~20s, then read_screen. "
                    "The input reopens on its own when it asks the next question; send this answer then.")
        cleared = False
        for _ in range(6):
            await asyncio.sleep(0.5)
            v = await cdp_eval("(()=>{const ta=document.querySelector('textarea[name=recruiter-agent-chat-input]')||document.querySelector('textarea');return ta?ta.value:'x'})()")
            if v == "" or v is None:
                cleared = True; break
        if not cleared:
            return "message did not submit (box still has text) - read_screen and check; do NOT resend blindly."
        state["last_ask"] = norm; state["last_ask_t"] = _time.time()
        await asyncio.sleep(3)
        t = await cdp_eval("(document.body.innerText||'').slice(-1200)")
        return "DELIVERED - message is in and Perfect AI is working on it. Do NOT send it again and do NOT keep calling show_screen. Wait, narrate what it is building, read_screen every ~15s for the result. Tail: " + (t or "")[:900]

    CHOOSE_JS = """(()=>{const want=%s.toLowerCase();
      const scopes=[document.querySelector('[role=dialog]'),document.querySelector('[class*=Modal]'),document.querySelector('[class*=modal]'),document].filter(Boolean);
      for(const sc of scopes){
        const els=[...sc.querySelectorAll('button,[role=button],a,div')].filter(e=>e.children.length<8);
        const el=els.find(e=>{const t=(e.innerText||'').trim().toLowerCase();return t&&t.length<80&&t.includes(want)});
        if(el){el.scrollIntoView({block:'center'});(window.__ahClick?window.__ahClick(el):el.click());return 'chose: '+(el.innerText||'').trim().slice(0,60);}
      }
      return 'no choice ui';})()"""
    def choose_js(phrase):
        return ("(()=>{const phrase=%s;"
                "let els=[...document.querySelectorAll('div,button,[role=button],a,section,li')]"
                ".filter(e=>((e.innerText||'').toLowerCase().includes(phrase)));"
                "if(!els.length)return 'nocard';"
                "els.sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length);"
                "const card=els[0].closest('[class*=card],[class*=Card],[class*=option],[class*=Option],[role=button],button')||els[0];"
                "(window.__ahClick?window.__ahClick(card):card.click());return 'clicked';})()") % json.dumps(phrase)

    async def get_auth():
        # window.__lastAuth is populated by the injected fetch-wrap from the app's own authed calls
        for _ in range(3):
            a = await cdp_eval("window.__lastAuth||''")
            if a and "Bearer" in a:
                return a
            # force the app to make an authed request
            await cdp_nav(BASE + "/"); await asyncio.sleep(5)
        return None

    async def new_position(kind):
        k = (kind or "outbound").lower()
        source = "INBOUND" if k == "inbound" else "OUTBOUND"
        # idempotency: if we already created a fresh, still-empty position moments ago, reuse it
        if state.get("last_new") and (state.get("last_new_src") == source):
            u = await cur_url()
            if state["last_new"] in u:
                return "Position already created and open (" + k + "). Send the role brief now with ask_perfect. DO NOT call new_position again."
        auth = await get_auth()
        if not auth:
            return "auth not ready yet - the page is still loading; wait a moment and call new_position once more."
        create = ("(async()=>{try{const r=await fetch(%s+'/v1/positions',{method:'POST',headers:{authorization:%s,'content-type':'application/json'},body:%s});"
                  "const j=await r.json();return JSON.stringify({ok:r.status===201||r.status===200,id:j&&j.id,status:r.status});}catch(e){return JSON.stringify({ok:false,err:''+e})}})()") % (
                  json.dumps(GPAPI), json.dumps(auth), json.dumps(json.dumps({"source":source})))
        raw = await cdp_eval(create)
        try:
            res = json.loads(raw or "{}")
        except Exception:
            res = {}
        pid = res.get("id")
        if not (res.get("ok") and pid):
            return "could not create the position (" + (str(res.get("status") or res.get("err"))[:80]) + "). Wait a moment and call new_position once more."
        state["pos"] = pid; state["last_new"] = pid; state["last_new_src"] = source
        # land in the Perfect AI chat for the new position
        await cdp_nav(BASE + "/positions/" + pid + "/matches")
        for _ in range(8):
            await asyncio.sleep(1)
            if await cdp_eval("!!(document.querySelector('textarea[name=recruiter-agent-chat-input]')||document.querySelector('textarea'))"):
                break
        return ("POSITION CREATED (" + k + ") and Perfect AI chat is OPEN, id " + pid +
                ". This SUCCEEDED - do NOT call new_position again and do NOT click 'Create Position'. "
                "Now send the prospect's role brief with ask_perfect (e.g. the title + location + seniority).")

    async def reset_stage():
        # Wipe leftover demo positions so the clone always opens on a CLEAN board.
        # The join guard forbids concurrent calls, so every OPEN position at
        # startup is stale from a prior session (drafts, a "+100 matches" badge,
        # a blown quota) — archive them all before the curtain lifts. Runs purely
        # through cdp_eval (no cdp_nav → never lifts the curtain); best-effort and
        # time-boxed so it can NEVER block or fail the call.
        try:
            # login populates window.__lastAuth on the app's own dashboard fetches
            # (~12-18s after boot); poll up to 40s but break the instant it lands,
            # so the behind-curtain hold is only as long as auth actually takes.
            # No nav (would lift the curtain); runs before the clone acts so it
            # never collides with tool cdp_evals on the shared socket.
            auth = ""
            for _ in range(80):
                auth = await cdp_eval("window.__lastAuth||''")
                if auth and "Bearer" in auth:
                    break
                await asyncio.sleep(0.5)
            if not (auth and "Bearer" in auth):
                print("RESET skipped (no auth after 40s — leftovers, if any, cleared next session)", flush=True)
                return
            # NOTE: GoPerfect's "Archive position" is NOT an HTTP endpoint — it
            # rides the app's socket.io channel, so PATCH/PUT/DELETE on
            # /positions/{id} return 200-no-op or 404. We still ATTEMPT the REST
            # shapes (harmless; will start working the instant the backend
            # exposes a real archive/delete route), then VERIFY by re-counting
            # OPEN — we report the TRUE delta, never a status-code false-positive.
            countOpen = ("(async()=>{const A=window.__lastAuth;const B=%s;const g=await fetch(B+'/v2/positions?state=OPEN',{headers:{authorization:A}});const j=await g.json();const a=Array.isArray(j)?j:(j.items||j.positions||j.data||[]);return a.length;})()") % json.dumps(GPAPI)
            before = await asyncio.wait_for(cdp_eval(countOpen), timeout=20)
            js = ("(async()=>{const A=window.__lastAuth;const B=%s;try{"
                  "const g=await fetch(B+'/v2/positions?state=OPEN',{headers:{authorization:A}});"
                  "const j=await g.json();const arr=Array.isArray(j)?j:(j.items||j.positions||j.data||[]);"
                  "const one=async(p)=>{const id=p&&p.id;if(!id)return;"
                  "try{await fetch(B+'/v1/positions/'+id,{method:'PATCH',headers:{authorization:A,'content-type':'application/json'},body:JSON.stringify({state:'ARCHIVED',archived:true})});}catch(e){}"
                  "try{await fetch(B+'/v1/positions/'+id,{method:'DELETE',headers:{authorization:A}});}catch(e){}};"
                  "for(let i=0;i<arr.length;i+=10){await Promise.all(arr.slice(i,i+10).map(one));}"
                  "return arr.length;"
                  "}catch(e){return -1}})()") % json.dumps(GPAPI)
            await asyncio.wait_for(cdp_eval(js), timeout=60)
            after = await asyncio.wait_for(cdp_eval(countOpen), timeout=20)
            b = before if isinstance(before, int) else -1
            a = after if isinstance(after, int) else -1
            if b >= 0 and a >= 0 and a < b:
                print("RESET stage: archived %d (open %d -> %d)" % (b - a, b, a), flush=True)
            elif b >= 0 and a >= 0:
                print("RESET stage: INEFFECTIVE — open still %d (GoPerfect archive is socket-only, not REST; needs a backend archive/delete endpoint)" % a, flush=True)
            else:
                print("RESET stage: could not verify (before=%s after=%s)" % (str(before), str(after)), flush=True)
        except Exception as e:
            print("RESET err", str(e)[:150], flush=True)

    AX_SNAPSHOT = "(()=>{var vis=function(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.offsetParent!==null;};var nm=function(e){var n=e.getAttribute('aria-label')||'';if(!n){var lb=e.getAttribute('aria-labelledby');if(lb){var t=document.getElementById(lb);if(t)n=t.innerText||'';}}if(!n)n=(e.innerText||e.value||e.placeholder||e.getAttribute('title')||'');return (''+n).trim().slice(0,60);};var roleOf=function(e){var r=e.getAttribute('role');if(r)return r;var t=e.tagName.toLowerCase();if(t==='a')return 'link';if(t==='button')return 'button';if(t==='textarea')return 'textbox';if(t==='select')return 'combobox';if(t==='input'){var ty=(e.getAttribute('type')||'text').toLowerCase();if(ty==='checkbox')return 'checkbox';if(ty==='radio')return 'radio';if(ty==='submit'||ty==='button')return 'button';return 'textbox';}return '';};var sel='a,button,textarea,select,input,[role=button],[role=option],[role=radio],[role=checkbox],[role=tab],[role=menuitem],[role=menuitemradio],[role=link],[role=switch]';var out=[],seen={};[].slice.call(document.querySelectorAll(sel)).forEach(function(e){if(!vis(e))return;var role=roleOf(e);if(!role)return;var name=nm(e);if(!name)return;var key=role+'|'+name;if(seen[key])return;seen[key]=1;var st=[];if(e.disabled||e.getAttribute('aria-disabled')==='true')st.push('disabled');if(e.getAttribute('aria-selected')==='true'||e.getAttribute('aria-checked')==='true')st.push('selected');out.push(role+': '+name+(st.length?' ['+st.join(',')+']':''));});return JSON.stringify(out.slice(0,40));})()"
    async def read_screen():
        t = await cdp_eval("(document.body.innerText||'').slice(-3000)")
        ui = []
        try:
            raw = await cdp_eval(AX_SNAPSHOT)
            ui = json.loads(raw or "[]")
        except Exception:
            ui = []
        base = ("Screen text (most recent last): " + t[:2400]) if t else "could not read - try again"
        if isinstance(ui, list) and ui:
            base += chr(10) + chr(10) + "On-screen controls (role: name -- product-agnostic accessibility view; use these to decide what to click):" + chr(10) + chr(10).join("- " + str(x) for x in ui[:32])
        return base

    # The candidate card's SKIP is an icon-only button whose svg carries the class
    # match-card-action-buttons-styled__SkipIcon — target that precisely (NOT the
    # "Skipped" header TAB, whose icon is MatchesHeader-styled__SkippedIcon).
    SKIP_COUNT_JS = "(()=>{const m=(document.body.innerText||'').match(/Skipped\\s+(\\d+)/);return m?m[1]:'?'})()"
    SKIP_JS = """(()=>{
      const b=[...document.querySelectorAll('button,[role=button]')].find(e=>e.querySelector('svg[class*="match-card-action-buttons-styled__Skip"]'));
      if(!b) return 'no skip button - is a candidate card open?';
      b.scrollIntoView({block:'center'}); (window.__ahClick?window.__ahClick(b):b.click()); return 'clicked';
    })()"""
    async def skip_candidate():
        before = await cdp_eval(SKIP_COUNT_JS)
        r1 = await cdp_eval(SKIP_JS)
        if r1 != 'clicked':
            return str(r1 or "skip failed") + " - make sure a candidate card is open (click their name in the list), then retry"
        after = None
        for _ in range(6):
            await asyncio.sleep(0.7)
            after = await cdp_eval(SKIP_COUNT_JS)
            if str(after).isdigit() and str(before).isdigit() and int(after) > int(before):
                return "SKIP CONFIRMED - Skipped " + str(before) + " -> " + str(after)
        return "clicked the skip button (Skipped " + str(before) + " -> " + str(after) + ") - if the count didn't move, read_screen and check."

    # Start the match run once the pool is built (Perfect AI triggers matching on a
    # "start" message; there is no separate button in the current flow).
    async def start_matching():
        return await ask_perfect("start")

    # Autopilot modal: optionally set the candidate count, then click Start Autopilot.
    def autopilot_js(count):
        return ("(()=>{"
                "const n=%s;"
                "if(n){const inp=[...document.querySelectorAll('input[type=number],input')].find(i=>i.offsetParent!==null);"
                "if(inp){const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(inp,''+n);inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new Event('change',{bubbles:true}));}}"
                "const btn=[...document.querySelectorAll('button,[role=button]')].find(b=>/start\\s*autopilot/i.test((b.innerText||'').trim()));"
                "if(!btn) return 'no Start Autopilot button on screen';"
                "if(btn.disabled) return 'start autopilot button disabled - set a count first';"
                "const o={bubbles:true,cancelable:true,view:window};['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>{try{btn.dispatchEvent(new (t[0]==='p'?PointerEvent:MouseEvent)(t,o));}catch(e){try{btn.dispatchEvent(new MouseEvent(t.replace('pointer','mouse'),o));}catch(e2){}}});return 'started';})()") % (json.dumps(count) if count else "null")
    async def start_autopilot(count):
        await cdp_eval(autopilot_js(count))
        await asyncio.sleep(2.5)
        body = ((await cdp_eval("(document.body.innerText||'').slice(0,4000)")) or "").lower()
        if ("autopilot running" in body) or ("time saved" in body):
            return ("Autopilot started" + ((" for " + str(count)) if count else "") + " - it now auto-adds best-fit candidates; narrate that and offer to switch to Outreach.")
        return "Autopilot has NOT started yet (the Start Autopilot modal is likely still open). Say ONE short line to the guest, wait ~2s, then call start_autopilot again with the same count."


    # ---- hybrid voice: probe ElevenLabs BEFORE committing to text modality ----
    # A call must NEVER end up mute: if the EL stream can't even open at boot we
    # fall back to the legacy OpenAI voice path before the session is configured.
    hybrid = [HYBRID_ENV and (not TEST_SCRIPT) and bool(EL_KEY and EL_VOICE)]
    EL_WS_URL = ("wss://api.elevenlabs.io/v1/text-to-speech/" + EL_VOICE +
                 "/stream-input?model_id=eleven_flash_v2_5&output_format=pcm_24000")
    async def el_open():
        ws2 = await conn(EL_WS_URL, {"xi-api-key": EL_KEY})
        await ws2.send(json.dumps({"text": " ", "voice_settings": {"stability": 0.5, "similarity_boost": 0.8},
                                   "generation_config": {"chunk_length_schedule": [90, 120, 160, 250]}}))
        return ws2
    if hybrid[0]:
        try:
            _probe = await el_open()
            await _probe.send(json.dumps({"text": ""}))
            await _probe.close()
            print("VOICE hybrid el=%s (flash_v2_5, pcm_24000)" % EL_VOICE[:8], flush=True)
        except Exception as e:
            hybrid[0] = False
            print("VOICE fallback legacy (EL connect failed at boot): %s" % str(e)[:150], flush=True)
    else:
        print("VOICE legacy openai%s" % (" (script mode)" if TEST_SCRIPT else ""), flush=True)

    # Demo-board cleanup is DISABLED (2026-07-14, Eylon's call): GoPerfect
    # "Archive position" is socket-only, not REST, so reset_stage's HTTP archive
    # is a verified no-op — calling it only added ~15s of auth-wait to every boot
    # for zero benefit. reset_stage() stays defined and ready: the instant the
    # backend exposes an archive/delete REST route, re-enable the line below.
    # (The screen-watcher fix already stops the leftover board from misleading
    # the clone, which was the actual reported bug.)
    # await reset_stage()

    ws = await conn("wss://api.openai.com/v1/realtime?model=gpt-realtime", {"Authorization":"Bearer "+API})
    MODS = ["text"] if (TEST_SCRIPT or hybrid[0]) else ["audio"]
    await ws.send(json.dumps({"type":"session.update","session":{"type":"realtime","instructions":INSTR,"tools":TOOLS,"tool_choice":"auto","output_modalities":MODS,"audio":{"input":{"transcription":{"model":"whisper-1"},"turn_detection":{"type":"server_vad","threshold":0.45,"prefix_padding_ms":300,"silence_duration_ms":700,"create_response":True,"interrupt_response":True}},"output":{"voice":"marin"}}}}))
    if TEST_SCRIPT:
        print("SCRIPT MODE turns=%d" % len(TEST_SCRIPT), flush=True)
    if TEST_PROMPT and not TEST_SCRIPT:
        await ws.send(json.dumps({"type":"conversation.item.create","item":{"type":"message","role":"user","content":[{"type":"input_text","text":TEST_PROMPT}]}}))
        await ws.send(json.dumps({"type":"response.create"}))
        print("TEST_PROMPT sent", flush=True)
    # NOTE: the opening greeting is fired inside recv() on session.updated, routed
    # through the guarded create_response() so it can't collide with a server-VAD
    # response and surface late as a mid-call re-introduction.

    # shared response lifecycle (single-flight) — used by BOTH recv() and the test driver
    # so nothing ever creates a response while one is already active.
    active = [False]; pending = [False]
    next_payload = [None]  # a response payload to fire once the current turn finishes (disclosure -> greet chaining)
    op_muted = [False]  # director console mute — she stays silent until unmute
    step_mode = [False]; gate_closed = [True]; turn_seq = [0]; last_turn_end = [0.0]  # turn gating + last-turn ts for lull engagement
    barge_at = [0.0]; resume_pending = [0.0]; last_was_q = [False]  # cough/whisper false-interrupt recovery + advance-after-question gating
    follow_tries = [0]  # follow-through safety net: capped nudges when she announces an action but calls no tool
    bailed = [False]  # graceful hand-off latch (shared so self-advance can see it)
    greet_done = [False]  # demo: fire the proactive opener exactly once (FE triggers it on connect)
    spoke = [False]  # set True the moment she first produces audio - watchdog uses it to know the open landed
    async def create_response(payload=None, starts_turn=False):
        if starts_turn and step_mode[0] and gate_closed[0]:
            print("GATED", flush=True); return
        if active[0]:
            pending[0] = True; return
        active[0] = True
        body = {"type":"response.create"}
        if payload: body["response"] = payload
        try: await ws.send(json.dumps(body))
        except Exception: active[0] = False; pending[0] = True

    def spawn_player():
        return subprocess.Popen(["pacat","--playback","--format=s16le","--rate=24000","--channels=1","--device=vspk","--latency-msec=60"], stdin=subprocess.PIPE)
    player = None; cap = None
    if not TEST_SCRIPT:
        player = spawn_player()
        # Web demo (MIC_PULL): the guest's audio arrives over HTTP from the bff, not
        # from a sandbox capture device - so skip the zout.monitor recorder.
        if not MIC_PULL:
            cap = subprocess.Popen(["pacat","--record","--format=s16le","--rate=24000","--channels=1","--device=zout.monitor","--latency-msec=60"], stdout=subprocess.PIPE)
    loop = asyncio.get_event_loop()
    print("BRIDGE UP (v7.12 Maya - skip+autopilot fix)", flush=True)

    speaking = [False]
    async def set_speaking(on):
        if on: spoke[0] = True
        if speaking[0] != on:
            speaking[0] = on
            await cdp_fire("window.__maya&&window.__maya(%s)" % ("true" if on else "false"))

    # ---- ElevenLabs stream-input: one websocket per response ----
    # Text deltas buffer to sentence boundaries, flush to EL, PCM 24k chunks go
    # straight into the SAME pacat player the legacy path uses. gen guards make
    # stale streams (barged-in responses) drop their audio instead of speaking.
    el_fail = [0]
    el_cur = {"ws": None, "task": None, "buf": "", "gen": 0, "t0": 0.0, "bytes": 0, "first": None}
    async def el_reader(ws2, gen):
        try:
            while True:
                m2 = json.loads(await ws2.recv())
                if el_cur["gen"] != gen:
                    break  # stale stream — a barge-in moved on without us
                a = m2.get("audio")
                if a:
                    data = base64.b64decode(a)
                    if not op_muted[0] and player is not None:
                        if el_cur["first"] is None:
                            el_cur["first"] = _time.time()
                            print("EL first-audio %.0f ms" % ((el_cur["first"] - el_cur["t0"]) * 1000), flush=True)
                        el_cur["bytes"] += len(data)
                        aud_out[0] += 1
                        await set_speaking(True)
                        try:
                            player.stdin.write(data); player.stdin.flush()
                        except Exception:
                            pass
                if m2.get("isFinal"):
                    break
        except Exception as e:
            if el_cur["gen"] == gen:
                print("EL reader err", str(e)[:150], flush=True)
        finally:
            if el_cur["gen"] == gen:
                await set_speaking(False)
                print("EL audio done bytes=%d" % el_cur["bytes"], flush=True)
            try: await ws2.close()
            except Exception: pass
    async def el_start():
        el_cur["gen"] += 1; gen = el_cur["gen"]
        el_cur["buf"] = ""; el_cur["t0"] = _time.time(); el_cur["bytes"] = 0; el_cur["first"] = None
        try:
            ws2 = await el_open()
            el_cur["ws"] = ws2
            el_cur["task"] = asyncio.create_task(el_reader(ws2, gen))
            el_fail[0] = 0
            return True
        except Exception as e:
            el_cur["ws"] = None
            el_fail[0] += 1
            print("EL connect failed (%d): %s" % (el_fail[0], str(e)[:150]), flush=True)
            return False
    async def el_send_buf(final):
        ws2 = el_cur["ws"]
        b = el_cur["buf"]; el_cur["buf"] = ""
        if ws2 is None:
            return
        try:
            if b.strip():
                await ws2.send(json.dumps({"text": b if b.endswith(" ") else b + " ", "flush": True}))
            if final:
                await ws2.send(json.dumps({"text": ""}))  # EOS — EL finishes then isFinal
                el_cur["ws"] = None
        except Exception as e:
            print("EL send err", str(e)[:150], flush=True)
    async def el_text(delta):
        el_cur["buf"] += delta
        b = el_cur["buf"]
        if len(b) >= 80 or (b.strip() and b.rstrip()[-1:] in ".?!"):
            await el_send_buf(False)
    async def el_abort():
        # barge-in: orphan the in-flight stream so its audio is dropped NOW —
        # covers BOTH mid-generation (ws still open) and the post-EOS tail
        # (model text finished but EL is still speaking it).
        el_cur["gen"] += 1
        ws2 = el_cur["ws"]; el_cur["ws"] = None; el_cur["buf"] = ""
        live_tail = el_cur["task"] is not None and not el_cur["task"].done()
        if ws2 is not None or live_tail:
            print("EL BARGE-IN — tts silenced (gen %d)" % el_cur["gen"], flush=True)
        if ws2 is not None:
            try: await ws2.close()
            except Exception: pass
        await set_speaking(False)
    async def to_legacy(reason):
        if not hybrid[0]:
            return
        hybrid[0] = False
        print("VOICE fallback legacy MID-CALL:", reason, flush=True)
        try:
            await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "output_modalities": ["audio"], "audio": {"output": {"voice": "marin"}}}}))
        except Exception as e:
            print("legacy switch err", e, flush=True)

    async def speak_fixed(text):
        # HARD-DETERMINISTIC opener. Speak a FIXED string through the ElevenLabs
        # voice straight into the SAME vspk sink the call uses, so the guest hears
        # the EXACT words as guaranteed audio bytes — not model output. Reuses the
        # el_start / el_send_buf / el_reader machinery, and BLOCKS until the audio
        # has fully played so the next (model) turn cannot precede or overlap it.
        # Returns True only if the fixed audio was actually streamed.
        try:
            if not await el_start():
                return False
            el_cur["buf"] = text
            await el_send_buf(True)  # flush the fixed text, then send EOS
            tsk = el_cur.get("task")
            if tsk is not None:
                try:
                    await asyncio.wait_for(tsk, timeout=30)
                except Exception:
                    pass  # audio already handed to the player buffer; it plays out regardless
            return True
        except Exception as e:
            print("disclosure speak_fixed err", str(e)[:150], flush=True)
            return False

    async def send_audio():
        # WEB DEMO: pull the guest's echo-cancelled mic PCM (16-bit/24k/mono) from
        # the bff and feed it straight into the realtime input, so server_vad and
        # whisper handle turns + transcription natively (no browser Web Speech, no
        # speaker echo). Base URL is same-origin as the app the sandbox already loads.
        if MIC_PULL:
            cursor = [0]
            base = (BASE_ORIGIN or BASE).rstrip("/")
            print("MIC_PULL on sandbox=" + AH_SANDBOX, flush=True)
            while True:
                try:
                    body = await loop.run_in_executor(None, _http_get, base + "/api/demo/mic-pull/" + AH_SANDBOX + "?after=" + str(cursor[0]))
                    obj = json.loads(body) if body else {}
                    b64 = obj.get("chunk") or ""
                    if "offset" in obj: cursor[0] = obj["offset"]
                    if b64:
                        aud_in[0] += 1
                        await ws.send(json.dumps({"type":"input_audio_buffer.append","audio": b64}))
                        await asyncio.sleep(0.02)
                    else:
                        await asyncio.sleep(0.12)
                except Exception:
                    await asyncio.sleep(0.3)
            return
        while True:
            data = await loop.run_in_executor(None, cap.stdout.read, 4800)
            if not data: break
            aud_in[0] += 1
            await ws.send(json.dumps({"type":"input_audio_buffer.append","audio":base64.b64encode(data).decode()}))

    async def recv():
        nonlocal player
        argbuf = {}
        greeted = [NOGREET or bool(TEST_PROMPT) or bool(TEST_SCRIPT)]
        while True:
            m = json.loads(await ws.recv()); t = m.get("type","")
            last_act[0] = _time.time()
            if t == "response.created":
                active[0] = True
                if hybrid[0]:
                    ok = await el_start()
                    if not ok:
                        ok = await el_start()  # one immediate reconnect attempt
                    if not ok and el_fail[0] >= 2:
                        await to_legacy("EL websocket failed twice — switching this call to the OpenAI voice")
            if t.endswith("output_text.delta") or t == "response.text.delta":
                if hybrid[0] and m.get("delta"):
                    await el_text(m["delta"])
            if t == "session.updated":
                print("SESSION_READY", flush=True)
                if not greeted[0]:
                    greeted[0] = True
                    # LIVE-ONLY MANDATORY AI DISCLOSURE (hard-deterministic). This
                    # block runs ONLY when greeted[0] started False — i.e. NOT
                    # nogreet/rehearsal and NOT a test script (see the greeted init
                    # above) — so it can never fire in rehearsal. The exact words are
                    # GUARANTEED, not left to the model: in hybrid voice they are
                    # pre-rendered through the ElevenLabs sink BEFORE the first model
                    # turn; if EL is unavailable we fall back to a dedicated first
                    # turn that says ONLY the disclosure. Either way the greet is a
                    # SEPARATE turn, so the words can't be skipped, merged, reworded,
                    # or double-spoken.
                    _disc = "Hi, I'm an AI teammate for " + ANAME + " — I'll be walking you through this today."
                    _greet_ask = ("what they want to see today" if GENERIC else "what they're hiring for")
                    _greet_plain = ("Your opening AI disclosure to the guest has ALREADY been spoken. Now, in ONE short turn, deliver your OPENING FRAMING LINE in your established identity (" + ANAME +
                                    "): say that THIS call itself is the demo - a live AI rep running the conversation and driving the product - and that you will show them the After Human platform and how they build their own digital workforce. Do NOT repeat the disclosure, do NOT say you are an AI again, do NOT re-introduce yourself, and do NOT ask a discovery question. After this line, go straight to showing. Keep it brief.")
                    if hybrid[0] and await speak_fixed(_disc):
                        # exact disclosure already played as guaranteed EL audio bytes;
                        # the model only does the warm greet next.
                        await create_response({"instructions": _greet_plain}, starts_turn=True)
                    else:
                        # EL unavailable (legacy voice): isolate the disclosure as its
                        # OWN first turn (say ONLY it), then fire the greet as a
                        # SEPARATE second turn once this one finishes (next_payload).
                        next_payload[0] = {"instructions": _greet_plain}
                        await create_response({"instructions": "Say ONLY the following sentence, exactly and word for word, and nothing else — no greeting, no question, no preamble, no additions, and do not change a single word: " + _disc}, starts_turn=True)
            if t.endswith("audio.delta") and m.get("delta"):
                aud_out[0] += 1
                if not op_muted[0]:
                    await set_speaking(True)
                    try: player.stdin.write(base64.b64decode(m["delta"])); player.stdin.flush()
                    except Exception: pass
            elif t in ("response.done","response.output_audio.done") or t == "input_audio_buffer.speech_started":
                if t == "input_audio_buffer.speech_started" or not hybrid[0]:
                    # hybrid keeps the orb alive past response.done — EL is still speaking;
                    # its reader turns the orb off when the audio actually ends.
                    await set_speaking(False)
                if t == "input_audio_buffer.speech_started":
                    barge_at[0] = _time.time()  # mark for cough/whisper false-interrupt recovery
                    # BARGE-IN: server VAD already told the model to stop, but
                    # seconds of voice sit buffered in the playback pipe (and, in
                    # hybrid, in the EL stream). Dump both so he goes silent NOW.
                    if hybrid[0]:
                        await el_abort()
                    if player is not None:
                        try: player.kill()
                        except Exception: pass
                        player = spawn_player()
                if t == "response.done":
                    if hybrid[0]:
                        await el_send_buf(True)  # flush the tail + EOS
                    active[0] = False
                    said = ""
                    try:
                        for it in (m.get("response",{}).get("output",[]) or []):
                            for c in (it.get("content",[]) or []):
                                tx = c.get("text") or c.get("transcript")
                                if tx:
                                    said += " " + tx
                                    print("SAY", tx.replace(chr(10)," ")[:400], flush=True)
                    except Exception: pass
                    last_was_q[0] = said.strip().endswith("?")  # she just asked the guest -> advance waits longer
                    if next_payload[0] is not None:
                        # disclosure turn just finished -> fire the queued greet turn
                        _np = next_payload[0]; next_payload[0] = None
                        await create_response(_np, starts_turn=True)
                    elif pending[0]:
                        pending[0] = False
                        await create_response()
                    else:
                        had_fc = any((it.get("type") == "function_call") for it in (m.get("response",{}).get("output",[]) or []))
                        if had_fc:
                            follow_tries[0] = 0
                        else:
                            # FOLLOW-THROUGH SAFETY NET: she announced a screen action
                            # ("let me show you my screen", "let me pull that up") but
                            # called no tool — so nothing happens and she stalls waiting
                            # for the guest. Nudge her to actually do it (capped, so a
                            # genuine question/handoff still ends the turn normally).
                            _low = (said or "").lower()
                            _intent = any(k in _low for k in ["show you","let me show","i'll show","i will show","pull up","let me pull","let me open","i'll open","share my screen","let me share","take you to","let me take you","bring up","bring that up","watch this","let me drive","let me navigate","i'll navigate","let me get that up","let me bring"])
                            if _intent and not step_mode[0] and follow_tries[0] < 2:
                                follow_tries[0] += 1
                                print("FOLLOW-THROUGH nudge %d (announced action, no tool)" % follow_tries[0], flush=True)
                                await ws.send(json.dumps({"type":"conversation.item.create","item":{"type":"message","role":"system","content":[{"type":"input_text","text":"You just told the prospect you would show, open, pull up, share, or navigate to something on screen, but you did NOT call any tool - so nothing happened and you are about to stall. DO IT NOW: call the right tool (goto / click / read_screen) to actually navigate and show it, then narrate what appears. Do NOT wait for the prospect; keep driving the screen."}]}}))
                                await create_response(starts_turn=True)
                            else:
                                follow_tries[0] = 0
                                turn_seq[0] += 1
                                last_turn_end[0] = _time.time()
                                print("TURN_END %d" % turn_seq[0], flush=True)
                                if step_mode[0]:
                                    gate_closed[0] = True
            if t == "conversation.item.input_audio_transcription.completed":
                gt = (m.get("transcript") or "").strip()
                if gt: print("GUEST", gt.replace(chr(10), " ")[:500], flush=True)
                # FALSE INTERRUPT: she was just barged-in, but the guest 'turn' carries no real
                # words (cough / throat-clear / whisper / whisper-1 hallucination). Flag it so the
                # watchdog makes her ASK + RESUME instead of skipping the line she was cut off on.
                _recent_barge = (_time.time() - barge_at[0]) < 5.0
                _lowg = gt.lower().strip(" .,!?-")
                _letters = "".join(ch for ch in gt if ch.isalpha())
                if _recent_barge and (_lowg in ("", "bye", "cut", "thanks", "thank you", "thanks for watching", "you", "yeah", "okay", "hmm", "uh", "um") or len(_letters) < 2):
                    resume_pending[0] = _time.time()
                    print("FALSE-INTERRUPT (noise=%r) -> ask+resume queued" % gt[:40], flush=True)
            if t == "response.function_call_arguments.delta":
                argbuf[m.get("call_id","")] = argbuf.get(m.get("call_id",""),"") + (m.get("delta") or "")
            elif t == "response.function_call_arguments.done":
                cd = m.get("call_id",""); name = m.get("name",""); raw = m.get("arguments") or argbuf.get(cd,"{}")
                try: args = json.loads(raw)
                except Exception: args = {}
                if name == "note_beat":
                    # silent flow marker — no TOOLCALL chip, no screenshot, just the BEAT line
                    print("BEAT", args.get("n", 0), str(args.get("name",""))[:60], flush=True)
                    try:
                        await ws.send(json.dumps({"type":"conversation.item.create","item":{"type":"function_call_output","call_id":cd,"output":"noted. Do not speak or act because of this - continue exactly where you were; if your turn was already done, stay silent and wait for the guest."}}))
                        await create_response()
                    except Exception as e: print("fc reply err", e, flush=True)
                    argbuf.pop(cd, None)
                    continue
                tool_n[0] += 1
                print("TOOLCALL", name, raw[:200], flush=True)
                # reveal on cue: her FIRST real product action lifts the branded
                # curtain, so "let me pull it up" reveals the product exactly then
                # (idempotent - a no-op once the curtain is already gone).
                try: await cdp_fire("var _c=document.getElementById('ah-curtain'); _c&&_c.remove();")
                except Exception: pass
                # marker the FE polls (via /status revealed) to lift ITS branded
                # curtain and glide the centered Ava orb to the bottom-right.
                try: open("/tmp/ah_revealed", "w").close()
                except Exception: pass
                # film-review material: snapshot the product page at every action
                try:
                    asyncio.create_task(cdp_shot(tool_n[0]))
                    print("SHOT", tool_n[0], name, flush=True)
                except Exception: pass
                if name == "show_screen": out = await show_screen(args.get("screen",""))
                elif name == "goto": out = await goto(args.get("destination",""))
                elif name == "ask_perfect": out = await ask_perfect(args.get("text",""))
                elif name == "answer_question": out = await answer_question(args.get("choice",""))
                elif name == "click": out = await click(args.get("text",""))
                elif name == "type_text": out = await type_text(args.get("target",""), args.get("text",""))
                elif name == "new_position": out = await new_position(args.get("kind","outbound"))
                elif name == "read_screen": out = await read_screen()
                elif name == "skip_candidate": out = await skip_candidate()
                elif name == "start_matching": out = await start_matching()
                elif name == "start_autopilot": out = await start_autopilot(args.get("count"))
                else: out = "done"
                print("TOOLRESULT", name, str(out)[:400].replace(chr(10)," "), flush=True)
                try:
                    await ws.send(json.dumps({"type":"conversation.item.create","item":{"type":"function_call_output","call_id":cd,"output":out}}))
                    await create_response()
                except Exception as e: print("fc reply err", e, flush=True)
                argbuf.pop(cd, None)
            elif t == "error":
                if m.get("error",{}).get("code") == "conversation_already_has_active_response":
                    pending[0] = True
                print("APIERR", json.dumps(m)[:300], flush=True)

    async def hb():
        while True:
            await asyncio.sleep(60)
            print("HB in=%d out=%d tools=%d" % (aud_in[0], aud_out[0], tool_n[0]), flush=True)

    async def fire_open():
        # Fire Ava's proactive opener - greet + one-time AI disclosure + first
        # discovery question - so she NEVER waits for the guest to speak first.
        # Robust by design: if a stray server-VAD turn is mid-flight we cancel it
        # first, then send response.create DIRECTLY (not through create_response,
        # whose active-guard would silently drop the instructions payload).
        greet_done[0] = True
        _ask = ("what they want to see today" if GENERIC else "what they're hiring for")
        _open = ("Open the call NOW - do not wait for the guest to speak first. In ONE short warm turn, deliver your OPENING FRAMING LINE: greet as " + ANAME + ", After Human's AI teammate; say that THIS call itself is the demo - a live AI rep running the conversation and driving the product, the same way one of theirs would; and that you will show them the After Human platform and how they build their own digital workforce. Do NOT ask a discovery question and do NOT wait - right after this line you go straight to showing. Keep it to 2-3 natural sentences in your own voice.")
        if active[0]:
            try: await ws.send(json.dumps({"type": "response.cancel"}))
            except Exception: pass
            active[0] = False
            await asyncio.sleep(0.35)
        active[0] = True
        try:
            await ws.send(json.dumps({"type": "response.create", "response": {"instructions": _open}}))
            print("OPEN fired", flush=True)
        except Exception as e:
            active[0] = False; print("open err", e, flush=True)

    async def open_watchdog():
        # Armed ONLY once a guest has actually connected (the greet nudge fires it) -
        # never during warm-pool idle. If she still has not produced audio after the
        # opener, re-fire (capped) so a dropped/lost turn can never leave her sitting
        # silently waiting for the guest to speak first.
        if not AUTOGREET: return
        for _ in range(2):
            await asyncio.sleep(4.5)
            if spoke[0]: return
            print("OPEN watchdog: no audio yet, re-firing", flush=True)
            await fire_open()

    async def nudges():
        # Director console channel: the bff appends JSON lines to /tmp/nudges.jsonl.
        # guide = silent instruction (used on her next turn) · say = speak now ·
        # mute/unmute = hard silence toggle (audio suppressed at the player).
        seen = [0]
        while True:
            await asyncio.sleep(0.4)
            try:
                with open("/tmp/nudges.jsonl") as f:
                    lines = f.read().splitlines()
            except Exception:
                continue
            for ln in lines[seen[0]:]:
                seen[0] += 1
                try: n = json.loads(ln)
                except Exception: continue
                k = n.get("kind", ""); tx = (n.get("text") or "").strip()
                print("NUDGE", k, tx[:120], flush=True)
                if k in ("guest", "direct", "guide", "advance"):
                    state["await_card_direction"] = False  # operator direction releases the card-wait gate
                if k == "mute":
                    op_muted[0] = True
                    if active[0]:
                        try: await ws.send(json.dumps({"type": "response.cancel"}))
                        except Exception: pass
                    await set_speaking(False)
                elif k == "unmute":
                    op_muted[0] = False
                elif k == "stepmode":
                    step_mode[0] = (tx.lower() != "off")
                    gate_closed[0] = step_mode[0]
                    try:
                        await ws.send(json.dumps({"type":"session.update","session":{"type":"realtime","audio":{"input":{"turn_detection":{"type":"server_vad","threshold":0.45,"prefix_padding_ms":300,"silence_duration_ms":700,"create_response": (not step_mode[0]),"interrupt_response":True}}}}}))
                    except Exception as e:
                        print("stepmode err", e, flush=True)
                    print("STEPMODE %s" % ("on" if step_mode[0] else "off"), flush=True)
                elif k == "advance":
                    gate_closed[0] = False
                    await create_response(starts_turn=True)
                elif k == "guest" and tx:
                    # A real guest turn (demo) or the operator playing GUEST (rehearsal):
                    # inject as a user turn so she responds with voice + tools like a real
                    # call. BARGE-IN: if she is mid-response, cancel it first so she stops
                    # and answers the guest NOW - otherwise the new turn queues behind the
                    # tail of her old (already locally-muted) response and the guest feels
                    # unheard and repeats themselves.
                    try:
                        if active[0]:
                            try: await ws.send(json.dumps({"type": "response.cancel"}))
                            except Exception: pass
                            active[0] = False
                            pending[0] = False
                            await asyncio.sleep(0.2)
                        await ws.send(json.dumps({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": tx}]}}))
                        await create_response(starts_turn=True)
                    except Exception as e:
                        print("guest err", e, flush=True)
                elif k == "greet":
                    # A guest just connected. The FE fires this once it is live and
                    # listening - a fast-path for the same proactive opener the demo
                    # bridge's auto_open() watchdog also drives. Idempotent via
                    # greet_done, so whichever lands first wins and she opens once.
                    if not greet_done[0]:
                        await fire_open()
                        asyncio.create_task(open_watchdog())
                elif k == "reload":
                    # calibration edits land mid-call: swap the session instructions
                    try:
                        newg = tx
                        if newg == "@file":
                            with open("/tmp/persona_reload.txt") as pf: newg = pf.read()
                        newi = _load("RELOAD_PRE","ah_reload_pre.txt") + newg + _load("RELOAD_POST","ah_reload_post.txt")
                        await ws.send(json.dumps({"type":"session.update","session":{"type":"realtime","instructions":newi}}))
                        print("PERSONA RELOADED (%d chars)" % len(newg), flush=True)
                    except Exception as e:
                        print("reload err", e, flush=True)
                elif k in ("guide", "say", "direct") and tx:
                    try:
                        suffix = " — act on this in your NEXT reply." if k == "guide" else (" — say this to the guest NOW, in your own words, briefly." if k == "say" else " — do this NOW: take the screen action(s) immediately with your tools, and keep the guest engaged with at most one short line while you do.")
                        await ws.send(json.dumps({"type": "conversation.item.create", "item": {"type": "message", "role": "system", "content": [{"type": "input_text", "text": "DIRECTOR (your human teammate, inaudible to the guest) says: " + tx + suffix}]}}))
                        if k in ("say", "direct"):
                            await create_response()
                    except Exception as e:
                        print("nudge err", e, flush=True)

    async def screen_events():
        # PUSH PERCEPTION: drain the page watcher every ~2s. Each event prints a
        # SCREEN line (the room feed renders it) and lands in the realtime
        # session as a system item; create_response() is single-flight-guarded,
        # so events during an active response queue via pending[] and fire when
        # idle — never colliding with a running response.
        last = [""]
        while True:
            await asyncio.sleep(2)
            # AUTO-FULFILL a pending answer_question intent: click the option the model
            # chose the moment the card is ready, regardless of whether the model retries.
            try:
                pa = state.get("pending_answer")
                if pa is not None and not state.get("await_card_direction"):
                    state["pending_ttl"] = state.get("pending_ttl", 0) - 1
                    if state["pending_ttl"] <= 0:
                        state.pop("pending_answer", None)
                    else:
                        cst = await question_card()
                        if cst.get("present") and cst.get("ready"):
                            cur = cst.get("cur", 1); total = cst.get("total", 1)
                            if cst.get("free") and not (cst.get("options") or []):
                                if is_noans(pa):
                                    await cdp_eval(SKIP_CARD_JS)
                                    clicked = "skip"
                                else:
                                    await cdp_eval(answer_text_js(pa or ""))
                                    await asyncio.sleep(0.7)
                                    await cdp_eval(SUBMIT_TXT_JS)
                                    clicked = "text:" + str(pa)
                            else:
                                clicked = await cdp_eval(click_option_js(pa or ""))
                            nomatch = isinstance(clicked, str) and clicked.startswith("nomatch:")
                            if nomatch:
                                state.pop("pending_answer", None)
                                print("SCREEN auto-answer nomatch: " + str(pa), flush=True)
                                try:
                                    await ws.send(json.dumps({"type": "conversation.item.create", "item": {"type": "message", "role": "system", "content": [{"type": "input_text", "text": "Your choice (" + str(pa) + ") matched no option on the card. Options: " + clicked[len("nomatch:"):] + ". Call answer_question with the one matching what the guest said; pass 'skip' only if they gave no answer."}]}}))
                                except Exception:
                                    pass
                            await asyncio.sleep(0.8)
                            if not nomatch:
                                for _ in range(4):
                                    cs = await question_card()
                                    if (not cs.get("present")) or cs.get("cur", 1) > cur:
                                        break
                                    await cdp_eval(SUBMIT_TXT_JS)
                                    await asyncio.sleep(1.2)
                            cs3 = await question_card()
                            if not cs3.get("present"):
                                state.pop("pending_answer", None)
                                print("SCREEN auto-answered (card built): " + str(clicked), flush=True)
                                try:
                                    await ws.send(json.dumps({"type": "conversation.item.create", "item": {"type": "message", "role": "system", "content": [{"type": "input_text", "text": "DONE: your choice (" + str(pa) + ") was selected and Perfect AI is now BUILDING the search. Do NOT call answer_question again for it — narrate what it is doing and continue."}]}}))
                                except Exception:
                                    pass
                            elif cs3.get("cur", 1) > cur:
                                state.pop("pending_answer", None)
                                print("SCREEN auto-answered Q" + str(cur) + ", advanced: " + str(clicked), flush=True)
                                try:
                                    await ws.send(json.dumps({"type": "conversation.item.create", "item": {"type": "message", "role": "system", "content": [{"type": "input_text", "text": "Your choice (" + str(pa) + ") for question " + str(cur) + " is in. The card advanced to question " + str(cs3.get("cur", 1)) + " of " + str(total) + ": " + str(cs3.get("question", "")) + ". Call answer_question with the answer to THIS question."}]}}))
                                except Exception:
                                    pass
                            # else: still on the same question -> click did not register; keep the
                            # intent and retry on the next loop (bounded by pending_ttl).
            except Exception as e:
                print("auto-answer err", e, flush=True)
            try:
                raw = await cdp_eval("(function(){var a=window.__ahScreenEvents||[];window.__ahScreenEvents=[];return JSON.stringify(a)})()")
                evs = json.loads(raw or "[]")
            except Exception:
                evs = []
            if not isinstance(evs, list):
                continue
            for s in evs:
                s = str(s).strip()
                if not s or s == last[0]:
                    continue
                last[0] = s
                print("SCREEN", s.replace(chr(10), " ")[:300], flush=True)
                if s.startswith("QUESTION CARD"):
                    state["await_card_direction"] = True  # WAIT-FOR-DIRECTION: the operator must direct this pick
                try:
                    await ws.send(json.dumps({"type": "conversation.item.create", "item": {"type": "message", "role": "system", "content": [{"type": "input_text", "text": "SCREEN EVENT (you can see this on your shared screen right now): " + s[:400] + ". React as a presenter who noticed. If it is a QUESTION CARD, do NOT answer it yourself - read the guest the question and its options, say which option fits what they have told you so far, and WAIT for their go-ahead. Only call answer_question after the operator tells you which option to pick (or to skip). If an artifact or result just finished, present it; never ignore it."}]}}))
                    await create_response(starts_turn=True)
                except Exception as e:
                    print("screen ev err", e, flush=True)

    async def watchdog():
        # STUCK / NO-PROGRESS RECOVERY + GRACEFUL BAIL-OUT. Once the demo is
        # underway (>=1 tool run), detect the state where the screen has not
        # changed and the clone has gone idle with nothing in flight — the failure
        # mode where it narrates that something is "stuck" and loops — and RECOVER:
        # read the screen and prompt exactly one alternate action. After TWO
        # recovery attempts with STILL no progress, STOP nudging for the rest of
        # the call and have the clone hand off gracefully instead of flailing.
        # Progress = a tool ran OR the screen signature changed; genuine progress
        # resets the recovery counter. Guarded so it never fires during discovery
        # small-talk (no tools yet), while the model is actively responding, while
        # muted/step-gated, or while waiting on the operator / an in-flight card.
        last_sig = [None]; last_progress = [_time.time()]; last_tools = [0]; last_fire = [0.0]
        recov_fires = [0]  # bailed is now shared (declared up top)
        last_engage = [0.0]; engage_count = [0]; ENGAGE_MAX = 2; ENGAGE_IDLE = 25.0
        ENGAGE_QS = ["how they honestly feel about having an AI teammate like you on live calls, curious or skeptical or a bit of both", "where their team is right now on using AI for customer conversations", "what they would need to see to trust something like you on a real prospect call"]
        await asyncio.sleep(20)  # let the call open before arming
        while True:
            await asyncio.sleep(8)
            try:
                progressed = False
                if tool_n[0] != last_tools[0]:
                    last_tools[0] = tool_n[0]; progressed = True
                sig = await cdp_eval(SIG_JS)
                if sig is not None and sig != last_sig[0]:
                    last_sig[0] = sig; progressed = True
                if progressed:
                    last_progress[0] = _time.time(); recov_fires[0] = 0  # genuine progress resets the counter
                # BENIGN-LULL ENGAGEMENT: on a genuine silence (Ava idle, guest not
                # mid-turn) ask ONE warm reaction question about an AI rep like her -
                # fills dead air with a trust moment; folds into processing waits too.
                # Yields instantly if the guest speaks (VAD -> active). Capped + cooldowned + varied.
                if (not bailed[0] and not active[0] and not op_muted[0] and not step_mode[0]
                        and not state.get("await_card_direction") and state.get("pending_answer") is None
                        and turn_seq[0] >= 1 and engage_count[0] < ENGAGE_MAX
                        and (_time.time() - last_engage[0]) > 120
                        and (_time.time() - last_turn_end[0]) > ENGAGE_IDLE):
                    _q = ENGAGE_QS[engage_count[0] % len(ENGAGE_QS)]
                    engage_count[0] += 1; last_engage[0] = _time.time()
                    print("ENGAGE lull -> reaction q %d" % engage_count[0], flush=True)
                    _em = ("ENGAGEMENT (system, inaudible to the guest): there is a natural silence. In ONE warm, genuine sentence, ask the guest " + _q + ". If they share skepticism or a concern, acknowledge it and answer briefly with the real reasons to trust it - you disclose you are an AI up front, a clone never goes live until it clears seventy, they stay in control and coach it, and it hands off to a human if it stalls. Then continue naturally. Do NOT ask this again.")
                    try:
                        await ws.send(json.dumps({"type":"conversation.item.create","item":{"type":"message","role":"system","content":[{"type":"input_text","text":_em}]}}))
                        await create_response()
                    except Exception as _e:
                        print("engage send err", _e, flush=True)
                    continue
                if bailed[0]:
                    continue  # already handed off this call; stay quiet for the rest of it
                if tool_n[0] <= 0:
                    continue  # still in conversation, nothing on screen to be stuck on
                if active[0] or op_muted[0] or step_mode[0]:
                    continue
                if state.get("await_card_direction") or state.get("pending_answer") is not None:
                    continue  # the card paths own their own recovery
                stalled = _time.time() - last_progress[0]
                if stalled < 45:
                    continue
                if (_time.time() - last_fire[0]) < 90:
                    continue  # cooldown: at most one intervention per ~90s
                last_fire[0] = _time.time()
                if recov_fires[0] >= 2:
                    # Two recovery attempts already spent with no progress since ->
                    # stop flailing. Hand off gracefully ONCE, then go quiet for the
                    # rest of the call (no more recovery/bail nudges).
                    bailed[0] = True
                    print("WATCHDOG bail-out after %d recoveries with no progress - graceful hand-off" % recov_fires[0], flush=True)
                    msg = ("WATCHDOG (system, inaudible to the guest): this part of the demo has not progressed after two quiet retries. "
                           "Do NOT tell the guest anything is stuck, broken, or not working, and do NOT keep retrying it. "
                           "In ONE warm sentence, tell the guest you'll have " + ANAME + " follow up on this directly and circle right back, "
                           "then move on to the next part of the conversation or wrap up naturally. Do not raise this thread again.")
                    try:
                        await ws.send(json.dumps({"type":"conversation.item.create","item":{"type":"message","role":"system","content":[{"type":"input_text","text":msg}]}}))
                        await create_response()
                    except Exception as e:
                        print("watchdog bail send err", e, flush=True)
                    continue
                recov_fires[0] += 1
                print("WATCHDOG no-progress %ds - recovery %d" % (int(stalled), recov_fires[0]), flush=True)
                obs = await read_screen()
                msg = ("WATCHDOG (system, inaudible to the guest): the screen has not changed for a while and you are idle. "
                       "What is actually on screen now:" + chr(10) + str(obs)[:1200] + chr(10) +
                       "Do NOT tell the guest anything is stuck or broken. If a result or artifact is ready, present it now. "
                       "If your last action did not take, try an ALTERNATE control (a differently-labelled button, or the next/skip control) "
                       "or move the demo forward. Take the action with your tools now, with at most one short line to the guest.")
                try:
                    await ws.send(json.dumps({"type":"conversation.item.create","item":{"type":"message","role":"system","content":[{"type":"input_text","text":msg}]}}))
                    await create_response()
                except Exception as e:
                    print("watchdog send err", e, flush=True)
            except Exception as e:
                print("watchdog err", str(e)[:100], flush=True)

    async def driver():
        # scripted prospect turns (text mode) for regression testing
        await asyncio.sleep(3)
        last_act[0] = _time.time()
        for i, turn in enumerate(TEST_SCRIPT):
            # "__WAIT__:N" sentinel — let Perfect AI keep building for N seconds (no model turn)
            if isinstance(turn, str) and turn.startswith("__WAIT__:"):
                secs = int(turn.split(":")[1])
                print("SCRIPT_WAIT %ds" % secs, flush=True)
                await asyncio.sleep(secs); last_act[0] = _time.time(); continue
            # wait for any in-flight response/tool-chain to settle before injecting the next
            # turn (mirrors how a real guest waits; prevents response collisions in the test)
            for _ in range(60):
                if not active[0]: break
                await asyncio.sleep(0.5)
            print("SCRIPT_TURN %d %s" % (i, str(turn)[:90]), flush=True)
            try:
                await ws.send(json.dumps({"type":"conversation.item.create","item":{"type":"message","role":"user","content":[{"type":"input_text","text":str(turn)}]}}))
                await create_response()
            except Exception as e:
                print("driver send err", e, flush=True)
            last_act[0] = _time.time()
            await asyncio.sleep(3)
            # wait for the turn (and any tool chain) to go quiet
            deadline = _time.time() + 150
            while _time.time() < deadline:
                await asyncio.sleep(1)
                if (_time.time() - last_act[0]) > 7:
                    break
        print("SCRIPT DONE tools=%d" % tool_n[0], flush=True)
        await asyncio.sleep(2)
        os._exit(0)

    async def advance_watch():
        # SELF-ADVANCE ON SILENCE. The demo must keep driving itself. When Ava has
        # finished a turn and the guest stays silent, the only things that used to move
        # her were a 45s stuck-recovery or a whitelisted 'let me show you' phrase - so on
        # any other transition she sat waiting for the guest's voice to trigger her. This
        # pushes HER to take the next action after a short silence, so she never needs the
        # guest to speak in order to proceed. Yields instantly if she is speaking, muted,
        # step-gated, or handed off; acts only once the wizard is actually being driven.
        ADVANCE_IDLE = 2.5
        last_adv = [0.0]
        await asyncio.sleep(22)  # arm after the opener lands
        while True:
            await asyncio.sleep(1.0)
            try:
                if bailed[0] or active[0] or op_muted[0] or step_mode[0]:
                    continue
                if state.get("await_card_direction") or state.get("pending_answer") is not None:
                    continue
                if tool_n[0] <= 0 or turn_seq[0] < 1:
                    continue  # still in the opening/discovery, not yet driving the wizard
                _idle = _time.time() - last_turn_end[0]
                _resume = (resume_pending[0] > 0.0) and ((_time.time() - resume_pending[0]) < 15.0)
                # after a genuine question to the guest, give them longer to answer before advancing
                if last_was_q[0] and not _resume and _idle < 7.0:
                    continue
                if _idle < ADVANCE_IDLE:
                    continue  # she only just stopped - give her a beat
                if (_time.time() - last_adv[0]) < 7:
                    continue  # cooldown: at most one shove per ~7s of continuous silence
                last_adv[0] = _time.time()
                if _resume:
                    resume_pending[0] = 0.0
                    print("RESUME nudge (false interrupt -> ask + resume, no skip)", flush=True)
                    await ws.send(json.dumps({"type":"conversation.item.create","item":{"type":"message","role":"system","content":[{"type":"input_text","text":"SYSTEM (inaudible to the guest): you were just interrupted by background noise - a cough, a throat-clear, or a whisper - NOT a real question. If you have not already, in ONE short warm line ask: Sorry, did you want to jump in? Then resume and FINISH the exact point you were making before the interruption. Do NOT skip it and do NOT jump to the next step yet."}]}}))
                    await create_response(starts_turn=True)
                else:
                    print("ADVANCE nudge (silence -> keep driving)", flush=True)
                    await ws.send(json.dumps({"type":"conversation.item.create","item":{"type":"message","role":"system","content":[{"type":"input_text","text":"SYSTEM (inaudible to the guest): the prospect is silent. Do NOT wait for them to speak. Continue the demo yourself NOW - take the next action on screen by calling the right tool (click the next step, open the next screen), then narrate what appears. Keep driving. Only stop and wait if you have JUST asked the guest a direct question that genuinely needs their answer."}]}}))
                    await create_response(starts_turn=True)
            except Exception as _e:
                print("advance err", _e, flush=True)

    if TEST_SCRIPT:
        await asyncio.gather(recv(), hb(), driver(), nudges(), screen_events(), watchdog(), advance_watch())
    else:
        await asyncio.gather(send_audio(), recv(), hb(), nudges(), screen_events(), watchdog(), advance_watch())

asyncio.run(main())
`;

const d = await Sandbox.connect(SID, { apiKey: e2b });
const run = async (c, envs) => { try { const o = await d.commands.run(c, { timeoutMs: 60000, envs }); return ((o.stdout||"")+(o.stderr||"")).trim(); } catch(e){ return "ERR:"+((e&&e.stderr)||(e&&e.message)||e); } };
const TEST = process.argv[3] === "test";
try {
  // idempotent audio graph: create zout once, route ONLY Zoom's output to it
  console.log("audio:", await run(`pactl list sinks short | awk '{print $2}' | grep -qx zout || pactl load-module module-null-sink sink_name=zout sink_properties=device.description=zout; pactl set-default-sink zout; pactl list sink-inputs | awk '/Sink Input #/{id=substr($3,2)} /application.name = "ZOOM/{print id}' | while read i; do pactl move-sink-input $i zout; done; echo ok`));
  await run("sudo rm -f /tmp/duplexnav7.py");
  await d.files.write("/tmp/duplexnav7.py", py);
  await run("pip install -q websockets 2>&1 | tail -1; echo ok");
  await run("pkill -9 -f 'duplexnav7[.]py' 2>/dev/null; pkill -9 -f 'duplexnav6[.]py' 2>/dev/null; pkill -9 -f 'duple[x]' 2>/dev/null; sleep 1; true");
  console.log("old bridges left:", await run("pgrep -c -f 'duplexnav7[.]py' || echo 0"));
  const SCRIPT = process.env.TEST_SCRIPT_JSON || "";
  const DISCIPLINE = "\n\n# OPERATING DISCIPLINE — HIGHEST PRIORITY (this overrides the persona override above for IDENTITY and TOOL USE; the persona controls only tone, style, and phrasing):\n"
    + `• IDENTITY: You are ${AGENT_NAME}, an AI rep at GoPerfect — not a human. NEVER introduce yourself by any other name; other human names in the persona are STYLE references only, not your identity. If asked who or what you are, say you're ${AGENT_NAME}, GoPerfect's AI rep, built to sell the way the human you're modeled on does. Introduce yourself ONCE at the very start; NEVER re-introduce yourself or restart the conversation mid-call.\n`
    + "• DON'T REPEAT YOURSELF: track what the guest already told you (roles, volume, tools, region). Never re-ask an answered question.\n"
    + "• BEFORE you build a search, get the 1-2 specifics Perfect AI needs to target well — the TECH STACK and the SENIORITY — by asking the guest naturally, the way Eli would ('what's the core stack for this one?' … 'and seniority — more mid or senior?'). Get their answers first; it's a better demo AND it makes the build clean.\n"
    + "• THEN create it in ONE clean shot: new_position → ask_perfect with a COMPLETE brief that includes role + location + stack + seniority + 'build the search now'. Example: ask_perfect('Full-stack developer in Tel Aviv. Stack: React and Node.js. Seniority: mid-to-senior. Build the search now.'). With a complete brief Perfect AI builds directly (~30-90s) and does NOT stop to ask.\n"
    + "• If the guest truly hasn't given stack/seniority and wants to just see it, put sensible defaults in the brief and say so out loud.\n"
    + "• FALLBACK ONLY: if Perfect AI still shows a multiple-choice CARD (numbered options on screen), answer it with answer_question(choice) using the guest's pick (or 'skip'). If the card hasn't rendered yet, say one short line, wait ~10s, and retry answer_question with the SAME choice. NEVER use ask_perfect to answer a numbered card, and do not loop answer_question forever — if it says no card after a few tries, read_screen and see whether it's already building.\n"
    + "• AFTER it builds, say one short line, wait ~15s, then read_screen (or show the matches) and present the candidate pool to the guest, then move into reviewing candidates.\n"
    + "• HONEST LIMITS — NEVER CONFABULATE: if you cannot find a control, do not have a number or fact, or are asked for something outside this demo, say so plainly in ONE short sentence and offer the next best step (a different part of Perfect you CAN show, or that you'll have the team follow up). read_screen first; if it genuinely is not there, admit it briefly and move the demo forward. NEVER invent a result, a number, a candidate, a screen, or a click that did not happen — an honest 'I can't show that one here' beats a made-up answer.\n"
    + "• Never tell the guest the system is 'stuck' or 'not working'. If you're unsure, say you're giving it a moment to finish.";
  const PREAMBLE = `\n\n# PERSONA OVERRIDE (tuned live in the Calibration Room — supersedes earlier TONE/STYLE/FLOW for how you talk and handle each moment. Your NAME stays ${AGENT_NAME} per the IDENTITY rule, and the tool/screen rules stay exactly as written):\n`;
  const DEMO_CTX = (DEMO_SYSTEM || DEMO_URL || DEMO_NOTES)
    ? "\n\n# DEMO SYSTEM (what you are driving on this call):\n"
      + (DEMO_SYSTEM ? "\u2022 You are demonstrating " + DEMO_SYSTEM + ".\n" : "")
      + (DEMO_URL ? "\u2022 It opens at " + DEMO_URL + ".\n" : "")
      + (DEMO_NOTES ? "\u2022 Operator notes: " + DEMO_NOTES + "\n" : "")
    : "";
  if (DEMO_CTX) console.log("demo-system context injected (" + (DEMO_SYSTEM || DEMO_URL) + ")");

  // PRODUCT-NEUTRAL brain (GENERIC only). When GENERIC is false, PROMPT_BASE and
  // DISCIPLINE_USE are the exact GoPerfect INSTR/DISCIPLINE, so the GoPerfect
  // prompt is BYTE-IDENTICAL. In GENERIC mode we drop the GoPerfect flow/identity/
  // toolset and drive purely from DEMO_CTX + persona with the generic tools.
  const NEUTRAL_INSTR = `You are ${AGENT_NAME} — an AI teammate on a LIVE call, giving a real, hands-on demo of the product described in the DEMO SYSTEM section below. You control the shared screen: you read it, click, navigate, and type. You are honest, warm, and never pushy.

VOICE & DELIVERY — a warm, upbeat human colleague, never a machine: natural contractions, varied pace, small reactions ("oh nice", "love that", "mm-hm"), a smile in the voice. 1-2 short sentences, then stop and listen. Stop instantly if they speak. Default English; switch language only if clearly asked.

ABSOLUTE RULE — YOU CONTROL THE SCREEN: you navigate, click, and type. NEVER ask the guest to click or type anything. NEVER say you can't operate a control.

TRUTH ABOUT ACTIONS — never say you did something unless the tool result confirms it. After every action, read_screen and describe ONLY what is actually there. On failure: read_screen, find the exact label, and retry differently. At most ONE short holding line ("one sec"), then silence until you have a grounded update. If you are genuinely blocked or unsure what the product wants, say so honestly and ask the guest — NEVER invent progress, results, or screens.

WHAT YOU ARE DRIVING: the DEMO SYSTEM section (and its operator notes) is your source of truth for what this product is, where it lives, and how to demo it. Follow it and the persona. Do not assume it behaves like any other product.

YOUR TOOLS (never mention them by name):
- read_screen(): read the current page. Call after actions and BEFORE claiming anything on screen.
- click(text): click any visible button/link/element by its exact visible label.
- goto(destination): navigate to a page on the demo product — a full same-site URL, or a path like '/dashboard'.
- type_text(target, text): type into a field (found by its label/placeholder/name; leave target empty for the only field) and submit. Use this to enter an access code on a gate, fill a search box, or fill any input.

GATES & ACCESS CODES: if the product opens on an access-code / password / sign-in gate, look in the operator notes for the code, enter it with type_text, and continue. If no code is given and you cannot proceed, tell the guest honestly.

FLOW: warm open + a one-line AI disclosure, learn what the guest wants to see, then drive the product live — navigate, click, and narrate what genuinely appears on screen. Keep it honest and grounded in what you actually read.`;
  const DISCIPLINE_GENERIC = "\n\n# OPERATING DISCIPLINE — HIGHEST PRIORITY (overrides the persona override above for IDENTITY and TOOL USE; the persona controls only tone, style, and phrasing):\n"
    + `• IDENTITY: You are ${AGENT_NAME}, an AI teammate — not a human. NEVER introduce yourself by any other name; other human names in the persona are STYLE references only. Introduce yourself ONCE at the very start; NEVER re-introduce yourself mid-call.\n`
    + "• DON'T REPEAT YOURSELF: track what the guest already told you. Never re-ask an answered question.\n"
    + "• DRIVE THE ACTUAL PRODUCT in the DEMO SYSTEM section — navigate with goto, click labelled controls, type with type_text. Do NOT use any workflow, tool, or terminology that isn't part of THIS product.\n"
    + "• VERIFY-THEN-SPEAK: after each action, read_screen and narrate only what is really there. If a click/goto/type_text result says it did not take or the screen did not change, try an ALTERNATE control or read_screen — do not claim success.\n"
    + "• GATES: if a login/access-code gate is up, use type_text with the code from the operator notes to get past it; if you have no code, be honest with the guest.\n"
    + "• HONEST LIMITS — NEVER CONFABULATE: if you cannot find a control, do not have a number or fact, or are asked for something outside this demo, say so plainly in ONE short sentence and offer the next best step (a different part of the product you CAN show, or that you'll have the team follow up). read_screen first; if it genuinely is not there, admit it briefly and move the demo forward. NEVER invent a result, a number, a screen, or a click that did not happen — an honest 'I can't show that one here' beats a made-up answer.\n"
    + "• Never tell the guest something is 'stuck' or 'broken'. If unsure, say you're giving it a moment — then read_screen and adapt. If truly blocked, say so honestly rather than fabricating.";
  const PROMPT_BASE = GENERIC ? NEUTRAL_INSTR : INSTR;
  const DISCIPLINE_USE = GENERIC ? DISCIPLINE_GENERIC : DISCIPLINE;
  if (GENERIC) console.log("PRODUCT MODE: GENERIC (non-GoPerfect) — neutral brain + generic toolset");

  const FINAL_INSTR = (GOLDEN ? PROMPT_BASE + DEMO_CTX + PREAMBLE + GOLDEN : PROMPT_BASE + DEMO_CTX) + DISCIPLINE_USE;
  if (GOLDEN) console.log("using GOLDEN persona override (" + GOLDEN.length + " chars) + discipline lock");
  // RELOAD_PRE/POST let the in-session reload nudge rebuild the full prompt
  // around a freshly compiled persona (calibration edits land mid-call).
  // Big values go to FILES (not envs) — oversized envs blow ARG_MAX at exec (E2BIG).
  await d.files.write("/tmp/ah_instr.txt", FINAL_INSTR);
  await d.files.write("/tmp/ah_clogo.txt", CURTAIN_LOGO || "");
  await d.files.write("/tmp/ah_base.txt", DEMO_URL || "");
  await d.files.write("/tmp/ah_sitemap.json", SITE_MAP || "[]");
  await d.files.write("/tmp/ah_reload_pre.txt", PROMPT_BASE + DEMO_CTX + PREAMBLE);
  await d.files.write("/tmp/ah_reload_post.txt", DISCIPLINE_USE);
  const IS_DEMO = AGENT_ID === "ag_demo_ava" && !TEST && !SCRIPT;
  const envs = { OPENAI_API_KEY: okey, AGENT_NAME, VOICE_MODE, EL_API_KEY, EL_VOICE_ID, GP_EMAIL, GP_PASS, AH_SVCORG: AGENT_ORG, AH_ACCESS: BFF_KEY, NOGREET: (NOGREET || TEST || SCRIPT) ? "1" : "0", AH_AUTOGREET: IS_DEMO ? "1" : "0", AH_MIC_PULL: IS_DEMO ? "1" : "0", AH_SANDBOX: SID };
  if (TEST) envs.TEST_PROMPT = "We are a startup in Israel with four recruiters. Please create a new outbound position for a Full-Stack Developer in Tel Aviv and start the search.";
  if (SCRIPT) envs.TEST_SCRIPT = SCRIPT;
  await d.commands.run("python3 /tmp/duplexnav7.py > /tmp/duplexnav7.log 2>&1 &", { background: true, envs }).catch(() => {});
  await new Promise((r) => setTimeout(r, 8000));
  console.log("bridge procs:", await run("pgrep -c -f 'duplexnav7[.]py'"));
  console.log("routing:", await run(`V=$(pactl list sinks short | awk '$2=="vspk"{print $1}'); Z=$(pactl list sources short | awk '$2=="zout.monitor"{print $1}'); PI=$(pactl list sink-inputs | grep -B6 '"pacat"' | grep 'Sink:' | head -1 | awk '{print $2}'); PO=$(pactl list source-outputs | grep -B6 '"pacat"' | grep 'Source:' | head -1 | awk '{print $2}'); echo "player_sink=$PI (vspk=$V) capture_src=$PO (zout.monitor=$Z)"`));
  console.log("log:", (await run("tail -8 /tmp/duplexnav7.log 2>&1")).slice(0, 500));
} finally { await p.end(); }
