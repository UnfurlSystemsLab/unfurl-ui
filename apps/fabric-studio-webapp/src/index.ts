export type FabricStudioApp = {
  readonly appName: "@unfurl/fabric-studio-webapp";
  readonly routeBase: "/components/fabric-studio";
};

export const fabricStudioApp: FabricStudioApp = {
  appName: "@unfurl/fabric-studio-webapp",
  routeBase: "/components/fabric-studio"
};

export * from "./tableView.js";
export * from "./readOnlyStudio.js";
export * from "./catalogPalette.js";
export * from "./draftOverlays.js";
export * from "./draftExport.js";
export * from "./draftWorkspace.js";
export * from "./decisionAuditView.js";
export * from "./deploymentPlanner.js";
export * from "./deploymentPlannerView.js";
export * from "./DeploymentPlannerPanel.js";
export * from "./SelectedShapesPanel.js";
export * from "./RejectedShapesPanel.js";
export * from "./IsolationMatchesPanel.js";
export * from "./FallbackAttemptsPanel.js";
export * from "./RequiredPortsPanel.js";
export * from "./graphView.js";
export * from "./intentHistory.js";
export * from "./readOnlyWorkspace.js";
export * from "./signingHandoff.js";
export * from "./visualDiff.js";
