import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ResolveDeploymentResponse, StudioFabricClient } from "@unfurl/fabric-validation-client";
import type { StudioDraftSession } from "@unfurl/fabric-scene-model";
import {
  buildDeploymentPlannerView,
  createDefaultDeploymentPlannerState,
  createDraftWorkspace,
  preferDeploymentShape,
  renderDeploymentPlannerText,
  resolveDeploymentForDraft
} from "./index.js";

describe("deployment planner view", () => {
  it("renders operator-readable shape choices", () => {
    const state = preferDeploymentShape(createDefaultDeploymentPlannerState(), "CONTAINERIZED_SERVICE");

    const text = renderDeploymentPlannerText(buildDeploymentPlannerView(state));

    assert.match(text, /Deployment Planner/);
    assert.match(text, /CONTAINERIZED_SERVICE \| 1 \| allowed \| ready/);
    assert.match(text, /IN_PROCESS_LIBRARY \| 2 \| allowed \| ready/);
    assert.match(text, /preferred shapes: CONTAINERIZED_SERVICE, IN_PROCESS_LIBRARY/);
  });

  it("marks runtime requirements that are not yet satisfied", () => {
    const text = renderDeploymentPlannerText(buildDeploymentPlannerView(createDefaultDeploymentPlannerState()));

    assert.match(text, /SPRING_BOOT_SERVICE \| - \| allowed \| missing springBoot/);
    assert.match(text, /REMOTE_MICROSERVICE \| - \| allowed \| missing serviceMesh/);
    assert.match(text, /CONTAINERIZED_SERVICE \| - \| allowed \| missing kubernetes/);
  });

  it("renders the last deployment resolution", () => {
    const resolved: ResolveDeploymentResponse = {
      status: "RESOLVED",
      candidateId: "cand-abc123",
      selections: [
        {
          componentId: "storage-s3",
          artifactCoordinates: "com.unfurl:storage-s3:1.2.0",
          capability: "storage.put",
          deploymentShape: "CONTAINERIZED_SERVICE",
          requiredPorts: ["secrets.provider"]
        }
      ],
      warnings: ["service count is near the configured maximum"]
    };

    const text = renderDeploymentPlannerText(
      buildDeploymentPlannerView(preferDeploymentShape(createDefaultDeploymentPlannerState(), "CONTAINERIZED_SERVICE"), resolved)
    );

    assert.match(text, /Last Resolution/);
    assert.match(text, /storage-s3 storage.put -> CONTAINERIZED_SERVICE/);
    assert.match(text, /WARNING service count is near the configured maximum/);
  });

  it("resolves deployment for a ready draft using the selected policy", async () => {
    const calls: unknown[] = [];
    const client = fakeClient(calls);
    const workspace = await createDraftWorkspace(client, { baseCatalogHash: "sha256:catalog" });
    const planner = preferDeploymentShape(createDefaultDeploymentPlannerState(), "CONTAINERIZED_SERVICE");

    const response = await resolveDeploymentForDraft(client, workspace, planner);

    assert.equal(response.status, "RESOLVED");
    assert.deepEqual(calls[0], {
      sessionId: "studio-session-123",
      candidateId: "cand-abc123",
      baseCatalogHash: "sha256:catalog",
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
    applyIntent: async intent => ({
      status: "VALID",
      newRevision: intent.baseRevision + 1,
      requiredSubstratePorts: [],
      warnings: []
    }),
    compileCandidate: async () => ({
      status: "COMPILED",
      candidateId: "cand-abc123",
      contractArtifact: artifact("contract"),
      substrateProfileArtifact: artifact("profile"),
      warnings: []
    }),
    resolveDeployment: async request => {
      calls.push(request);
      return {
        status: "RESOLVED",
        candidateId: "cand-abc123",
        selections: [],
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
    currentCandidateId: "cand-abc123",
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
