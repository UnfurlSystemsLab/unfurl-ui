import type { StudioDraftSession } from "@unfurl/fabric-scene-model";
import type { VisualCatalogEntry } from "@unfurl/visual-manifest";
import type {
  CompileDraftCandidateResponse,
  CreateDraftCompositionRequest,
  CreateDraftCompositionResponse,
  FetchLike,
  FetchResponseLike,
  IntentResponse,
  ListCatalogVisualsResponse,
  LoadCompositionViewResponse,
  ResolveDeploymentResponse,
  StudioVisualAsset
} from "./index.js";

export type MockStudioApiFixtures = {
  readonly catalog?: ListCatalogVisualsResponse;
  readonly compositionView?: LoadCompositionViewResponse;
  readonly session?: StudioDraftSession;
  readonly intentResponse?: IntentResponse;
  readonly compileResponse?: CompileDraftCandidateResponse;
  readonly resolveDeploymentResponse?: ResolveDeploymentResponse;
  readonly asset?: StudioVisualAsset;
};

export const studioApiExampleCatalog: ListCatalogVisualsResponse = {
  catalogHash: "sha256:catalog",
  entries: [
    {
      catalogEntryId: "com.unfurl:storage-s3:1.2.0",
      claimHash: "sha256:claim-storage-s3",
      artifactSha256: "sha256:artifact-storage-s3",
      visualManifest: {
        fallbackShape: { kind: "CUBE", category: "STORAGE" },
        ports: [
          {
            id: "storage-put",
            mapsTo: "claim.offers.storage.put",
            kind: "OFFER",
            anchor: "right-upper",
            connectorShape: "SQUARE_SOCKET"
          }
        ],
        interactions: {
          draggable: true,
          connectable: true,
          inspectable: true
        }
      },
      visualIntegrity: {
        visualManifestHash: "sha256:visual-storage-s3",
        assets: []
      },
      warnings: []
    }
  ]
};

export const studioApiExampleSession: StudioDraftSession = {
  sessionId: "studio-session-123",
  baseCatalogHash: "sha256:catalog",
  currentCandidateId: "cand-abc123",
  sceneRevision: 7,
  warnings: []
};

export const studioApiExampleCompositionView: LoadCompositionViewResponse = {
  view: {
    contractId: "contract-123",
    candidateId: "cand-abc123",
    components: [
      {
        componentId: "storage-s3",
        catalogEntryId: "com.unfurl:storage-s3:1.2.0",
        name: "S3 Storage",
        coordinates: "com.unfurl:storage-s3:1.2.0",
        claimHash: "sha256:claim-storage-s3",
        artifactSha256: "sha256:artifact-storage-s3",
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
  }
};

export const studioApiExampleCompileResponse: CompileDraftCandidateResponse = {
  status: "COMPILED",
  candidateId: "cand-abc123",
  contractArtifact: artifact("contract"),
  substrateProfileArtifact: artifact("profile"),
  decisionAudit: {
    selectionMode: "AUTO_SINGLE",
    alternativesConsidered: [
      { candidateId: "cand-abc123", score: 1, selected: true, reason: "only valid candidate" }
    ],
    scoreBreakdown: [
      { factor: "trust", value: 1, explanation: "trusted catalog entry" }
    ],
    planningWarnings: []
  },
  warnings: []
};

export const studioApiExampleResolveDeploymentResponse: ResolveDeploymentResponse = {
  status: "RESOLVED",
  candidateId: "cand-abc123",
  selections: [
    {
      componentId: "storage-s3",
      artifactCoordinates: "com.unfurl:storage-s3:1.2.0",
      capability: "storage.put",
      deploymentShape: "IN_PROCESS_LIBRARY",
      requiredPorts: []
    }
  ],
  warnings: []
};

export const studioApiExampleAsset: StudioVisualAsset = {
  assetId: "storage-s3-model",
  path: "META-INF/visual/storage-s3.glb",
  mediaType: "model/gltf-binary",
  sha256: "sha256:storage-s3-model",
  url: "/studio/assets/storage-s3-model/content"
};

export function createMockStudioApiFetch(fixtures: MockStudioApiFixtures = {}): FetchLike {
  const session = fixtures.session ?? studioApiExampleSession;
  return async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const path = url.pathname;

    if (method === "GET" && path === "/studio/catalog") {
      return ok(fixtures.catalog ?? studioApiExampleCatalog);
    }
    if (method === "POST" && path === "/studio/composition-view") {
      return ok(fixtures.compositionView ?? studioApiExampleCompositionView);
    }
    if (method === "POST" && path === "/studio/sessions") {
      parseJson<CreateDraftCompositionRequest>(init?.body);
      return ok<CreateDraftCompositionResponse>({ session });
    }
    if (method === "GET" && path === `/studio/sessions/${encodeURIComponent(session.sessionId)}`) {
      return ok(session);
    }
    if (method === "POST" && path === `/studio/sessions/${encodeURIComponent(session.sessionId)}/intents`) {
      return ok(fixtures.intentResponse ?? {
        status: "VALID",
        newRevision: session.sceneRevision + 1,
        updatedCandidateId: session.currentCandidateId,
        requiredSubstratePorts: ["secrets.provider"],
        warnings: []
      });
    }
    if (method === "POST" && path === `/studio/sessions/${encodeURIComponent(session.sessionId)}/compile`) {
      return ok(fixtures.compileResponse ?? studioApiExampleCompileResponse);
    }
    if (method === "POST" && path === "/studio/deployment/resolve") {
      return ok(fixtures.resolveDeploymentResponse ?? studioApiExampleResolveDeploymentResponse);
    }
    if (method === "GET" && path.startsWith("/studio/assets/")) {
      return ok(fixtures.asset ?? studioApiExampleAsset);
    }
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({})
    };
  };
}

function ok<T>(body: T): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body
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

function parseJson<T>(body: string | undefined): T | undefined {
  return body === undefined ? undefined : JSON.parse(body) as T;
}
