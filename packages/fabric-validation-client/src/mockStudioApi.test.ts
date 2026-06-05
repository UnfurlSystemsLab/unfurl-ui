import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createHttpStudioFabricClient,
  createMockStudioApiFetch,
  studioApiExampleSession
} from "./index.js";

describe("mock Studio API contract", () => {
  it("serves the full Studio MVP endpoint set through the HTTP client", async () => {
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: createMockStudioApiFetch()
    });

    const catalog = await client.listCatalogVisuals();
    const composition = await client.loadCompositionView({
      contractPath: "./contract.yaml",
      substrateProfilePath: "./profile.yaml"
    });
    const draft = await client.createDraftComposition({ baseCatalogHash: catalog.catalogHash });
    const session = await client.getDraftSession(draft.session.sessionId);
    const intent = await client.applyIntent({
      tenantId: session.tenantId,
      assemblyId: session.assemblyId,
      sessionId: session.sessionId,
      baseRevision: session.sceneRevision,
      type: "ADD_COMPONENT",
      catalogEntryId: catalog.entries[0]?.catalogEntryId ?? "missing"
    });
    const compile = await client.compileCandidate({
      sessionId: session.sessionId,
      expectedRevision: session.sceneRevision
    });
    const deployment = await client.resolveDeployment?.({
      sessionId: session.sessionId,
      ...(session.currentCandidateId === undefined ? {} : { candidateId: session.currentCandidateId })
    });
    const asset = await client.getVisualAsset("storage-s3-model");

    assert.equal(composition.view.contractId, "contract-123");
    assert.equal(draft.session.sessionId, studioApiExampleSession.sessionId);
    assert.equal(intent.status, "VALID");
    assert.equal(compile.status, "COMPILED");
    assert.equal(deployment?.status, "RESOLVED");
    assert.equal(asset.sha256, "sha256:storage-s3-model");
  });
});
