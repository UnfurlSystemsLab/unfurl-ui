import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyDraftIntent,
  compileDraftWorkspace,
  createDraftWorkspace,
  currentRevision,
  type DraftIntentCommand
} from "./index.js";
import type { IntentResponse, StudioFabricClient } from "@unfurl/fabric-validation-client";
import type { StudioDraftSession } from "@unfurl/fabric-scene-model";

describe("draft workspace", () => {
  it("creates a governed draft session from Fabric", async () => {
    const client = fakeClient({
      session: session({ sceneRevision: 3 })
    });

    const state = await createDraftWorkspace(client, {
      baseCatalogHash: "sha256:catalog",
      needsId: "needs-docs"
    });

    assert.equal(state.status, "READY");
    assert.equal(state.status === "READY" ? state.session.sceneRevision : undefined, 3);
    assert.equal(state.status === "READY" ? currentRevision(state.history) : undefined, 3);
  });

  it("applies valid commands as session-scoped revisioned intents", async () => {
    const calls: unknown[] = [];
    const client = fakeClient({
      session: session({ sceneRevision: 7 }),
      refreshedSession: session({ sceneRevision: 8, currentCandidateId: "cand-next" }),
      intentResponse: {
        status: "VALID",
        newRevision: 8,
        updatedCandidateId: "cand-next",
        requiredSubstratePorts: ["secrets.provider"],
        warnings: []
      },
      calls
    });
    const created = await createDraftWorkspace(client, { baseCatalogHash: "sha256:catalog" });

    const state = await applyDraftIntent(client, created, connectCommand());

    assert.equal(state.status, "READY");
    assert.equal(state.status === "READY" ? state.session.currentCandidateId : undefined, "cand-next");
    assert.equal(state.status === "READY" ? currentRevision(state.history) : undefined, 8);
    assert.deepEqual(calls[0], {
      sessionId: "studio-session-123",
      baseRevision: 7,
      type: "CONNECT",
      fromPort: "storage-s3.storage.put",
      toPort: "workflow.storage.required"
    });
  });

  it("keeps invalid responses visible without adding them to history", async () => {
    const client = fakeClient({
      session: session({ sceneRevision: 7 }),
      intentResponse: {
        status: "INVALID",
        reason: "Capability version conflict",
        details: "storage.put@2.0 cannot satisfy storage.put@^1"
      }
    });
    const created = await createDraftWorkspace(client, { baseCatalogHash: "sha256:catalog" });

    const state = await applyDraftIntent(client, created, connectCommand());

    assert.equal(state.status, "READY");
    assert.equal(state.status === "READY" ? state.lastResponse?.status : undefined, "INVALID");
    assert.equal(state.status === "READY" ? currentRevision(state.history) : undefined, 7);
  });

  it("refreshes session and resets local history when Fabric reports a stale revision", async () => {
    const client = fakeClient({
      session: session({ sceneRevision: 7 }),
      refreshedSession: session({ sceneRevision: 9, currentCandidateId: "cand-server" }),
      intentResponse: {
        status: "STALE_REVISION",
        expectedRevision: 9,
        receivedRevision: 7
      }
    });
    const created = await createDraftWorkspace(client, { baseCatalogHash: "sha256:catalog" });

    const state = await applyDraftIntent(client, created, connectCommand());

    assert.equal(state.status, "READY");
    assert.equal(state.status === "READY" ? state.session.sceneRevision : undefined, 9);
    assert.equal(state.status === "READY" ? currentRevision(state.history) : undefined, 9);
    assert.equal(state.status === "READY" ? state.history.records.length : undefined, 0);
  });

  it("compiles the current validated session revision through Fabric", async () => {
    const calls: unknown[] = [];
    const client = fakeClient({
      session: session({ sceneRevision: 7 }),
      compileResponse: {
        status: "COMPILED",
        candidateId: "cand-abc123",
        contractArtifact: artifact("contract"),
        substrateProfileArtifact: artifact("profile"),
        warnings: []
      },
      calls
    });
    const created = await createDraftWorkspace(client, { baseCatalogHash: "sha256:catalog" });

    const state = await compileDraftWorkspace(client, created, { sign: true });

    assert.equal(state.status, "READY");
    assert.equal(state.status === "READY" ? state.lastCompile?.status : undefined, "COMPILED");
    assert.deepEqual(calls[0], {
      sessionId: "studio-session-123",
      expectedRevision: 7,
      sign: true
    });
  });

  it("refreshes session when compile sees a stale revision", async () => {
    const client = fakeClient({
      session: session({ sceneRevision: 7 }),
      refreshedSession: session({ sceneRevision: 9, currentCandidateId: "cand-server" }),
      compileResponse: {
        status: "STALE_REVISION",
        expectedRevision: 9,
        receivedRevision: 7
      }
    });
    const created = await createDraftWorkspace(client, { baseCatalogHash: "sha256:catalog" });

    const state = await compileDraftWorkspace(client, created);

    assert.equal(state.status, "READY");
    assert.equal(state.status === "READY" ? state.session.sceneRevision : undefined, 9);
    assert.equal(state.status === "READY" ? currentRevision(state.history) : undefined, 9);
    assert.equal(state.status === "READY" ? state.lastCompile?.status : undefined, "STALE_REVISION");
  });
});

function connectCommand(): DraftIntentCommand {
  return {
    type: "CONNECT",
    fromPort: "storage-s3.storage.put",
    toPort: "workflow.storage.required"
  };
}

function session(overrides: { readonly sceneRevision: number; readonly currentCandidateId?: string }): StudioDraftSession {
  const base = {
    sessionId: "studio-session-123",
    baseCatalogHash: "sha256:catalog",
    sceneRevision: overrides.sceneRevision,
    warnings: []
  };
  return overrides.currentCandidateId === undefined
    ? base
    : { ...base, currentCandidateId: overrides.currentCandidateId };
}

function fakeClient(options: {
  readonly session: StudioDraftSession;
  readonly refreshedSession?: StudioDraftSession;
  readonly intentResponse?: IntentResponse;
  readonly compileResponse?: ReturnType<typeof compiled> | {
    readonly status: "STALE_REVISION";
    readonly expectedRevision: number;
    readonly receivedRevision: number;
  } | {
    readonly status: "INVALID";
    readonly reason: string;
    readonly details: string;
  };
  readonly calls?: unknown[];
}): StudioFabricClient {
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
    createDraftComposition: async () => ({ session: options.session }),
    getDraftSession: async () => options.refreshedSession ?? options.session,
    applyIntent: async intent => {
      options.calls?.push(intent);
      return options.intentResponse ?? {
        status: "VALID",
        newRevision: intent.baseRevision + 1,
        requiredSubstratePorts: [],
        warnings: []
      };
    },
    compileCandidate: async request => {
      options.calls?.push(request);
      return options.compileResponse ?? compiled();
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

function compiled() {
  return {
    status: "COMPILED" as const,
    candidateId: "cand-abc123",
    contractArtifact: artifact("contract"),
    substrateProfileArtifact: artifact("profile"),
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
