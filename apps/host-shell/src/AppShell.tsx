import { NavLink } from "react-router-dom";
import { AppRoutes } from "./routes.js";
import { studioAssemblyId, studioMode, studioTenantId } from "./StudioClientContext.js";

export type AppShellProps = {
  readonly mode?: "live" | "fixture";
  readonly tenantId?: string;
  readonly assemblyId?: string;
};

export function AppShell({
  mode = studioMode(),
  tenantId = studioTenantId(),
  assemblyId = studioAssemblyId()
}: AppShellProps) {
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
          <NavLink to="/components/fabric-studio/help">
            Help
          </NavLink>
        </nav>
        <div className="shell-context">
          <span className="scope-pill" title="Tenant">{tenantId}</span>
          <span className="scope-pill" title="Assembly">{assemblyId}</span>
          <span className="mode-pill">{mode} mode</span>
        </div>
      </aside>
      <main className="app-main">
        <AppRoutes />
      </main>
    </div>
  );
}
