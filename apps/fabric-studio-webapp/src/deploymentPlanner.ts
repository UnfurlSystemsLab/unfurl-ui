import type {
  DeploymentPolicyDraft,
  DeploymentRuntimePolicyDraft,
  DeploymentShape
} from "@unfurl/fabric-validation-client";
import type { DraftWorkspaceState } from "./draftWorkspace.js";
import { compileDraftWorkspace, type CompileDraftWorkspaceOptions } from "./draftWorkspace.js";
import type { StudioFabricClient } from "@unfurl/fabric-validation-client";

export type DeploymentShapeOption = {
  readonly shape: DeploymentShape;
  readonly label: string;
  readonly description: string;
  readonly requires: readonly string[];
};

export type DeploymentPlannerState = {
  readonly preferredShapes: readonly DeploymentShape[];
  readonly disallowedShapes: readonly DeploymentShape[];
  readonly requireIsolationForCapabilityPatterns: readonly string[];
  readonly runtime: DeploymentRuntimePolicyDraft;
};

export const DEPLOYMENT_SHAPE_OPTIONS: readonly DeploymentShapeOption[] = [
  {
    shape: "IN_PROCESS_LIBRARY",
    label: "In-process library",
    description: "Load the component as a library inside the host runtime JVM.",
    requires: []
  },
  {
    shape: "MODULAR_MONOLITH_MODULE",
    label: "Modular monolith module",
    description: "Keep one process while preserving module boundaries for the component.",
    requires: []
  },
  {
    shape: "STANDALONE_JAVA_APP",
    label: "Standalone Java app",
    description: "Run the component in its own JVM and connect over a local or LAN endpoint.",
    requires: ["java"]
  },
  {
    shape: "SPRING_BOOT_SERVICE",
    label: "Spring Boot service",
    description: "Package the component as a Spring Boot HTTP service.",
    requires: ["springBoot"]
  },
  {
    shape: "REMOTE_MICROSERVICE",
    label: "Remote microservice",
    description: "Bind the component to a remote service endpoint.",
    requires: ["serviceMesh"]
  },
  {
    shape: "CONTAINERIZED_SERVICE",
    label: "Containerized service",
    description: "Run the component as a platform-managed container.",
    requires: ["kubernetes"]
  },
  {
    shape: "MANAGED_EXTERNAL_ADAPTER",
    label: "Managed external adapter",
    description: "Use a customer-managed external system through a thin adapter.",
    requires: []
  }
];

export function createDefaultDeploymentPlannerState(): DeploymentPlannerState {
  return {
    preferredShapes: ["IN_PROCESS_LIBRARY"],
    disallowedShapes: [],
    requireIsolationForCapabilityPatterns: [],
    runtime: {}
  };
}

export function createAllShapesDeploymentPlannerState(): DeploymentPlannerState {
  return {
    preferredShapes: DEPLOYMENT_SHAPE_OPTIONS.map(option => option.shape),
    disallowedShapes: [],
    requireIsolationForCapabilityPatterns: [],
    runtime: {
      javaVersion: "21",
      springBoot: true,
      kubernetes: true,
      serviceMesh: true,
      maxServices: 20
    }
  };
}

export function preferDeploymentShape(
  state: DeploymentPlannerState,
  shape: DeploymentShape
): DeploymentPlannerState {
  const preferredShapes = [shape, ...state.preferredShapes.filter(candidate => candidate !== shape)];
  return {
    ...state,
    preferredShapes,
    disallowedShapes: state.disallowedShapes.filter(candidate => candidate !== shape),
    runtime: runtimeWithShapeRequirements(state.runtime, shape)
  };
}

export function disallowDeploymentShape(
  state: DeploymentPlannerState,
  shape: DeploymentShape
): DeploymentPlannerState {
  return {
    ...state,
    preferredShapes: state.preferredShapes.filter(candidate => candidate !== shape),
    disallowedShapes: uniqueShapes([...state.disallowedShapes, shape])
  };
}

export function allowDeploymentShape(
  state: DeploymentPlannerState,
  shape: DeploymentShape
): DeploymentPlannerState {
  return {
    ...state,
    disallowedShapes: state.disallowedShapes.filter(candidate => candidate !== shape)
  };
}

export function requireIsolationForCapabilityPattern(
  state: DeploymentPlannerState,
  pattern: string
): DeploymentPlannerState {
  const trimmed = pattern.trim();
  if (trimmed.length === 0 || state.requireIsolationForCapabilityPatterns.includes(trimmed)) {
    return state;
  }
  return {
    ...state,
    requireIsolationForCapabilityPatterns: [...state.requireIsolationForCapabilityPatterns, trimmed]
  };
}

export function removeIsolationRequirement(
  state: DeploymentPlannerState,
  pattern: string
): DeploymentPlannerState {
  return {
    ...state,
    requireIsolationForCapabilityPatterns:
      state.requireIsolationForCapabilityPatterns.filter(candidate => candidate !== pattern)
  };
}

export function setDeploymentRuntime(
  state: DeploymentPlannerState,
  runtime: DeploymentRuntimePolicyDraft
): DeploymentPlannerState {
  return {
    ...state,
    runtime: normalizeRuntime(runtime)
  };
}

export function deploymentPolicyFromPlannerState(state: DeploymentPlannerState): DeploymentPolicyDraft {
  return {
    preferredShapes: state.preferredShapes,
    disallowedShapes: state.disallowedShapes,
    requireIsolationForCapabilityPatterns: state.requireIsolationForCapabilityPatterns,
    runtime: normalizeRuntime(state.runtime)
  };
}

export async function compileDraftWorkspaceWithDeployment(
  client: Pick<StudioFabricClient, "compileCandidate" | "getDraftSession">,
  state: DraftWorkspaceState,
  plannerState: DeploymentPlannerState,
  options: Omit<CompileDraftWorkspaceOptions, "deploymentPolicy"> = {}
): Promise<DraftWorkspaceState> {
  return compileDraftWorkspace(client, state, {
    ...options,
    deploymentPolicy: deploymentPolicyFromPlannerState(plannerState)
  });
}

function runtimeWithShapeRequirements(
  runtime: DeploymentRuntimePolicyDraft,
  shape: DeploymentShape
): DeploymentRuntimePolicyDraft {
  switch (shape) {
    case "SPRING_BOOT_SERVICE":
      return { ...runtime, springBoot: true };
    case "REMOTE_MICROSERVICE":
      return { ...runtime, serviceMesh: true };
    case "CONTAINERIZED_SERVICE":
      return { ...runtime, kubernetes: true };
    default:
      return runtime;
  }
}

function normalizeRuntime(runtime: DeploymentRuntimePolicyDraft): DeploymentRuntimePolicyDraft {
  const normalized: DeploymentRuntimePolicyDraft = {
    ...(runtime.javaVersion === undefined || runtime.javaVersion.trim() === ""
      ? {}
      : { javaVersion: runtime.javaVersion.trim() }),
    ...(runtime.springBoot === undefined ? {} : { springBoot: runtime.springBoot }),
    ...(runtime.kubernetes === undefined ? {} : { kubernetes: runtime.kubernetes }),
    ...(runtime.serviceMesh === undefined ? {} : { serviceMesh: runtime.serviceMesh }),
    ...(runtime.maxServices === undefined ? {} : { maxServices: runtime.maxServices })
  };
  return normalized;
}

function uniqueShapes(shapes: readonly DeploymentShape[]): readonly DeploymentShape[] {
  return DEPLOYMENT_SHAPE_OPTIONS
    .map(option => option.shape)
    .filter(shape => shapes.includes(shape));
}
