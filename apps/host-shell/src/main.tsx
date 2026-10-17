import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppShell } from "./AppShell.js";
import type { HostRuntime } from "./hostRuntime.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("root element is missing");
}

// Production must be explicitly bootstrapped by the deployment, not an implicit local identity.
const runtime = (window as Window & { unfurlHost?: HostRuntime }).unfurlHost;
if (import.meta.env.PROD && !runtime) {
  throw new Error("Configure window.unfurlHost before loading the production host shell");
}

createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppShell runtime={runtime} />
    </BrowserRouter>
  </React.StrictMode>
);
