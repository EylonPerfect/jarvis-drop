import { useState } from "react";
import { api, setAccessKey, clearAccessKey } from "../api/client";

// Access gate — the app requires an access code (BFF_API_KEY) before anything
// loads. Verifies the code against a protected endpoint, then stores it.
export default function LoginGate({ onAuthed }: { onAuthed: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    setError(null);
    setAccessKey(c);
    try {
      // A protected endpoint: 401 if the code is wrong, 200 if it's right.
      await api.get("/api/agents");
      onAuthed();
    } catch {
      clearAccessKey();
      setError("That access code didn't work. Check it and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--jv-void)", padding: 24 }}>
      <div style={{ width: 380, maxWidth: "100%", borderRadius: "var(--r-lg)", background: "var(--grad-panel)", border: "1px solid var(--jv-border-cyan)", boxShadow: "var(--panel-shadow-active)", padding: "30px 28px", textAlign: "center" }}>
        <img src="/after-human-logo.svg" alt="After Human" style={{ width: 240, maxWidth: "100%", height: "auto", display: "block", margin: "0 auto 18px" }} />
        <div style={{ font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)", marginBottom: 18 }}>
          Enter your access code to continue.
        </div>
        <input
          type="password"
          value={code}
          autoFocus
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          placeholder="Access code"
          style={{ width: "100%", height: 44, padding: "0 14px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: `1px solid ${error ? "var(--jv-red)" : "var(--jv-border)"}`, color: "var(--jv-text)", font: "var(--fw-medium) 14px var(--font-body)", outline: "none", boxSizing: "border-box", textAlign: "center", letterSpacing: "0.1em" }}
        />
        {error && <div style={{ marginTop: 10, font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-red)" }}>{error}</div>}
        <button
          onClick={() => void submit()}
          disabled={busy || !code.trim()}
          style={{ marginTop: 16, width: "100%", height: 44, borderRadius: "var(--r-sm)", border: "none", cursor: busy || !code.trim() ? "default" : "pointer", background: code.trim() ? "var(--grad-cyan)" : "var(--jv-surface-3)", color: code.trim() ? "var(--accent-contrast)" : "var(--jv-text-muted)", font: "var(--fw-semibold) 12px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase" }}
        >
          {busy ? "Verifying…" : "Enter"}
        </button>
      </div>
    </div>
  );
}
