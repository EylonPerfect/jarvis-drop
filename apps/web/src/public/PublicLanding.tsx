import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Icon, PublicNav, PublicFooter, PublicShell, type Nav } from "./PublicChrome";

// ============================================================
// After Human — public landing page. Faithful recreation of
// "Landing Page.dc.html": animated Zoom-style hero that cycles
// joining -> in call (voice) -> screen share (fake
// app.goperfect.com/pipeline dashboard), trust bar, how it
// works, three capability rows, gradient stats band, final CTA,
// footer. All motion respects prefers-reduced-motion (handled in
// public.css). Copy is sentence case, no exclamation marks, no
// em dashes.
// ============================================================

type Phase = {
  connecting: boolean;
  voiceOn: boolean;
  sharing: boolean;
  status: string;
  caption: string;
};

const PHASES: Phase[] = [
  { connecting: true, voiceOn: false, sharing: false, status: "Joining", caption: "" },
  { connecting: false, voiceOn: true, sharing: false, status: "In call", caption: "Thanks for the time, Dana. Let me pull up your pipeline." },
  { connecting: false, voiceOn: true, sharing: true, status: "Sharing screen", caption: "Sharing my screen now, here is your role mix." },
  { connecting: false, voiceOn: true, sharing: true, status: "Sharing screen", caption: "Engineering is where the scoring earns its keep." },
];

const STEPS = [
  { n: "1", icon: "graphic_eq", title: "Clone", desc: "Feed recordings of one top rep. We extract their style, phrases, and knowledge." },
  { n: "2", icon: "tune", title: "Calibrate", desc: "Tune the clone turn by turn until it sounds and decides like them." },
  { n: "3", icon: "verified", title: "Certify", desc: "It clears 7 gates for grounding, latency, and fidelity before it goes live." },
  { n: "4", icon: "work", title: "Works", desc: "It joins calls from its calendar, posts to Slack, and sends follow-ups." },
];

type Chip = { icon: string; color: string; title: string; sub: string; badge?: string; badgeBg?: string; badgeColor?: string };
type Feature = {
  textOrder: number;
  visualOrder: number;
  tag: string;
  tagBg: string;
  tagColor: string;
  icon: string;
  title: string;
  body: string;
  points: string[];
  visualBg: string;
  visualInk: CSSProperties;
  chipBg: string;
  chips: Chip[];
};

const FEATURES: Feature[] = [
  {
    textOrder: 1, visualOrder: 2,
    tag: "Real fidelity", tagBg: "#F1E3FF", tagColor: "#6B2BB5", icon: "fingerprint",
    title: "Cloned from your best, not a generic bot",
    body: "Every clone is mirrored from a specific person and scored against their real calls, so it carries their judgment, not a template.",
    points: ["Style vector from real recordings", "Signature phrases with provenance", "Grounded on your product facts"],
    visualBg: "#04042A", visualInk: { color: "#fff" }, chipBg: "rgba(255,255,255,.05)",
    chips: [
      { icon: "tune", color: "#CBA3FF", title: "Tone and empathy", sub: "matched to source", badge: "97", badgeBg: "rgba(46,211,125,.18)", badgeColor: "#4BE39A" },
      { icon: "format_quote", color: "#CBA3FF", title: "Signature phrases", sub: "from 18 calls" },
      { icon: "database", color: "#CBA3FF", title: "Product knowledge", sub: "confidence-flagged", badge: "95", badgeBg: "rgba(46,211,125,.18)", badgeColor: "#4BE39A" },
    ],
  },
  {
    textOrder: 2, visualOrder: 1,
    tag: "Human in the loop", tagBg: "#FFE0EB", tagColor: "#D8004E", icon: "pan_tool",
    title: "Goes live with a director on console",
    body: "A person supervises every call from a hidden console, holds a response before it speaks, and steers with one thumb.",
    points: ["Grace window to hold any turn", "Live nudges and dual ratings", "Panic controls always in reach"],
    visualBg: "var(--panel)", visualInk: { color: "var(--ink1)" }, chipBg: "var(--card)",
    chips: [
      { icon: "pan_tool", color: "#FF0660", title: "Hold", sub: "before Maya responds", badge: "live", badgeBg: "#FFE0EB", badgeColor: "#D8004E" },
      { icon: "ads_click", color: "#A342FF", title: "Nudge", sub: "cite the ROI number" },
      { icon: "shield", color: "#0E8A4F", title: "Grounding gate", sub: "no ungrounded numbers", badge: "on", badgeBg: "#E8F9EF", badgeColor: "#0E8A4F" },
    ],
  },
  {
    textOrder: 1, visualOrder: 2,
    tag: "Works like an employee", tagBg: "#D6F3FF", tagColor: "#0089c4", icon: "badge",
    title: "On the clock with its own accounts",
    body: "Once certified, the clone has a dedicated inbox, joins calls from its calendar, and keeps the team posted, all reviewable by you.",
    points: ["Dedicated inbox for email and follow-ups", "Posts updates to Slack", "Auto-joins calls it is invited to"],
    visualBg: "var(--panel)", visualInk: { color: "var(--ink1)" }, chipBg: "var(--card)",
    chips: [
      { icon: "calendar_month", color: "#00BBFF", title: "4 calls today", sub: "next in 8 minutes" },
      { icon: "forum", color: "#A342FF", title: "Posted to #northwind", sub: "QBR recap and next steps" },
      { icon: "outgoing_mail", color: "#FF0660", title: "Follow-up scheduled", sub: "sends in 3 days" },
    ],
  },
];

const BARS = [0, 1, 2, 3, 4].map((i) => `${(i * 0.12).toFixed(2)}s`);

export default function PublicLanding({ nav }: { nav: Nav }) {
  const [p, setP] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const cycle = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      [0, 1500, 4000, 6800].forEach((ms, idx) => timers.current.push(setTimeout(() => setP(idx), ms)));
      timers.current.push(setTimeout(cycle, 9600));
    };
    cycle();
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const ph = PHASES[p];
  const ringAnim = ph.voiceOn ? "ahpRing 1.6s ease-in-out infinite" : "none";
  const micGlyph = ph.voiceOn ? "mic" : "mic_off";

  return (
    <PublicShell theme={nav.theme}>
      <PublicNav nav={nav} active="landing" onAnchor={scrollToId} />

      {/* HERO */}
      <section style={{ position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -140, left: -80, width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,6,96,.16), transparent 70%)", pointerEvents: "none", animation: "ahpFloatA 9s ease-in-out infinite" }} />
        <div style={{ position: "absolute", top: -60, right: -60, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(163,66,255,.16), transparent 70%)", pointerEvents: "none", animation: "ahpFloatB 11s ease-in-out infinite" }} />
        <div style={{ position: "absolute", top: 220, right: 240, width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,187,255,.14), transparent 70%)", pointerEvents: "none", animation: "ahpFloatC 10s ease-in-out infinite" }} />

        <div className="ahp-hero-grid" style={{ position: "relative", maxWidth: 1160, margin: "0 auto", padding: "70px 24px 60px", display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: 40, alignItems: "center" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, letterSpacing: ".02em", padding: "7px 14px", borderRadius: 9999, background: "#F1E3FF", color: "#6B2BB5", marginBottom: 22 }}>
              <Icon name="auto_awesome" style={{ fontSize: 16 }} />Employment OS for digital workers
            </div>
            <h1 style={{ margin: 0, fontSize: 54, fontWeight: 300, letterSpacing: "-.03em", lineHeight: 1.02 }}>
              Your AI sales and<br />customer success team,<br /><span style={{ fontWeight: 700 }}>cloned from your best.</span>
            </h1>
            <p style={{ margin: "22px 0 0", fontSize: 17, fontWeight: 400, color: "var(--ink2)", maxWidth: 500, lineHeight: 1.55 }}>
              After Human clones a top rep into a digital worker that joins live calls in their voice, runs demos, and follows up. It goes live only after it clears your readiness bar, and it always says it is an AI.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); nav.go("#/auth"); }} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 30, maxWidth: 520, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 240, height: 54, padding: "0 8px 0 18px", borderRadius: 9999, background: "var(--card)", border: "2px solid var(--border)" }}>
                <Icon name="mail" style={{ fontSize: 20, color: "var(--ink3)" }} />
                <input type="email" placeholder="Your work email" style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 15, fontWeight: 500, color: "var(--ink1)" }} />
              </div>
              <button type="submit" style={{ display: "flex", alignItems: "center", gap: 8, height: 54, padding: "0 26px", border: "none", borderRadius: 9999, background: "#FF0660", color: "#fff", fontSize: 16, fontWeight: 700, letterSpacing: ".02em", cursor: "pointer", boxShadow: "0 8px 24px rgba(255,6,96,.3)" }}>
                Start free<Icon name="arrow_forward" style={{ fontSize: 20 }} />
              </button>
            </form>
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 18, flexWrap: "wrap" }}>
              <a href="#/ava" onClick={(e) => { e.preventDefault(); nav.go("#/ava"); }} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: "#FF0660" }}><Icon name="videocam" style={{ fontSize: 18, color: "#FF0660" }} />Talk live with our AI rep now</a>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500, color: "var(--ink3)" }}><Icon name="check_circle" style={{ fontSize: 18, color: "#0E8A4F" }} />Free to start, no card</div>
              <a href="#/ava" onClick={(e) => { e.preventDefault(); nav.go("#/ava"); }} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#FF0660" }}><Icon name="graphic_eq" style={{ fontSize: 18 }} />Talk to Ava live</a>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* product preview */}
            <div style={{ borderRadius: 24, padding: 2, background: "linear-gradient(79deg, #FF0660, #A342FF, #00BBFF)", boxShadow: "0 24px 60px rgba(0,0,64,.16)", animation: "ahpCard 6s ease-in-out infinite" }}>
              <div style={{ background: "#0B0B30", borderRadius: 22, overflow: "hidden", color: "#fff" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "12px 16px", background: "rgba(255,255,255,.04)", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#FF5F57" }} />
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#FEBC2E" }} />
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28C840" }} />
                  <div style={{ marginLeft: 6, fontSize: 12, fontWeight: 700 }}>GoPerfect QBR</div>
                  <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,.6)" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#FF0660", animation: "ahpDot 1.4s ease-in-out infinite" }} />{ph.status}
                  </div>
                </div>
                <div style={{ position: "relative", height: 208, padding: 14, background: "linear-gradient(160deg, #14144a, #0B0B30)" }}>
                  {!ph.sharing && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, height: "100%" }}>
                      <div style={{ position: "relative", borderRadius: 14, background: "rgba(255,255,255,.05)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 9 }}>
                        <div style={{ width: 60, height: 60, borderRadius: "50%", background: "radial-gradient(circle at 30% 30%, rgba(255,6,96,.5), rgba(163,66,255,.45))", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, animation: ringAnim }}>MC</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}><Icon name={micGlyph} style={{ fontSize: 14, color: "#4BE39A" }} /><span style={{ fontSize: 12, fontWeight: 700 }}>Maya</span></div>
                        {ph.voiceOn && (
                          <div style={{ position: "absolute", bottom: 12, display: "flex", alignItems: "flex-end", gap: 3, height: 13 }}>
                            {BARS.map((d, i) => (
                              <div key={i} style={{ width: 3, height: "100%", background: "#4BE39A", borderRadius: 2, transformOrigin: "bottom", animation: "ahpWave .9s ease-in-out infinite", animationDelay: d }} />
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ borderRadius: 14, background: "rgba(255,255,255,.05)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 9 }}>
                        <div style={{ width: 60, height: 60, borderRadius: "50%", background: "rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18 }}>DK</div>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>Dana</span>
                      </div>
                    </div>
                  )}
                  {ph.sharing && (
                    <div style={{ height: "100%", borderRadius: 14, background: "#F5F5F7", color: "#000040", position: "relative", overflow: "hidden" }}>
                      <div style={{ height: 22, display: "flex", alignItems: "center", gap: 5, padding: "0 9px", background: "#fff", borderBottom: "1px solid rgba(0,0,64,.08)", position: "relative", zIndex: 3 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#FF5F57" }} />
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#FEBC2E" }} />
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#28C840" }} />
                        <div style={{ marginLeft: 8, flex: 1, height: 12, borderRadius: 6, background: "#EBEBEE", display: "flex", alignItems: "center", padding: "0 8px", fontSize: 7, fontWeight: 600, color: "rgba(0,0,64,.45)" }}>app.goperfect.com/pipeline</div>
                      </div>
                      <div style={{ position: "absolute", inset: "22px 0 0", overflow: "hidden" }}>
                        <div style={{ padding: "12px 14px", animation: "ahpScreenScroll 8s ease-in-out infinite" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "-.01em" }}>Pipeline overview</div>
                            <div style={{ fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 9999, background: "#E0E0F5", color: "#000072" }}>Q3 · all roles</div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7, marginTop: 10 }}>
                            {[
                              { l: "Qualified", v: "312", c: "#000040" },
                              { l: "Avg fit", v: "78", c: "#000040" },
                              { l: "Accept", v: "64%", c: "#0E8A4F" },
                            ].map((k) => (
                              <div key={k.l} style={{ background: "#fff", borderRadius: 9, padding: "8px 9px" }}>
                                <div style={{ fontSize: 7, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "rgba(0,0,64,.4)" }}>{k.l}</div>
                                <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.02em", color: k.c }}>{k.v}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ background: "#fff", borderRadius: 11, padding: "11px 12px", marginTop: 9 }}>
                            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#A342FF" }}>Role mix</div>
                            <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 66, marginTop: 9 }}>
                              {["92%", "60%", "44%", "30%", "22%"].map((h, i) => (
                                <div key={i} style={{ flex: 1, height: h, background: ["#A342FF", "rgba(163,66,255,.5)", "rgba(163,66,255,.32)", "rgba(163,66,255,.22)", "rgba(163,66,255,.18)"][i], borderRadius: 4 }} />
                              ))}
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 6.5, fontWeight: 600, color: "rgba(0,0,64,.45)", marginTop: 5 }}><span>Eng</span><span>Sales</span><span>Ops</span><span>Design</span><span>Finance</span></div>
                          </div>
                          <div style={{ fontSize: 8.5, fontWeight: 600, color: "rgba(0,0,64,.5)", marginTop: 8 }}>Engineering leads at 42% of qualified candidates</div>
                          <div style={{ background: "#fff", borderRadius: 11, padding: "10px 12px", marginTop: 9 }}>
                            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(0,0,64,.4)", marginBottom: 7 }}>Top candidates</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                              {[
                                { in: "AR", n: "Amir Rahimi · Staff Engineer", s: "94", c: "#0E8A4F" },
                                { in: "SL", n: "Sofia Lindqvist · Backend", s: "89", c: "#0E8A4F" },
                                { in: "TO", n: "Tunde Okafor · Platform", s: "76", c: "#8A6A00" },
                                { in: "MK", n: "Mara Kovac · Frontend", s: "71", c: "#8A6A00" },
                              ].map((r) => (
                                <div key={r.in} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <div style={{ width: 16, height: 16, borderRadius: "50%", background: "radial-gradient(circle at 30% 30%, #FFE0EB, #F1E3FF)", fontSize: 6.5, fontWeight: 700, color: "#D8004E", display: "flex", alignItems: "center", justifyContent: "center" }}>{r.in}</div>
                                  <div style={{ flex: 1, fontSize: 8.5, fontWeight: 600 }}>{r.n}</div>
                                  <div style={{ fontSize: 8.5, fontWeight: 800, color: r.c }}>{r.s}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div style={{ position: "absolute", top: 22, left: 0, zIndex: 4, animation: "ahpCursorMove 8s ease-in-out infinite", pointerEvents: "none" }}>
                        <Icon name="arrow_selector_tool" style={{ fontSize: 17, color: "#04042A", filter: "drop-shadow(0 1px 2px rgba(255,255,255,.9))", display: "block", animation: "ahpCursorClick 8s ease-in-out infinite" }} />
                      </div>
                      <div style={{ position: "absolute", right: 10, bottom: 10, zIndex: 5, width: 50, height: 38, borderRadius: 9, background: "#0B0B30", border: "1.5px solid rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "radial-gradient(circle at 30% 30%, rgba(255,6,96,.5), rgba(163,66,255,.45))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", animation: ringAnim }}>MC</div>
                      </div>
                      <span style={{ position: "absolute", left: 10, bottom: 10, zIndex: 5, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, fontWeight: 700, padding: "3px 8px", borderRadius: 9999, background: "rgba(255,6,96,.14)", color: "#D8004E" }}>
                        <Icon name="present_to_all" style={{ fontSize: 12 }} />Maya is sharing
                      </span>
                    </div>
                  )}
                  {ph.connecting && (
                    <div style={{ position: "absolute", inset: 14, borderRadius: 14, background: "rgba(11,11,48,.88)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
                      <Icon name="progress_activity" style={{ fontSize: 30, color: "#CBA3FF", animation: "ahpSpin 1.2s linear infinite" }} />
                      <div style={{ fontSize: 13, fontWeight: 700 }}>Maya is joining the call</div>
                    </div>
                  )}
                </div>
                <div style={{ minHeight: 44, padding: "10px 16px", background: "rgba(255,255,255,.03)", borderTop: "1px solid rgba(255,255,255,.07)" }}>
                  {ph.voiceOn && (
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <Icon name="graphic_eq" style={{ fontSize: 16, color: "#4BE39A", marginTop: 1 }} />
                      <div key={`c${p}`} style={{ fontSize: 12, lineHeight: 1.4, color: "rgba(255,255,255,.85)", animation: "ahpRise .4s ease" }}>{ph.caption}</div>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 12, background: "rgba(0,0,0,.25)" }}>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: ph.voiceOn ? "#2ED37D" : "rgba(255,255,255,.12)", color: ph.voiceOn ? "#04042A" : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={micGlyph} style={{ fontSize: 19 }} /></div>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,.12)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="videocam" style={{ fontSize: 19 }} /></div>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: ph.sharing ? "#FF0660" : "rgba(255,255,255,.12)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="present_to_all" style={{ fontSize: 19 }} /></div>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#E1173F", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="call_end" style={{ fontSize: 19 }} /></div>
                </div>
              </div>
            </div>
            <a href="#/ava" onClick={(e) => { e.preventDefault(); nav.go("#/ava"); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, height: 60, borderRadius: 9999, background: "#FF0660", color: "#fff", fontSize: 17, fontWeight: 700, letterSpacing: ".02em", boxShadow: "0 8px 24px rgba(255,6,96,.3)" }}>
              <Icon name="graphic_eq" style={{ fontSize: 22 }} />Talk to Ava now
            </a>
          </div>
        </div>

        {/* trust bar */}
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "8px 24px 50px", display: "flex", alignItems: "center", gap: 36, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ink3)" }}>Trusted by revenue teams at</span>
          <span style={{ display: "inline-flex", alignItems: "center", fontSize: 21, fontWeight: 600, letterSpacing: "-.01em", color: "var(--ink2)", fontFamily: "Georgia, 'Times New Roman', serif" }}>Harvey</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 1, fontSize: 20, fontWeight: 800, letterSpacing: "-.03em", color: "var(--ink2)" }}>Base<span style={{ color: "#FF0660" }}>44</span></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 20, fontWeight: 700, letterSpacing: "-.02em", color: "var(--ink2)" }}><Icon name="favorite" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1", color: "#FF4D6D" }} />Lovable</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 20, fontWeight: 700, letterSpacing: "-.02em", color: "var(--ink2)" }}><span style={{ width: 22, height: 22, borderRadius: 5, border: "1.5px solid var(--ink2)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>N</span>Notion</span>
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, fontSize: 20, fontWeight: 800, letterSpacing: "-.03em", color: "var(--ink2)" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#FF3D57" }} /><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#FFCB00" }} /><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#00CA72" }} /></span>monday<span style={{ fontWeight: 500, color: "var(--ink3)" }}>.com</span></span>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" style={{ maxWidth: 1160, margin: "0 auto", padding: "60px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 44 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#A342FF", marginBottom: 12 }}>How it works</div>
          <h2 style={{ margin: 0, fontSize: 38, fontWeight: 700, letterSpacing: "-.02em" }}>From your best rep to a certified clone</h2>
        </div>
        <div className="ahp-feat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
          {STEPS.map((s) => (
            <div key={s.n} style={{ background: "var(--panel)", borderRadius: 20, padding: 24 }}>
              <div style={{ width: 44, height: 44, borderRadius: 13, background: "#fff", color: "#6B2BB5", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, boxShadow: "0 4px 16px rgba(0,0,0,.06)" }}><Icon name={s.icon} style={{ fontSize: 24 }} /></div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 6 }}>Step {s.n}</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{s.title}</div>
              <div style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.5 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CAPABILITIES */}
      <section id="capabilities" style={{ maxWidth: 1160, margin: "0 auto", padding: "40px 24px 20px" }}>
        {FEATURES.map((f, i) => (
          <div key={i} className="ahp-feat-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 44, alignItems: "center", padding: "44px 0", borderTop: "1px solid var(--divider)" }}>
            <div style={{ order: f.textOrder }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, letterSpacing: ".02em", padding: "6px 12px", borderRadius: 9999, background: f.tagBg, color: f.tagColor, marginBottom: 18 }}><Icon name={f.icon} style={{ fontSize: 16 }} />{f.tag}</div>
              <h3 style={{ margin: "0 0 12px", fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.15 }}>{f.title}</h3>
              <p style={{ margin: "0 0 18px", fontSize: 15.5, color: "var(--ink2)", lineHeight: 1.55 }}>{f.body}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {f.points.map((pt) => (
                  <div key={pt} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 500 }}><Icon name="check_circle" style={{ fontSize: 20, color: "#0E8A4F" }} />{pt}</div>
                ))}
              </div>
            </div>
            <div style={{ order: f.visualOrder, background: f.visualBg, borderRadius: 22, padding: 26, minHeight: 260, display: "flex", flexDirection: "column", justifyContent: "center", gap: 12, ...f.visualInk }}>
              {f.chips.map((c, ci) => (
                <div key={ci} style={{ display: "flex", alignItems: "center", gap: 12, background: f.chipBg, borderRadius: 14, padding: "14px 16px" }}>
                  <Icon name={c.icon} style={{ fontSize: 22, color: c.color }} />
                  <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 700 }}>{c.title}</div><div style={{ fontSize: 12, opacity: 0.6 }}>{c.sub}</div></div>
                  {c.badge && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 9999, background: c.badgeBg, color: c.badgeColor }}>{c.badge}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* STATS */}
      <section style={{ maxWidth: 1160, margin: "40px auto", padding: "0 24px" }}>
        <div style={{ borderRadius: 26, background: "linear-gradient(79deg, #FF0660, #A342FF, #00BBFF)", padding: "48px 40px", color: "#fff" }}>
          <div className="ahp-feat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 30 }}>
            {[
              { v: "92%", l: "average fidelity to the source rep" },
              { v: "71%", l: "of conversations auto-resolved" },
              { v: "1,910", l: "human-hours saved each week" },
              { v: "7", l: "gates every clone clears first" },
            ].map((s) => (
              <div key={s.l}><div style={{ fontSize: 46, fontWeight: 800, letterSpacing: "-.03em" }}>{s.v}</div><div style={{ fontSize: 14, fontWeight: 500, opacity: 0.85, marginTop: 4 }}>{s.l}</div></div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section id="pricing-cta" style={{ maxWidth: 900, margin: "0 auto", padding: "70px 24px 90px", textAlign: "center" }}>
        <h2 style={{ margin: 0, fontSize: 42, fontWeight: 700, letterSpacing: "-.025em", lineHeight: 1.08 }}>Clone your best rep this week</h2>
        <p style={{ margin: "16px auto 0", fontSize: 17, color: "var(--ink2)", maxWidth: 520, lineHeight: 1.55 }}>Start free with recordings of one top performer. We handle the cloning, calibration, and certification. You stay in control on every call.</p>
        <form onSubmit={(e) => { e.preventDefault(); nav.go("#/auth"); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, margin: "30px auto 0", maxWidth: 520, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 240, height: 54, padding: "0 8px 0 18px", borderRadius: 9999, background: "var(--card)", border: "2px solid var(--border)" }}>
            <Icon name="mail" style={{ fontSize: 20, color: "var(--ink3)" }} />
            <input type="email" placeholder="Your work email" style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 15, fontWeight: 500, color: "var(--ink1)" }} />
          </div>
          <button type="submit" style={{ display: "flex", alignItems: "center", gap: 8, height: 54, padding: "0 28px", border: "none", borderRadius: 9999, background: "#FF0660", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 24px rgba(255,6,96,.3)" }}>Start free<Icon name="arrow_forward" style={{ fontSize: 20 }} /></button>
        </form>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 18, fontSize: 13, fontWeight: 500, color: "var(--ink3)" }}>
          Not ready to sign up? <a href="#/ava" onClick={(e) => { e.preventDefault(); nav.go("#/ava"); }} style={{ fontWeight: 600, color: "#FF0660" }}>Talk to Ava live</a> or <a href="#/pricing" onClick={(e) => { e.preventDefault(); nav.go("#/pricing"); }} style={{ fontWeight: 600, color: "var(--ink1)", textDecoration: "underline" }}>see pricing</a>
        </div>
      </section>

      <PublicFooter nav={nav} onAnchor={scrollToId} />

      {/* Persistent floating CTA — the single primary action, always in reach. */}
      <a
        href="#/ava"
        onClick={(e) => { e.preventDefault(); nav.go("#/ava"); }}
        aria-label="Talk to Ava, our live AI rep"
        style={{ position: "fixed", right: 24, bottom: 24, zIndex: 40, display: "inline-flex", alignItems: "center", gap: 9, height: 56, padding: "0 24px", borderRadius: 9999, background: "#FF0660", color: "#fff", fontSize: 15.5, fontWeight: 700, letterSpacing: ".02em", boxShadow: "0 12px 32px rgba(255,6,96,.42)", animation: "ahpCard 6s ease-in-out infinite" }}
      >
        <Icon name="graphic_eq" style={{ fontSize: 22 }} />Talk to Ava
      </a>
    </PublicShell>
  );
}
