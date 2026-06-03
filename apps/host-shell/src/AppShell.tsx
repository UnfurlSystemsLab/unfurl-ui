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
          <NavLink to="/components/fabric-studio/deployment-planner">
            Deployment Planner
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
