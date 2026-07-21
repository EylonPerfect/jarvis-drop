import { useEffect, useState } from "react";
import { Icon, type Nav } from "./PublicChrome";
import { api, setAccessKey } from "../api/client";
import { getAttribution, captureAttribution } from "./attribution";

// ============================================================
// After Human — public auth screen. Single screen covering both
// signup and signin (recreated from "Auth.dc.html"): split
// layout with a gradient brand panel and a form panel, Google
// SSO, email/password, forgot password, and an in-page mode
// toggle. Dark by default with a light toggle.
//
// Phase 2 auth contract (dependency): submit POSTs to
//   POST /api/auth/signup { email, password }
//   POST /api/auth/login  { email, password }
// and expects an access key back (token | accessKey | key). On
// success it stores the key and enters the product: signup ->
// Clone a Rep, signin -> Agents Home. Until Phase 2 ships those
// endpoints, the call fails gracefully and we still route into
// the app (its own LoginGate then handles an unauthenticated
// visitor). Google SSO is a stub pending the OAuth handoff.
// ============================================================

const PERKS = [
  "Clone your best rep in about a week",
  "Every clone clears a readiness bar before going live",
  "Never goes live until it clears all 7 gates",
];

export default function PublicAuth({ nav, mode }: { nav: Nav; mode: "signup" | "signin" }) {
  const isSignup = mode === "signup";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Every user must affirmatively accept the Terms before an account is created.
  const [agreed, setAgreed] = useState(false);
  // Capture ?ref= from the URL on mount (before reading it) so the "a teammate
  // invited you" banner shows reliably regardless of parent capture timing.
  const [invitedByRef, setInvitedByRef] = useState<string | null>(null);
  useEffect(() => { const a = captureAttribution(); setInvitedByRef(a.ref || null); }, []);

  const enterApp = () => nav.goApp(isSignup ? "clonerep" : "agentshome");

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (busy) return;
    // Terms gate: no signup without an affirmative acceptance.
    if (isSignup && !agreed) { setError("Please accept the Terms & Conditions to continue."); return; }
    setBusy(true);
    setError("");
    try {
      const path = isSignup ? "/api/auth/signup" : "/api/auth/login";
      // On signup, carry the captured outbound attribution so the new org is tied
      // back to its source (billing webhook → org → attribution → paid).
      const attribution = isSignup ? getAttribution() : {};
      const body = isSignup
        ? { email, password, tosAccepted: true, ...(Object.keys(attribution).length ? { attribution } : {}) }
        : { email, password };
      const res = await api.post<{ token?: string; accessKey?: string; key?: string }>(path, body);
      const key = res?.token || res?.accessKey || res?.key;
      if (key) setAccessKey(key);
      enterApp();
    } catch {
      // Phase 2 auth endpoints may not be live yet. Route into the app anyway;
      // its LoginGate handles an unauthenticated visitor.
      enterApp();
    } finally {
      setBusy(false);
    }
  };

  const inputStyle: React.CSSProperties = { width: "100%", height: 50, padding: "0 16px", borderRadius: 14, border: "2px solid var(--border)", outline: "none", fontSize: 15, fontWeight: 500, color: "var(--ink1)", background: "var(--card)" };
  const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--ink2)", marginBottom: 6 };

  return (
    <div
      className="ah-public ahp-auth-grid"
      data-theme={nav.theme}
      style={{ height: "100vh", overflow: "hidden", background: "var(--bg)", color: "var(--ink1)", display: "grid", gridTemplateColumns: "1.05fr .95fr" }}
    >
      {/* BRAND PANEL */}
      <div className="ahp-auth-brand" style={{ position: "relative", overflow: "hidden", background: "linear-gradient(150deg, #04042A, #1a1060)", color: "#fff", padding: 44, display: "flex", flexDirection: "column" }}>
        <div style={{ position: "absolute", top: -80, left: -60, width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,6,96,.28), transparent 70%)", animation: "ahpBlob 11s ease-in-out infinite", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -100, right: -60, width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(163,66,255,.26), transparent 70%)", animation: "ahpBlob 13s ease-in-out infinite reverse", pointerEvents: "none" }} />

        <a href="#/" onClick={(e) => { e.preventDefault(); nav.go("#/"); }} style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, color: "#fff" }}>
          <img src="/assets/afterhuman-mark.svg" alt="After Human" style={{ width: 34, height: 34, display: "block" }} />
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.02em" }}>After Human</div>
        </a>

        <div style={{ position: "relative", marginTop: "auto" }}>
          <div style={{ fontSize: 34, fontWeight: 300, letterSpacing: "-.03em", lineHeight: 1.12, maxWidth: 460 }}>Your AI sales and customer success team, <span style={{ fontWeight: 700 }}>cloned from your best.</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 30, maxWidth: 420 }}>
            {PERKS.map((p) => (
              <div key={p} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14.5, fontWeight: 500, color: "rgba(255,255,255,.85)" }}><Icon name="check_circle" style={{ fontSize: 22, color: "#4BE39A" }} />{p}</div>
            ))}
          </div>
        </div>

        <div style={{ position: "relative", marginTop: 34, paddingTop: 22, borderTop: "1px solid rgba(255,255,255,.14)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: "50%", background: "radial-gradient(circle at 30% 30%, rgba(255,6,96,.6), rgba(163,66,255,.55))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800 }}>A</div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4 }}>Prefer to see it first? Talk to Ava, our AI rep, live.</div>
            <a href="#/ava" onClick={(e) => { e.preventDefault(); nav.go("#/ava"); }} style={{ fontSize: 13, fontWeight: 700, color: "#FF6E9C" }}>Start the live call →</a>
          </div>
        </div>
      </div>

      {/* FORM PANEL */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, padding: "20px 28px" }}>
          <span style={{ fontSize: 13, color: "var(--ink3)" }}>{isSignup ? "Already have an account?" : "New to After Human?"}</span>
          <button onClick={() => nav.go(isSignup ? "#/signin" : "#/auth")} style={{ height: 38, padding: "0 16px", borderRadius: 9999, border: "1px solid var(--border)", background: "transparent", color: "var(--ink1)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{isSignup ? "Sign in" : "Start free"}</button>
          <button onClick={nav.toggleTheme} title="Toggle theme" style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: "var(--border)", color: "var(--ink1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={nav.theme === "dark" ? "light_mode" : "dark_mode"} style={{ fontSize: 19 }} /></button>
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 28px 40px" }}>
          <div style={{ width: "100%", maxWidth: 400 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 9999, background: isSignup ? "#FFE0EB" : "#F1E3FF", color: isSignup ? "#D8004E" : "#6B2BB5", marginBottom: 18 }}><Icon name={isSignup ? "rocket_launch" : "waving_hand"} style={{ fontSize: 16 }} />{isSignup ? "Start free" : "Welcome back"}</div>
            {isSignup && invitedByRef && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", marginBottom: 16, borderRadius: 14, background: "linear-gradient(90deg, #FFE0EB, #F1E3FF)", color: "#6B2BB5" }}>
                <Icon name="redeem" style={{ fontSize: 20, color: "#D8004E", marginTop: 1 }} />
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.45 }}>A teammate invited you to After Human. Take a clone live and you'll <strong>both get a free clone-month.</strong></div>
              </div>
            )}
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: "-.02em" }}>{isSignup ? "Create your account" : "Sign in to After Human"}</h1>
            <p style={{ margin: "10px 0 26px", fontSize: 14.5, color: "var(--ink2)", lineHeight: 1.5 }}>{isSignup ? "Free to start, no card required. Clone your first rep in minutes." : "Sign in to manage your digital workforce."}</p>

            <button onClick={submit} disabled={busy || (isSignup && !agreed)} title={isSignup && !agreed ? "Accept the Terms & Conditions to continue" : undefined} style={{ width: "100%", height: 52, borderRadius: 9999, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink1)", fontSize: 15, fontWeight: 600, cursor: busy || (isSignup && !agreed) ? "not-allowed" : "pointer", opacity: busy || (isSignup && !agreed) ? 0.55 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <svg width="19" height="19" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>
              Continue with Google
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
              <div style={{ flex: 1, height: 1, background: "var(--divider)" }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink3)" }}>or</span>
              <div style={{ flex: 1, height: 1, background: "var(--divider)" }} />
            </div>

            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={label}>{isSignup ? "Work email" : "Email"}</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com" style={inputStyle} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)" }}>Password</label>
                  {!isSignup && <a href="#/signin" onClick={(e) => e.preventDefault()} style={{ fontSize: 12, fontWeight: 600, color: "#FF0660" }}>Forgot password?</a>}
                </div>
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={isSignup ? "Create a password" : "Enter your password"} style={inputStyle} />
              </div>
              {isSignup && (
                <label htmlFor="tos-agree" style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.5, marginTop: 8, cursor: "pointer", userSelect: "none" }}>
                  <input
                    id="tos-agree"
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => { setAgreed(e.target.checked); if (e.target.checked) setError(""); }}
                    style={{ width: 18, height: 18, marginTop: 1, flex: "none", accentColor: "#FF0660", cursor: "pointer" }}
                  />
                  <span>I have read and agree to After Human's <a href="#/terms" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontWeight: 700, color: "var(--ink1)", textDecoration: "underline" }}>Terms &amp; Conditions</a> and <a href="#/privacy" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontWeight: 700, color: "var(--ink1)", textDecoration: "underline" }}>Privacy Policy</a>.</span>
                </label>
              )}
              <button type="submit" disabled={busy || (isSignup && !agreed)} title={isSignup && !agreed ? "Accept the Terms & Conditions to continue" : undefined} style={{ width: "100%", height: 52, marginTop: 6, border: "none", borderRadius: 9999, background: "#FF0660", color: "#fff", fontSize: 15, fontWeight: 700, letterSpacing: ".02em", cursor: busy || (isSignup && !agreed) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 8px 24px rgba(255,6,96,.3)", opacity: busy || (isSignup && !agreed) ? 0.55 : 1 }}>{busy ? "Please wait" : isSignup ? "Create account" : "Sign in"}<Icon name="arrow_forward" style={{ fontSize: 20 }} /></button>
            </form>

            {error && <div style={{ fontSize: 12.5, color: "#E1173F", marginTop: 12, textAlign: "center" }}>{error}</div>}

            <div style={{ fontSize: 12.5, color: "var(--ink3)", lineHeight: 1.5, marginTop: 18, textAlign: "center" }}>{isSignup ? "Already have an account?" : "Don't have an account?"} <a href={isSignup ? "#/signin" : "#/auth"} onClick={(e) => { e.preventDefault(); nav.go(isSignup ? "#/signin" : "#/auth"); }} style={{ fontWeight: 700, color: "#FF0660" }}>{isSignup ? "Sign in" : "Start free"}</a></div>
          </div>
        </div>
      </div>
    </div>
  );
}
