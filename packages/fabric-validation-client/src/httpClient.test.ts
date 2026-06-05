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
        input: "http://fabric.local/studio/tenants/tenant-local/catalog",
        method: "GET",
        body: undefined
      }
    ]);
  });

  it("uses configured tenant and assembly defaults for scoped endpoints", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      defaultTenantId: "tenant-payments",
      defaultAssemblyId: "assembly-checkout",
      fetch: fakeFetch(calls, {
        session: session({ sessionId: "studio-session-123", sceneRevision: 0 })
      })
    });

    await client.listCatalogVisuals();
    await client.createDraftComposition({ baseCatalogHash: "sha256:catalog" });

    assert.equal(calls[0]?.input, "http://fabric.local/studio/tenants/tenant-payments/catalog");
    assert.equal(calls[1]?.input, "http://fabric.local/studio/tenants/tenant-payments/assemblies/assembly-checkout/sessions");
    assert.deepEqual(JSON.parse(calls[1]?.body ?? "{}"), {
      tenantId: "tenant-payments",
      assemblyId: "assembly-checkout",
      baseCatalogHash: "sha256:catalog"
    });
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
      tenantId: "tenant-payments",
      assemblyId: "assembly-checkout",
      sessionId: "studio-session-123",
      baseRevision: 7,
      type: "CONNECT",
      fromPort: "storage-s3.storage.put",
      toPort: "workflow.storage.required"
    });

    assert.equal(response.status, "VALID");
    assert.deepEqual(calls, [
      {
        input: "http://fabric.local/studio/tenants/tenant-payments/assemblies/assembly-checkout/sessions/studio-session-123/intents",
        method: "POST",
        body: JSON.stringify({
          tenantId: "tenant-payments",
          assemblyId: "assembly-checkout",
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
    assert.equal(calls[0]?.input, "http://fabric.local/studio/tenants/tenant-local/assemblies/assembly-demo/sessions");
    assert.equal(calls[0]?.method, "POST");
    assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), {
      tenantId: "tenant-local",
      assemblyId: "assembly-demo",
      baseCatalogHash: "sha256:catalog",
      needsId: "needs-docs",
      trustPolicyId: "trust-prod",
      initialCandidateId: "cand-abc123"
    });
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
        input: "http://fabric.local/studio/tenants/tenant-local/assemblies/assembly-demo/sessions/studio%20session%2F123",
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
    assert.equal(calls[0]?.input, "http://fabric.local/studio/tenants/tenant-local/assemblies/assembly-demo/sessions/studio-session-123/compile");
    assert.equal(calls[0]?.method, "POST");
    assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), {
      tenantId: "tenant-local",
      assemblyId: "assembly-demo",
      sessionId: "studio-session-123",
      expectedRevision: 8,
      sign: false
    });
  });

  it("resolves deployment through the deployment endpoint", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, {
        status: "RESOLVED",
        candidateId: "cand-abc123",
        selections: [],
        warnings: []
      })
    });

    const response = await client.resolveDeployment?.({
      baseCatalogHash: "sha256:catalog",
      deploymentPolicy: {
        preferredShapes: ["IN_PROCESS_LIBRARY"],
        disallowedShapes: [],
        requireIsolationForCapabilityPatterns: [],
        runtime: {}
      }
    });

    assert.equal(response?.status, "RESOLVED");
    assert.deepEqual(calls, [
      {
        input: "http://fabric.local/studio/deployment/resolve",
        method: "POST",
        body: JSON.stringify({
          baseCatalogHash: "sha256:catalog",
          deploymentPolicy: {
            preferredShapes: ["IN_PROCESS_LIBRARY"],
            disallowedShapes: [],
            requireIsolationForCapabilityPatterns: [],
            runtime: {}
          }
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
        input: "http://fabric.local/studio/tenants/tenant-local/assets/asset%2Fmodel%20glb",
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
      /Fabric Studio API failed: GET \/studio\/tenants\/tenant-local\/catalog HTTP 409 Conflict/
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
    tenantId: "tenant-local",
    assemblyId: "assembly-demo",
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
