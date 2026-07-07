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

  it("sends Studio identity and tenant membership headers when configured", async () => {
    const calls: HeaderFetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      defaultTenantId: "tenant-payments",
      userId: "user-1",
      tenantMemberships: ["tenant-payments", "tenant-risk"],
      fetch: async (input, init) => {
        calls.push({ input, headers: init?.headers });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ catalogHash: "sha256:catalog", entries: [] })
        };
      }
    });

    await client.listCatalogVisuals();

    assert.equal(calls[0]?.input, "http://fabric.local/studio/tenants/tenant-payments/catalog");
    assert.deepEqual(calls[0]?.headers, {
      "Content-Type": "application/json",
      "X-Unfurl-Tenant": "tenant-payments",
      "X-Unfurl-User": "user-1",
      "X-Unfurl-Tenant-Memberships": "tenant-payments,tenant-risk"
    });
  });

  it("admits component artifacts through the tenant catalog admission endpoint", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, {
        tenantId: "tenant-local",
        assemblyId: "assembly-demo",
        status: "VERIFIED",
        results: [{
          fileName: "payment.yaml",
          status: "VERIFIED",
          catalogEntryId: "uploaded:payment.yaml",
          claimHash: "sha256:claim-payment",
          warnings: [],
          diagnostics: []
        }],
        catalog: { catalogHash: "sha256:catalog", entries: [] },
        claimBundleArtifact: {
          artifactId: "adm-123",
          mediaType: "application/zip",
          sha256: "sha256:bundle",
          url: "/studio/tenants/tenant-local/catalog/admissions/adm-123/claims.zip?sha256=sha256:bundle"
        }
      })
    });

    const response = await client.admitCatalogArtifacts?.({
      assemblyId: "assembly-demo",
      artifacts: [
        { fileName: "payment.yaml", claimYaml: "identity:\n  name: payment\n" },
        { fileName: "payment.jar", artifactBase64: "UEsDBA==" }
      ]
    });

    assert.equal(response?.status, "VERIFIED");
    assert.equal(response?.claimBundleArtifact?.mediaType, "application/zip");
    assert.deepEqual(response?.results[0]?.diagnostics, []);
    assert.equal(calls[0]?.input, "http://fabric.local/studio/tenants/tenant-local/catalog/admissions");
    assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), {
      tenantId: "tenant-local",
      assemblyId: "assembly-demo",
      artifacts: [
        { fileName: "payment.yaml", claimYaml: "identity:\n  name: payment\n" },
        { fileName: "payment.jar", artifactBase64: "UEsDBA==" }
      ]
    });
  });

  it("removes catalog entries through the tenant catalog endpoint", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, {
        tenantId: "tenant-local",
        catalogEntryId: "com.unfurl:storage-s3:1.2.0",
        status: "REMOVED",
        catalog: { catalogHash: "sha256:catalog-after-remove", entries: [] }
      })
    });

    const response = await client.removeCatalogEntry?.({
      catalogEntryId: "com.unfurl:storage-s3:1.2.0"
    });

    assert.equal(response?.status, "REMOVED");
    assert.equal(calls[0]?.input, "http://fabric.local/studio/tenants/tenant-local/catalog/com.unfurl%3Astorage-s3%3A1.2.0");
    assert.equal(calls[0]?.method, "DELETE");
    assert.equal(calls[0]?.body, undefined);
  });

  it("saves and loads catalog snapshots through tenant endpoints", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, { tenantId: "tenant-local", catalogHash: "sha256:snapshot", entries: [] })
    });
    const snapshot = await client.saveCatalogSnapshot?.();

    await client.loadCatalogSnapshot?.({ snapshot: snapshot ?? { tenantId: "tenant-local", catalogHash: "sha256:snapshot", entries: [] } });

    assert.equal(calls[0]?.input, "http://fabric.local/studio/tenants/tenant-local/catalog/snapshot");
    assert.equal(calls[0]?.method, "GET");
    assert.equal(calls[1]?.input, "http://fabric.local/studio/tenants/tenant-local/catalog/snapshot");
    assert.equal(calls[1]?.method, "POST");
    assert.deepEqual(JSON.parse(calls[1]?.body ?? "{}"), {
      tenantId: "tenant-local",
      catalogHash: "sha256:snapshot",
      entries: []
    });
  });

  it("extracts needs through the tenant assembly endpoint", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, {
        tenantId: "tenant-local",
        assemblyId: "assembly-demo",
        needsId: "assembly-demo-extracted-needs",
        targetApplicationName: "Checkout Platform",
        suggestedNeedsYaml: "requiredCapabilities: []",
        defaultDeploymentTarget: "kubernetes-prod",
        warnings: []
      })
    });

    const response = await client.extractNeeds?.({
      assemblyId: "assembly-demo",
      targetApplicationName: "Checkout Platform",
      fileNames: ["workflow.yaml"],
      defaultDeploymentTarget: "kubernetes-prod"
    });

    assert.equal(response?.needsId, "assembly-demo-extracted-needs");
    assert.equal(calls[0]?.input, "http://fabric.local/studio/tenants/tenant-local/assemblies/assembly-demo/needs/extract");
    assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), {
      tenantId: "tenant-local",
      assemblyId: "assembly-demo",
      targetApplicationName: "Checkout Platform",
      fileNames: ["workflow.yaml"],
      defaultDeploymentTarget: "kubernetes-prod"
    });
  });

  it("lists creates and saves tenant assemblies", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, {
        status: "SAVED",
        assembly: {
          tenantId: "tenant-local",
          assemblyId: "assembly-demo",
          targetApplicationName: "Checkout Platform",
          defaultDeploymentTarget: "kubernetes-prod",
          needsId: "needs-checkout",
          deploymentShape: "CONTAINERIZED_SERVICE",
          currentCandidateId: "cand-abc123",
          sceneRevision: 8
        },
        warnings: []
      })
    });

    await client.saveDraft?.({
      assemblyId: "assembly-demo",
      targetApplicationName: "Checkout Platform",
      needsId: "needs-checkout",
      deploymentTarget: "kubernetes-prod",
      deploymentShape: "CONTAINERIZED_SERVICE",
      currentCandidateId: "cand-abc123",
      sceneRevision: 8
    });

    assert.equal(calls[0]?.input, "http://fabric.local/studio/tenants/tenant-local/assemblies/assembly-demo/drafts/save");
    assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), {
      tenantId: "tenant-local",
      assemblyId: "assembly-demo",
      targetApplicationName: "Checkout Platform",
      needsId: "needs-checkout",
      deploymentTarget: "kubernetes-prod",
      deploymentShape: "CONTAINERIZED_SERVICE",
      currentCandidateId: "cand-abc123",
      sceneRevision: 8
    });
  });

  it("loads and saves tenant assembly layout state", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, {
        tenantId: "tenant-local",
        assemblyId: "assembly-demo",
        activeView: "Exploded",
        semanticZoomLevel: "CHILD_DCP",
        selectedSurface: "payment",
        camera: { distance: 5.5 },
        annotations: ["inspect payment replacement"]
      })
    });

    await client.loadLayoutState?.();
    const saved = await client.saveLayoutState?.({
      activeView: "Exploded",
      semanticZoomLevel: "CHILD_DCP",
      selectedSurface: "payment",
      camera: { distance: 5.5 },
      annotations: ["inspect payment replacement"]
    });

    assert.equal(saved?.selectedSurface, "payment");
    assert.equal(calls[0]?.input, "http://fabric.local/studio/tenants/tenant-local/assemblies/assembly-demo/layout");
    assert.equal(calls[0]?.method, "GET");
    assert.equal(calls[1]?.input, "http://fabric.local/studio/tenants/tenant-local/assemblies/assembly-demo/layout");
    assert.equal(calls[1]?.method, "POST");
    assert.deepEqual(JSON.parse(calls[1]?.body ?? "{}"), {
      tenantId: "tenant-local",
      assemblyId: "assembly-demo",
      activeView: "Exploded",
      semanticZoomLevel: "CHILD_DCP",
      selectedSurface: "payment",
      camera: { distance: 5.5 },
      annotations: ["inspect payment replacement"]
    });
  });

  it("saves and loads assembly snapshots through tenant assembly endpoints", async () => {
    const calls: FetchCall[] = [];
    const snapshot = {
      tenantId: "tenant-local",
      assemblyId: "assembly-demo",
      assembly: {
        tenantId: "tenant-local",
        assemblyId: "assembly-demo",
        targetApplicationName: "Checkout Platform",
        defaultDeploymentTarget: "kubernetes-prod",
        needsId: "",
        deploymentShape: "CONTAINERIZED_SERVICE",
        currentCandidateId: "cand-abc123",
        sceneRevision: 4
      },
      layout: {
        tenantId: "tenant-local",
        assemblyId: "assembly-demo",
        activeView: "Assembly",
        semanticZoomLevel: "ASSEMBLY_DCP",
        selectedSurface: "validation",
        camera: {},
        annotations: []
      },
      sessions: []
    };
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      fetch: fakeFetch(calls, snapshot)
    });

    await client.saveAssemblySnapshot?.();
    await client.loadAssemblySnapshot?.({ snapshot });

    assert.equal(calls[0]?.input, "http://fabric.local/studio/tenants/tenant-local/assemblies/assembly-demo/snapshot");
    assert.equal(calls[0]?.method, "GET");
    assert.equal(calls[1]?.input, "http://fabric.local/studio/tenants/tenant-local/assemblies/assembly-demo/snapshot");
    assert.equal(calls[1]?.method, "POST");
    assert.deepEqual(JSON.parse(calls[1]?.body ?? "{}"), snapshot);
  });

  it("loads the dynamic DCP projection for a tenant assembly", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      defaultTenantId: "tenant-payments",
      defaultAssemblyId: "assembly-checkout",
      fetch: fakeFetch(calls, {
        tenantId: "tenant-payments",
        assemblyId: "assembly-checkout",
        compositionMode: "DYNAMIC",
        rootNodeId: "company:payments",
        focusNodeId: "assembly:checkout",
        nodes: [],
        edges: [],
        warnings: []
      })
    });

    const response = await client.loadDynamicDcpProjection?.();

    assert.equal(response?.compositionMode, "DYNAMIC");
    assert.deepEqual(calls, [
      {
        input: "http://fabric.local/studio/tenants/tenant-payments/assemblies/assembly-checkout/dynamic-dcp",
        method: "GET",
        body: undefined
      }
    ]);
  });

  it("loads replacement candidates for a selected dynamic DCP node", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      defaultTenantId: "tenant-payments",
      defaultAssemblyId: "assembly-checkout",
      fetch: fakeFetch(calls, {
        tenantId: "tenant-payments",
        assemblyId: "assembly-checkout",
        componentNodeId: "component.validation-service",
        candidates: [
          {
            catalogEntryId: "com.unfurl:customer-policy-validator:1.2.0",
            label: "Customer Policy Validator",
            owner: "risk-team",
            shape: "CONTAINER",
            status: "ALLOWED",
            reason: "compatible"
          }
        ],
        warnings: []
      })
    });

    const response = await client.loadReplacementCandidates?.({
      componentNodeId: "component.validation-service"
    });

    assert.equal(response?.candidates[0]?.catalogEntryId, "com.unfurl:customer-policy-validator:1.2.0");
    assert.deepEqual(calls, [
      {
        input: "http://fabric.local/studio/tenants/tenant-payments/assemblies/assembly-checkout/dynamic-dcp/replacements?componentNodeId=component.validation-service",
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

  it("sends collaborator heartbeat to the scoped session endpoint", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      defaultTenantId: "tenant-payments",
      defaultAssemblyId: "assembly-checkout",
      fetch: fakeFetch(calls, session({ sessionId: "studio-session-123", sceneRevision: 4 }))
    });

    const response = await client.heartbeatCollaborator?.({
      sessionId: "studio-session-123",
      collaboratorId: "alice",
      displayName: "Alice",
      selectedSurface: "validation"
    });

    assert.equal(response?.sceneRevision, 4);
    assert.deepEqual(calls, [
      {
        input: "http://fabric.local/studio/tenants/tenant-payments/assemblies/assembly-checkout/sessions/studio-session-123/collaborators/heartbeat",
        method: "POST",
        body: JSON.stringify({
          collaboratorId: "alice",
          displayName: "Alice",
          selectedSurface: "validation"
        })
      }
    ]);
  });

  it("builds the server-sent events URL for a scoped draft session", () => {
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local/",
      defaultTenantId: "tenant-payments",
      defaultAssemblyId: "assembly-checkout",
      fetch: fakeFetch([], {})
    });

    const url = client.sessionEventsUrl?.({
      sessionId: "studio session/123"
    });

    assert.equal(
      url,
      "http://fabric.local/studio/tenants/tenant-payments/assemblies/assembly-checkout/sessions/studio%20session%2F123/events"
    );
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

  it("converses with the server-side authoring endpoint without provider fields", async () => {
    const calls: FetchCall[] = [];
    const client = createHttpStudioFabricClient({
      baseUrl: "http://fabric.local",
      defaultTenantId: "tenant-payments",
      defaultAssemblyId: "assembly-checkout",
      fetch: fakeFetch(calls, {
        kind: "clarify",
        assistantMessage: "Where should this run?",
        questions: [
          {
            id: "target",
            label: "Target",
            type: "SINGLE_SELECT",
            options: ["Customer Runtime Substrate"]
          }
        ]
      })
    });

    const response = await client.converseAuthoring?.({
      sessionId: "studio-session-123",
      conversation: [],
      userMessage: "Build a docs chatbot"
    });

    assert.equal(response?.kind, "clarify");
    assert.equal(calls[0]?.input, "http://fabric.local/studio/authoring/converse");
    assert.equal(calls[0]?.method, "POST");
    assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), {
      tenantId: "tenant-payments",
      assemblyId: "assembly-checkout",
      sessionId: "studio-session-123",
      conversation: [],
      userMessage: "Build a docs chatbot"
    });
    assert.doesNotMatch(calls[0]?.body ?? "", /apiKey|providerKey|modelProvider/i);
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

type HeaderFetchCall = {
  readonly input: string;
  readonly headers: Record<string, string> | undefined;
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
