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
} from "@unfurl/fabric-studio-webapp";
import { useStudioClient } from "./StudioClientContext.js";
import { useSearchParams } from "react-router-dom";

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

function CatalogRoute() {
  const client = useStudioClient();
  return <CatalogPalettePanel client={client} />;
}

function WorkspaceRoute() {
  const client = useStudioClient();
  const [searchParams] = useSearchParams();
  return (
    <DraftWorkspacePanel
      client={client}
      initialBaseCatalogHash={searchParams.get("catalogHash") ?? undefined}
    />
  );
}

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

function IntentHistoryRoute() {
  const [searchParams] = useSearchParams();
  const revision = Number(searchParams.get("revision") ?? "7");
  return <IntentHistoryPanel initialRevision={Number.isFinite(revision) ? revision : 7} />;
}

function VisualDiffRoute() {
  return <VisualDiffPanel />;
}

function DeploymentPlannerRoute() {
  const client = useStudioClient();
  const [searchParams] = useSearchParams();
  const initialPlannerState = searchParams.get("policy") === "all-shapes"
    ? createAllShapesDeploymentPlannerState()
    : undefined;
  return (
    <DeploymentPlannerPanel
      client={client}
      initialCatalogPath={searchParams.get("catalogPath") ?? ""}
      initialNeedsPath={searchParams.get("needsPath") ?? ""}
      initialPlannerState={initialPlannerState}
    />
  );
}
