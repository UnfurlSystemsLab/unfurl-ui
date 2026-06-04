import { NavLink } from "react-router-dom";
import { AppRoutes } from "./routes.js";
import { studioMode } from "./StudioClientContext.js";

export type AppShellProps = {
  readonly mode?: "live" | "fixture";
};

export function AppShell({ mode = studioMode() }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand">Unfurl Studio</div>
        <nav>
          <NavLink to="/components/fabric-studio/catalog">
            Catalog Palette
          </NavLink>
          <NavLink to="/components/fabric-studio/workspace">
            Studio Workbench
          </NavLink>
          <NavLink to="/components/fabric-studio/read-only">
            Read-Only Studio
          </NavLink>
          <NavLink to="/components/fabric-studio/deployment-planner">
            Deployment Planner
          </NavLink>
          <NavLink to="/components/fabric-studio/signing">
            Signing Handoff
          </NavLink>
          <NavLink to="/components/fabric-studio/graph">
            Graph View
          </NavLink>
          <NavLink to="/components/fabric-studio/audit">
            Decision Audit
          </NavLink>
          <NavLink to="/components/fabric-studio/intents">
            Intent History
          </NavLink>
          <NavLink to="/components/fabric-studio/diff">
            Visual Diff
          </NavLink>
        </nav>
        <div className="mode-pill">{mode} mode</div>
      </aside>
      <main className="app-main">
        <AppRoutes />
      </main>
    </div>
  );
}
