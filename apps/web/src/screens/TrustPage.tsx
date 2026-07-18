import { useState } from "react";
import type { CSSProperties } from "react";
import "../pds.css";

// ============================================================
// Public trust & security page — AfterHuman marketing surface.
// DATA GOVERNANCE (#2). Self-contained + namespaced (aht-*) so
// it never touches product screens or shared/global styles:
// it imports only pds.css (design tokens) and renders under the
// .pds scope like the marketing Landing/Pricing pages.
//
// Content is the authoritative governance story from CLAUDE.md
// "DATA GOVERNANCE (#2)" + "LAUNCH DECISIONS BATCH 4" and
// doubles as the answer to security questionnaires.
// ============================================================

const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));

const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

type Pillar = { icon: string; title: string; body: string; tint: string; ink: string };
const PILLARS: Pillar[] = [
  {
    icon: "lock",
    title: "Encryption at rest",
    body: "Customer data, transcripts, and stored credentials are encrypted at rest. Secrets are held server-side and never returned to the browser — only a masked hint is ever shown.",
    tint: "var(--purple-soft)",
    ink: "var(--purple-ink)",
  },
  {
    icon: "domain",
    title: "Per-org isolation",
    body: "Every organization's clones, sources, and connected systems are scoped to that org. A clone can only ever be summoned by a member of its own org — never cross-org, never public.",
    tint: "var(--success-soft)",
    ink: "var(--success-ink)",
  },
  {
    icon: "history_edu",
    title: "Audit logging",
    body: "Privileged and super-admin actions are audit-logged (who did what, which resource, when) — the forensic record behind incident response and access reviews.",
    tint: "rgba(0,187,255,.14)",
    ink: "#0784B5",
  },
  {
    icon: "auto_delete",
    title: "Real deletion",
    body: "Delete an org, a clone, or a call and we HARD-purge the data — DB rows, stored files, and sandbox artifacts — plus revoke the cloned voice and wipe stored product credentials. Not soft-delete.",
    tint: "var(--error-soft)",
    ink: "var(--error-ink)",
  },
  {
    icon: "record_voice_over",
    title: "AI disclosure on calls",
    body: "The digital worker discloses that it is an AI on every live call, regardless of how it joined. Disclosure is a fixed behavior, not a per-call toggle.",
    tint: "var(--warning-soft)",
    ink: "var(--warning-ink)",
  },
  {
    icon: "shield_person",
    title: "Guarded admin plane",
    body: "The operator control plane sits behind an access key. Before real customer data lands, admin access is gated by MFA and/or an IP allowlist, with new-IP login alerts and one-click lockdown.",
    tint: "var(--ghost)",
    ink: "var(--ink1)",
  },
];

type Sub = { name: string; purpose: string; data: string };
const SUBPROCESSORS: Sub[] = [
  { name: "OpenAI", purpose: "Language + reasoning models behind the clone", data: "Call context, transcripts, prompts" },
  { name: "ElevenLabs", purpose: "Voice cloning + speech synthesis", data: "Rep voice sample, generated speech" },
  { name: "e2b", purpose: "Isolated cloud sandboxes the clone runs in", data: "Live-call session artifacts (ephemeral)" },
  { name: "Hostinger", purpose: "Application + database hosting", data: "All platform data at rest" },
];

export default function TrustPage() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const dark = theme === "dark";
  const bg = dark ? "#04042A" : "#FFFEFE";
  const panel = dark ? "#0B0B33" : "#F5F5F7";
  const navBg = dark ? "rgba(16,16,60,.72)" : "rgba(255,255,255,.7)";
  const navBorder = dark ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.7)";

  const card: CSSProperties = {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 20,
    padding: 24,
  };

  return (
    <div
      className="pds pds-scroll"
      data-theme={theme}
      style={{ height: "100vh", overflowY: "auto", background: bg, color: "var(--ink1)", transition: "background .2s ease" }}
    >
      {/* NAV */}
      <div style={{ position: "sticky", top: 0, zIndex: 30, padding: "16px 24px 6px" }}>
        <nav
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            height: 62,
            borderRadius: 9999,
            background: navBg,
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: `1px solid ${navBorder}`,
            boxShadow: "0 4px 16px rgba(0,0,0,.08)",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "0 12px 0 22px",
          }}
        >
          <button onClick={() => nav("landing")} style={{ display: "flex", alignItems: "center", gap: 10, border: "none", background: "transparent", padding: 0, ...btnFont }}>
            <img src="/assets/afterhuman-mark.svg" alt="AfterHuman" style={{ width: 32, height: 32, display: "block" }} />
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.02em", color: "var(--ink1)" }}>AfterHuman</div>
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 18 }}>
            <button onClick={() => nav("landing")} style={{ border: "none", background: "transparent", padding: 0, fontSize: 14, fontWeight: 500, color: "var(--ink2)", ...btnFont }}>Home</button>
            <button onClick={() => nav("dpa")} style={{ border: "none", background: "transparent", padding: 0, fontSize: 14, fontWeight: 500, color: "var(--ink2)", ...btnFont }}>DPA</button>
            <button onClick={() => nav("pricing")} style={{ border: "none", background: "transparent", padding: 0, fontSize: 14, fontWeight: 500, color: "var(--ink2)", ...btnFont }}>Pricing</button>
            <button
              onClick={() => setTheme(dark ? "light" : "dark")}
              title="Toggle theme"
              style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: "var(--border)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 20 }}>{dark ? "light_mode" : "dark_mode"}</span>
            </button>
          </div>
        </nav>
      </div>

      {/* HERO */}
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "60px 24px 20px", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, letterSpacing: ".02em", padding: "7px 14px", borderRadius: 9999, background: "var(--purple-soft)", color: "var(--purple-ink)", marginBottom: 22 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 16 }}>verified_user</span>Trust &amp; security
        </div>
        <h1 style={{ margin: 0, fontSize: 46, fontWeight: 300, letterSpacing: "-.03em", lineHeight: 1.06 }}>
          A digital worker you can<br /><span style={{ fontWeight: 700 }}>actually trust with the account.</span>
        </h1>
        <p style={{ margin: "20px auto 0", fontSize: 17, color: "var(--ink2)", maxWidth: 620, lineHeight: 1.55 }}>
          AfterHuman clones your best rep into a worker that joins live calls, runs demos, and follows up. Here is how we
          protect the data, the voice, and the credentials you trust us with — and what happens the day you leave.
        </p>
      </section>

      {/* PILLARS */}
      <section style={{ maxWidth: 1080, margin: "24px auto", padding: "0 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18 }}>
          {PILLARS.map((p) => (
            <div key={p.title} style={card}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: p.tint, color: p.ink, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 24 }}>{p.icon}</span>
              </div>
              <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, letterSpacing: "-.01em" }}>{p.title}</h3>
              <p style={{ margin: 0, fontSize: 14.5, color: "var(--ink2)", lineHeight: 1.55 }}>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* AI DISCLOSURE CALLOUT */}
      <section style={{ maxWidth: 1080, margin: "24px auto", padding: "0 24px" }}>
        <div style={{ ...card, display: "flex", gap: 18, alignItems: "flex-start", background: "linear-gradient(90deg, var(--purple-soft), transparent)" }}>
          <span className="material-symbols-rounded" style={{ fontSize: 30, color: "var(--purple-ink)" }}>campaign</span>
          <div>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>The AI always says it is an AI</h3>
            <p style={{ margin: 0, fontSize: 14.5, color: "var(--ink2)", lineHeight: 1.55, maxWidth: 780 }}>
              On every live call — scheduled or ad-hoc, on your production system or a demo org — the clone discloses that
              it is an AI. It presents with your logo and the rep's cloned voice and screen; it never wears a synthetic
              human face. It can quote and discuss, but it will never invent a number it was not given, and it will never
              sign or finalize a binding contract by voice.
            </p>
          </div>
        </div>
      </section>

      {/* SUBPROCESSORS */}
      <section style={{ maxWidth: 1080, margin: "40px auto", padding: "0 24px" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 700, letterSpacing: "-.02em" }}>Subprocessors</h2>
        <p style={{ margin: "0 0 20px", fontSize: 15, color: "var(--ink2)", maxWidth: 680, lineHeight: 1.55 }}>
          We rely on a short, named list of subprocessors to run the platform. Each is under a signed DPA. We disclose
          changes before they take effect.
        </p>
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink3)", fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase" }}>
                  <th style={{ padding: "14px 20px", fontWeight: 700 }}>Subprocessor</th>
                  <th style={{ padding: "14px 20px", fontWeight: 700 }}>Purpose</th>
                  <th style={{ padding: "14px 20px", fontWeight: 700 }}>Data processed</th>
                </tr>
              </thead>
              <tbody>
                {SUBPROCESSORS.map((s) => (
                  <tr key={s.name} style={{ borderTop: "1px solid var(--divider)" }}>
                    <td style={{ padding: "14px 20px", fontWeight: 700 }}>{s.name}</td>
                    <td style={{ padding: "14px 20px", color: "var(--ink2)" }}>{s.purpose}</td>
                    <td style={{ padding: "14px 20px", color: "var(--ink2)" }}>{s.data}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* DELETION & RETENTION */}
      <section style={{ maxWidth: 1080, margin: "40px auto", padding: "0 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
          <div style={card}>
            <h3 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 700 }}>Retention</h3>
            <p style={{ margin: "0 0 14px", fontSize: 14.5, color: "var(--ink2)", lineHeight: 1.55 }}>
              By default we keep your data while the clone is active and purge it on delete. Time-boxed retention (auto-purge
              after N days) is available as a per-org option.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: "var(--ink2)", lineHeight: 1.7 }}>
              <li><strong style={{ color: "var(--ink1)" }}>Keep while active</strong> — default; data lives as long as the clone does.</li>
              <li><strong style={{ color: "var(--ink1)" }}>Hard time-box</strong> — optional; purge anything older than your chosen window.</li>
              <li>Single region at launch, disclosed. EU data residency is an enterprise fast-follow.</li>
            </ul>
            <button onClick={() => nav("retention")} style={{ marginTop: 18, display: "inline-flex", alignItems: "center", gap: 8, height: 42, padding: "0 18px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink1)", fontSize: 14, fontWeight: 700, ...btnFont }}>
              Manage retention<span className="material-symbols-rounded" style={{ fontSize: 18 }}>arrow_forward</span>
            </button>
          </div>
          <div style={card}>
            <h3 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 700 }}>What deletion actually does</h3>
            <p style={{ margin: "0 0 14px", fontSize: 14.5, color: "var(--ink2)", lineHeight: 1.55 }}>
              When you delete an org, a clone, or a call we run a hard cascade purge. When a customer leaves, we hold
              neither their biometric voice likeness nor their CRM keys.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: "var(--ink2)", lineHeight: 1.7 }}>
              <li>Delete DB rows (no soft-delete tombstone left behind).</li>
              <li>Delete stored files and e2b sandbox artifacts.</li>
              <li>Revoke the ElevenLabs cloned voice.</li>
              <li>Wipe stored product credentials.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* INCIDENT / CONTACT */}
      <section style={{ maxWidth: 1080, margin: "40px auto", padding: "0 24px" }}>
        <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ maxWidth: 640 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700 }}>Incident response</h3>
            <p style={{ margin: 0, fontSize: 14.5, color: "var(--ink2)", lineHeight: 1.55 }}>
              Each customer has a named security contact. In the event of a confirmed breach affecting your data, we commit
              to notifying you within 72 hours. Automated backups are taken and restores are tested. SOC 2 is on the
              roadmap — we launch on the security-basics story and start the formal process as enterprise demand appears.
            </p>
          </div>
          <a
            href="mailto:security@afterhuman.ai"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 48, padding: "0 22px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 15, fontWeight: 700, textDecoration: "none", boxShadow: "0 8px 24px rgba(255,6,96,.3)" }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>mail</span>Contact security
          </a>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: "1px solid var(--divider)", background: panel, marginTop: 30 }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "34px 24px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/assets/afterhuman-mark.svg" alt="AfterHuman" style={{ width: 28, height: 28, display: "block" }} />
            <div style={{ fontSize: 15, fontWeight: 700 }}>AfterHuman</div>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink3)" }}>Employment OS for digital workers</div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 22, fontSize: 13, fontWeight: 500, color: "var(--ink2)" }}>
            <button onClick={() => nav("landing")} style={{ border: "none", background: "transparent", padding: 0, fontSize: 13, fontWeight: 500, color: "var(--ink2)", ...btnFont }}>Home</button>
            <button onClick={() => nav("dpa")} style={{ border: "none", background: "transparent", padding: 0, fontSize: 13, fontWeight: 500, color: "var(--ink2)", ...btnFont }}>DPA</button>
            <button onClick={() => nav("echo")} style={{ border: "none", background: "transparent", padding: 0, fontSize: 13, fontWeight: 500, color: "var(--ink2)", ...btnFont }}>Sign in</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
