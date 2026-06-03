import { Navigate, Route, Routes } from "react-router-dom";
import {
  DeploymentPlannerPanel,
  createAllShapesDeploymentPlannerState
} from "@unfurl/fabric-studio-webapp";
import { useStudioClient } from "./StudioClientContext.js";
import { useSearchParams } from "react-router-dom";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/components/fabric-studio/deployment-planner" replace />} />
      <Route path="/components/fabric-studio/deployment-planner" element={<DeploymentPlannerRoute />} />
    </Routes>
  );
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
