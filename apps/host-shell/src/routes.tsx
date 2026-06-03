import { Navigate, Route, Routes } from "react-router-dom";
import { DeploymentPlannerPanel } from "@unfurl/fabric-studio-webapp";
import { useStudioClient } from "./StudioClientContext.js";

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
  return <DeploymentPlannerPanel client={client} />;
}
