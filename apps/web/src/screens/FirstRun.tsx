import { useState } from "react";
import type { CSSProperties } from "react";
import type { CallPlaybook } from "@jarvis/shared";
import { api } from "../api/client";
import "../pds.css";
import "../pds-mockup.css";

// ============================================================
// First-run — "Clone your first rep". The activation moment a brand-new org
// (0 clones) lands on by default (App.tsx routes here when GET /api/agents has
// no buildTrack==="clone" rows). It is a launchpad, not a form: two no-dead-end
// paths off the same screen —
//   • Start with a sample rep  → POSTs the existing create-clone API with a
//     ready-made sample CallPlaybook so they instantly have a clone to see and
//     rehearse, even with zero call data. Then jumps to that clone's Readiness.
//   • Connect your calls       → launches the existing PDS clone-from-calls
//     wizard (CloneARep, view "clonerep": Fathom share links / transcript
//     upload), which is the real path to a clone of their own rep.
// Free to build + rehearse; you only pay at Go-Live (70 score). Skippable to the
// empty dashboard via the quiet "Skip for now" link.
// Scoped to the `.pmx` Perfect Design System, theme-aware, no app chrome.
// ============================================================

function nav(view: string): void {
  window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
}

const bf: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

// The ready-made sample rep. A generic (product-neutral) five-stage demo flow
// so the created clone has a real storyboard + compiled live-call instructions
// the moment it exists — the backend compiles callPlaybook.approved+stages into
// instructions on create (see POST /api/agents). No call data required.
const SAMPLE_NAME = "Sample rep — Alex Rivera";
const SAMPLE_ROLE = "Account Executive";

const SAMPLE_PLAYBOOK: CallPlaybook = {
  sources: [{ id: "sample-1", url: "sample://demo", title: "Sample discovery + demo call" }],
  stages: [
    {
      id: "s1",
      name: "Open & set the frame",
      goal: "Build quick rapport and agree an agenda for the call.",
      wireframe: { archetype: "talk-only", screenTitle: "Intro", regions: ["Agenda"] },
      voice: {
        objective: "Land a warm, confident open and confirm what the buyer wants to get out of the time.",
        moves: ["Greet by name, mirror their energy", "Confirm time budget", "Propose a short agenda and get a yes"],
        exampleLines: [
          "Thanks for making the time — want to make this genuinely useful, so tell me what would make the next 20 minutes worth it for you.",
          "I figured we'd cover where you are today, show you the parts that map to that, and leave time for questions — sound right?",
        ],
        listenFor: ["Their stated goal", "Time pressure", "Who else is involved"],
      },
      screen: { actions: ["Stay on camera — nothing to show yet"], waitBehavior: "Keep talking, no screen needed." },
      exitCriteria: "Agenda agreed and the buyer's goal stated out loud.",
    },
    {
      id: "s2",
      name: "Discovery",
      goal: "Surface the real problem, its cost, and the current workaround.",
      wireframe: { archetype: "talk-only", screenTitle: "Discovery", regions: ["Notes"] },
      voice: {
        objective: "Diagnose before prescribing — get the pain, the impact, and what they've tried.",
        moves: ["Ask about the current process", "Quantify the cost of the problem", "Find the trigger for looking now"],
        exampleLines: [
          "Walk me through how your team handles that today.",
          "When that breaks, what does it actually cost you — time, money, deals?",
        ],
        listenFor: ["Metrics they care about", "Failed alternatives", "Urgency / a deadline"],
      },
      screen: { actions: ["Take visible notes on shared screen if helpful"], waitBehavior: "Reflect back what you heard." },
      exitCriteria: "A concrete, owned problem you can now map the product to.",
    },
    {
      id: "s3",
      name: "Tailored walkthrough",
      goal: "Show only the parts that solve the problem they just described.",
      wireframe: { archetype: "dashboard", screenTitle: "Product", regions: ["Overview", "Key workflow", "Result"] },
      voice: {
        objective: "Connect each thing you show back to their stated pain — no feature tour.",
        moves: ["Anchor to their words", "Show the one workflow that matters", "Confirm it lands before moving on"],
        exampleLines: [
          "You said reps waste an hour a day on this — here's exactly where that hour goes away.",
          "Does that match how you'd want it to work?",
        ],
        listenFor: ["Head-nods vs. hesitation", "New questions", "Signs of a second stakeholder"],
      },
      screen: {
        actions: ["Bring up the overview", "Drill into the one key workflow", "Land on the outcome/result view"],
        waitBehavior: "Narrate what's loading so there's never dead air.",
      },
      exitCriteria: "Buyer agrees the product solves the problem they named.",
    },
    {
      id: "s4",
      name: "Handle objections & price",
      goal: "Answer concerns honestly and frame pricing against the cost of the problem.",
      wireframe: { archetype: "record-detail", screenTitle: "Pricing", regions: ["Plan", "What's included"] },
      voice: {
        objective: "Meet objections straight, then re-anchor value before stating a number.",
        moves: ["Acknowledge the concern", "Re-anchor to the cost of inaction", "State pricing plainly, then stop talking"],
        exampleLines: [
          "Fair question — let me be straight with you.",
          "Against the hour a day you mentioned, here's what it costs.",
        ],
        listenFor: ["The real blocker behind the objection", "Budget authority", "Buying signals"],
      },
      screen: { actions: ["Show the plan and what's included"], waitBehavior: "Give them a beat to read it." },
      exitCriteria: "Objection addressed and price is on the table.",
    },
    {
      id: "s5",
      name: "Agree next steps",
      goal: "Lock a specific, dated next action with an owner.",
      wireframe: { archetype: "talk-only", screenTitle: "Next steps", regions: ["Plan"] },
      voice: {
        objective: "Turn interest into a committed next step — never end on 'I'll think about it'.",
        moves: ["Summarise the fit", "Propose the specific next step", "Get a date and an owner"],
        exampleLines: [
          "Here's what I'd suggest as the next step.",
          "Does Thursday work to get the right people in the room?",
        ],
        listenFor: ["A firm yes", "Who needs to sign off", "The real timeline"],
      },
      screen: { actions: ["Nothing to show — close eye-to-eye"], waitBehavior: "Stay present, confirm the plan." },
      exitCriteria: "A dated next step with a named owner.",
    },
  ],
  facts: [
    "This is a sample rep — a ready-made demo clone so you can feel the product before connecting your own calls.",
    "Replace it any time by cloning a real rep from their recorded calls.",
  ],
  objections: [
    { objection: "We already have something like this.", response: "Totally fair — what I'd want to know is where it falls short for you today, and whether this closes that gap." },
    { objection: "It's not the right time.", response: "Understood — what would need to be true for it to be the right time? Let's work back from there." },
    { objection: "It looks expensive.", response: "Let's put it against what the problem costs you today, then you can judge the trade honestly." },
  ],
  closes: [
    { buyerType: "Champion", close: "Let's get your exec in the room Thursday and make this real." },
    { buyerType: "Economic buyer", close: "Against the cost you described, the payback is fast — shall we get started?" },
  ],
  generatedAt: new Date().toISOString(),
  approved: true,
};

export default function FirstRun() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function startSample(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const body = {
        icon: "user",
        name: SAMPLE_NAME,
        role: SAMPLE_ROLE,
        buildTrack: "clone" as const,
        cloneSource: { name: SAMPLE_NAME, title: SAMPLE_ROLE },
        callPlaybook: SAMPLE_PLAYBOOK,
      };
      const ag = await api.post<{ id: string }>("/api/agents", body);
      try {
        localStorage.setItem("pds_agent", ag.id);
      } catch {
        /* ignore */
      }
      // Kick the build pipeline so Readiness has a live story straight away —
      // same fire-and-forget the clone wizard uses on finish.
      void api.post("/api/pipeline/start", { agentId: ag.id }).catch(() => {
        /* Readiness renders either way */
      });
      nav("readiness");
    } catch (e) {
      setErr(`Couldn't spin up the sample rep: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  return (
    <div className="pmx" data-theme={theme} style={{ height: "100%", overflowY: "auto", background: "var(--bg)" }}>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      {/* minimal top bar — brand + theme toggle only; a brand-new org has nowhere else to go yet */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px clamp(16px,4vw,40px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/assets/afterhuman-mark.svg" alt="" style={{ width: 32, height: 32, display: "block" }} />
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.02em" }}>AfterHuman</div>
        </div>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme" style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "grid", placeItems: "center", ...bf }}>
          <span className="material-symbols-rounded" style={{ fontSize: 21 }}>{theme === "dark" ? "light_mode" : "dark_mode"}</span>
        </button>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "clamp(8px,3vh,40px) clamp(16px,4vw,40px) 80px", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 9999, background: "var(--purple-soft)", color: "var(--purple-ink)", fontSize: 12.5, fontWeight: 700, letterSpacing: ".02em", marginBottom: 20 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}>rocket_launch</span>
          Welcome — let's get your first clone up
        </div>

        <h1 style={{ fontSize: "clamp(30px,5vw,46px)", fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.05, margin: "0 0 14px" }}>
          Clone your first rep
        </h1>
        <p style={{ fontSize: "clamp(14.5px,2vw,16.5px)", color: "var(--ink2)", maxWidth: 560, margin: "0 auto 40px", lineHeight: 1.55 }}>
          Spin up a clone of your best salesperson — voice, style, and call flow. Building and rehearsing is free; you only pay when a clone hits its go-live score. Pick where to start.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, textAlign: "left" }}>
          {/* PATH A — sample-first: instant, zero data */}
          <div className="card" style={{ borderRadius: 22, padding: 28, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 16, right: 16, fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--purple-ink)", background: "var(--purple-soft)", padding: "4px 9px", borderRadius: 9999 }}>Instant</div>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(140deg,#A342FF,#FF0660)", color: "#fff", display: "grid", placeItems: "center", marginBottom: 18 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 28 }}>bolt</span>
            </div>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.02em", marginBottom: 8 }}>Start with a sample rep</div>
            <p style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.55, margin: "0 0 20px", flex: 1 }}>
              We'll drop in a ready-made demo clone with a full call playbook — no data needed. Rehearse against it in seconds to feel exactly how this works, then make it your own.
            </p>
            <button onClick={() => void startSample()} disabled={busy} className="btn pink" style={{ width: "100%", justifyContent: "center", opacity: busy ? 0.65 : 1 }}>
              {busy ? (
                <>
                  <span className="material-symbols-rounded" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>progress_activity</span>
                  Spinning up your sample rep…
                </>
              ) : (
                <>
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>bolt</span>
                  Start with a sample rep
                </>
              )}
            </button>
          </div>

          {/* PATH B — connect real calls: the real clone of their own rep */}
          <div className="card" style={{ borderRadius: 22, padding: 28, display: "flex", flexDirection: "column" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(140deg,#00BBFF,#A342FF)", color: "#fff", display: "grid", placeItems: "center", marginBottom: 18 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 28 }}>graphic_eq</span>
            </div>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.02em", marginBottom: 8 }}>Connect your calls</div>
            <p style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.55, margin: "0 0 20px", flex: 1 }}>
              Clone a real rep from their recorded calls. Paste a few Fathom share links or upload transcripts, and we build their voice, style, and call flow into a clone that's truly yours.
            </p>
            <button onClick={() => nav("clonerep")} className="btn" style={{ width: "100%", justifyContent: "center" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>link</span>
              Connect your calls
            </button>
          </div>

          {/* PATH C — no recordings: Ava auto-drafts a sample call from role + company */}
          <div className="card" style={{ borderRadius: 22, padding: 28, display: "flex", flexDirection: "column" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(140deg,#FF0660,#FFB020)", color: "#fff", display: "grid", placeItems: "center", marginBottom: 18 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 28 }}>auto_awesome</span>
            </div>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.02em", marginBottom: 8 }}>No recordings? Draft one</div>
            <p style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.55, margin: "0 0 20px", flex: 1 }}>
              No call recordings handy? Just tell us the rep's role and what they sell — Ava writes a realistic sample call and builds a starter clone from it in seconds. Refine it, or add real calls later.
            </p>
            <button onClick={() => nav("mockcall")} className="btn" style={{ width: "100%", justifyContent: "center" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>auto_awesome</span>
              Draft a clone
            </button>
          </div>
        </div>

        {err && (
          <div style={{ marginTop: 20, padding: "10px 14px", borderRadius: 12, background: "var(--error-soft)", color: "var(--error-ink)", fontSize: 12.5, fontWeight: 700 }}>
            {err}
          </div>
        )}

        <div style={{ marginTop: 34 }}>
          <button onClick={() => nav("echo")} style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 13, fontWeight: 600, ...bf }}>
            Skip for now — take me to the dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
