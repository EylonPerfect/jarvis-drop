import { useEffect, useState } from "react";
import "./public.css";
import { type Nav } from "./PublicChrome";
import PublicLanding from "./PublicLanding";
import PublicPricing from "./PublicPricing";
import PublicAuth from "./PublicAuth";
import TalkToAva from "./TalkToAva";
import PublicLegal from "./PublicLegal";

// ============================================================
// After Human — public marketing site entry. Mounted by main.tsx
// for the /site path. Owns theme (dark by default with a light
// toggle) and hash-based sub-routing so browser back/forward and
// shared links work:
//   /site#/        -> Landing
//   /site#/pricing -> Pricing
//   /site#/ava     -> Talk to Ava (live voice + screen demo)
//   /site#/auth    -> Auth (signup)
//   /site#/signin  -> Auth (signin)
//   /site#/terms   -> Terms of Service
//   /site#/privacy -> Privacy Policy
// Navigation into the product app leaves the public site via
// goApp (e.g. window.location.href = "/#/clonerep").
//
// Everything renders inside the scoped .ah-public wrapper, so no
// product screen or shared style is touched.
// ============================================================

type Route = { page: "landing" | "pricing" | "auth" | "ava" | "terms" | "privacy"; authMode: "signup" | "signin" };

function routeFromHash(): Route {
  const h = window.location.hash.toLowerCase();
  if (h.indexOf("ava") > -1) return { page: "ava", authMode: "signup" };
  if (h.indexOf("privacy") > -1) return { page: "privacy", authMode: "signup" };
  if (h.indexOf("terms") > -1) return { page: "terms", authMode: "signup" };
  if (h.indexOf("pricing") > -1) return { page: "pricing", authMode: "signup" };
  if (h.indexOf("signin") > -1) return { page: "auth", authMode: "signin" };
  if (h.indexOf("auth") > -1) return { page: "auth", authMode: "signup" };
  return { page: "landing", authMode: "signup" };
}

export default function PublicSite() {
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Load Material Symbols Rounded once, only for the public site. Injected here
  // (not in index.html) so the product's global HTML stays byte-identical.
  useEffect(() => {
    const href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200";
    if (!document.querySelector(`link[data-ah-symbols]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.setAttribute("data-ah-symbols", "1");
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash) window.history.replaceState(null, "", "#/");
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const nav: Nav = {
    theme,
    toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    go: (hash: string) => {
      // Setting the hash fires hashchange (handled above); we also update state
      // synchronously so a same-hash click still re-renders. Reset scroll.
      if (window.location.hash !== hash) window.location.hash = hash;
      setRoute(routeFromHash());
      document.querySelector(".ah-public")?.scrollTo?.({ top: 0 });
    },
    goApp: (view: string) => {
      window.location.href = "/#/" + view;
    },
  };

  if (route.page === "ava") return <TalkToAva nav={nav} />;
  if (route.page === "terms") return <PublicLegal nav={nav} doc="terms" />;
  if (route.page === "privacy") return <PublicLegal nav={nav} doc="privacy" />;
  if (route.page === "pricing") return <PublicPricing nav={nav} />;
  if (route.page === "auth") return <PublicAuth nav={nav} mode={route.authMode} />;
  return <PublicLanding nav={nav} />;
}
