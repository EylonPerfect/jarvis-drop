import { useState } from "react";
import type { CSSProperties } from "react";
import { api } from "../api/client";
import "../pds.css";

// ============================================================
// Pricing page — AfterHuman marketing site (from Pricing
// Page.dc.html, design v2). Static marketing page: three pricing
// tiers (Team, Growth, Enterprise), an "every plan includes"
// panel, FAQ, CTA band, and footer. All prices, features, and
// FAQ copy are marketing copy ported verbatim from the design.
// The design is light-only; a theme toggle is added per the app
// convention, mapping the landing page token set for dark mode.
// ============================================================

const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));

const RESPONSIVE = `
@media (max-width: 900px) { .ahp-tier-grid { grid-template-columns: 1fr !important; } }
`;

type Tier = {
  name: string; tagline: string; price: string; unit: string;
  cta: string; view: string; featured: boolean; plan?: string;
  pad: number; frame: string; shadow: string; innerRadius: number;
  cardBg?: string; ink?: string; sub?: string; check?: string;
  ctaBg?: string; ctaColor?: string; ctaBorder?: string;
  feats: string[];
};

const TIERS: Tier[] = [
  {
    name: "Team", tagline: "For a first clone of one top rep.", price: "$2,000", unit: "/ clone / month",
    cta: "Start with one clone", view: "clonerep", featured: false, plan: "starter",
    pad: 1, frame: "rgba(0,0,64,.1)", shadow: "0 4px 16px rgba(0,0,0,.06)", innerRadius: 23,
    ctaBg: "transparent",
    feats: ["1 clone cleared for live", "Live call cockpit", "Standard calibration and quality checks", "Dedicated inbox, Slack, calendar", "Email support"],
  },
  {
    name: "Growth", tagline: "For a team scaling several clones.", price: "$1,500", unit: "/ clone / month",
    cta: "Book a demo", view: "echo", featured: true, plan: "growth",
    pad: 2, frame: "linear-gradient(79deg, #FF0660, #A342FF, #00BBFF)", shadow: "0 20px 50px rgba(163,66,255,.28)", innerRadius: 22,
    cardBg: "#04042A", ink: "#fff", sub: "rgba(255,255,255,.6)", check: "#4BE39A",
    ctaBg: "#FF0660", ctaColor: "#fff", ctaBorder: "none",
    feats: ["Up to 10 clones", "Priority calibration and drill decks", "Custom screen graphs per product", "Multi-model AI core with your keys", "Shared Slack channel support"],
  },
  {
    name: "Enterprise", tagline: "For org-wide digital workforce.", price: "Custom", unit: "tailored to your needs",
    cta: "Talk to sales", view: "echo", featured: false,
    pad: 1, frame: "rgba(0,0,64,.1)", shadow: "0 4px 16px rgba(0,0,0,.06)", innerRadius: 23,
    ctaBorder: "none",
    feats: ["Unlimited clones", "SSO, audit logs, data residency", "On-prem or private model hosting", "Dedicated success and onboarding", "SLA and security review"],
  },
];

const INCLUDED: { icon: string; title: string; desc: string }[] = [
  { icon: "verified", title: "Quality checks", desc: "No clone goes live until it passes every check." },
  { icon: "shield", title: "Grounding guardrails", desc: "Blocks ungrounded claims before they are spoken." },
  { icon: "pan_tool", title: "Human in the loop", desc: "A director can hold or take over any call." },
  { icon: "history", title: "Full provenance", desc: "Every phrase traces to a call or correction." },
];

const FAQS: { q: string; a: string }[] = [
  { q: "What counts as one clone?", a: "One digital worker cloned from one person. You can retrain or re-run its quality checks as often as you like at no extra cost." },
  { q: "Do you charge for calibration?", a: "No. Cloning, calibration, and quality checks are included in every plan. You pay for clones that are on the clock." },
  { q: "Whose voice and accounts does it use?", a: "The clone uses its own dedicated inbox and logins that you provision, and speaks in the cloned voice of the source person with their consent." },
  { q: "Can we bring our own models?", a: "Yes. On Growth and Enterprise you connect your own API keys and route each job to the model you trust." },
];

const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

export default function PricingPage() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  // A paid tier's CTA starts hosted Checkout; on any failure (not signed in /
  // billing not configured) we fall back to the in-app Billing screen so the
  // buyer still lands somewhere useful. Enterprise/free tiers just navigate.
  async function onTierCta(t: Tier) {
    if (!t.plan) { nav(t.view); return; }
    try {
      const r = await api.post<{ url?: string }>("/api/billing/checkout", { plan: t.plan, quantity: 1 });
      if (r.url) { window.location.href = r.url; return; }
    } catch { /* fall through */ }
    nav("billing");
  }
  const dark = theme === "dark";
  const bg = dark ? "#04042A" : "#FFFEFE";
  const panel = dark ? "#0B0B33" : "#F5F5F7";
  const navBg = dark ? "rgba(16,16,60,.72)" : "rgba(255,255,255,.7)";
  const navBorder = dark ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.7)";

  return (
    <div className="pds pds-scroll" data-theme={theme} style={{ height: "100vh", overflowY: "auto", background: bg, color: "var(--ink1)", transition: "background .2s ease" }}>
      <style>{RESPONSIVE}</style>

      {/* NAV */}
      <div style={{ position: "sticky", top: 0, zIndex: 30, padding: "16px 24px 6px" }}>
        <nav style={{ maxWidth: 1160, margin: "0 auto", height: 62, borderRadius: 9999, background: navBg, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: `1px solid ${navBorder}`, boxShadow: "0 4px 16px rgba(0,0,0,.08)", display: "flex", alignItems: "center", gap: 14, padding: "0 12px 0 22px" }}>
          <button onClick={() => nav("landing")} style={{ display: "flex", alignItems: "center", gap: 10, border: "none", background: "transparent", padding: 0, color: "var(--ink1)", ...btnFont }}>
            <img src="/assets/afterhuman-mark.svg" alt="AfterHuman" style={{ width: 32, height: 32, display: "block" }} />
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.02em" }}>AfterHuman</div>
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 18 }}>
            <button onClick={() => nav("landing")} style={{ border: "none", background: "transparent", padding: 0, fontSize: 14, fontWeight: 500, color: "var(--ink2)", ...btnFont }}>How it works</button>
            <button onClick={() => nav("landing")} style={{ border: "none", background: "transparent", padding: 0, fontSize: 14, fontWeight: 500, color: "var(--ink2)", ...btnFont }}>Product</button>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink1)" }}>Pricing</span>
            <button onClick={() => nav("echo")} style={{ border: "none", background: "transparent", padding: 0, fontSize: 14, fontWeight: 600, color: "var(--ink1)", ...btnFont }}>Sign in</button>
            <button onClick={() => setTheme(dark ? "light" : "dark")} title="Toggle theme" style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: "var(--border)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }}>
              <span className="material-symbols-rounded" style={{ fontSize: 20 }}>{dark ? "light_mode" : "dark_mode"}</span>
            </button>
            <button onClick={() => nav("echo")} style={{ display: "flex", alignItems: "center", gap: 7, height: 44, padding: "0 20px", borderRadius: 9999, border: "none", background: "#FF0660", color: "#fff", fontSize: 14, fontWeight: 700, letterSpacing: ".03em", boxShadow: "0 8px 24px rgba(255,6,96,.3)", ...btnFont }}>Book a demo</button>
          </div>
        </nav>
      </div>

      {/* HEADER */}
      <section style={{ position: "relative", overflow: "hidden", textAlign: "center", padding: "64px 24px 30px" }}>
        <div style={{ position: "absolute", top: -120, left: "50%", transform: "translateX(-50%)", width: 720, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(163,66,255,.14), transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#A342FF", marginBottom: 14 }}>Pricing</div>
          <h1 style={{ margin: 0, fontSize: 48, fontWeight: 300, letterSpacing: "-.03em", lineHeight: 1.05 }}>
            Pay per clone,<br /><span style={{ fontWeight: 700 }}>priced like a hire, not a seat</span>
          </h1>
          <p style={{ margin: "18px auto 0", fontSize: 17, color: "var(--ink2)", maxWidth: 540, lineHeight: 1.55 }}>
            Every plan includes calibration, certification, and a readiness gate before any clone goes live. Scale by adding clones, not tools.
          </p>
        </div>
      </section>

      {/* TIERS */}
      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 24px 20px" }}>
        <div className="ahp-tier-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, alignItems: "start" }}>
          {TIERS.map((t) => {
            const cardBg = t.cardBg ?? "var(--card)";
            const ink = t.ink ?? "var(--ink1)";
            const sub = t.sub ?? "var(--ink2)";
            const check = t.check ?? "#0E8A4F";
            const ctaBg = t.ctaBg ?? (t.name === "Enterprise" ? (dark ? "#fff" : "#000040") : "transparent");
            const ctaColor = t.ctaColor ?? (t.name === "Enterprise" ? (dark ? "#000040" : "#fff") : "var(--ink1)");
            const ctaBorder = t.ctaBorder ?? "2px solid var(--border)";
            return (
              <div key={t.name} style={{ borderRadius: 24, padding: t.pad, background: t.frame, boxShadow: t.shadow }}>
                <div style={{ background: cardBg, borderRadius: t.innerRadius, padding: 30, color: ink, height: "100%" }}>
                  {t.featured && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", padding: "5px 11px", borderRadius: 9999, background: "rgba(255,255,255,.22)", color: "#fff", marginBottom: 16 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 15 }}>star</span>Most popular
                    </div>
                  )}
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{t.name}</div>
                  <div style={{ fontSize: 13, color: sub, marginTop: 4, minHeight: 38 }}>{t.tagline}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "18px 0 4px" }}>
                    <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-.03em" }}>{t.price}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: sub }}>{t.unit}</span>
                  </div>
                  <button onClick={() => onTierCta(t)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 48, borderRadius: 9999, margin: "22px 0", background: ctaBg, color: ctaColor, border: ctaBorder, fontSize: 14.5, fontWeight: 700, letterSpacing: ".02em", ...btnFont }}>{t.cta}</button>
                  <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                    {t.feats.map((f) => (
                      <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, fontWeight: 500, lineHeight: 1.4 }}>
                        <span className="material-symbols-rounded" style={{ fontSize: 19, color: check, flexShrink: 0 }}>check_circle</span>{f}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* EVERY PLAN INCLUDES */}
      <section style={{ maxWidth: 1120, margin: "30px auto 0", padding: "0 24px" }}>
        <div style={{ background: panel, borderRadius: 24, padding: "34px 36px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 20 }}>Every plan includes</div>
          <div className="ahp-tier-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
            {INCLUDED.map((i) => (
              <div key={i.title} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                <span className="material-symbols-rounded" style={{ fontSize: 22, color: "#A342FF" }}>{i.icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{i.title}</div>
                  <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 3, lineHeight: 1.45 }}>{i.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ maxWidth: 780, margin: "0 auto", padding: "60px 24px" }}>
        <h2 style={{ margin: "0 0 26px", fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", textAlign: "center" }}>Common questions</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {FAQS.map((q) => (
            <div key={q.q} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 20px" }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{q.q}</div>
              <div style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.5 }}>{q.a}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA BAND */}
      <section style={{ maxWidth: 1120, margin: "0 auto 70px", padding: "0 24px" }}>
        <div style={{ borderRadius: 26, background: "linear-gradient(79deg, #FF0660, #A342FF, #00BBFF)", padding: "46px 40px", color: "#fff", display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em" }}>Not sure how many clones you need?</div>
            <div style={{ fontSize: 15, opacity: 0.85, marginTop: 8 }}>Tell us your team and volume, and we will map it to a plan.</div>
          </div>
          <button onClick={() => nav("echo")} style={{ display: "flex", alignItems: "center", gap: 8, height: 54, padding: "0 28px", borderRadius: 9999, border: "none", background: "#fff", color: "#000040", fontSize: 16, fontWeight: 700, boxShadow: "0 8px 24px rgba(0,0,0,.18)", ...btnFont }}>
            Talk to sales<span className="material-symbols-rounded" style={{ fontSize: 20 }}>arrow_forward</span>
          </button>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid var(--divider)", background: panel }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "34px 24px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/assets/afterhuman-mark.svg" alt="AfterHuman" style={{ width: 28, height: 28, display: "block" }} />
            <div style={{ fontSize: 15, fontWeight: 700 }}>AfterHuman</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 22, fontSize: 13, fontWeight: 500, color: "var(--ink2)" }}>
            <button onClick={() => nav("landing")} style={{ border: "none", background: "transparent", padding: 0, fontSize: 13, fontWeight: 500, color: "var(--ink2)", ...btnFont }}>Home</button>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink2)" }}>Pricing</span>
            <button onClick={() => nav("echo")} style={{ border: "none", background: "transparent", padding: 0, fontSize: 13, fontWeight: 500, color: "var(--ink2)", ...btnFont }}>Sign in</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
