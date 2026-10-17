import { useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { studioApiBaseUrl, studioAssemblyId, studioMode, studioTenantId } from "./StudioClientContext.js";
import { createHostRegistry } from "./registry.js";
import { evaluateRouteAccess } from "./accessControl.js";
import { resolveActiveTheme } from "./activeTheme.js";
import { createMicroAppProps } from "./microAppProps.js";
import { localHostRuntime, type HostRuntime, hostCompatibility } from "./hostRuntime.js";
import { MicroAppHost } from "./MicroAppHost.js";
import type { CSSProperties } from "react";

export type AppShellProps = {
  readonly mode?: "live" | "fixture";
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly runtime?: HostRuntime | undefined;
};
const studioLinks = [["workspace", "Assembly"], ["catalog", "Catalog"], ["read-only", "Exploded"],
  ["deployment-planner", "Deployment"], ["signing", "Signing"], ["graph", "Ports"], ["audit", "Audit"],
  ["intents", "Intents"], ["diff", "Diff"], ["help", "Help"]] as const;

/** Composite: render deployment navigation, a guarded lifecycle mount and resolved theme. */
export function AppShell({ mode = studioMode(), tenantId = studioTenantId(), assemblyId = studioAssemblyId(), runtime }: AppShellProps) {
  const local = useMemo(() => localHostRuntime(tenantId, studioApiBaseUrl()), [tenantId]);
  const host = runtime ?? local;
  const location = useLocation();
  const path = location.pathname === "/" ? "/components/fabric-studio/workspace" : location.pathname;
  const registry = useMemo(() => createHostRegistry({ ...host.registry, hostCompatibility,
    userPermissions: host.context.user.permissions }), [host]);
  const access = evaluateRouteAccess(registry, path, host.context.user.permissions);
  const activeTheme = useMemo(() => resolveActiveTheme({ registry, currentPath: path,
    baseTheme: host.baseTheme, policy: host.themePolicy }), [registry, path, host]);
  const selected = access.allowed ? access.webapp : undefined;
  const props = useMemo(() => selected ? createMicroAppProps(selected,
    { ...host.context, theme: activeTheme.theme }) : undefined, [selected, host, activeTheme.theme]);
  const style = Object.fromEntries(Object.entries(activeTheme.theme.tokens)
    .filter(([key]) => /^[a-zA-Z][\w.-]*$/.test(key)).map(([key, value]) => [`--${key.replaceAll(".", "-")}`, value])) as CSSProperties;
  return <div className="app-shell" style={style}>
    <aside className="side-nav"><div className="brand">Unfurl Studio</div><nav>
      {registry.navigation.flatMap(item => item.componentId === "fabric-studio"
        ? studioLinks.map(([route, label]) => <NavLink key={route} to={`${item.routePrefix}/${route}${location.search}`}>{label}</NavLink>)
        : [<NavLink key={item.componentId} to={item.routePrefix}>{item.title}</NavLink>])}
    </nav><div className="shell-context">
      <span className="scope-pill" title="Tenant">{host.context.tenantId}</span>
      <span className="scope-pill" title="Assembly">{assemblyId}</span><span className="mode-pill">{mode} mode</span>
      <span className="mode-pill" title="Authentication profile">{host.authentication === "local-development" ? "Unauthenticated local" : "Authenticated host"}</span>
    </div></aside>
    <main className="app-main">
      {access.allowed && props ? <MicroAppHost key={JSON.stringify([access.webapp.componentId, host.context.tenantId, host.context.user.id])}
        webapp={access.webapp} props={props} approvedUrls={host.approvedBundleUrls} mode={mode} assemblyId={assemblyId}
        localDevelopment={host.authentication === "local-development"} />
        : <p role="alert">{!access.allowed && access.reason === "MISSING_PERMISSION" ? "Access denied" : "No enabled compatible component for this route"}</p>}
      {registry.rejected.map(item => <p role="status" key={item.componentId}>Component {item.componentId} is incompatible: {item.details.join(", ")}</p>)}
    </main>
  </div>;
}
