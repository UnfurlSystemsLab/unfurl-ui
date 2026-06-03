import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHttpStudioFabricClient, type FetchLike } from "./index.js";

describe("HTTP Studio Fabric client", () => {
  it("lists catalog visuals from the Studio catalog endpoint", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local/",
      fetch: fakeFetch(calls, { catalogHash: "sha256:catalog", entries: [] })
    });

    const response = await client.listCatalogVisuals();

    assert.equal(response.catalogHash, "sha256:catalog");
    assert.deepEqual(calls, [
      {
        input: "http://fabric.local/studio/catalog",
        method: "GET",
        body: undefined
      }
    ]);
  });

  it("loads a read-only composition view by posting contract and profile paths", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, {
        view: {
          contractId: "contract-1",
          candidateId: "cand-1",
          components: [],
          ports: [],
          substrate: [],
          warnings: []
        }
      })
    });

    const response = await client.loadCompositionView({
      contractPath: "./contract.yaml",
      substrateProfilePath: "./profile.yaml"
    });

    assert.equal(response.view.contractId, "contract-1");
    assert.deepEqual(calls, [
      {
        input: "http://fabric.local/studio/composition-view",
        method: "POST",
        body: JSON.stringify({
          contractPath: "./contract.yaml",
          substrateProfilePath: "./profile.yaml"
        })
      }
    ]);
  });

  it("applies a validated intent through the intents endpoint", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, {
        status: "VALID",
        newRevision: 8,
        updatedCandidateId: "cand-abc123",
        requiredSubstratePorts: ["secrets.provider"],
        warnings: []
      })
    });

    const response = await client.applyIntent({
      sessionId: "studio-session-123",
      baseRevision: 7,
      type: "CONNECT",
      fromPort: "storage-s3.storage.put",
      toPort: "workflow.storage.required"
    });

    assert.equal(response.status, "VALID");
    assert.deepEqual(calls, [
      {
        input: "http://fabric.local/studio/sessions/studio-session-123/intents",
        method: "POST",
        body: JSON.stringify({
          sessionId: "studio-session-123",
          baseRevision: 7,
          type: "CONNECT",
          fromPort: "storage-s3.storage.put",
          toPort: "workflow.storage.required"
        })
      }
    ]);
  });

  it("creates draft sessions with catalog needs and trust policy context", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, {
        session: session({ sessionId: "studio-session-123", sceneRevision: 0 })
      })
    });

    const response = await client.createDraftComposition({
      baseCatalogHash: "sha256:catalog",
      needsId: "needs-docs",
      trustPolicyId: "trust-prod",
      initialCandidateId: "cand-abc123"
    });

    assert.equal(response.session.sessionId, "studio-session-123");
    assert.deepEqual(calls, [
      {
        input: "http://fabric.local/studio/sessions",
        method: "POST",
        body: JSON.stringify({
          baseCatalogHash: "sha256:catalog",
          needsId: "needs-docs",
          trustPolicyId: "trust-prod",
          initialCandidateId: "cand-abc123"
        })
      }
    ]);
  });

  it("loads a draft session by encoded session id", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, session({ sessionId: "studio session/123", sceneRevision: 4 }))
    });

    const response = await client.getDraftSession("studio session/123");

    assert.equal(response.sceneRevision, 4);
    assert.deepEqual(calls, [
      {
        input: "http://fabric.local/studio/sessions/studio%20session%2F123",
        method: "GET",
        body: undefined
      }
    ]);
  });

  it("compiles a draft session through the compile endpoint", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, {
        status: "COMPILED",
        candidateId: "cand-abc123",
        contractArtifact: artifact("contract"),
        substrateProfileArtifact: artifact("profile"),
        warnings: []
      })
    });

    const response = await client.compileCandidate({
      sessionId: "studio-session-123",
      expectedRevision: 8,
      sign: false
    });

    assert.equal(response.status, "COMPILED");
    assert.deepEqual(calls, [
      {
        input: "http://fabric.local/studio/sessions/studio-session-123/compile",
        method: "POST",
        body: JSON.stringify({
          sessionId: "studio-session-123",
          expectedRevision: 8,
          sign: false
        })
      }
    ]);
  });

  it("loads visual assets by encoded Fabric asset id", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, {
        assetId: "asset/model glb",
        path: "META-INF/visual/component.glb",
        mediaType: "model/gltf-binary",
        sha256: "sha256:model",
        url: "http://fabric.local/studio/assets/asset%2Fmodel%20glb/content"
      })
    });

    const response = await client.getVisualAsset("asset/model glb");

    assert.equal(response.sha256, "sha256:model");
    assert.deepEqual(calls, [
      {
        input: "http://fabric.local/studio/assets/asset%2Fmodel%20glb",
        method: "GET",
        body: undefined
      }
    ]);
  });

  it("reports non-success responses with method path and HTTP status", async () => {
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: async () => ({
        ok: false,
        status: 409,
        statusText: "Conflict",
        json: async () => ({})
      })
    });

    await assert.rejects(
      () => client.listCatalogVisuals(),
      /Fabric Studio API failed: GET \/studio\/catalog HTTP 409 Conflict/
    );
  });
});

type FetchCall = {
  readonly input: string;
  readonly method: string | undefined;
  readonly body: string | undefined;
};

function fakeFetch(calls: FetchCall[], json: unknown): FetchLike {
  return async (input, init) => {
    calls.push({
      input,
      method: init?.method,
      body: init?.body
    });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => json
    };
  };
}

function session(overrides: { readonly sessionId: string; readonly sceneRevision: number }) {
  return {
    sessionId: overrides.sessionId,
    baseCatalogHash: "sha256:catalog",
    currentCandidateId: "cand-abc123",
    sceneRevision: overrides.sceneRevision,
    warnings: []
  };
}

function artifact(name: string) {
  return {
    artifactId: name,
    mediaType: "application/yaml",
    sha256: `sha256:${name}`,
    url: `http://fabric.local/studio/assets/${name}`
  };
}
