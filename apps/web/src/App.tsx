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

export function App() {
  const [view, setView] = useState<ViewId>("command");
  const [about, setAbout] = useState(false);
  const [authed, setAuthed] = useState(() => !!getAccessKey());
  const nav = (id: ViewId) => setView(id);

  // If any request 401s (bad/expired code), the client clears the key and fires
  // this event — bounce back to the login gate.
  useEffect(() => {
    const onUnauth = () => setAuthed(false);
    window.addEventListener("jv-unauthorized", onUnauth);
    return () => window.removeEventListener("jv-unauthorized", onUnauth);
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

  return (
    <>
      <AppShell active={view} onNav={nav} onAbout={() => setAbout(true)} showDock={view !== "command"}>
        {body}
      </AppShell>
      {about && <AboutModal onClose={() => setAbout(false)} />}
    </>
  );
}
