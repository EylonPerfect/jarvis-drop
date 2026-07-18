import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

// The one nav bar for the Perfect surface — every hub screen mounts this so
// the top-level menu is identical everywhere. Primary destinations as pills,
// with Connections tucked under the profile menu and an optional context slot
// (e.g. the agent switcher on per-agent screens).

const PRIMARY: { icon: string; label: string; view: string }[] = [
  { icon: "space_dashboard", label: "Overview", view: "echo" },
  { icon: "groups", label: "Roster", view: "agentshome" },
  { icon: "insights", label: "Insights", view: "debrief" },
];
function nav(view: string): void {
  window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
}
const bf: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };
const pill: CSSProperties = { display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 9999, border: "none", background: "transparent", color: "var(--ink2)", fontSize: 14, fontWeight: 500, ...bf };

export default function PdsNav({
  active, theme, onTheme, context,
}: { active: string; theme: "light" | "dark"; onTheme: () => void; context?: ReactNode }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const themeIcon = theme === "dark" ? "light_mode" : "dark_mode";
  return (
    <div style={{ position: "sticky", top: 12, zIndex: 30, padding: "0 clamp(14px,3vw,32px)", marginBottom: 4 }}>
      <nav style={{ maxWidth: 1320, margin: "0 auto", minHeight: 62, borderRadius: 22, background: "var(--nav-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid var(--border)", boxShadow: "var(--shadow)", display: "flex", alignItems: "center", gap: 12, padding: "9px 12px 9px 20px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/assets/afterhuman-mark.svg" alt="" style={{ width: 32, height: 32, display: "block" }} />
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.02em", whiteSpace: "nowrap" }}>AfterHuman</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          {PRIMARY.map((it) => {
            const on = it.view === active;
            return (
              <button key={it.view} onClick={() => nav(it.view)} style={{ ...pill, background: on ? "#FF0660" : "transparent", color: on ? "#fff" : "var(--ink2)", fontWeight: on ? 700 : 500, boxShadow: on ? "0 8px 24px rgba(255,6,96,.30)" : "none" }}>
                <span className="material-symbols-rounded" style={{ fontSize: 20, fontVariationSettings: on ? "'FILL' 1" : "'FILL' 0" }}>{it.icon}</span> {it.label}
              </button>
            );
          })}
        </div>

        {context && <div style={{ display: "flex", alignItems: "center" }}>{context}</div>}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onTheme} title="Toggle theme" style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "grid", placeItems: "center", ...bf }}>
            <span className="material-symbols-rounded" style={{ fontSize: 21 }}>{themeIcon}</span>
          </button>
          <button onClick={() => nav("clonerep")} style={{ display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 20px", borderRadius: 9999, border: "none", background: "#FF0660", color: "#fff", fontSize: 14, fontWeight: 700, letterSpacing: ".04em", ...bf }}>
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>add</span> Clone a rep
          </button>
          <span style={{ position: "relative" }}>
            <button onClick={() => setProfileOpen((o) => !o)} title="Account" style={{ width: 40, height: 40, borderRadius: "50%", border: "none", padding: 0, background: "radial-gradient(circle at 30% 30%, #FFE0EB, #F1E3FF)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, color: "#FF0660", ...bf }}>RS</button>
            {profileOpen && (
              <>
                <div onClick={() => setProfileOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
                <div style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, zIndex: 61, width: 220, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 16px 42px rgba(0,0,0,.45)", padding: 6, display: "flex", flexDirection: "column" }}>
                  <button onClick={() => { setProfileOpen(false); nav("connections"); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, border: "none", background: "transparent", color: "var(--ink1)", fontSize: 12.5, fontWeight: 600, textAlign: "left", ...bf }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 17, color: "var(--ink3)" }}>cable</span>Connections
                  </button>
                </div>
              </>
            )}
          </span>
        </div>
      </nav>
    </div>
  );
}
