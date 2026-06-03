import type {
  DeploymentPolicyDraft,
  ResolveDeploymentRequest,
  ResolveDeploymentResponse,
  StudioFabricClient
} from "@unfurl/fabric-validation-client";

const smallClientPolicy: DeploymentPolicyDraft = {
  preferredShapes: ["IN_PROCESS_LIBRARY"],
  disallowedShapes: [
    "CONTAINERIZED_SERVICE",
    "REMOTE_MICROSERVICE",
    "SPRING_BOOT_SERVICE",
    "STANDALONE_JAVA_APP"
  ],
  requireIsolationForCapabilityPatterns: [],
  runtime: {
    javaVersion: "21",
    springBoot: false,
    kubernetes: false,
    serviceMesh: false,
    maxServices: 0
  }
};

const smallClientResponse: Extract<ResolveDeploymentResponse, { readonly status: "RESOLVED" }> = {
  status: "RESOLVED",
  candidateId: "cand-small-client",
  selections: [
    {
      componentId: "storage-s3",
      artifactCoordinates: "com.unfurl:storage-s3:1.0.0",
      capability: "storage.put",
      deploymentShape: "IN_PROCESS_LIBRARY",
      requiredPorts: []
    }
  ],
  warnings: []
};

export function createFixtureStudioFabricClient(): Pick<StudioFabricClient, "resolveDeployment"> {
  return {
    resolveDeployment: async (request: ResolveDeploymentRequest) => ({
      ...smallClientResponse,
      candidateId: request.candidateId ?? smallClientResponse.candidateId
    })
  };
}

export function fixtureDeploymentPolicy(): DeploymentPolicyDraft {
  return smallClientPolicy;
}
