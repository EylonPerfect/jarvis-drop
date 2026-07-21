import { useState } from "react";
import type { CSSProperties } from "react";
import { api } from "../api/client";
import "../pds.css";

// ============================================================
// No-recordings path to a clone — AUTO-DRAFT. The user has no note-taker
// transcript, so Ava writes a realistic sample call for their rep's role +
// company (POST /api/mockcall/generate), then that transcript feeds the existing
// clone-from-calls extraction (POST /api/agents → /api/clones/:id/sources →
// …/persona/extract) to produce a starter clone. It's a tailored STARTER draft
// (synthetic, not their real rep) — they rehearse/refine it, or add real calls
// to make it truly theirs. Scoped to the .pmx system.
// ============================================================

function nav(view: string): void {
  window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
}
const bf: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };
const inp: CSSProperties = { width: "100%", marginTop: 6, padding: "11px 14px", borderRadius: 12, border: "2px solid var(--border)", background: "var(--card)", color: "var(--ink1)", fontSize: 14, fontFamily: "inherit", fontWeight: 500, outline: "none", boxSizing: "border-box" };

export default function MockCall() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [phase, setPhase] = useState<"form" | "building">("form");
  const [err, setErr] = useState("");

  async function draft(): Promise<void> {
    if (phase === "building") return;
    if (!name.trim() || !role.trim()) { setErr("Add at least your rep's name and role."); return; }
    setPhase("building"); setErr("");
    try {
      const g = await api.post<{ transcript: string }>("/api/mockcall/generate", { name: name.trim(), role: role.trim(), company: company.trim() });
      const ag = await api.post<{ id: string }>("/api/agents", { icon: "user", name: name.trim(), role: role.trim(), buildTrack: "clone", cloneSource: { name: name.trim(), title: role.trim() } });
      await api.post(`/api/clones/${ag.id}/sources`, { sources: [{ title: "Sample call (AI-drafted)", transcript: g.transcript }] });
      await api.post(`/api/clones/${ag.id}/persona/extract`, {});
      try { localStorage.setItem("pds_agent", ag.id); } catch { /* ignore */ }
      void api.post("/api/pipeline/start", { agentId: ag.id }).catch(() => {});
      nav("readiness");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setPhase("form"); }
  }

  return (
    <div className="pmx" data-theme={theme} style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px clamp(16px,4vw,40px)", borderBottom: "1px solid var(--divider)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/assets/afterhuman-mark.svg" alt="" style={{ width: 30, height: 30, display: "block" }} />
          <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-.02em" }}>Draft a clone from your role</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme" style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "grid", placeItems: "center", ...bf }}>
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>{theme === "dark" ? "light_mode" : "dark_mode"}</span>
          </button>
          <button onClick={() => nav("firstrun")} className="btn" style={{ height: 38 }}><span className="material-symbols-rounded" style={{ fontSize: 18 }}>close</span>Exit</button>
        </div>
      </div>

      {phase === "form" && (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
            <div style={{ width: 64, height: 64, borderRadius: 18, background: "linear-gradient(140deg,#FF0660,#A342FF)", color: "#fff", display: "grid", placeItems: "center", margin: "0 auto 20px" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 32 }}>auto_awesome</span>
            </div>
            <h1 style={{ fontSize: "clamp(24px,4vw,34px)", fontWeight: 800, letterSpacing: "-.03em", margin: "0 0 12px" }}>No recordings? I'll draft one.</h1>
            <p style={{ fontSize: 15, color: "var(--ink2)", lineHeight: 1.55, margin: "0 0 26px" }}>
              Tell me who you're cloning and what they sell. I'll write a realistic sample call in their role and build a starter clone from it in seconds — then rehearse and refine it, or add real calls to make it truly yours.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left", marginBottom: 22 }}>
              <label style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink2)" }}>Rep's name<br />
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jordan Blake" style={inp} /></label>
              <label style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink2)" }}>Their role<br />
                <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Account Executive" style={inp} /></label>
              <label style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink2)" }}>What do you sell? <span style={{ color: "var(--ink3)", fontWeight: 500 }}>(company or product)</span><br />
                <input value={company} onChange={(e) => setCompany(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void draft(); }} placeholder="e.g. a revenue-forecasting platform" style={inp} /></label>
            </div>
            <button onClick={() => void draft()} className="btn pink" style={{ width: "100%", justifyContent: "center", height: 48 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 20 }}>auto_awesome</span>Draft my clone
            </button>
            {err && <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 12, background: "var(--error-soft)", color: "var(--error-ink)", fontSize: 12.5, fontWeight: 700 }}>{err}</div>}
          </div>
        </div>
      )}

      {phase === "building" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ textAlign: "center", maxWidth: 440 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 44, color: "var(--purple-ink)", animation: "spin 1.1s linear infinite", display: "inline-block" }}>progress_activity</span>
            <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em", margin: "18px 0 8px" }}>Drafting a sample call and building your clone…</h2>
            <p style={{ fontSize: 14, color: "var(--ink2)", lineHeight: 1.55 }}>Writing a realistic call for a {role.trim() || "rep"}{company.trim() ? ` selling ${company.trim()}` : ""}, then learning the voice, phrases, and objection-handling. A few seconds.</p>
          </div>
        </div>
      )}
    </div>
  );
}
