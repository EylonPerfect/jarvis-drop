import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import "../pds.css";
import { api } from "../api/client";

// ============================================================
// DATA GOVERNANCE (#2) — per-org retention settings surface.
// Reads/writes GET/PUT /api/retention. The saved policy is the
// value the Phase 2 purge/retention job reads via
// getRetentionPolicy(). Namespaced + scoped under .pds; imports
// only pds.css + the shared api client (no shared-style edits,
// no product-screen edits).
// ============================================================

const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

type RetentionMode = "keep-while-active" | "hard-timebox";
interface RetentionPolicy {
  mode: RetentionMode;
  purgeOnDelete: true;
  hardTimeboxDays: number | null;
  updatedAt: string | null;
}

export default function RetentionSettings() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [policy, setPolicy] = useState<RetentionPolicy | null>(null);
  const [days, setDays] = useState<number>(90);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<RetentionPolicy>("/api/retention")
      .then((p) => { setPolicy(p); if (p.hardTimeboxDays) setDays(p.hardTimeboxDays); })
      .catch((e) => setError(String(e)));
  }, []);

  const dark = theme === "dark";
  const bg = dark ? "#04042A" : "#FFFEFE";
  const navBg = dark ? "rgba(16,16,60,.72)" : "rgba(255,255,255,.7)";
  const navBorder = dark ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.7)";
  const card: CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20, padding: 24 };

  const mode = policy?.mode ?? "keep-while-active";
  const setMode = (m: RetentionMode) => { setPolicy((p) => (p ? { ...p, mode: m } : p)); setSaved(false); };

  const save = async () => {
    if (!policy) return;
    setSaving(true);
    setError(null);
    try {
      const body = { mode: policy.mode, hardTimeboxDays: policy.mode === "hard-timebox" ? days : null };
      const next = await api.put<RetentionPolicy>("/api/retention", body);
      setPolicy(next);
      if (next.hardTimeboxDays) setDays(next.hardTimeboxDays);
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const OptionRow = ({ value, title, desc }: { value: RetentionMode; title: string; desc: string }) => {
    const active = mode === value;
    return (
      <button
        onClick={() => setMode(value)}
        style={{
          display: "flex", gap: 14, alignItems: "flex-start", textAlign: "left", width: "100%",
          padding: "16px 18px", borderRadius: 14, marginBottom: 12,
          border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
          background: active ? "var(--purple-soft)" : "transparent", ...btnFont,
        }}
      >
        <span
          className="material-symbols-rounded"
          style={{ fontSize: 22, color: active ? "var(--accent)" : "var(--ink3)" }}
        >
          {active ? "radio_button_checked" : "radio_button_unchecked"}
        </span>
        <span>
          <span style={{ display: "block", fontSize: 15.5, fontWeight: 700, color: "var(--ink1)" }}>{title}</span>
          <span style={{ display: "block", fontSize: 13.5, color: "var(--ink2)", marginTop: 3, lineHeight: 1.5 }}>{desc}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="pds pds-scroll" data-theme={theme} style={{ height: "100vh", overflowY: "auto", background: bg, color: "var(--ink1)", transition: "background .2s ease" }}>
      {/* NAV */}
      <div style={{ position: "sticky", top: 0, zIndex: 30, padding: "16px 24px 6px" }}>
        <nav style={{ maxWidth: 760, margin: "0 auto", height: 62, borderRadius: 9999, background: navBg, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: `1px solid ${navBorder}`, boxShadow: "0 4px 16px rgba(0,0,0,.08)", display: "flex", alignItems: "center", gap: 14, padding: "0 12px 0 22px" }}>
          <button onClick={() => nav("trust")} style={{ display: "flex", alignItems: "center", gap: 10, border: "none", background: "transparent", padding: 0, ...btnFont }}>
            <span className="material-symbols-rounded" style={{ fontSize: 22, color: "var(--ink2)" }}>arrow_back</span>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em", color: "var(--ink1)" }}>Data &amp; retention</div>
          </button>
          <div style={{ marginLeft: "auto" }}>
            <button onClick={() => setTheme(dark ? "light" : "dark")} title="Toggle theme" style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: "var(--border)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }}>
              <span className="material-symbols-rounded" style={{ fontSize: 20 }}>{dark ? "light_mode" : "dark_mode"}</span>
            </button>
          </div>
        </nav>
      </div>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "34px 24px 90px" }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 30, fontWeight: 700, letterSpacing: "-.02em" }}>Retention policy</h1>
        <p style={{ margin: "0 0 26px", fontSize: 15, color: "var(--ink2)", lineHeight: 1.55 }}>
          Choose how long we keep your organization's data. This is the policy the purge job enforces.
        </p>

        {error && (
          <div style={{ ...card, borderColor: "var(--error)", color: "var(--error-ink)", marginBottom: 18, fontSize: 14 }}>{error}</div>
        )}

        <div style={card}>
          <OptionRow
            value="keep-while-active"
            title="Keep while active"
            desc="Retain data as long as the clone is active. Purge on delete. The recommended default."
          />
          <OptionRow
            value="hard-timebox"
            title="Hard time-box"
            desc="Additionally purge any data older than a fixed window, regardless of activity."
          />

          {mode === "hard-timebox" && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 4px 4px" }}>
              <label style={{ fontSize: 14, fontWeight: 600, color: "var(--ink1)" }}>Purge data older than</label>
              <input
                type="number" min={1} max={3650} value={days}
                onChange={(e) => { setDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1))); setSaved(false); }}
                style={{ width: 90, height: 40, padding: "0 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--sunk)", color: "var(--ink1)", fontSize: 15, fontFamily: "inherit" }}
              />
              <span style={{ fontSize: 14, color: "var(--ink2)" }}>days</span>
            </div>
          )}
        </div>

        {/* Non-configurable guarantee */}
        <div style={{ ...card, marginTop: 16, display: "flex", gap: 14, alignItems: "flex-start" }}>
          <span className="material-symbols-rounded" style={{ fontSize: 24, color: "var(--success-ink)" }}>verified_user</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Hard purge on delete is always on</div>
            <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.55 }}>
              Deleting an org, clone, or call always runs the full cascade purge — DB rows, files, sandbox artifacts,
              cloned-voice revoke, and credential wipe. This guarantee cannot be turned off.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 22 }}>
          <button
            onClick={save}
            disabled={saving || !policy}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 48, padding: "0 24px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 15, fontWeight: 700, opacity: saving || !policy ? 0.6 : 1, boxShadow: "0 8px 24px rgba(255,6,96,.3)", ...btnFont }}
          >
            {saving ? "Saving…" : "Save policy"}
          </button>
          {saved && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600, color: "var(--success-ink)" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>check_circle</span>Saved
            </span>
          )}
          {policy?.updatedAt && (
            <span style={{ fontSize: 12.5, color: "var(--ink3)", marginLeft: "auto" }}>Last changed {new Date(policy.updatedAt).toLocaleString()}</span>
          )}
        </div>
      </main>
    </div>
  );
}
