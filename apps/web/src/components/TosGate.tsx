import { useEffect, useState } from "react";
import { api, clearAccessKey } from "../api/client";

// ============================================================================
// TosGate — a blocking, non-dismissable overlay that forces EVERY signed-in
// user to accept the current Terms before using the app. Fires when the user
// has not accepted TOS_VERSION (new users are captured at signup; this catches
// pre-existing users and anyone after a version bump — T&C §18).
//
// Renders nothing when: not yet loaded, not authenticated (access-code / demo
// tenant → the API returns accepted:true), or already accepted. Mounted once at
// the app root so it overlays whatever screen is showing.
// ============================================================================
export default function TosGate(): JSX.Element | null {
  const [needed, setNeeded] = useState(false);
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await api.get<{ version: string; accepted: boolean; authenticated: boolean }>("/api/legal/tos");
        if (!alive) return;
        setVersion(r.version);
        setNeeded(r.authenticated && !r.accepted);
      } catch { /* on error, don't block the app */ }
    })();
    return () => { alive = false; };
  }, []);

  if (!needed) return null;

  const accept = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await api.post("/api/legal/tos/accept", { version });
      setNeeded(false);
    } catch (e) {
      setError(`Could not record your acceptance${e instanceof Error ? ` · ${e.message}` : ""}. Please try again.`);
    } finally { setBusy(false); }
  };

  const logout = async () => {
    try { await api.post("/api/auth/logout"); } catch { /* ignore */ }
    clearAccessKey();
    window.location.href = "/site#/signin";
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 100000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(4,4,20,.72)", backdropFilter: "blur(6px)" }}
    >
      <div style={{ width: "100%", maxWidth: 460, background: "var(--card, #fff)", color: "var(--ink1, #101020)", border: "1px solid var(--border, rgba(128,128,160,.25))", borderRadius: 18, padding: 28, boxShadow: "0 24px 70px rgba(0,0,0,.4)" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800, padding: "6px 12px", borderRadius: 9999, background: "#FFE0EB", color: "#D8004E", marginBottom: 16 }}>
          Terms &amp; Conditions
        </div>
        <h2 style={{ margin: 0, fontSize: 21, fontWeight: 800, letterSpacing: "-.01em" }}>Please review and accept our Terms</h2>
        <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.55, color: "var(--ink2, #555)" }}>
          To keep using After Human you need to accept our Terms &amp; Conditions and Privacy Policy. They cover how clones run on your behalf, AI disclosure on calls, your responsibility for connected accounts, billing, and data handling.
        </p>
        <a
          href="/site#/terms"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, fontSize: 13.5, fontWeight: 700, color: "#FF0660", textDecoration: "none" }}
        >
          Read the full Terms &amp; Conditions ↗
        </a>
        {error && <div style={{ fontSize: 12.5, color: "#E1173F", marginTop: 14 }}>{error}</div>}
        <button
          onClick={accept}
          disabled={busy}
          style={{ width: "100%", height: 50, marginTop: 20, border: "none", borderRadius: 9999, background: "#FF0660", color: "#fff", fontSize: 15, fontWeight: 800, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1, boxShadow: "0 8px 24px rgba(255,6,96,.3)" }}
        >
          {busy ? "Please wait…" : "I agree to the Terms & Conditions"}
        </button>
        <button
          onClick={logout}
          disabled={busy}
          style={{ width: "100%", height: 40, marginTop: 10, border: "none", borderRadius: 9999, background: "transparent", color: "var(--ink3, #888)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          Not now — log out
        </button>
      </div>
    </div>
  );
}
