import type { CSSProperties, ReactNode } from "react";

// ============================================================
// Shared chrome for the public marketing site (nav pill, footer,
// icon helper). Everything renders inside the .ah-public wrapper
// so all styling stays scoped to the public pages. No product
// component or shared style is imported here.
// ============================================================

export type Nav = {
  theme: "dark" | "light";
  toggleTheme: () => void;
  go: (hash: string) => void; // navigate within the public site (#/, #/pricing, #/auth, #/signin)
  goApp: (view: string) => void; // navigate into the product app (leaves the public site)
};

export const Icon = ({ name, style }: { name: string; style?: CSSProperties }) => (
  <span className="material-symbols-rounded" style={style}>
    {name}
  </span>
);

const MARK = "/assets/afterhuman-mark.svg";

// Top navigation pill. `active` bolds the matching link. On the landing page the
// in-page anchors scroll to sections; elsewhere they route back to the landing
// page hash so they never dead-end.
export function PublicNav({
  nav,
  active,
  onAnchor,
}: {
  nav: Nav;
  active: "landing" | "pricing";
  onAnchor?: (id: string) => void;
}) {
  const link: CSSProperties = { fontSize: 14, fontWeight: 500, color: "var(--ink2)" };
  const linkActive: CSSProperties = { fontSize: 14, fontWeight: 700, color: "var(--ink1)" };
  const anchor = (id: string) => {
    if (onAnchor) onAnchor(id);
    else nav.go("#/");
  };
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 30, padding: "16px 24px 6px" }}>
      <nav
        style={{
          maxWidth: 1160,
          margin: "0 auto",
          height: 62,
          borderRadius: 9999,
          background: "var(--nav-bg)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--nav-border)",
          boxShadow: "0 4px 16px rgba(0,0,0,.08)",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 12px 0 22px",
        }}
      >
        <a
          href="#/"
          onClick={(e) => { e.preventDefault(); nav.go("#/"); }}
          style={{ display: "flex", alignItems: "center", gap: 10 }}
        >
          <img src={MARK} alt="After Human" style={{ width: 32, height: 32, display: "block" }} />
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.02em" }}>After Human</div>
        </a>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 18 }}>
          <a href="#how" onClick={(e) => { e.preventDefault(); anchor("how"); }} style={link}>How it works</a>
          <a href="#capabilities" onClick={(e) => { e.preventDefault(); anchor("capabilities"); }} style={link}>Product</a>
          <a href="#/pricing" onClick={(e) => { e.preventDefault(); nav.go("#/pricing"); }} style={active === "pricing" ? linkActive : link}>Pricing</a>
          <a href="#/auth" onClick={(e) => { e.preventDefault(); nav.go("#/auth"); }} style={link}>Blog</a>
          <button
            onClick={nav.toggleTheme}
            title="Toggle theme"
            style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: "var(--border)", color: "var(--ink1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <Icon name={nav.theme === "dark" ? "light_mode" : "dark_mode"} style={{ fontSize: 20 }} />
          </button>
          <a
            href="#/ava"
            onClick={(e) => { e.preventDefault(); nav.go("#/ava"); }}
            style={{ display: "flex", alignItems: "center", gap: 7, height: 44, padding: "0 16px", borderRadius: 9999, border: "1px solid var(--border)", color: "var(--ink1)", fontSize: 14, fontWeight: 600 }}
          >
            <Icon name="graphic_eq" style={{ fontSize: 19, color: "#FF0660" }} />Talk to Ava
          </a>
          <a
            href="#/signin"
            onClick={(e) => { e.preventDefault(); nav.go("#/signin"); }}
            style={{ display: "flex", alignItems: "center", height: 44, padding: "0 18px", borderRadius: 9999, border: "1px solid var(--border)", color: "var(--ink1)", fontSize: 14, fontWeight: 700 }}
          >
            Sign in
          </a>
          <a
            href="#/auth"
            onClick={(e) => { e.preventDefault(); nav.go("#/auth"); }}
            style={{ display: "flex", alignItems: "center", gap: 7, height: 44, padding: "0 20px", borderRadius: 9999, background: "#FF0660", color: "#fff", fontSize: 14, fontWeight: 700, letterSpacing: ".03em", boxShadow: "0 8px 24px rgba(255,6,96,.3)" }}
          >
            Start free
          </a>
        </div>
      </nav>
    </div>
  );
}

export function PublicFooter({ nav, onAnchor }: { nav: Nav; onAnchor?: (id: string) => void }) {
  const anchor = (id: string) => (onAnchor ? onAnchor(id) : nav.go("#/"));
  return (
    <footer style={{ borderTop: "1px solid var(--divider)", background: "var(--panel)" }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "34px 24px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src={MARK} alt="After Human" style={{ width: 28, height: 28, display: "block" }} />
          <div style={{ fontSize: 15, fontWeight: 700 }}>After Human</div>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink3)" }}>Employment OS for digital workers</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 22, fontSize: 13, fontWeight: 500, color: "var(--ink2)" }}>
          <a href="#how" onClick={(e) => { e.preventDefault(); anchor("how"); }}>How it works</a>
          <a href="#capabilities" onClick={(e) => { e.preventDefault(); anchor("capabilities"); }}>Product</a>
          <a href="#/pricing" onClick={(e) => { e.preventDefault(); nav.go("#/pricing"); }}>Pricing</a>
          <a href="#/terms" onClick={(e) => { e.preventDefault(); nav.go("#/terms"); }}>Terms</a>
          <a href="#/privacy" onClick={(e) => { e.preventDefault(); nav.go("#/privacy"); }}>Privacy</a>
          <a href="#/signin" onClick={(e) => { e.preventDefault(); nav.go("#/signin"); }}>Sign in</a>
        </div>
      </div>
    </footer>
  );
}

// Shared full-height scroll wrapper used by every public page.
export function PublicShell({ theme, children }: { theme: "dark" | "light"; children: ReactNode }) {
  return (
    <div
      className="ah-public ahp-scroll"
      data-theme={theme}
      style={{ height: "100vh", overflowY: "auto", background: "var(--bg)", color: "var(--ink1)", transition: "background .2s ease" }}
    >
      {children}
    </div>
  );
}
