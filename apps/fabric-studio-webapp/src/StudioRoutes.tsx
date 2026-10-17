import { Navigate, Route, Routes } from "react-router-dom";
import {
  CatalogPalettePanel,
  DecisionAuditPanel,
  DraftWorkspacePanel,
  DeploymentPlannerPanel,
  GraphPanel,
  IntentHistoryPanel,
  ReadOnlyStudioPanel,
  SigningHandoffPanel,
  StudioHelpPanel,
  VisualDiffPanel,
  createAllShapesDeploymentPlannerState
} from "./index.js";
import { studioDemoFallbacks, useStudioMode, useStudioClient } from "./StudioClientContext.js";
import { useSearchParams } from "react-router-dom";

/** Router: map Studio-owned paths to product experiences. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/components/fabric-studio/workspace" replace />} />
      <Route path="/components/fabric-studio/catalog" element={<CatalogRoute />} />
      <Route path="/components/fabric-studio/workspace" element={<WorkspaceRoute />} />
      <Route path="/components/fabric-studio/read-only" element={<ReadOnlyRoute />} />
      <Route path="/components/fabric-studio/signing" element={<SigningRoute />} />
      <Route path="/components/fabric-studio/graph" element={<GraphRoute />} />
      <Route path="/components/fabric-studio/audit" element={<AuditRoute />} />
      <Route path="/components/fabric-studio/intents" element={<IntentHistoryRoute />} />
      <Route path="/components/fabric-studio/diff" element={<VisualDiffRoute />} />
      <Route path="/components/fabric-studio/help" element={<StudioHelpPanel />} />
      <Route path="/components/fabric-studio/deployment-planner" element={<DeploymentPlannerRoute />} />
    </Routes>
  );
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
      // Round-trip the panel's tenant edits into the URL so the tenant is
      // bookmarkable / shareable and the multitenant flow is exercised
      // end-to-end from the URL bar.
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

/** Scope Adapter: remount the workspace on externally selected identity changes. */
function WorkspaceRoute() {
  const client = useStudioClient();
  const [searchParams] = useSearchParams();
  return (
    <DraftWorkspacePanel
      key={JSON.stringify([searchParams.get("tenantId"), searchParams.get("assemblyId")])}
      client={client}
      initialTenantId={searchParams.get("tenantId") ?? undefined}
      initialAssemblyId={searchParams.get("assemblyId") ?? undefined}
      initialBaseCatalogHash={searchParams.get("catalogHash") ?? undefined}
      demoFallbacks={studioDemoFallbacks()}
    />
  );
}

/** Route Adapter: select an authoritative composition view. */
function ReadOnlyRoute() {
  const client = useStudioClient();
  const [searchParams] = useSearchParams();
  return (
    <ReadOnlyStudioPanel
      client={client}
      initialContractPath={searchParams.get("contractPath") ?? ""}
      initialSubstrateProfilePath={searchParams.get("substrateProfilePath") ?? ""}
    />
  );
}

/** Route Adapter: collect the session and revision for signed export. */
function SigningRoute() {
  const client = useStudioClient();
  const [searchParams] = useSearchParams();
  const revision = Number(searchParams.get("revision") ?? "7");
  return (
    <SigningHandoffPanel
      client={client}
      initialSessionId={searchParams.get("sessionId") ?? "studio-session-123"}
      initialExpectedRevision={Number.isFinite(revision) ? revision : 7}
    />
  );
}

/** Route Adapter: select the accessible graph representation. */
function GraphRoute() {
  const client = useStudioClient();
  const [searchParams] = useSearchParams();
  return (
    <GraphPanel
      client={client}
      initialContractPath={searchParams.get("contractPath") ?? ""}
      initialSubstrateProfilePath={searchParams.get("substrateProfilePath") ?? ""}
      initialRenderer={searchParams.get("renderer") === "3d" ? "3d" : "2d"}
    />
  );
}

/** Route Adapter: inspect the selected revision through the Fabric client. */
function AuditRoute() {
  const client = useStudioClient();
  const [searchParams] = useSearchParams();
  const revision = Number(searchParams.get("revision") ?? "7");
  return (
    <DecisionAuditPanel
      client={client}
      initialSessionId={searchParams.get("sessionId") ?? "studio-session-123"}
      initialExpectedRevision={Number.isFinite(revision) ? revision : 7}
    />
  );
}

/** Route Adapter: expose unavailable live history or an explicitly selected fixture. */
function IntentHistoryRoute() {
  const [searchParams] = useSearchParams();
  const revision = Number(searchParams.get("revision") ?? "7");
  return <IntentHistoryPanel fixture={useStudioMode() === "fixture"} initialRevision={Number.isFinite(revision) ? revision : 7} />;
}

/** Route Adapter: never supply fabricated live revision artifacts. */
function VisualDiffRoute() {
  return <VisualDiffPanel fixture={useStudioMode() === "fixture"} />;
}

/**
 * Route adapter: hydrates the deployment planner from URL parameters, preferring
 * Studio session identifiers over filesystem debug paths.
 */
function DeploymentPlannerRoute() {
  const client = useStudioClient();
  const [searchParams] = useSearchParams();
  const initialPlannerState = searchParams.get("policy") === "all-shapes"
    ? createAllShapesDeploymentPlannerState()
    : undefined;
  // Accept the canonical `needsPath` param (what launchers actually emit) while
  // keeping `assemblyPath` as a backward-compat alias for old bookmarks. The
  // previous hardcoded `samples/...` placeholder was dropped — defaulting to
  // an empty string is consistent with `initialCatalogPath` and produces a
  // friendly empty field instead of a misleading file-not-found error.
  return (
    <DeploymentPlannerPanel
      client={client}
      initialTenantId={searchParams.get("tenantId") ?? ""}
      initialAssemblyId={searchParams.get("assemblyId") ?? ""}
      initialSessionId={searchParams.get("sessionId") ?? ""}
      initialNeedsId={searchParams.get("needsId") ?? ""}
      initialCatalogPath={searchParams.get("catalogPath") ?? ""}
      initialAssemblyPath={searchParams.get("needsPath") ?? searchParams.get("assemblyPath") ?? ""}
      initialPlannerState={initialPlannerState}
    />
  );
}
