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
          <NavLink to="/components/fabric-studio/workspace">
            Assembly
          </NavLink>
          <NavLink to="/components/fabric-studio/catalog">
            Catalog
          </NavLink>
          <NavLink to="/components/fabric-studio/read-only">
            Exploded
          </NavLink>
          <NavLink to="/components/fabric-studio/deployment-planner">
            Deployment
          </NavLink>
          <NavLink to="/components/fabric-studio/signing">
            Signing
          </NavLink>
          <NavLink to="/components/fabric-studio/graph">
            Ports
          </NavLink>
          <NavLink to="/components/fabric-studio/audit">
            Audit
          </NavLink>
          <NavLink to="/components/fabric-studio/intents">
            Intents
          </NavLink>
          <NavLink to="/components/fabric-studio/diff">
            Diff
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
