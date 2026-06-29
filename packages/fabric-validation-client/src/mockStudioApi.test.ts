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
    const authoring = await client.converseAuthoring?.({
      sessionId: session.sessionId,
      conversation: [],
      userMessage: "Build a docs chatbot"
    });
    const asset = await client.getVisualAsset("storage-s3-model");

    assert.equal(composition.view.contractId, "contract-123");
    assert.equal(draft.session.sessionId, studioApiExampleSession.sessionId);
    assert.equal(intent.status, "VALID");
    assert.equal(compile.status, "COMPILED");
    assert.equal(deployment?.status, "RESOLVED");
    assert.equal(authoring?.kind, "proposal");
    assert.equal(asset.sha256, "sha256:storage-s3-model");
  });

  it("returns clarifying questions and gaps from authoring fixture paths", async () => {
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: createMockStudioApiFetch()
    });

    const clarify = await client.converseAuthoring?.({
      conversation: [],
      userMessage: "bot"
    });
    const gap = await client.converseAuthoring?.({
      conversation: [],
      userMessage: "Need uncatalogued capability"
    });

    assert.equal(clarify?.kind, "clarify");
    assert.equal(gap?.kind, "gap");
  });

  it("adds admitted artifacts to the mock catalog", async () => {
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: createMockStudioApiFetch()
    });

    const admission = await client.admitCatalogArtifacts?.({
      artifacts: [{ fileName: "payment.yaml", claimYaml: "identity:\n  name: payment\n" }]
    });
    const catalog = await client.listCatalogVisuals();

    assert.equal(admission?.status, "VERIFIED");
    assert.equal(admission?.claimBundleArtifact?.mediaType, "application/zip");
    assert.match(admission?.claimBundleArtifact?.url ?? "", /claims\.zip\?sha256=/);
    assert.ok(admission?.catalog.entries.some(entry => entry.catalogEntryId === "uploaded:payment.yaml"));
    assert.ok(catalog.entries.some(entry => entry.catalogEntryId === "uploaded:payment.yaml"));
  });

  it("adds JAR artifacts with base64 content to the mock catalog", async () => {
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: createMockStudioApiFetch()
    });

    const admission = await client.admitCatalogArtifacts?.({
      artifacts: [{ fileName: "payment.jar", artifactBase64: "UEsDBA==" }]
    });
    const catalog = await client.listCatalogVisuals();

    assert.equal(admission?.status, "VERIFIED");
    assert.ok(admission?.catalog.entries.some(entry => entry.catalogEntryId === "uploaded:payment.jar"));
    assert.ok(catalog.entries.some(entry => entry.catalogEntryId === "uploaded:payment.jar"));
  });

  it("returns DCP diagnostics for filename-only catalog admission drafts", async () => {
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: createMockStudioApiFetch()
    });

    const admission = await client.admitCatalogArtifacts?.({
      artifacts: [{ fileName: "payment.jar" }]
    });

    assert.equal(admission?.status, "REJECTED");
    assert.equal(admission?.results[0]?.diagnostics[0]?.code, "CLAIM_MALFORMED");
    assert.equal(admission?.results[0]?.diagnostics[0]?.path, "claim");
    assert.match(admission?.results[0]?.diagnostics[0]?.message ?? "", /DCP claim YAML is required/);
  });
});
