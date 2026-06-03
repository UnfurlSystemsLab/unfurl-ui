import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppShell } from "./AppShell.js";
import { StudioClientProvider } from "./StudioClientContext.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("root element is missing");
}

createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <StudioClientProvider>
        <AppShell />
      </StudioClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
