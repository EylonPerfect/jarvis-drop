import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { App } from "./App";
import Presenter from "./screens/Presenter";

// The /present page runs inside the Recall bot's headless browser as its shared
// screen — no app shell, no login gate (it's authorized by the session id).
const isPresent = window.location.pathname.replace(/\/$/, "") === "/present";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPresent ? <Presenter /> : <App />}
  </StrictMode>,
);
