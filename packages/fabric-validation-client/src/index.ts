import type { ReadOnlyCompositionView, StudioDraftSession } from "@unfurl/fabric-scene-model";
import type { VisualCatalogEntry } from "@unfurl/visual-manifest";

export type { StudioDraftSession } from "@unfurl/fabric-scene-model";

export type StudioIntent =
  | AddComponentIntent
  | ConnectPortsIntent
  | DisconnectIntent
  | ReplaceComponentIntent;

export type BaseIntent = {
  readonly sessionId: string;
  readonly baseRevision: number;
};

export type AddComponentIntent = BaseIntent & {
  readonly type: "ADD_COMPONENT";
  readonly catalogEntryId: string;
};

export type ConnectPortsIntent = BaseIntent & {
  readonly type: "CONNECT";
  readonly fromPort: string;
  readonly toPort: string;
};

export type DisconnectIntent = BaseIntent & {
  readonly type: "DISCONNECT";
  readonly pipeId: string;
};

export type ReplaceComponentIntent = BaseIntent & {
  readonly type: "REPLACE_COMPONENT";
  readonly oldComponentId: string;
  readonly newCatalogEntryId: string;
};

export type IntentResponse =
  | {
      readonly status: "VALID";
      readonly newRevision: number;
      readonly updatedCandidateId?: string;
      readonly requiredSubstratePorts: readonly string[];
      readonly warnings: readonly string[];
    }
  | {
      readonly status: "INVALID";
      readonly reason: string;
      readonly details: string;
    }
  | {
      readonly status: "STALE_REVISION";
      readonly expectedRevision: number;
      readonly receivedRevision: number;
    };

export type ListCatalogVisualsResponse = {
  readonly catalogHash: string;
  readonly entries: readonly VisualCatalogEntry[];
};

export type LoadCompositionViewRequest = {
  readonly contractPath: string;
  readonly substrateProfilePath: string;
};

export type LoadCompositionViewResponse = {
  readonly view: ReadOnlyCompositionView;
};

export type CreateDraftCompositionRequest = {
  readonly baseCatalogHash: string;
  readonly needsId?: string;
  readonly trustPolicyId?: string;
  readonly initialCandidateId?: string;
};

export type CreateDraftCompositionResponse = {
  readonly session: StudioDraftSession;
};

export type CompileDraftCandidateRequest = {
  readonly sessionId: string;
  readonly expectedRevision: number;
  readonly sign?: boolean;
};

export type CompileDraftCandidateResponse =
  | {
      readonly status: "COMPILED";
      readonly candidateId: string;
      readonly contractArtifact: StudioExportArtifact;
      readonly substrateProfileArtifact: StudioExportArtifact;
      readonly signedContractArtifact?: StudioExportArtifact;
      readonly decisionAudit?: StudioDecisionAudit;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: "STALE_REVISION";
      readonly expectedRevision: number;
      readonly receivedRevision: number;
    }
  | {
      readonly status: "INVALID";
      readonly reason: string;
      readonly details: string;
    };

export type StudioExportArtifact = {
  readonly artifactId: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly url: string;
};

export type StudioVisualAsset = {
  readonly assetId: string;
  readonly path: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly url: string;
};

export type StudioDecisionAudit = {
  readonly selectionMode: "AUTO_SINGLE" | "MANUAL" | "AUTO_BEST_SCORE" | string;
  readonly alternativesConsidered: readonly StudioDecisionAlternative[];
  readonly scoreBreakdown: readonly StudioScoreBreakdown[];
  readonly planningWarnings: readonly string[];
};

export type StudioDecisionAlternative = {
  readonly candidateId: string;
  readonly score: number;
  readonly selected: boolean;
  readonly reason: string;
};

export type StudioScoreBreakdown = {
  readonly factor: string;
  readonly value: number;
  readonly explanation: string;
};

export interface StudioFabricClient {
  readonly listCatalogVisuals: () => Promise<ListCatalogVisualsResponse>;
  readonly loadCompositionView: (request: LoadCompositionViewRequest) => Promise<LoadCompositionViewResponse>;
  readonly createDraftComposition: (request: CreateDraftCompositionRequest) => Promise<CreateDraftCompositionResponse>;
  readonly getDraftSession: (sessionId: string) => Promise<StudioDraftSession>;
  readonly applyIntent: (intent: StudioIntent) => Promise<IntentResponse>;
  readonly compileCandidate: (request: CompileDraftCandidateRequest) => Promise<CompileDraftCandidateResponse>;
  readonly getVisualAsset: (assetId: string) => Promise<StudioVisualAsset>;
}

export * from "./httpClient.js";
export * from "./mockStudioApi.js";
