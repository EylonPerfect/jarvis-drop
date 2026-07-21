import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { api, clearAccessKey } from "../api/client";

// Avatar initials from a name ("Eylon Perfect" -> "EP") or, failing that, the
// email ("eylon@…" -> "EY"). Empty when we know neither (show a person icon).
function initialsFrom(name?: string | null, email?: string | null): string {
  const n = (name || "").trim();
  if (n) {
    const p = n.split(/\s+/).filter(Boolean);
    return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase();
  }
  const e = (email || "").trim();
  return e ? e.slice(0, 2).toUpperCase() : "";
}

// Log out: drop the server session + the local access key, then return to the
// public sign-in. Works in both password and access-code modes.
async function logout(): Promise<void> {
  try { await api.post("/api/auth/logout"); } catch { /* clear locally regardless */ }
  clearAccessKey();
  window.location.href = "/site#/signin";
}

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
type Notif = { id: string; kind: string; title: string | null; body: string; href: string | null; severity: string; icon: string | null; created_at: string; read_at: string | null };
const SEV: Record<string, { bg: string; ink: string }> = {
  info: { bg: "var(--decor-soft, rgba(0,187,255,.14))", ink: "#00BBFF" },
  success: { bg: "rgba(46,211,125,.16)", ink: "#0E8A4F" },
  warning: { bg: "rgba(248,192,26,.18)", ink: "#B8890A" },
  critical: { bg: "rgba(255,6,96,.14)", ink: "#FF0660" },
};
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const bf: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };
const pill: CSSProperties = { display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 9999, border: "none", background: "transparent", color: "var(--ink2)", fontSize: 14, fontWeight: 500, ...bf };

export default function PdsNav({
  active, theme, onTheme, context,
}: { active: string; theme: "light" | "dark"; onTheme: () => void; context?: ReactNode }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [me, setMe] = useState<{ name?: string | null; email?: string | null } | null>(null);
  useEffect(() => {
    void api.get<{ user?: { name?: string | null; email?: string | null } }>("/api/auth/me")
      .then((r) => { if (r.user) setMe({ name: r.user.name, email: r.user.email }); })
      .catch(() => { /* not signed in as a named user (access-code) — show the icon */ });
  }, []);
  const initials = initialsFrom(me?.name, me?.email);
  const themeIcon = theme === "dark" ? "light_mode" : "dark_mode";

  // ---- notification center ----
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const loadNotifs = () => void api.get<{ notifications: Notif[]; unread: number }>("/api/notifications")
    .then((r) => { setNotifs(r.notifications || []); setUnread(r.unread || 0); }).catch(() => {});
  useEffect(() => { loadNotifs(); const t = setInterval(loadNotifs, 45000); return () => clearInterval(t); }, []);
  const openNotifs = () => { setNotifOpen((o) => !o); if (!notifOpen) loadNotifs(); };
  const markAll = () => { void api.post("/api/notifications/read", { all: true }).catch(() => {}); setNotifs((ns) => ns.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))); setUnread(0); };
  const onNotif = (n: Notif) => {
    void api.post("/api/notifications/read", { id: n.id }).catch(() => {});
    setUnread((u) => (n.read_at ? u : Math.max(0, u - 1)));
    setNotifs((ns) => ns.map((x) => (x.id === n.id ? { ...x, read_at: x.read_at ?? new Date().toISOString() } : x)));
    setNotifOpen(false);
    if (n.href) nav(n.href.replace(/^#\//, ""));
  };
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
            <button onClick={openNotifs} title="Notifications" style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: "var(--ghost)", color: "var(--ink1)", display: "grid", placeItems: "center", ...bf }}>
              <span className="material-symbols-rounded" style={{ fontSize: 21 }}>notifications</span>
              {unread > 0 && <span style={{ position: "absolute", top: 5, right: 5, minWidth: 15, height: 15, padding: "0 3px", borderRadius: 9999, background: "#FF0660", color: "#fff", fontSize: 9.5, fontWeight: 800, display: "grid", placeItems: "center", lineHeight: 1 }}>{unread > 9 ? "9+" : unread}</span>}
            </button>
            {notifOpen && (
              <>
                <div onClick={() => setNotifOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
                <div style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, zIndex: 61, width: 340, maxHeight: 440, overflowY: "auto", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 16px 42px rgba(0,0,0,.45)", padding: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", padding: "8px 10px 10px" }}>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>Notifications</span>
                    {unread > 0 && <button onClick={markAll} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--decor)", fontSize: 11.5, fontWeight: 700, ...bf }}>Mark all read</button>}
                  </div>
                  {notifs.length === 0 ? (
                    <div style={{ padding: "18px 10px 22px", textAlign: "center", fontSize: 12.5, color: "var(--ink3)" }}>You&apos;re all caught up.</div>
                  ) : notifs.map((n) => {
                    const sv = SEV[n.severity] || SEV.info;
                    return (
                      <button key={n.id} onClick={() => onNotif(n)} style={{ display: "flex", gap: 10, width: "100%", textAlign: "left", padding: "10px", borderRadius: 10, border: "none", background: n.read_at ? "transparent" : "var(--sunk)", cursor: "pointer", fontFamily: "inherit", marginBottom: 2 }}>
                        <span style={{ flex: "none", width: 30, height: 30, borderRadius: 9, background: sv.bg, display: "grid", placeItems: "center" }}><span className="material-symbols-rounded" style={{ fontSize: 17, color: sv.ink }}>{n.icon || "notifications"}</span></span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--ink1)" }}>{n.title || n.kind}</span>
                          <span style={{ display: "block", fontSize: 11.5, color: "var(--ink2)", lineHeight: 1.4, marginTop: 1 }}>{n.body}</span>
                          <span style={{ display: "block", fontSize: 10.5, color: "var(--ink3)", marginTop: 3 }}>{ago(n.created_at)}</span>
                        </span>
                        {!n.read_at && <span style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: "#FF0660", marginTop: 5 }} />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </span>
          <span style={{ position: "relative" }}>
            <button onClick={() => setProfileOpen((o) => !o)} title={me?.email || "Account"} style={{ width: 40, height: 40, borderRadius: "50%", border: "none", padding: 0, background: "radial-gradient(circle at 30% 30%, #FFE0EB, #F1E3FF)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, color: "#FF0660", ...bf }}>
              {initials || <span className="material-symbols-rounded" style={{ fontSize: 22 }}>person</span>}
            </button>
            {profileOpen && (
              <>
                <div onClick={() => setProfileOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
                <div style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, zIndex: 61, width: 220, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 16px 42px rgba(0,0,0,.45)", padding: 6, display: "flex", flexDirection: "column" }}>
                  {me && (me.name || me.email) && (
                    <div style={{ padding: "6px 10px 10px", marginBottom: 4, borderBottom: "1px solid var(--border)" }}>
                      {me.name && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me.name}</div>}
                      {me.email && <div style={{ fontSize: 11.5, color: "var(--ink3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me.email}</div>}
                    </div>
                  )}
                  <button onClick={() => { setProfileOpen(false); nav("connections"); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, border: "none", background: "transparent", color: "var(--ink1)", fontSize: 12.5, fontWeight: 600, textAlign: "left", ...bf }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 17, color: "var(--ink3)" }}>cable</span>Connections
                  </button>
                  <div style={{ height: 1, background: "var(--border)", margin: "5px 8px" }} />
                  <button onClick={() => { setProfileOpen(false); void logout(); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, border: "none", background: "transparent", color: "#E1173F", fontSize: 12.5, fontWeight: 700, textAlign: "left", ...bf }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 17, color: "#E1173F" }}>logout</span>Log out
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
