import { Icon, PublicNav, PublicFooter, PublicShell, type Nav } from "./PublicChrome";

// ============================================================
// After Human — public pricing page. Recreated from "Pricing
// Page.dc.html" with the real, flat per-clone numbers from the
// brief: Free (Rehearsal), Starter, Growth (featured), and
// Enterprise. No overage or per-minute language on the public
// page; usage reads as generous and fair use stays invisible.
// Dark by default with a light toggle, consistent with the rest
// of the public site. Copy is sentence case, no exclamation
// marks, no em dashes.
// ============================================================

type Tier = {
  name: string;
  tagline: string;
  price: string;
  unit: string;
  cta: string;
  hash: string;
  featured: boolean;
  feats: string[];
};

const TIERS: Tier[] = [
  {
    name: "Rehearsal",
    tagline: "Clone, calibrate, and rehearse your first rep at no cost.",
    price: "$0",
    unit: "free forever",
    cta: "Start free",
    hash: "#/auth",
    featured: false,
    feats: [
      "1 clone",
      "Clone from recorded calls",
      "Unlimited calibration and rehearsal",
      "Readiness scoring up to 70 plus",
      "Going live needs a paid plan",
    ],
  },
  {
    name: "Starter",
    tagline: "For your first clone on real, live calls.",
    price: "$2,000",
    unit: "first clone / month, then $1,500 each",
    cta: "Start with Starter",
    hash: "#/auth",
    featured: false,
    feats: [
      "Up to 3 clones",
      "Everything in Rehearsal",
      "Director console on live calls",
      "Dedicated inbox, Slack, calendar",
      "Standard support",
    ],
  },
  {
    name: "Growth",
    tagline: "For a team scaling several clones.",
    price: "$1,500",
    unit: "/ clone / month",
    cta: "Book a demo",
    hash: "#/auth",
    featured: true,
    feats: [
      "Up to 15 clones",
      "Priority support",
      "Director console and A/B calibration",
      "Post-call debrief on every call",
      "Multi-model AI core with your keys",
    ],
  },
  {
    name: "Enterprise",
    tagline: "For an org-wide digital workforce.",
    price: "Custom",
    unit: "tailored to your team",
    cta: "Talk to sales",
    hash: "#/auth",
    featured: false,
    feats: [
      "Unlimited clones",
      "SSO, audit logs, data residency",
      "Dedicated customer success manager",
      "Security review and SLA",
      "Custom model routing",
    ],
  },
];

const INCLUDED = [
  { icon: "graphic_eq", title: "Clone from calls", desc: "Every clone is mirrored from one person's real recordings." },
  { icon: "tune", title: "Calibration and rehearsal", desc: "Tune and rehearse turn by turn, as much as you need." },
  { icon: "verified", title: "Readiness gate", desc: "Clones go live only once they reach a readiness score of 70 or more." },
  { icon: "campaign", title: "Mandatory AI disclosure", desc: "Every clone discloses that it is an AI on the call." },
  { icon: "grid_view", title: "Drives any product", desc: "The clone navigates and demos your live product on screen." },
  { icon: "history_edu", title: "Post-call debrief", desc: "Each call turns into deltas and memory the clone learns from." },
  { icon: "receipt_long", title: "Audit trail", desc: "Every phrase and action traces to a call or a correction." },
];

const FAQS = [
  { q: "What counts as one clone?", a: "One digital worker cloned from one person. You can retrain or re-certify it as often as you like at no extra cost." },
  { q: "Is there any usage or per-minute billing?", a: "No. Pricing is flat per clone per month. Rehearsals and demos are unlimited, and you are never charged per call or per minute." },
  { q: "What is free on the Rehearsal plan?", a: "Cloning, calibration, and rehearsal are free for one clone. Going live on real calls needs a paid plan." },
  { q: "Can we bring our own models?", a: "Yes. On Growth and Enterprise you connect your own API keys and route each job to the model you trust." },
];

export default function PublicPricing({ nav }: { nav: Nav }) {
  return (
    <PublicShell theme={nav.theme}>
      <PublicNav nav={nav} active="pricing" />

      {/* HEADER */}
      <section style={{ position: "relative", overflow: "hidden", textAlign: "center", padding: "64px 24px 30px" }}>
        <div style={{ position: "absolute", top: -120, left: "50%", transform: "translateX(-50%)", width: 720, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(163,66,255,.14), transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#A342FF", marginBottom: 14 }}>Pricing</div>
          <h1 style={{ margin: 0, fontSize: 48, fontWeight: 300, letterSpacing: "-.03em", lineHeight: 1.05 }}>Pay per clone,<br /><span style={{ fontWeight: 700 }}>priced like a hire, not a seat</span></h1>
          <p style={{ margin: "18px auto 0", fontSize: 17, color: "var(--ink2)", maxWidth: 560, lineHeight: 1.55 }}>Every plan includes calibration, rehearsal, and a readiness gate before any clone goes live. Scale by adding clones, not tools.</p>
        </div>
      </section>

      {/* TIERS */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 24px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 20, alignItems: "start" }}>
          {TIERS.map((t) => {
            const frame = t.featured ? "linear-gradient(79deg, #FF0660, #A342FF, #00BBFF)" : "var(--border)";
            const shadow = t.featured ? "0 20px 50px rgba(163,66,255,.28)" : "0 4px 16px rgba(0,0,0,.06)";
            const cardBg = t.featured ? "#04042A" : "var(--card)";
            const ink = t.featured ? "#fff" : "var(--ink1)";
            const sub = t.featured ? "rgba(255,255,255,.6)" : "var(--ink2)";
            const check = t.featured ? "#4BE39A" : "#0E8A4F";
            const ctaBg = t.featured ? "#FF0660" : t.name === "Enterprise" ? "#000040" : "transparent";
            const ctaColor = t.featured || t.name === "Enterprise" ? "#fff" : "var(--ink1)";
            const ctaBorder = !t.featured && t.name !== "Enterprise" ? "2px solid var(--border)" : "none";
            return (
              <div key={t.name} style={{ borderRadius: 24, padding: t.featured ? 2 : 1, background: frame, boxShadow: shadow }}>
                <div style={{ background: cardBg, borderRadius: t.featured ? 22 : 23, padding: 30, color: ink, height: "100%" }}>
                  {t.featured && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", padding: "5px 11px", borderRadius: 9999, background: "rgba(255,255,255,.22)", color: "#fff", marginBottom: 16 }}><Icon name="star" style={{ fontSize: 15 }} />Most popular</div>
                  )}
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{t.name}</div>
                  <div style={{ fontSize: 13, color: sub, marginTop: 4, minHeight: 38 }}>{t.tagline}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "18px 0 4px" }}>
                    <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-.03em" }}>{t.price}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: sub, minHeight: 34 }}>{t.unit}</div>
                  <a href={t.hash} onClick={(e) => { e.preventDefault(); nav.go(t.hash); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 9999, margin: "18px 0 22px", background: ctaBg, color: ctaColor, border: ctaBorder, fontSize: 14.5, fontWeight: 700, letterSpacing: ".02em" }}>{t.cta}</a>
                  <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                    {t.feats.map((f) => (
                      <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, fontWeight: 500, lineHeight: 1.4 }}><Icon name="check_circle" style={{ fontSize: 19, color: check, flexShrink: 0 }} />{f}</div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* EVERY PLAN INCLUDES */}
      <section style={{ maxWidth: 1180, margin: "30px auto 0", padding: "0 24px" }}>
        <div style={{ background: "var(--panel)", borderRadius: 24, padding: "34px 36px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 20 }}>Every plan includes</div>
          <div className="ahp-inc-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 22 }}>
            {INCLUDED.map((i) => (
              <div key={i.title} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                <Icon name={i.icon} style={{ fontSize: 22, color: "#A342FF" }} />
                <div><div style={{ fontSize: 14, fontWeight: 700 }}>{i.title}</div><div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 3, lineHeight: 1.45 }}>{i.desc}</div></div>
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
      <section style={{ maxWidth: 1180, margin: "0 auto 70px", padding: "0 24px" }}>
        <div style={{ borderRadius: 26, background: "linear-gradient(79deg, #FF0660, #A342FF, #00BBFF)", padding: "46px 40px", color: "#fff", display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em" }}>Not sure how many clones you need?</div>
            <div style={{ fontSize: 15, opacity: 0.85, marginTop: 8 }}>Tell us your team and volume, and we will map it to a plan.</div>
          </div>
          <a href="#/auth" onClick={(e) => { e.preventDefault(); nav.go("#/auth"); }} style={{ display: "flex", alignItems: "center", gap: 8, height: 54, padding: "0 28px", borderRadius: 9999, background: "#fff", color: "#000040", fontSize: 16, fontWeight: 700, boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}>Talk to sales<Icon name="arrow_forward" style={{ fontSize: 20 }} /></a>
        </div>
      </section>

      <PublicFooter nav={nav} />
    </PublicShell>
  );
}
