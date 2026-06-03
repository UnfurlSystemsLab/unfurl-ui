import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IntentResponse, StudioFabricClient } from "@unfurl/fabric-validation-client";
import type { StudioDraftSession } from "@unfurl/fabric-scene-model";
import {
  compileDraftWorkspaceWithDeployment,
  createAllShapesDeploymentPlannerState,
  createDefaultDeploymentPlannerState,
  createDraftWorkspace,
  DEPLOYMENT_SHAPE_OPTIONS,
  deploymentPolicyFromPlannerState,
  disallowDeploymentShape,
  preferDeploymentShape,
  requireIsolationForCapabilityPattern,
  setDeploymentRuntime
} from "./index.js";

describe("deployment planner", () => {
  it("exposes all supported deployment shapes", () => {
    assert.deepEqual(DEPLOYMENT_SHAPE_OPTIONS.map(option => option.shape), [
      "IN_PROCESS_LIBRARY",
      "MODULAR_MONOLITH_MODULE",
      "STANDALONE_JAVA_APP",
      "SPRING_BOOT_SERVICE",
      "REMOTE_MICROSERVICE",
      "CONTAINERIZED_SERVICE",
      "MANAGED_EXTERNAL_ADAPTER"
    ]);
  });

  it("starts from the conservative in-process default", () => {
    const policy = deploymentPolicyFromPlannerState(createDefaultDeploymentPlannerState());

    assert.deepEqual(policy.preferredShapes, ["IN_PROCESS_LIBRARY"]);
    assert.deepEqual(policy.disallowedShapes, []);
    assert.deepEqual(policy.requireIsolationForCapabilityPatterns, []);
    assert.deepEqual(policy.runtime, {});
  });

  it("can preload a manual test policy that exercises every deployment shape", () => {
    const policy = deploymentPolicyFromPlannerState(createAllShapesDeploymentPlannerState());

    assert.deepEqual(policy.preferredShapes, DEPLOYMENT_SHAPE_OPTIONS.map(option => option.shape));
    assert.deepEqual(policy.disallowedShapes, []);
    assert.deepEqual(policy.runtime, {
      javaVersion: "21",
      springBoot: true,
      kubernetes: true,
      serviceMesh: true,
      maxServices: 20
    });
  });

  it("moves preferred shapes to the front and enables required runtime knobs", () => {
    const state = preferDeploymentShape(createDefaultDeploymentPlannerState(), "CONTAINERIZED_SERVICE");
    const policy = deploymentPolicyFromPlannerState(state);

    assert.deepEqual(policy.preferredShapes, ["CONTAINERIZED_SERVICE", "IN_PROCESS_LIBRARY"]);
    assert.equal(policy.runtime.kubernetes, true);
  });

  it("treats disallowed shapes as hard gates", () => {
    const state = disallowDeploymentShape(
      preferDeploymentShape(createDefaultDeploymentPlannerState(), "SPRING_BOOT_SERVICE"),
      "SPRING_BOOT_SERVICE"
    );
    const policy = deploymentPolicyFromPlannerState(state);

    assert.deepEqual(policy.preferredShapes, ["IN_PROCESS_LIBRARY"]);
    assert.deepEqual(policy.disallowedShapes, ["SPRING_BOOT_SERVICE"]);
  });

  it("captures isolation and runtime policy choices", () => {
    const state = setDeploymentRuntime(
      requireIsolationForCapabilityPattern(createDefaultDeploymentPlannerState(), "ai.*"),
      { javaVersion: " 21 ", maxServices: 3, serviceMesh: true }
    );
    const policy = deploymentPolicyFromPlannerState(state);

    assert.deepEqual(policy.requireIsolationForCapabilityPatterns, ["ai.*"]);
    assert.deepEqual(policy.runtime, { javaVersion: "21", serviceMesh: true, maxServices: 3 });
  });

  it("passes deployment policy through the governed compile request", async () => {
    const calls: unknown[] = [];
    const client = fakeClient(calls);
    const workspace = await createDraftWorkspace(client, { baseCatalogHash: "sha256:catalog" });
    const planner = preferDeploymentShape(createDefaultDeploymentPlannerState(), "CONTAINERIZED_SERVICE");

    const compiled = await compileDraftWorkspaceWithDeployment(client, workspace, planner, { sign: true });

    assert.equal(compiled.status, "READY");
    assert.deepEqual(calls[0], {
      sessionId: "studio-session-123",
      expectedRevision: 7,
      sign: true,
      deploymentPolicy: {
        preferredShapes: ["CONTAINERIZED_SERVICE", "IN_PROCESS_LIBRARY"],
        disallowedShapes: [],
        requireIsolationForCapabilityPatterns: [],
        runtime: { kubernetes: true }
      }
    });
  });
});

function fakeClient(calls: unknown[]): StudioFabricClient {
  return {
    listCatalogVisuals: async () => ({ catalogHash: "sha256:catalog", entries: [] }),
    loadCompositionView: async () => ({
      view: {
        contractId: "contract-1",
        candidateId: "cand-1",
        components: [],
        ports: [],
        substrate: [],
        warnings: []
      }
    }),
    createDraftComposition: async () => ({ session: session() }),
    getDraftSession: async () => session(),
    applyIntent: async (): Promise<IntentResponse> => ({
      status: "VALID",
      newRevision: 8,
      requiredSubstratePorts: [],
      warnings: []
    }),
    compileCandidate: async request => {
      calls.push(request);
      return {
        status: "COMPILED",
        candidateId: "cand-abc123",
        contractArtifact: artifact("contract"),
        substrateProfileArtifact: artifact("profile"),
        warnings: []
      };
    },
    getVisualAsset: async assetId => ({
      assetId,
      path: "META-INF/visual/component.glb",
      mediaType: "model/gltf-binary",
      sha256: "sha256:model",
      url: `/studio/assets/${assetId}`
    })
  };
}

function session(): StudioDraftSession {
  return {
    sessionId: "studio-session-123",
    baseCatalogHash: "sha256:catalog",
    sceneRevision: 7,
    warnings: []
  };
}

function artifact(name: string) {
  return {
    artifactId: name,
    mediaType: "application/yaml",
    sha256: `sha256:${name}`,
    url: `/studio/assets/${name}`
  };
}
