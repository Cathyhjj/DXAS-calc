import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { WorkspaceErrorBoundary } from "./components/WorkspaceErrorBoundary.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <WorkspaceErrorBoundary><App /></WorkspaceErrorBoundary>
  </React.StrictMode>,
);
