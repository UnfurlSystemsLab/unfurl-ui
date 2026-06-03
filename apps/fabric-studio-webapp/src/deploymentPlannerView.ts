import type { ResolveDeploymentResponse, StudioFabricClient } from "@unfurl/fabric-validation-client";
import {
  DEPLOYMENT_SHAPE_OPTIONS,
  deploymentPolicyFromPlannerState,
  type DeploymentPlannerState,
  type DeploymentShapeOption
} from "./deploymentPlanner.js";
import type { DraftWorkspaceState } from "./draftWorkspace.js";
import { currentRevision } from "./intentHistory.js";

export type DeploymentPlannerChoice = {
  readonly shape: DeploymentShapeOption["shape"];
  readonly label: string;
  readonly description: string;
  readonly preferredRank?: number;
  readonly disallowed: boolean;
  readonly requires: readonly string[];
  readonly runtimeSatisfied: boolean;
};

export type DeploymentPlannerView = {
  readonly title: string;
  readonly status: "READY" | "DISABLED";
  readonly summary: readonly string[];
  readonly choices: readonly DeploymentPlannerChoice[];
  readonly isolationPatterns: readonly string[];
  readonly runtime: readonly string[];
  readonly lastResolution?: ResolveDeploymentResponse;
};

export function buildDeploymentPlannerView(
  state: DeploymentPlannerState,
  lastResolution?: ResolveDeploymentResponse
): DeploymentPlannerView {
  const policy = deploymentPolicyFromPlannerState(state);
  return {
    title: "Deployment Planner",
    status: "READY",
    summary: [
      `preferred shapes: ${policy.preferredShapes.join(", ") || "none"}`,
      `disallowed shapes: ${policy.disallowedShapes.join(", ") || "none"}`,
      `isolation patterns: ${policy.requireIsolationForCapabilityPatterns.join(", ") || "none"}`
    ],
    choices: DEPLOYMENT_SHAPE_OPTIONS.map(option => {
      const rank = preferredRank(policy.preferredShapes, option.shape);
      return {
        shape: option.shape,
        label: option.label,
        description: option.description,
        ...(rank === undefined ? {} : { preferredRank: rank }),
        disallowed: policy.disallowedShapes.includes(option.shape),
        requires: option.requires,
        runtimeSatisfied: runtimeSatisfied(policy.runtime, option.requires)
      };
    }),
    isolationPatterns: policy.requireIsolationForCapabilityPatterns,
    runtime: runtimeLines(policy.runtime),
    ...(lastResolution === undefined ? {} : { lastResolution })
  };
}

export function disabledDeploymentPlannerView(message: string): DeploymentPlannerView {
  return {
    title: "Deployment Planner",
    status: "DISABLED",
    summary: [message],
    choices: [],
    isolationPatterns: [],
    runtime: []
  };
}

export function renderDeploymentPlannerText(view: DeploymentPlannerView): string {
  const lines = [view.title, `status: ${view.status}`, ...view.summary.map(item => `- ${item}`)];
  if (view.runtime.length > 0) {
    lines.push("", "Runtime");
    lines.push(...view.runtime.map(item => `- ${item}`));
  }
  if (view.choices.length > 0) {
    lines.push("", "Choices", "Shape | Rank | Allowed | Runtime | Description");
    for (const choice of view.choices) {
      lines.push([
        choice.shape,
        choice.preferredRank === undefined ? "-" : String(choice.preferredRank),
        choice.disallowed ? "blocked" : "allowed",
        choice.runtimeSatisfied ? "ready" : `missing ${choice.requires.join(", ")}`,
        choice.description
      ].join(" | "));
    }
  }
  if (view.lastResolution) {
    lines.push("", "Last Resolution", renderResolution(view.lastResolution));
  }
  return lines.join("\n");
}

export async function resolveDeploymentForDraft(
  client: Pick<StudioFabricClient, "resolveDeployment">,
  workspace: DraftWorkspaceState,
  plannerState: DeploymentPlannerState
): Promise<ResolveDeploymentResponse> {
  if (!client.resolveDeployment) {
    throw new Error("resolveDeployment API is not available");
  }
  if (workspace.status !== "READY") {
    throw new Error("deployment resolution requires a ready draft workspace");
  }
  return client.resolveDeployment({
    sessionId: workspace.session.sessionId,
    ...(workspace.session.currentCandidateId === undefined ? {} : { candidateId: workspace.session.currentCandidateId }),
    baseCatalogHash: workspace.session.baseCatalogHash,
    deploymentPolicy: deploymentPolicyFromPlannerState(plannerState)
  });
}

function preferredRank(preferredShapes: readonly string[], shape: string): number | undefined {
  const index = preferredShapes.indexOf(shape);
  return index < 0 ? undefined : index + 1;
}

function runtimeSatisfied(runtime: Record<string, unknown>, requirements: readonly string[]): boolean {
  return requirements.every(requirement => runtime[requirement] === true || requirement === "java");
}

function runtimeLines(runtime: Record<string, unknown>): readonly string[] {
  return Object.entries(runtime)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}: ${value}`);
}

function renderResolution(response: ResolveDeploymentResponse): string {
  if (response.status === "INVALID") {
    return `INVALID ${response.reason}: ${response.details}`;
  }
  return [
    `RESOLVED candidate=${response.candidateId}`,
    ...response.selections.map(selection =>
      `${selection.componentId} ${selection.capability} -> ${selection.deploymentShape}`
    ),
    ...response.warnings.map(warning => `WARNING ${warning}`)
  ].join("\n");
}
