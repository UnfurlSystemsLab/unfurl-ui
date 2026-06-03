import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadingReadOnlyStudio,
  loadReadOnlyStudio,
  readyReadOnlyStudio
} from "./readOnlyStudio.js";
import type { ReadOnlyCompositionView } from "@unfurl/fabric-scene-model";

describe("read-only Studio loader", () => {
  it("creates a loading state for a contract/profile request", () => {
    assert.deepEqual(loadingReadOnlyStudio(request()), {
      status: "LOADING",
      request: request()
    });
  });

  it("loads a composition view and builds table/text projections", async () => {
    const state = await loadReadOnlyStudio({
      loadCompositionView: async () => ({ view: composition() })
    }, request());

    assert.equal(state.status, "READY");
    if (state.status === "READY") {
      assert.equal(state.table.title, "Composition contract-1");
      assert.equal(state.renderScene.components[0]?.id, "storage-s3");
      assert.match(state.text, /storage.put/);
    }
  });

  it("returns a failed state instead of throwing through the app", async () => {
    const state = await loadReadOnlyStudio({
      loadCompositionView: async () => {
        throw new Error("profile hash mismatch");
      }
    }, request());

    assert.deepEqual(state, {
      status: "FAILED",
      request: request(),
      message: "profile hash mismatch"
    });
  });

  it("can build a ready state from an already loaded composition", () => {
    const state = readyReadOnlyStudio(composition());

    assert.equal(state.status, "READY");
    if (state.status === "READY") {
      assert.equal(state.composition.candidateId, "cand-1");
      assert.equal(state.renderScene.substrateSockets[0]?.port, "secrets.provider");
      assert.match(state.text, /secrets.provider/);
    }
  });
});

function request() {
  return {
    contractPath: "contract.signed.yaml",
    substrateProfilePath: "profile.yaml"
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
