import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadReadOnlyWorkspace, loadingReadOnlyWorkspace } from "./readOnlyWorkspace.js";
import type { ReadOnlyCompositionView } from "@unfurl/fabric-scene-model";
import type { VisualCatalogEntry } from "@unfurl/visual-manifest";

describe("read-only workspace", () => {
  it("creates a loading state for the combined palette and composition request", () => {
    assert.deepEqual(loadingReadOnlyWorkspace(request()), {
      status: "LOADING",
      request: request()
    });
  });

  it("loads palette table graph and render-scene projections together", async () => {
    const state = await loadReadOnlyWorkspace({
      listCatalogVisuals: async () => ({
        catalogHash: "sha256:catalog",
        entries: [visualEntry()]
      }),
      loadCompositionView: async () => ({ view: composition() })
    }, request());

    assert.equal(state.status, "READY");
    if (state.status === "READY") {
      assert.equal(state.catalogHash, "sha256:catalog");
      assert.match(state.paletteText, /storage-s3/);
      assert.match(state.tableText, /storage.put/);
      assert.match(state.graphText, /REQUIRES_SUBSTRATE/);
      assert.equal(state.renderScene.components[0]?.id, "storage-s3");
      assert.equal(state.warningCount, 1);
    }
  });

  it("returns failed state when catalog loading fails", async () => {
    const state = await loadReadOnlyWorkspace({
      listCatalogVisuals: async () => {
        throw new Error("catalog unavailable");
      },
      loadCompositionView: async () => ({ view: composition() })
    }, request());

    assert.deepEqual(state, {
      status: "FAILED",
      request: request(),
      message: "catalog unavailable"
    });
  });
});

function request() {
  return {
    composition: {
      contractPath: "contract.yaml",
      substrateProfilePath: "profile.yaml"
    }
  };
}

function visualEntry(): VisualCatalogEntry {
  return {
    catalogEntryId: "com.unfurl:storage-s3:1.2.0",
    claimHash: "sha256:claim",
    artifactSha256: "sha256:artifact",
    visualManifest: {
      fallbackShape: { kind: "CUBE", category: "STORAGE" },
      ports: [],
      interactions: { draggable: true, connectable: true, inspectable: true }
    },
    visualIntegrity: { assets: [] },
    warnings: [
      { code: "MISSING_VISUAL_MANIFEST", message: "fallback used" }
    ]
  };
}

function composition(): ReadOnlyCompositionView {
  return {
    contractId: "contract-1",
    candidateId: "cand-1",
    components: [
      {
        componentId: "storage-s3",
        catalogEntryId: "com.unfurl:storage-s3:1.2.0",
        name: "S3 Storage",
        coordinates: "com.unfurl:storage-s3:1.2.0",
        claimHash: "sha256:claim",
        artifactSha256: "sha256:artifact",
        visualStatus: "FALLBACK_SHAPE"
      }
    ],
    ports: [
      {
        componentId: "storage-s3",
        portId: "storage-s3:storage.put",
        capability: "storage.put",
        kind: "OFFER",
        status: "AVAILABLE"
      },
      {
        componentId: "storage-s3",
        portId: "storage-s3:substrate:secrets.provider",
        capability: "substrate:secrets.provider",
        kind: "SUBSTRATE_DEPENDENCY",
        status: "REQUIRED"
      }
    ],
    substrate: [
      {
        port: "secrets.provider",
        status: "REQUIRED",
        profileHash: "sha256:profile"
      }
    ],
    warnings: []
  };
}
