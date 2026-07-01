import { useState } from "react";
import { AppShell, type ViewId } from "./components/AppShell";
import { AboutModal } from "./screens/AboutModal";
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

export function App() {
  const [view, setView] = useState<ViewId>("command");
  const [about, setAbout] = useState(false);
  const nav = (id: ViewId) => setView(id);

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
