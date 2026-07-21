// ============================================================
// DEMO TENANT — "Talk to Ava" public demo org (Northwind Staffing).
//
// A rich, pre-seeded org that every prospect sees Ava drive, reset to pristine
// on each lease. This module is the SINGLE source of truth for both the seed
// (apps/bff/src/scripts/seedDemoTenant.ts) and the warm-pool reset path.
//
// HARD SAFETY INVARIANTS:
//   1. Every read/write is scoped to DEMO_ORG_ID. There is no code path that can
//      touch org_legacy (or any other tenant) — assertDemoOrg() throws first.
//   2. We NEVER TRUNCATE. Wipes are org-scoped DELETEs only.
//   3. Idempotent: seed/reset both do wipe-then-reassert inside one transaction
//      under an advisory lock, so re-running (or two concurrent leases) is safe.
//
// Fully-formed so Overview / Roster / Insights / Calibration render rich:
//   - 5 believable Northwind reps across every lifecycle stage (learning →
//     rehearsing → ready-to-review → live), incl. the flagship demoable clone
//     Ava with persona + pinned Live version + voice + verify/red-team/fidelity
//     so her readiness score is high and she can be demoed driving.
//   - Sample Fathom-style call sources/transcripts (fictional but realistic,
//     recruiting/sales context), persona versions, a rehearsal, past ended
//     calls, debriefs, goals, demo-system logins, org integrations, people.
// ============================================================
import { pool, withTx } from "../db/pool.js";
import type { PoolClient } from "pg";
import {
  compileClone,
  DEFAULT_PERSONA_STYLE,
  DEFAULT_AUTHORITY,
  type PersonaSpec,
  type CallPlaybook,
  type CallStage,
} from "@jarvis/shared";
import { sealDemoLogin, agentDemoKey, ORG_DEMO_LOGIN_KEY, type DemoLogin } from "./tenancy.js";

// ---- canonical ids (the coordinator + warm-pool workstream import these) ----
export const DEMO_ORG_ID = "org_demo_northwind";
export const DEMO_AGENT_ID = "ag_demo_ava"; // the host clone Ava drives the demo as
export const DEMO_COMPANY_NAME = "Northwind Staffing";
export const DEMO_OWNER_USER_ID = "usr_demo_northwind";

// Every clone id in the demo roster. Exposed so the pool/coordinator can address
// them and so tests can assert the roster.
export const DEMO_CLONE_IDS = {
  ava: "ag_demo_ava",
  marcus: "ag_demo_marcus",
  priya: "ag_demo_priya",
  diego: "ag_demo_diego",
  hannah: "ag_demo_hannah",
} as const;

// Advisory-lock key unique to the demo-tenant rebuild (distinct from seed.ts's).
const DEMO_LOCK_KEY = 731_020_026;

// Fixed timestamp anchor so the seeded data is deterministic run-to-run (a demo
// should look the same every lease). "now" only used for the audit-ish fields we
// want to read as recent; historical rows are offset from this anchor.
const ANCHOR = Date.parse("2026-07-18T09:00:00.000Z");
const daysAgo = (d: number) => new Date(ANCHOR - d * 86_400_000).toISOString();
const minsAgo = (m: number) => new Date(ANCHOR - m * 60_000).toISOString();

const J = (v: unknown) => JSON.stringify(v);

// Every org-scoped table the demo baseline writes into — the exact set wipe()
// clears (scoped by org_id) before re-asserting. Mirrors the tenancy backfill
// set for the tables we use. calibration_turns is cleared via its session join.
const DEMO_TABLES = [
  "rehearsal_grades",
  "debriefs",
  "live_calls",
  "clone_sources",
  "persona_versions",
  "calibration_sessions", // turns cleared first, below
  "agent_activity",
  "agent_comms",
  "agent_runs",
  "approvals",
  "company_people",
  "integrations",
  "cost_entries",
  "settings",
  "agents",
] as const;

function assertDemoOrg(orgId: string): void {
  if (orgId !== DEMO_ORG_ID) {
    throw new Error(
      `demoTenant refuses to operate on "${orgId}" — it only ever touches ${DEMO_ORG_ID}. ` +
        `This is the guard that keeps the real org_legacy tenant safe.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Persona + playbook builders (produce real PersonaSpec / CallPlaybook shapes)
// ---------------------------------------------------------------------------
function spec(
  identity: { name: string; role: string; self?: string },
  style: Partial<PersonaSpec["style"]>,
  opts: {
    signature?: string[];
    banned?: string[];
    vocab?: string;
    rules?: string[];
    fewShots?: Array<{ situation: string; human_response: string }>;
    boundaries?: string[];
    voiceId?: string | null;
    authority?: { level: "conservative" | "standard" | "empowered"; pricing?: string; product?: string; positioning?: string; commonAnswers?: string };
  } = {},
): PersonaSpec {
  return {
    identity: { name: identity.name, role: identity.role, company: DEMO_COMPANY_NAME, self_description: identity.self ?? "" },
    style: { ...DEFAULT_PERSONA_STYLE, ...style },
    lexicon: {
      signature_phrases: (opts.signature ?? []).map((text) => ({ text, source: "call" })),
      banned_phrases: opts.banned ?? ["As an AI", "I don't have feelings", "Certainly!"],
      vocabulary_notes: opts.vocab ?? "",
    },
    behaviors: {
      rules: (opts.rules ?? []).map((text, i) => ({ id: `rule_${i + 1}`, text, source: "extraction", active: true })),
      escalation: { triggers: ["asked for a discount beyond the band", "legal or contract redline"], action: "offer to bring in the team and set a follow-up" },
    },
    knowledge_boundaries: opts.boundaries ?? [],
    few_shots: (opts.fewShots ?? []).map((f, i) => ({ id: `fs_${i + 1}`, situation: f.situation, human_response: f.human_response, source: "call", active: true })),
    voice: { elevenlabs_voice_id: opts.voiceId ?? null, speaking_rate: 1.0, stability: 0.5 },
    authority: {
      level: opts.authority?.level ?? DEFAULT_AUTHORITY.level,
      facts: {
        pricing: opts.authority?.pricing ?? "",
        product: opts.authority?.product ?? "",
        positioning: opts.authority?.positioning ?? "",
        commonAnswers: opts.authority?.commonAnswers ?? "",
      },
    },
  };
}

function stage(id: string, name: string, goal: string, archetype: CallStage["wireframe"]["archetype"], screenTitle: string, regions: string[], voice: CallStage["voice"], screen: CallStage["screen"], exit?: string): CallStage {
  return { id, name, goal, wireframe: { archetype, screenTitle, regions }, voice, screen, exitCriteria: exit };
}

function playbook(sources: Array<{ id: string; url: string; title: string }>, stages: CallStage[], extra: { facts: string[]; objections: Array<{ objection: string; response: string }>; pricing?: string; closes: Array<{ buyerType: string; close: string }> }): CallPlaybook {
  return {
    sources: sources.map((s) => ({ id: s.id, url: s.url, title: s.title })),
    stages,
    directives: [],
    facts: extra.facts,
    objections: extra.objections,
    pricing: extra.pricing,
    closes: extra.closes,
    generatedAt: daysAgo(9),
    approved: true,
  };
}

// The Northwind recruiting-demo storyboard, reused (with per-role framing) by the
// AE/recruiter clones so their Storyboard/Calibration screens are populated.
function recruitingStages(): CallStage[] {
  return [
    stage("st_open", "Open & frame", "Warm open, confirm the role they're hiring for, set the agenda.", "talk-only", "Welcome", ["greeting", "agenda"],
      { objective: "Build rapport and confirm the hiring need", moves: ["greet by name", "confirm the open role", "state the agenda"], exampleLines: ["Hey Dana, great to finally connect — you're hiring a senior backend engineer, right?", "I'll show you how Northwind sources and screens for that in minutes."], listenFor: ["role title", "seniority", "urgency"] },
      { actions: ["bring up the Northwind dashboard"], waitBehavior: "narrate what the dashboard shows while it loads" }, "role confirmed"),
    stage("st_discover", "Discover the req", "Pull out must-haves, comp band, and timeline.", "form-wizard", "New requisition", ["role fields", "must-haves", "comp"],
      { objective: "Capture the requirement precisely", moves: ["ask for the top 3 must-haves", "confirm comp band", "confirm start date"], exampleLines: ["What are the three things a candidate absolutely must have?", "And the comp band you're working with?"], listenFor: ["skills", "budget", "location", "remote/onsite"] },
      { actions: ["open the new-requisition form", "fill the captured fields"], waitBehavior: "read back each field as it's entered" }, "requirement captured"),
    stage("st_source", "Source & rank", "Run sourcing, show the ranked shortlist, explain the match reasoning.", "list", "Ranked candidates", ["candidate list", "match score", "filters"],
      { objective: "Show a credible ranked shortlist fast", moves: ["start sourcing", "surface the ranked list", "explain top match's reasoning"], exampleLines: ["Give it a few seconds — it's ranking against your must-haves now.", "Top of the list is a 92% match; here's why."], listenFor: ["reaction to top candidates", "objections on fit"] },
      { actions: ["start matching", "bring up the ranked candidate list", "open the top candidate"], waitBehavior: "explain the ranking while results stream in" }, "shortlist reviewed"),
    stage("st_screen", "Screen & outreach", "Show autonomous screening + outreach, tie it back to time saved.", "chat-assistant", "Screening & outreach", ["screening Q&A", "outreach draft", "status"],
      { objective: "Demonstrate autonomous screening and outreach", moves: ["show the screening questions", "show the drafted outreach", "quantify time saved"], exampleLines: ["It screens each one with your questions and drafts the outreach — you just approve.", "That's about six hours of sourcing done before your coffee's cold."], listenFor: ["who approves outreach", "volume", "ATS in use"] },
      { actions: ["open the screening view", "show the outreach draft"], waitBehavior: "keep talking through the value while drafts render" }, "value landed"),
    stage("st_close", "Next steps", "Confirm fit, propose the pilot, set the follow-up.", "talk-only", "Wrap up", ["summary", "next step"],
      { objective: "Convert interest into a concrete next step", moves: ["summarize the fit", "propose a pilot req", "book the follow-up"], exampleLines: ["Want to point it at one live req this week and see real candidates?", "I'll set up a 20-minute follow-up to review the shortlist together."], listenFor: ["yes/maybe", "who else to involve", "timing"] },
      { actions: ["show the pilot summary"], waitBehavior: "" }, "next step agreed"),
  ];
}

// ---------------------------------------------------------------------------
// Roster definition
// ---------------------------------------------------------------------------
type Score = { average: number; cases: number };
type Fidelity = { avg: number; prevAvg: number; topGaps: Array<{ atSec: number; fidelity: number; gap: string }> };

interface CloneDef {
  id: string;
  icon: string;
  name: string;
  role: string;
  department: string;
  status: string;
  statusLabel: string;
  persona: PersonaSpec | null; // null → learning (empty persona, no identity)
  playbook: CallPlaybook | null;
  versionCount: number; // how many persona_versions to write (>=1 if persona)
  goldenAtVersion: number | null; // which version number to pin as Live (null → none)
  voiceId: string | null;
  verify: Score | null;
  redteam: Score | null;
  fidelity: Fidelity | null;
  goals: Array<{ objective: string; metric: string }>;
  sources: Array<{ title: string; url: string; transcript: string; grounded: boolean }>;
  demoLogin: DemoLogin;
}

const NORTHWIND_PRICING =
  "Pilot: $0 for one live requisition (2-week rehearsal-to-live trial). Growth: $1,500 per certified clone / month, up to 15 clones. Starter: $2,000 first clone, $1,500 each additional, up to 3 clones. Enterprise: custom (SSO, dedicated CSM, SLA). Included ~1,500 live-call minutes/clone/month; overage $1.50/minute.";
const NORTHWIND_PRODUCT =
  "Northwind Staffing runs on After Human: AI teammates cloned from your best recruiters that source, rank, screen, and run live intake/demo calls. Outbound sourcing, inbound screening, autonomous candidate outreach. Clones only go live once they clear a 70/100 readiness score.";
const NORTHWIND_POSITIONING =
  "Versus a traditional agency: no 20-25% placement fee, no black-box shortlist — you see the ranked reasoning. Versus a job board: proactive sourcing + screening, not inbound-only. Versus generic AI screeners: cloned from your team's real calls, so it sounds like you.";

function recruitingSource(title: string, days: number, transcript: string, grounded = false): { title: string; url: string; transcript: string; grounded: boolean } {
  return { title, url: `https://fathom.video/share/nw-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32)}`, transcript, grounded };
}

const T_INTAKE =
  "Recruiter: Hey Dana, thanks for hopping on. You're hiring a senior backend engineer, is that right?\n" +
  "Dana (Hiring Mgr): Yeah, we lost one and we're drowning. Need someone strong on Go and Postgres.\n" +
  "Recruiter: Got it — Go, Postgres. Is this remote or onsite?\n" +
  "Dana: Remote-first, US time zones. Comp is 160 to 185 base.\n" +
  "Recruiter: Perfect. Must-haves — I'm hearing Go, Postgres, and someone who's carried on-call. Anything else non-negotiable?\n" +
  "Dana: Payments experience would be huge. And I need bodies in the pipeline this week, honestly.\n" +
  "Recruiter: Totally fair. Let me show you the shortlist it builds against exactly those must-haves — give it a few seconds while it ranks.\n" +
  "Dana: This is way faster than our last agency.\n" +
  "Recruiter: That's the idea. Top match here is a 92% — Go, Postgres, ran payments at a fintech, on-call lead. Want me to draft the outreach and you just approve?\n" +
  "Dana: Do it.";
const T_DEMO =
  "Recruiter: So this is the ranked list — everyone here cleared your three must-haves.\n" +
  "Prospect: How does it decide the ranking?\n" +
  "Recruiter: It scores each candidate against the requirement you gave me, then explains the why on every card — no black box. Click the top one.\n" +
  "Prospect: And it reaches out automatically?\n" +
  "Recruiter: It drafts the outreach in your voice and screens replies with your questions. You approve before anything sends. That's about six hours of sourcing gone.\n" +
  "Prospect: What does this cost?\n" +
  "Recruiter: Growth is fifteen hundred a clone a month; happy to start you on a free pilot against one live req so you see real candidates before you pay a dollar.";
const T_OBJECTION =
  "Prospect: Honestly I'm nervous an AI will sound robotic to candidates.\n" +
  "Recruiter: Fair — that's why it's cloned from your team's real calls, not a generic bot. It discloses it's an AI teammate up front, keeps your tone, and hands off to a human the second it's out of its depth.\n" +
  "Prospect: And if it gets a comp question it shouldn't answer?\n" +
  "Recruiter: It only states the numbers you've authorized and defers on the rest — 'let me get you the exact figure.' It never makes one up.";
const T_CS =
  "CSM: Hey Priya here from Northwind — wanted to check in on your first two weeks live. How's the shortlist quality feeling?\n" +
  "Customer: Better than expected. The screening summaries save my team real time.\n" +
  "CSM: Love that. One thing I'd suggest — turn on auto-outreach for your evergreen roles so the pipeline never goes cold.\n" +
  "Customer: Can we cap how many it sends a day?\n" +
  "CSM: Absolutely, you set the daily cap and approval rules. Want me to set it to twenty a day and you approve each batch?\n" +
  "Customer: Perfect.";

const ROSTER: CloneDef[] = [
  // 1) AVA — flagship host clone, LIVE, high readiness, demoable driving.
  {
    id: DEMO_CLONE_IDS.ava,
    icon: "sparkles",
    name: "Ava Chen",
    role: "Senior Technical Recruiter",
    department: "Talent",
    status: "golden",
    statusLabel: "Live",
    persona: spec(
      { name: "Ava Chen", role: "Senior Technical Recruiter", self: "I run intake and demo calls the way our best recruiters do — warm, fast, and specific." },
      { formality: 0.42, verbosity: 0.45, assertiveness: 0.62, warmth: 0.78, humor: 0.35, proactivity: 0.7 },
      {
        signature: ["give it a few seconds while it ranks", "no black box — here's the why", "want me to draft that and you just approve?"],
        vocab: "Recruiting-native: req, must-haves, comp band, shortlist, on-call, pipeline. Never corporate-stiff.",
        rules: ["Always confirm the role and must-haves before showing candidates.", "Explain the match reasoning on the top candidate every time.", "Quantify time saved at least once per demo."],
        fewShots: [
          { situation: "Prospect asks how the ranking works", human_response: "It scores each candidate against the exact must-haves you gave me, then shows the why on every card — no black box." },
          { situation: "Prospect worries the AI sounds robotic", human_response: "Fair — it's cloned from your team's real calls, discloses it's an AI teammate up front, and hands to a human the moment it's out of its depth." },
        ],
        boundaries: ["Never quote a placement fee — Northwind doesn't charge one.", "Never promise a guaranteed hire or time-to-fill."],
        voiceId: null,
        authority: { level: "standard", pricing: NORTHWIND_PRICING, product: NORTHWIND_PRODUCT, positioning: NORTHWIND_POSITIONING, commonAnswers: "Free pilot on one live req before any payment. Clones disclose they're AI. You approve all outreach." },
      },
    ),
    playbook: playbook(
      [{ id: "cs_ava_intake", url: "https://fathom.video/share/nw-intake", title: "Backend intake — Dana" }, { id: "cs_ava_demo", url: "https://fathom.video/share/nw-demo", title: "Platform demo — ranked list" }],
      recruitingStages(),
      { facts: ["No placement fee.", "Free pilot on one live requisition.", "Clones go live only above a 70/100 readiness score.", "AI is disclosed on every live call."], objections: [{ objection: "AI will sound robotic to candidates", response: "It's cloned from your team's real calls, discloses it's an AI, and keeps your tone." }, { objection: "What does it cost", response: "Growth is $1,500/clone/month; start free on one live req." }], pricing: NORTHWIND_PRICING, closes: [{ buyerType: "Head of Talent", close: "Point it at one live req this week and review real candidates together in 20 minutes." }, { buyerType: "Founder", close: "Free pilot, no fee — you only pay once a clone is live and earning its keep." }] },
    ),
    versionCount: 4,
    goldenAtVersion: 4,
    voiceId: null,
    verify: { average: 0.86, cases: 8 },
    redteam: { average: 0.94, cases: 9 },
    fidelity: { avg: 0.8, prevAvg: 0.71, topGaps: [{ atSec: 148, fidelity: 0.44, gap: "On the pricing question Ava jumped to the pilot before naming the Growth price the human led with." }] },
    goals: [
      { objective: "Run first-touch intake + demo calls end to end", metric: "≥ 8 live demos/week" },
      { objective: "Convert demo → pilot", metric: "≥ 35% book a pilot req" },
    ],
    sources: [recruitingSource("Backend intake — Dana", 12, T_INTAKE, true), recruitingSource("Platform demo — ranked list", 9, T_DEMO, true), recruitingSource("Objection handling — AI tone + comp", 7, T_OBJECTION, false)],
    demoLogin: { system: "After Human — Northwind demo workspace", url: "https://afterhuman.srv1797540.hstgr.cloud/#/echo", notes: "Ava drives the Northwind instance: dashboard → new req → ranked candidates → screening/outreach.", email: "ava-ai@northwindstaffing.com", password: "demo-not-a-real-secret" },
  },
  // 2) MARCUS — Enterprise AE, LIVE (clean, no weak moments).
  {
    id: DEMO_CLONE_IDS.marcus,
    icon: "briefcase",
    name: "Marcus Reed",
    role: "Enterprise Account Executive",
    department: "Sales",
    status: "golden",
    statusLabel: "Live",
    persona: spec(
      { name: "Marcus Reed", role: "Enterprise Account Executive", self: "I sell Northwind into larger talent orgs — measured, consultative, ROI-first." },
      { formality: 0.58, verbosity: 0.6, assertiveness: 0.7, warmth: 0.6, humor: 0.2, proactivity: 0.65 },
      {
        signature: ["let's put real numbers on it", "where does this break for you today?"],
        vocab: "Enterprise-sales register: pipeline, req volume, cost-per-hire, procurement, SSO, security review.",
        rules: ["Anchor on the customer's current cost-per-hire before quoting.", "Offer the security/SSO story to enterprise buyers unprompted."],
        fewShots: [{ situation: "Buyer asks about security", human_response: "Enterprise includes SSO, a security review, and a signed DPA — I'll loop our team in for the questionnaire." }],
        boundaries: ["Never commit custom discounts by voice — route to the team."],
        voiceId: null,
        authority: { level: "standard", pricing: NORTHWIND_PRICING, product: NORTHWIND_PRODUCT, positioning: NORTHWIND_POSITIONING },
      },
    ),
    playbook: playbook(
      [{ id: "cs_marcus_demo", url: "https://fathom.video/share/nw-ent-demo", title: "Enterprise demo — req volume" }],
      recruitingStages(),
      { facts: ["Enterprise includes SSO, DPA, and a dedicated CSM.", "No placement fee."], objections: [{ objection: "We need a security review", response: "Enterprise ships with SSO, a signed DPA and a security review — I'll bring our team in." }], pricing: NORTHWIND_PRICING, closes: [{ buyerType: "VP Talent", close: "Run a paid pilot across three teams and measure cost-per-hire delta over 30 days." }] },
    ),
    versionCount: 3,
    goldenAtVersion: 3,
    voiceId: null,
    verify: { average: 0.8, cases: 6 },
    redteam: { average: 0.88, cases: 8 },
    fidelity: { avg: 0.75, prevAvg: 0.69, topGaps: [] },
    goals: [{ objective: "Land enterprise pilots", metric: "≥ 3 pilots/quarter" }],
    sources: [recruitingSource("Enterprise demo — req volume", 11, T_DEMO, true), recruitingSource("Security & procurement Q&A", 8, T_OBJECTION, false)],
    demoLogin: { system: "After Human — Northwind demo workspace", url: "https://afterhuman.srv1797540.hstgr.cloud/#/echo", notes: "Marcus runs the enterprise ROI walkthrough.", email: "marcus-ai@northwindstaffing.com", password: "demo-not-a-real-secret" },
  },
  // 3) HANNAH — Staffing Account Manager, READY-TO-REVIEW (golden v2, tip v3).
  {
    id: DEMO_CLONE_IDS.hannah,
    icon: "user-check",
    name: "Hannah Brooks",
    role: "Staffing Account Manager",
    department: "Accounts",
    status: "golden",
    statusLabel: "Ready to review",
    persona: spec(
      { name: "Hannah Brooks", role: "Staffing Account Manager", self: "I keep our staffing accounts warm and expand them." },
      { formality: 0.5, verbosity: 0.5, assertiveness: 0.55, warmth: 0.82, humor: 0.4, proactivity: 0.72 },
      {
        signature: ["how's the pipeline feeling this week?", "want me to just set that up for you?"],
        vocab: "Account-management warmth: renewal, expansion, evergreen roles, check-in, cap.",
        rules: ["Open every check-in on outcomes, not features.", "Propose one concrete automation each call."],
        boundaries: ["Never re-negotiate an existing contract by voice."],
        voiceId: null,
        authority: { level: "standard", pricing: NORTHWIND_PRICING, product: NORTHWIND_PRODUCT },
      },
    ),
    playbook: playbook(
      [{ id: "cs_hannah_qbr", url: "https://fathom.video/share/nw-qbr", title: "Account check-in — week 2" }],
      recruitingStages().slice(0, 4),
      { facts: ["Daily outreach caps and per-batch approval are configurable."], objections: [{ objection: "Worried it'll over-send", response: "You set a daily cap and approve each batch — nothing sends without you." }], pricing: NORTHWIND_PRICING, closes: [{ buyerType: "Existing customer", close: "Turn on auto-outreach for evergreen roles at 20/day with batch approval." }] },
    ),
    versionCount: 3,
    goldenAtVersion: 2, // pinned behind the tip → promote-pending → ready-to-review
    voiceId: null,
    verify: { average: 0.78, cases: 6 },
    redteam: { average: 0.82, cases: 7 },
    fidelity: { avg: 0.7, prevAvg: 0.66, topGaps: [] },
    goals: [{ objective: "Grow net revenue retention", metric: "≥ 115% NRR" }],
    sources: [recruitingSource("Account check-in — week 2", 6, T_CS, true), recruitingSource("Expansion pitch — evergreen roles", 5, T_CS, false)],
    demoLogin: { system: "After Human — Northwind demo workspace", url: "https://afterhuman.srv1797540.hstgr.cloud/#/echo", notes: "Hannah runs account check-ins and expansion.", email: "hannah-ai@northwindstaffing.com", password: "demo-not-a-real-secret" },
  },
  // 4) PRIYA — Customer Success, REHEARSING (persona + voice, no golden, no verify).
  {
    id: DEMO_CLONE_IDS.priya,
    icon: "headphones",
    name: "Priya Nair",
    role: "Customer Success Manager",
    department: "Customer Success",
    status: "training",
    statusLabel: "Rehearsing",
    persona: spec(
      { name: "Priya Nair", role: "Customer Success Manager", self: "I onboard new customers and keep them successful." },
      { formality: 0.48, verbosity: 0.5, assertiveness: 0.5, warmth: 0.85, humor: 0.3, proactivity: 0.68 },
      {
        signature: ["let's get you a quick win in week one", "I'll take that off your plate"],
        vocab: "CS-native: onboarding, adoption, first value, health, cap, approval rules.",
        rules: ["Aim for a first win inside week one.", "Never leave a call without a next step owned."],
        voiceId: null,
        authority: { level: "standard", product: NORTHWIND_PRODUCT },
      },
    ),
    playbook: playbook(
      [{ id: "cs_priya_onb", url: "https://fathom.video/share/nw-onboard", title: "Onboarding — first two weeks" }],
      recruitingStages().slice(0, 3),
      { facts: ["Daily caps and approval rules are customer-configurable."], objections: [{ objection: "Can we cap sends", response: "Yes — you set the daily cap and approve each batch." }], closes: [{ buyerType: "New customer", close: "Set auto-outreach to 20/day with batch approval and book a week-one review." }] },
    ),
    versionCount: 2,
    goldenAtVersion: null,
    voiceId: null,
    verify: null,
    redteam: null,
    fidelity: null,
    goals: [{ objective: "Drive week-one activation", metric: "≥ 80% reach first value in 7 days" }],
    sources: [recruitingSource("Onboarding — first two weeks", 4, T_CS, false)],
    demoLogin: { system: "After Human — Northwind demo workspace", url: "https://afterhuman.srv1797540.hstgr.cloud/#/echo", notes: "Priya runs onboarding check-ins (still rehearsing).", email: "priya-ai@northwindstaffing.com", password: "demo-not-a-real-secret" },
  },
  // 5) DIEGO — SDR / Outbound, LEARNING (sources only, no persona identity yet).
  {
    id: DEMO_CLONE_IDS.diego,
    icon: "phone-outgoing",
    name: "Diego Alvarez",
    role: "Sales Development Rep",
    department: "Sales",
    status: "training",
    statusLabel: "Learning",
    persona: null, // empty persona → learning stage
    playbook: null,
    versionCount: 0,
    goldenAtVersion: null,
    voiceId: null,
    verify: null,
    redteam: null,
    fidelity: null,
    goals: [{ objective: "Book qualified intro calls", metric: "≥ 12 SQLs/month" }],
    sources: [recruitingSource("Cold intro call — staffing lead", 2, T_INTAKE, false), recruitingSource("Discovery — hiring pains", 1, T_OBJECTION, false)],
    demoLogin: { system: "After Human — Northwind demo workspace", url: "https://afterhuman.srv1797540.hstgr.cloud/#/echo", notes: "Diego is still learning from his intro calls.", email: "diego-ai@northwindstaffing.com", password: "demo-not-a-real-secret" },
  },
];

// ---------------------------------------------------------------------------
// Insert helpers (all take the tx client; all set org_id = DEMO_ORG_ID)
// ---------------------------------------------------------------------------
async function insertClone(c: PoolClient, org: string, d: CloneDef): Promise<void> {
  const persona = d.persona ?? {};
  const pbCol = d.playbook ? { kind: "calls", name: `${d.name} — call playbook`, callPlaybook: d.playbook } : {};

  // persona versions (immutable history). Numbered 1..versionCount; the pinned
  // Live version is goldenAtVersion.
  let goldenVersionId: string | null = null;
  let goldenSpec: PersonaSpec | null = null;
  for (let n = 1; n <= d.versionCount; n++) {
    const pvId = `pv_${d.id}_${n}`;
    // Earlier versions are lightly nerfed copies so the diff/history reads real.
    const vSpec: PersonaSpec = d.persona
      ? n === d.versionCount
        ? d.persona
        : { ...d.persona, style: { ...d.persona.style, proactivity: Math.max(0.3, d.persona.style.proactivity - 0.08 * (d.versionCount - n)) } }
      : (persona as PersonaSpec);
    const createdBy = n === 1 ? "extraction" : "operator";
    await c.query(
      `INSERT INTO persona_versions (id, agent_id, number, spec, change_note, parent_id, created_by, org_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [pvId, d.id, n, J(vSpec), n === 1 ? "Extracted from call sources" : `Calibration edit v${n}`, n === 1 ? null : `pv_${d.id}_${n - 1}`, createdBy, org, daysAgo(10 - n)],
    );
    if (d.goldenAtVersion === n) {
      goldenVersionId = pvId;
      goldenSpec = vSpec;
    }
  }

  const goldenInstructions = goldenSpec ? compileClone(goldenSpec, d.playbook ?? null, d.name, DEMO_COMPANY_NAME) : null;

  await c.query(
    `INSERT INTO agents
       (id, icon, name, role, status, status_label, model, autonomy, sort,
        persona, playbook, golden_persona_id, golden_instructions, voice_id, goals,
        build_track, clone_source, overview, allow_instant_joins, calendar_watch, org_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      d.id, d.icon, d.name, d.role, d.status, d.statusLabel, "claude-opus-4-8", "Ask before acting", ROSTER.indexOf(d),
      J(persona), J(pbCol), goldenVersionId, goldenInstructions, d.voiceId, J(d.goals),
      "clone", J({ name: d.name, title: d.role, email: d.demoLogin.email }), `${d.name} — cloned from ${d.department} call recordings.`, true, false, org, daysAgo(13),
    ],
  );

  // clone sources (Fathom-style transcripts). Grounded ones carry an observed
  // timeline so the fidelity/corrections approvals render.
  for (let i = 0; i < d.sources.length; i++) {
    const s = d.sources[i];
    const sid = `cs_${d.id}_${i + 1}`;
    const observed = s.grounded
      ? J({ generatedAt: daysAgo(9), timeline: [{ atSec: 5, screen: "dashboard", label: "Northwind dashboard" }, { atSec: 60, screen: "list", label: "Ranked candidates" }, { atSec: 150, screen: "chat-assistant", label: "Screening & outreach" }] })
      : null;
    await c.query(
      `INSERT INTO clone_sources (id, agent_id, kind, title, url, transcript, observed, org_id, created_at)
       VALUES ($1,$2,'fathom_transcript',$3,$4,$5,$6,$7,$8)`,
      [sid, d.id, s.title, s.url, s.transcript, observed, org, daysAgo(12 - i)],
    );
  }

  // per-clone settings: verify / redteam / fidelity results + demo login.
  if (d.verify) await setSetting(c, org, `verify_result:${d.id}`, { average: d.verify.average, cases: d.verify.cases, at: daysAgo(2), version: d.goldenAtVersion });
  if (d.redteam) await setSetting(c, org, `redteam_result:${d.id}`, { average: d.redteam.average, cases: d.redteam.cases, at: daysAgo(2) });
  if (d.fidelity) await setSetting(c, org, `fidelity_report:${d.id}`, { avg: d.fidelity.avg, prevAvg: d.fidelity.prevAvg, at: daysAgo(3), topGaps: d.fidelity.topGaps });
  if (goldenVersionId && goldenInstructions) await setSetting(c, org, "live_golden_instructions", { agentId: d.id, versionId: goldenVersionId, instructions: goldenInstructions });

  // demo-system login (password encrypted at rest via sealDemoLogin, bound to org+key).
  const key = agentDemoKey(d.id);
  await setSetting(c, org, key, sealDemoLogin(org, key, d.demoLogin));
}

async function setSetting(c: PoolClient, org: string, key: string, value: unknown): Promise<void> {
  await c.query(
    `INSERT INTO settings (org_id, key, value) VALUES ($1,$2,$3)
       ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [org, key, J(value)],
  );
}

async function insertOrgExtras(c: PoolClient, org: string): Promise<void> {
  // Company profile (brands the shared screen / curtain + tailors AI copy).
  await setSetting(c, org, "company", {
    name: DEMO_COMPANY_NAME,
    domain: "northwindstaffing.com",
    industry: "Staffing & Recruiting",
    size: "Mid-market (120 employees)",
    coreBusiness: "Tech & GTM staffing agency — places engineers, PMs, and sales talent for high-growth startups.",
    notes: "Demo tenant for the public 'Talk to Ava' experience. Everything here is fictional.",
  });
  // Org-default demo login (fallback for any clone without its own creds).
  await setSetting(c, org, ORG_DEMO_LOGIN_KEY, sealDemoLogin(org, ORG_DEMO_LOGIN_KEY, {
    system: "After Human — Northwind demo workspace",
    url: "https://afterhuman.srv1797540.hstgr.cloud/#/echo",
    notes: "Shared Northwind demo workspace.",
    email: "demo@northwindstaffing.com",
    password: "demo-not-a-real-secret",
  }));

  // People (the HUMANS in the org — populate the org chart).
  const people: Array<[string, string, string, string, string | null, boolean]> = [
    ["ppl_nw_vp", "Dana Whitfield", "VP of Talent", "dana@northwindstaffing.com", null, true],
    ["ppl_nw_sales", "Owen Mbeki", "Head of Sales", "owen@northwindstaffing.com", "ppl_nw_vp", false],
    ["ppl_nw_ops", "Sofia Ramos", "Recruiting Ops Lead", "sofia@northwindstaffing.com", "ppl_nw_vp", false],
  ];
  for (const [id, name, title, email, reports, isYou] of people) {
    await c.query(
      `INSERT INTO company_people (id, name, title, email, department, reports_to_id, is_you, org_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, name, title, email, "Leadership", reports, isYou, org],
    );
  }

  // Integrations — make the Connections screen look set up (no real secrets).
  const integrations: Array<[string, Record<string, string>, boolean, string]> = [
    // NOTE: left DISCONNECTED on purpose so the demo org falls back to the platform ElevenLabs key (getIntegrationSource) and the voice library actually populates - a fake key here 401s and hangs the Voice step.
    ["elevenlabs", {}, false, "using platform voice library"],
    ["e2b", { apiKey: "demo-e2b-key" }, true, "sandboxes ready"],
    ["slack", { botToken: "demo-slack-token" }, true, "#northwind-hiring"],
    ["gmail", { email: "demo@northwindstaffing.com" }, false, "not connected"],
  ];
  for (const [id, values, connected, detail] of integrations) {
    await c.query(
      `INSERT INTO integrations (id, values, connected, detail, org_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, J(values), connected, detail, org, daysAgo(14)],
    );
  }

  // Provider cost rollup (top-bar cost chip / Insights).
  const costs: Array<[string, number, number]> = [["openai", 4.8213, 214_800], ["elevenlabs", 1.2044, 0], ["e2b", 0.9331, 0]];
  for (const [provider, cost, tokens] of costs) {
    await c.query(`INSERT INTO cost_entries (provider, cost, tokens, org_id) VALUES ($1,$2,$3,$4)`, [provider, cost, tokens, org]);
  }

  // A couple of pending human-in-the-loop approvals (legacy inbox).
  const approvals: Array<[string, string, string, string, string, string]> = [
    ["apr_nw_1", "Hannah Brooks", "Turn on auto-outreach for Acme's evergreen roles", "Enable autonomous outreach at 20/day with per-batch approval for the Acme account.", "medium", "action"],
    ["apr_nw_2", "Diego Alvarez", "Which segment should I prioritize for outbound?", "Two segments qualify equally — need your call before I build the sequence.", "low", "question"],
  ];
  for (const [id, agent, action, detail, risk, kind] of approvals) {
    await c.query(
      `INSERT INTO approvals (id, agent, action, detail, risk, kind, options, org_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, agent, action, detail, risk, kind, J(kind === "question" ? ["Startups", "Mid-market", "Let me decide"] : []), org],
    );
  }
}

async function insertActivity(c: PoolClient, org: string): Promise<void> {
  // Past ENDED live calls (ground-truth call counts for Overview; film for
  // Debrief). Never leave an un-ended call — that reads as an active session.
  type Call = { id: string; agent: string; days: number; dur: number; readiness: number };
  const calls: Call[] = [
    { id: "lc_nw_1", agent: DEMO_CLONE_IDS.ava, days: 1, dur: 14, readiness: 90 },
    { id: "lc_nw_2", agent: DEMO_CLONE_IDS.ava, days: 2, dur: 17, readiness: 89 },
    { id: "lc_nw_3", agent: DEMO_CLONE_IDS.ava, days: 4, dur: 12, readiness: 88 },
    { id: "lc_nw_4", agent: DEMO_CLONE_IDS.marcus, days: 3, dur: 22, readiness: 86 },
    { id: "lc_nw_5", agent: DEMO_CLONE_IDS.marcus, days: 6, dur: 19, readiness: 85 },
    { id: "lc_nw_6", agent: DEMO_CLONE_IDS.ava, days: 8, dur: 15, readiness: 87 },
    { id: "lc_nw_7", agent: DEMO_CLONE_IDS.hannah, days: 9, dur: 11, readiness: 80 },
  ];
  for (const call of calls) {
    const start = new Date(ANCHOR - call.days * 86_400_000);
    const end = new Date(start.getTime() + call.dur * 60_000);
    await c.query(
      `INSERT INTO live_calls (id, agent_id, meeting_id, mode, phase, sandbox_id, phases, started_at, ended_at, org_id, readiness_at_start, outcome)
       VALUES ($1,$2,$3,'zoom','ended',NULL,$4,$5,$6,$7,$8,'completed')`,
      [call.id, call.agent, `nwdemo-${call.id}`, J([{ phase: "ready", at: start.toISOString() }, { phase: "ended", at: end.toISOString() }]), start.toISOString(), end.toISOString(), org, call.readiness],
    );
    // Metrics ledger — each completed call as a live_call_run event.
    await c.query(`INSERT INTO usage_events (name, org_id, agent_id, call_id, value, props, ts) VALUES ('live_call_run',$1,$2,$3,$4,$5,$6)`, [org, call.agent, call.id, call.dur, J({ outcome: "completed" }), end.toISOString()]);
  }

  // Funnel/metric events so the six launch metrics have something to roll up.
  await c.query(`INSERT INTO usage_events (name, org_id, value, ts) VALUES ('signup',$1,NULL,$2)`, [org, daysAgo(20)]);
  await c.query(`INSERT INTO usage_events (name, org_id, agent_id, value, ts) VALUES ('reached_70',$1,$2,90,$3)`, [org, DEMO_CLONE_IDS.ava, daysAgo(15)]);
  await c.query(`INSERT INTO usage_events (name, org_id, value, ts) VALUES ('went_live',$1,NULL,$2)`, [org, daysAgo(14)]);

  // Calibration rehearsal for the flagship (populates the Calibration Room feed).
  const sessId = "cal_nw_ava_1";
  await c.query(`INSERT INTO calibration_sessions (id, agent_id, mode, active_version_id, org_id, created_at) VALUES ($1,$2,'calibration',$3,$4,$5)`, [sessId, DEMO_CLONE_IDS.ava, `pv_${DEMO_CLONE_IDS.ava}_4`, org, daysAgo(3)]);
  const turns: Array<[number, string, string]> = [
    [0, "user", "Hey, we're hiring a senior backend engineer — how does this work?"],
    [1, "clone", "Great — senior backend. Before I show you anyone, what are the three must-haves? I heard Go and Postgres; what's the third?"],
    [2, "user", "On-call experience. And payments would be a bonus."],
    [3, "clone", "Perfect — Go, Postgres, on-call, payments a plus. Give it a few seconds while it ranks against exactly that... top match is a 92%, and here's the why on the card. Want me to draft the outreach and you just approve?"],
    [4, "user", "What does this cost?"],
    [5, "clone", "Growth is fifteen hundred a clone a month — but let's start you free on one live req so you see real candidates before you pay a dollar."],
  ];
  for (const [idx, role, text] of turns) {
    await c.query(
      `INSERT INTO calibration_turns (id, session_id, idx, role, text, version_id, org_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [`ct_nw_${idx}`, sessId, idx, role, text, role === "clone" ? `pv_${DEMO_CLONE_IDS.ava}_4` : null, org, daysAgo(3)],
    );
  }

  // Rehearsal grades for the flagship (server-authoritative approve/coach).
  const grades: Array<[number, string, string]> = [[1, "speech", "approve"], [1, "screen", "approve"], [3, "speech", "approve"], [3, "screen", "coach"], [5, "speech", "approve"]];
  for (const [seq, part, verdict] of grades) {
    await c.query(
      `INSERT INTO rehearsal_grades (id, call_id, agent_id, turn_seq, part, verdict, org_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [`rg_nw_${seq}_${part}`, "lc_nw_1", DEMO_CLONE_IDS.ava, seq, part, verdict, org, daysAgo(1)],
    );
  }

  // Post-call debriefs (Insights/Debrief screen).
  const debriefs: Array<[string, string, string, unknown]> = [
    ["db_nw_ava", DEMO_CLONE_IDS.ava, "lc_nw_1", { summary: "Strong intake→demo→pilot flow; one pricing-order nit flagged for coaching.", deltas: [{ id: "d1", tag: "Grounding", src: "lc_nw_1", before: "Jumped to the pilot before naming Growth pricing", after: "Name the Growth price first, then offer the pilot", state: "pending" }] }],
    ["db_nw_marcus", DEMO_CLONE_IDS.marcus, "lc_nw_4", { summary: "Clean enterprise ROI walkthrough; security story landed.", deltas: [] }],
  ];
  for (const [id, agent, ref, data] of debriefs) {
    await c.query(`INSERT INTO debriefs (id, agent_id, ref_kind, ref_id, data, org_id, created_at) VALUES ($1,$2,'session',$3,$4,$5,$6)`, [id, agent, ref, J(data), org, daysAgo(1)]);
  }
}

// ---------------------------------------------------------------------------
// Wipe (org-scoped only) + org identity + orchestration
// ---------------------------------------------------------------------------
async function wipeDemoOrg(c: PoolClient, org: string): Promise<void> {
  // turns first (FK-free but keyed via session); then the rest.
  await c.query(
    `DELETE FROM calibration_turns WHERE session_id IN (SELECT id FROM calibration_sessions WHERE org_id = $1)`,
    [org],
  );
  // Auxiliary org-scoped tables a prospect action can create (metering, joins,
  // scheduling). Guarded — they may not all exist on a minimal test DB. Clearing
  // them keeps the reset truly pristine.
  for (const t of ["usage_events", "usage_ledger", "scheduled_calls", "call_audit", "org_concurrency", "mrr_snapshots"]) {
    await c.query(`DELETE FROM ${t} WHERE org_id = $1`, [org]).catch(() => {});
  }
  for (const t of DEMO_TABLES) {
    await c.query(`DELETE FROM ${t} WHERE org_id = $1`, [org]);
  }
}

async function ensureOrgIdentity(c: PoolClient, org: string): Promise<void> {
  await c.query(
    `INSERT INTO orgs (id, name, slug, plan, status, seats, mrr_cents, signup_at, went_live_at)
       VALUES ($1,$2,'northwind','growth','active',5,750000,$3,$4)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, plan = EXCLUDED.plan, status = EXCLUDED.status, seats = EXCLUDED.seats, mrr_cents = EXCLUDED.mrr_cents`,
    [org, DEMO_COMPANY_NAME, daysAgo(20), daysAgo(14)],
  );
  // A demo owner user + membership so the org is coherent under password auth.
  // No password is stored (invite-style); nothing secret here.
  await c.query(
    `INSERT INTO users (id, email, name) VALUES ($1,$2,$3)
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name`,
    [DEMO_OWNER_USER_ID, "owner@northwindstaffing.com", "Dana Whitfield"],
  );
  await c.query(
    `INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,'owner')
     ON CONFLICT (user_id, org_id) DO UPDATE SET role = 'owner'`,
    [DEMO_OWNER_USER_ID, org],
  );
}

export interface DemoTenantSummary {
  orgId: string;
  demoAgentId: string;
  clones: number;
  goldenClones: number;
  sources: number;
  personaVersions: number;
  liveCalls: number;
}

/**
 * The one rebuild primitive: assert the org is the demo org, ensure the identity
 * rows, then wipe every demo-org row and re-assert the pristine baseline — all in
 * one transaction under an advisory lock so concurrent leases serialize. Fast and
 * fully idempotent.
 */
async function rebuild(org: string): Promise<DemoTenantSummary> {
  assertDemoOrg(org);
  // clone_sources.observed is added lazily by the fathom route in prod; ensure it
  // here so grounded sources work on a fresh DB. Idempotent DDL, outside the tx.
  await pool.query(`ALTER TABLE clone_sources ADD COLUMN IF NOT EXISTS observed JSONB`).catch(() => {});

  return withTx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock($1)", [DEMO_LOCK_KEY]);
    await ensureOrgIdentity(c, org);
    await wipeDemoOrg(c, org);
    for (const d of ROSTER) await insertClone(c, org, d);
    await insertOrgExtras(c, org);
    await insertActivity(c, org);

    const n = async (sql: string, params: unknown[] = [org]) => Number((await c.query<{ n: string }>(sql, params)).rows[0]?.n ?? 0);
    return {
      orgId: org,
      demoAgentId: DEMO_AGENT_ID,
      clones: await n(`SELECT COUNT(*) n FROM agents WHERE org_id=$1`),
      goldenClones: await n(`SELECT COUNT(*) n FROM agents WHERE org_id=$1 AND golden_persona_id IS NOT NULL`),
      sources: await n(`SELECT COUNT(*) n FROM clone_sources WHERE org_id=$1`),
      personaVersions: await n(`SELECT COUNT(*) n FROM persona_versions WHERE org_id=$1`),
      liveCalls: await n(`SELECT COUNT(*) n FROM live_calls WHERE org_id=$1`),
    };
  });
}

/**
 * Seed (or re-seed) the Northwind demo tenant to its pristine baseline. Safe to
 * run repeatedly; only ever touches DEMO_ORG_ID.
 */
export async function seedDemoTenant(): Promise<DemoTenantSummary> {
  return rebuild(DEMO_ORG_ID);
}

/**
 * Restore the demo org to its pristine seeded state — deletes every
 * session-created artifact (clones/positions/calls a prospect made Ava create)
 * and re-asserts the seed baseline. Idempotent, fast, safe to call on every
 * lease. THIS is the module the warm-pool workstream imports.
 *
 * @param orgId must equal DEMO_ORG_ID — any other value throws (the guard that
 *              makes it impossible to reset the real tenant).
 */
export async function resetDemoTenant(orgId: string = DEMO_ORG_ID): Promise<DemoTenantSummary> {
  return rebuild(orgId);
}
