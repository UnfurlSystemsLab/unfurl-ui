import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { CatalogPalettePanel } from "./CatalogPalettePanel.js";
import { StudioHelpPanel } from "./StudioHelpPanel.js";
import { useStudioClient, useStudioOperator } from "./StudioClientContext.js";
import { CompiledContractWorkbench, Workbench } from "./workbench/Workbench.js";

/** The workbench route (LLD-studio-viewpoints-and-perspectives §5.3). */
export const WORKBENCH_PATH = "/components/fabric-studio/workspace";

/**
 * The retired Studio routes and the workbench view state each lands on (LLD §5.3). Only these parameters are added;
 * every parameter the old link carried (`tenantId`, `assemblyId`, `contractPath`, `policy`, ...) is kept.
 */
export const RETIRED_ROUTES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  graph: { view: "flow", renderer: "2d" },
  "read-only": { view: "flow", renderer: "table" },
  "deployment-planner": { view: "topology" },
  signing: { view: "flow", overlays: "security", panel: "compile" },
  audit: { view: "flow", overlays: "compliance", panel: "compile" },
  intents: { view: "flow", panel: "history" },
  diff: { view: "flow", panel: "compile" }
};

/** Router: Studio's three entries (workbench, catalog, help) and the redirects of the retired routes. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={WORKBENCH_PATH} replace />} />
      <Route path="/components/fabric-studio/catalog" element={<CatalogRoute />} />
      <Route path={WORKBENCH_PATH} element={<WorkbenchRoute />} />
      <Route path="/components/fabric-studio/help" element={<StudioHelpPanel />} />
      {Object.keys(RETIRED_ROUTES).map(route => (
        <Route key={route} path={`/components/fabric-studio/${route}`} element={<RetiredRoute route={route} />} />
      ))}
    </Routes>
  );
}

/**
 * Redirect Adapter: a retired route lands on the workbench with its mapped view state; a parameter of the old link wins
 * over nothing, and the mapping never overrides an explicit `view`, `overlays`, `renderer` or `panel` it already carried.
 * The old `renderer=2d|3d` keeps its meaning.
 */
function RetiredRoute({ route }: { readonly route: string }) {
  const location = useLocation();
  return <Navigate to={retiredRouteTarget(route, location.search)} replace />;
}

/** The workbench URL a retired route redirects to. */
export function retiredRouteTarget(route: string, search: string): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(RETIRED_ROUTES[route] ?? {})) {
    if (!params.has(key)) params.set(key, value);
  }
  return `${WORKBENCH_PATH}?${params.toString()}`;
}

/** Route Adapter: hydrate catalog selection from navigation state. */
function CatalogRoute() {
  const client = useStudioClient();
  const [searchParams, setSearchParams] = useSearchParams();
  return (
    <CatalogPalettePanel
      client={client}
      tenantId={searchParams.get("tenantId") ?? undefined}
      assemblyId={searchParams.get("assemblyId") ?? undefined}
      // Round-trip the panel's tenant edits into the URL so the tenant is bookmarkable / shareable and the multitenant
      // flow is exercised end-to-end from the URL bar.
      onTenantIdChange={(next) => {
        setSearchParams(prev => {
          const out = new URLSearchParams(prev);
          if (next === "" || next === "tenant-local") {
            out.delete("tenantId");
          } else {
            out.set("tenantId", next);
          }
          return out;
        });
      }}
    />
  );
}

/**
 * Scope Adapter: the workbench for the linked tenant and assembly, remounted when they change, with the deep link's view
 * state. A supplied `contractPath` opens that compiled contract read-only instead (`read-only`, LLD §5.3).
 */
function WorkbenchRoute() {
  const client = useStudioClient();
  const operator = useStudioOperator();
  const [searchParams] = useSearchParams();
  const contractPath = searchParams.get("contractPath");
  if (contractPath) {
    return <CompiledContractWorkbench client={client} contractPath={contractPath}
      substrateProfilePath={searchParams.get("substrateProfilePath") ?? ""} deepLink={searchParams.toString()} />;
  }
  return (
    <Workbench
      key={JSON.stringify([searchParams.get("tenantId"), searchParams.get("assemblyId")])}
      client={client}
      initialTenantId={searchParams.get("tenantId") ?? undefined}
      initialAssemblyId={searchParams.get("assemblyId") ?? undefined}
      initialBaseCatalogHash={searchParams.get("catalogHash") ?? undefined}
      operatorId={operator}
      deepLink={searchParams.toString()}
      allShapesPolicy={searchParams.get("policy") === "all-shapes"}
    />
  );
}
