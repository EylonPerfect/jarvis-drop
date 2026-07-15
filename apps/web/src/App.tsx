import { useEffect, useState } from "react";
import { AppShell, type ViewId } from "./components/AppShell";
import { AboutModal } from "./screens/AboutModal";
import LoginGate from "./screens/LoginGate";
import { getAccessKey } from "./api/client";
import CommandCenter from "./screens/CommandCenter";
import AICore from "./screens/AICore";
import Agents from "./screens/Agents";
import TasksKanban from "./screens/TasksKanban";
import Calendar from "./screens/Calendar";
import Memory from "./screens/Memory";
import Conversations from "./screens/Conversations";
import KnowledgeBase from "./screens/KnowledgeBase";
import ToolsSkills from "./screens/ToolsSkills";
import Workflows from "./screens/Workflows";
import SystemMonitor from "./screens/SystemMonitor";
import HireAgent from "./screens/HireAgent";
import ApprovalsInbox from "./screens/ApprovalsInbox";
import Permissions from "./screens/Permissions";
import Spend from "./screens/Spend";
import Ledger from "./screens/Ledger";
import Integrations from "./screens/Integrations";
import Company from "./screens/Company";
import Artifacts from "./screens/Artifacts";
import Meetings from "./screens/Meetings";
import Workstation from "./screens/Workstation";
import LiveCall from "./screens/LiveCall";
import Debrief from "./screens/Debrief";
import RehearsalRoom from "./screens/RehearsalRoom";
import AgentWorkspace from "./screens/AgentWorkspace";
import ModelSettings from "./screens/ModelSettings";
import LandingPage from "./screens/LandingPage";
import PricingPage from "./screens/PricingPage";
import AgentsHome from "./screens/AgentsHome";
import EchoDashboard from "./screens/EchoDashboard";
import CloneARep from "./screens/CloneARep";
import DrillMode from "./screens/DrillMode";
import MomentTrainer from "./screens/MomentTrainer";
import Certification from "./screens/Certification";
import Readiness from "./screens/Readiness";
import PreCallCheck from "./screens/PreCallCheck";
import ScreenMap from "./screens/ScreenMap";
import Connections from "./screens/Connections";

// Every page has its own URL (#/echo, #/precall, ...) so browser back/forward,
// bookmarks, and shared links work like any normal app. The hash is the source
// of truth; nav() writes it and the hashchange listener applies it.
const viewFromHash = (): ViewId | null => {
  const h = window.location.hash.replace(/^#\/?/, "").trim();
  return h ? (h as ViewId) : null;
};

export function App() {
  const [view, setView] = useState<ViewId>(() => viewFromHash() ?? "echo");
  const [about, setAbout] = useState(false);
  const [authed, setAuthed] = useState(() => !!getAccessKey());
  const nav = (id: ViewId) => {
    if (viewFromHash() !== id) window.location.hash = "/" + id;
    setView(id);
  };

  // back/forward + direct links
  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, "", "#/" + (viewFromHash() ?? "echo"));
    const onHash = () => { const v = viewFromHash(); if (v) setView(v); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // If any request 401s (bad/expired code), the client clears the key and fires
  // this event — bounce back to the login gate.
  useEffect(() => {
    const onUnauth = () => setAuthed(false);
    window.addEventListener("jv-unauthorized", onUnauth);
    return () => window.removeEventListener("jv-unauthorized", onUnauth);
  }, []);

  // The Perfect screens cross-navigate by firing a pds-nav event (they don't
  // receive setView as a prop).
  useEffect(() => {
    const onPds = (e: Event) => {
      const v = (e as CustomEvent).detail?.view;
      if (v) { if (viewFromHash() !== v) window.location.hash = "/" + v; setView(v as ViewId); }
    };
    window.addEventListener("pds-nav", onPds);
    return () => window.removeEventListener("pds-nav", onPds);
  }, []);

  if (!authed) return <LoginGate onAuthed={() => setAuthed(true)} />;

  let body: React.ReactNode;
  switch (view) {
    case "command":
      body = <CommandCenter onNav={nav} />;
      break;
    case "aicore":
      body = <AICore />;
      break;
    case "agents":
      body = <Agents />;
      break;
    case "hire":
      body = <HireAgent />;
      break;
    case "approvals":
      body = <ApprovalsInbox />;
      break;
    case "meetings":
      body = <Meetings />;
      break;
    case "workstation":
      body = <Workstation />;
      break;
    case "livecall":
      body = <LiveCall />;
      break;
    case "debrief":
      body = <Debrief />;
      break;
    case "rehearsal":
      body = <RehearsalRoom />;
      break;
    case "workspace":
      body = <AgentWorkspace />;
      break;
    case "modelsettings":
      body = <ModelSettings />;
      break;
    case "landing":
      body = <LandingPage />;
      break;
    case "pricing":
      body = <PricingPage />;
      break;
    case "agentshome":
      body = <AgentsHome />;
      break;
    case "echo":
      body = <EchoDashboard />;
      break;
    case "clonerep":
      body = <CloneARep />;
      break;
    case "pdsstudio":
      // The studio was absorbed into the Calibration Room — old links land there.
      body = <RehearsalRoom />;
      break;
    case "drillmode":
      body = <DrillMode />;
      break;
    case "momenttrainer":
      body = <MomentTrainer />;
      break;
    case "certification":
      body = <Certification />;
      break;
    case "readiness":
      body = <Readiness />;
      break;
    case "connections":
      body = <Connections />;
      break;
    case "precall":
      body = <PreCallCheck />;
      break;
    case "director":
      // No separate director screen — the Calibration Room is the one live cockpit.
      body = <RehearsalRoom />;
      break;
    case "democanvas":
      // retired — the Calibration Room is the one live cockpit (stream included)
      body = <RehearsalRoom />;
      break;
    case "screenmap":
      body = <ScreenMap />;
      break;
    case "permissions":
      body = <Permissions />;
      break;
    case "spend":
      body = <Spend />;
      break;
    case "ledger":
      body = <Ledger />;
      break;
    case "integrations":
      body = <Integrations />;
      break;
    case "company":
      body = <Company />;
      break;
    case "artifacts":
      body = <Artifacts />;
      break;
    case "tasks":
      body = <TasksKanban />;
      break;
    case "calendar":
      body = <Calendar />;
      break;
    case "memory":
      body = <Memory />;
      break;
    case "conversations":
      body = <Conversations />;
      break;
    case "knowledge":
      body = <KnowledgeBase />;
      break;
    case "tools":
      body = <ToolsSkills />;
      break;
    case "workflows":
      body = <Workflows />;
      break;
    case "monitor":
      body = <SystemMonitor />;
      break;
    default:
      body = <div className="placeholder">This surface isn't part of the kit yet.</div>;
  }

  // The Perfect app is its own product surface — full screen, no HUD chrome.
  // A small corner pill drops back into the legacy ops console.
  const PDS_VIEWS: ViewId[] = ["agentshome", "echo", "readiness", "connections", "clonerep", "pdsstudio", "drillmode", "momenttrainer", "certification", "precall", "director", "democanvas", "debrief", "screenmap", "workspace", "modelsettings", "landing", "pricing", "rehearsal"];
  if (PDS_VIEWS.includes(view)) {
    // Design-faithful: Perfect screens are full-bleed pages that navigate through
    // their own links (top-nav pills, jump-to chips, back arrows) — no app chrome.
    // The discreet corner pill reaches the legacy ops console.
    return (
      <div style={{ height: "100vh", overflow: "hidden", position: "relative" }}>
        {body}
        <button onClick={() => setView("command")} title="Open the ops console" style={{ position: "fixed", left: 12, bottom: 12, zIndex: 3000, height: 26, padding: "0 10px", borderRadius: 9999, border: "1px solid rgba(128,128,160,.25)", background: "rgba(10,10,40,.55)", color: "rgba(255,255,255,.5)", font: "600 10px system-ui, sans-serif", cursor: "pointer", backdropFilter: "blur(8px)", opacity: 0.6 }}>ops</button>
      </div>
    );
  }

  return (
    <>
      <AppShell active={view} onNav={nav} onAbout={() => setAbout(true)} showDock={view !== "command"}>
        {body}
      </AppShell>
      {about && <AboutModal onClose={() => setAbout(false)} />}
    </>
  );
}
