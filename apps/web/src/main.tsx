import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import "./pds-mockup.css";
import { App } from "./App";
import Presenter from "./screens/Presenter";
import Live from "./screens/Live";
import SuperAdmin from "./superadmin/SuperAdmin";
// Public marketing site (new, self-scoped routes) served at /site.
import PublicSite from "./public/PublicSite";

// The /present and /live pages run inside the Recall bot's headless browser (as
// its shared screen / camera+mic) — no app shell, no login gate (authorized by
// the unguessable session id in the URL). /superadmin is the platform operator
// console — also its own top-level page (own password gate, dark surface, all
// styles scoped under .sa), never mixed into the product app shell.
const path = window.location.pathname.replace(/\/$/, "");
const isPresent = path === "/present";
const isLive = path === "/live";
const isSuperadmin = path === "/superadmin";
const isSite = path === "/site";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPresent ? <Presenter /> : isLive ? <Live /> : isSuperadmin ? <SuperAdmin /> : isSite ? <PublicSite /> : <App />}
  </StrictMode>,
);
