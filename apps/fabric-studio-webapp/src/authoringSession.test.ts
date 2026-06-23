import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  AuthoringConverseResponse,
  AuthoringProposal,
  IntentResponse,
  ResolveDeploymentResponse,
  StudioFabricClient
} from "@unfurl/fabric-validation-client";
import type { StudioDraftSession } from "@unfurl/fabric-scene-model";
import {
  applyAuthoringProposal,
  converseAuthoring,
  finalizeAuthoringProposal,
  initialAuthoringSession
} from "./authoringSession.js";
import { createDraftWorkspace } from "./draftWorkspace.js";

describe("authoring session", () => {
  it("converses through the server-side authoring endpoint", async () => {
    const response: AuthoringConverseResponse = {
      kind: "clarify",
      assistantMessage: "Pick a target.",
      questions: [{ id: "target", label: "Target", type: "SINGLE_SELECT", options: ["Customer Runtime Substrate"] }]
    };
    const client = fakeClient({ authoringResponse: response });

    const state = await converseAuthoring(client, initialAuthoringSession(), {
      tenantId: "tenant-local",
      assemblyId: "assembly-demo",
      userMessage: "Build a chatbot"
    });

    assert.equal(state.status, "READY");
    assert.equal(state.status === "READY" ? state.response.kind : undefined, "clarify");
  });

  it("applies proposal intents through the existing draft intent path", async () => {
    const calls: unknown[] = [];
    const client = fakeClient({ calls });
    const draft = await createDraftWorkspace(client, { baseCatalogHash: "sha256:catalog" });

    const result = await applyAuthoringProposal(client, draft, proposal());

    assert.equal(result.state.status, "READY");
    assert.equal(result.appliedIntentCount, 2);
    assert.deepEqual(calls.slice(0, 2), [
      {
        tenantId: "tenant-local",
        assemblyId: "assembly-demo",
        sessionId: "studio-session-123",
        baseRevision: 7,
        type: "ADD_COMPONENT",
        catalogEntryId: "com.unfurl.flow:orchestrator:0.1.0"
      },
      {
        tenantId: "tenant-local",
        assemblyId: "assembly-demo",
        sessionId: "studio-session-123",
        baseRevision: 8,
        type: "CONNECT",
        fromPort: "workflow-execute",
        toPort: "state-store"
      }
    ]);
  });

  it("resolves deployment compiles signed output and renders existing export bundle", async () => {
    const calls: unknown[] = [];
    const client = fakeClient({ calls });
    const draft = await createDraftWorkspace(client, { baseCatalogHash: "sha256:catalog" });
    const applied = await applyAuthoringProposal(client, draft, proposal());

    const finalized = await finalizeAuthoringProposal(client, applied.state, proposal().deploymentPolicy);

    assert.equal(finalized.deployment?.status, "RESOLVED");
    assert.equal(finalized.exportBundle.status, "READY");
    assert.match(finalized.exportText, /SIGNED_CONTRACT/);
    assert.deepEqual(calls.at(-2), {
      tenantId: "tenant-local",
      assemblyId: "assembly-demo",
      sessionId: "studio-session-123",
      candidateId: "cand-next",
      deploymentPolicy: proposal().deploymentPolicy
    });
    assert.deepEqual(calls.at(-1), {
      sessionId: "studio-session-123",
      tenantId: "tenant-local",
      assemblyId: "assembly-demo",
      expectedRevision: 9,
      sign: true,
      deploymentPolicy: proposal().deploymentPolicy
    });
  });
});

function proposal(): AuthoringProposal {
  return {
    summary: "Add Flow and connect state",
    needsYaml: "requiredCapabilities:\n  - capability: workflow.execute\n",
    intents: [
      { type: "ADD_COMPONENT", catalogEntryId: "com.unfurl.flow:orchestrator:0.1.0" },
      { type: "CONNECT", fromPort: "workflow-execute", toPort: "state-store" }
    ],
    deploymentPolicy: {
      preferredShapes: ["CONTAINERIZED_SERVICE"],
      disallowedShapes: [],
      requireIsolationForCapabilityPatterns: ["workflow.*"],
      runtime: { kubernetes: true }
    },
    warnings: []
  };
}

function fakeClient(options: {
  readonly authoringResponse?: AuthoringConverseResponse;
  readonly intentResponse?: IntentResponse;
  readonly deploymentResponse?: ResolveDeploymentResponse;
  readonly calls?: unknown[];
} = {}): StudioFabricClient {
  return {
    listCatalogVisuals: async () => ({ catalogHash: "sha256:catalog", entries: [] }),
    loadCompositionView: async () => ({ view: { contractId: "contract", candidateId: "cand", components: [], ports: [], substrate: [], warnings: [] } }),
    createDraftComposition: async () => ({ session: session(7) }),
    getDraftSession: async () => session((options.calls?.length ?? 0) + 7, "cand-next"),
    applyIntent: async intent => {
      options.calls?.push(intent);
      return options.intentResponse ?? {
        status: "VALID",
        newRevision: intent.baseRevision + 1,
        updatedCandidateId: "cand-next",
        requiredSubstratePorts: [],
        warnings: []
      };
    },
    compileCandidate: async request => {
      options.calls?.push(request);
      return {
        status: "COMPILED",
        candidateId: "cand-next",
        contractArtifact: artifact("contract"),
        substrateProfileArtifact: artifact("profile"),
        signedContractArtifact: artifact("signed"),
        warnings: []
      };
    },
    resolveDeployment: async request => {
      options.calls?.push(request);
      return options.deploymentResponse ?? {
        status: "RESOLVED",
        candidateId: "cand-next",
        selections: [],
        warnings: []
      };
    },
    converseAuthoring: async () => options.authoringResponse ?? {
      kind: "proposal",
      assistantMessage: "Proposal ready.",
      proposal: proposal()
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

function session(sceneRevision: number, currentCandidateId?: string): StudioDraftSession {
  return {
    tenantId: "tenant-local",
    assemblyId: "assembly-demo",
    sessionId: "studio-session-123",
    baseCatalogHash: "sha256:catalog",
    sceneRevision,
    ...(currentCandidateId === undefined ? {} : { currentCandidateId }),
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
