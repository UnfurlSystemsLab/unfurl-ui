import type { ReadOnlyCompositionView, StudioCompileRecord, StudioDraftSession } from "@unfurl/fabric-scene-model";
import type { VisualCatalogEntry } from "@unfurl/visual-manifest";

export type { StudioDraftSession, StudioCompileRecord } from "@unfurl/fabric-scene-model";

export type StudioIntent =
  | AddComponentIntent
  | ConnectPortsIntent
  | DisconnectIntent
  | RemoveComponentIntent
  | ReplaceComponentIntent;

export type AuthoringProposedIntent =
  | {
      readonly type: "ADD_COMPONENT";
      readonly catalogEntryId: string;
    }
  | {
      readonly type: "CONNECT";
      readonly fromPort: string;
      readonly toPort: string;
    }
  | {
      readonly type: "DISCONNECT";
      readonly pipeId: string;
    }
  | {
      readonly type: "REMOVE_COMPONENT";
      readonly componentId: string;
      readonly catalogEntryId?: string;
    }
  | {
      readonly type: "REPLACE_COMPONENT";
      readonly oldComponentId: string;
      readonly oldCatalogEntryId?: string;
      readonly newCatalogEntryId: string;
    };

export type StudioScope = {
  readonly tenantId: string;
  readonly assemblyId: string;
};

export type BaseIntent = {
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly sessionId: string;
  readonly baseRevision: number;
  readonly collaboratorId?: string;
  readonly collaboratorName?: string;
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

export type RemoveComponentIntent = BaseIntent & {
  readonly type: "REMOVE_COMPONENT";
  readonly componentId: string;
  readonly catalogEntryId?: string;
};

export type ReplaceComponentIntent = BaseIntent & {
  readonly type: "REPLACE_COMPONENT";
  readonly oldComponentId: string;
  readonly oldCatalogEntryId?: string;
  readonly newCatalogEntryId: string;
};

export type IntentResponse =
  | {
      readonly status: "VALID";
      readonly newRevision: number;
      readonly updatedCandidateId?: string;
      readonly requiredSubstratePorts: readonly string[];
      readonly warnings: readonly string[];
      readonly session?: StudioDraftSession;
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
      readonly session?: StudioDraftSession;
    };

export type ListCatalogVisualsResponse = {
  readonly catalogHash: string;
  readonly entries: readonly VisualCatalogEntry[];
  readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
};

export type ListCatalogVisualsRequest = {
  readonly tenantId?: string;
  readonly catalogFileId?: string;
};

export type StudioFileRecord = {
  readonly fileId: string;
  readonly tenantId: string;
  readonly logicalFileId: string;
  readonly version: number;
  readonly fileName: string;
  readonly fileTitle: string;
  readonly filePath: string;
  readonly fileType: "CATALOG" | "DRAFT" | "ASSEMBLY" | "EXPORT" | "SIGNED_EXPORT" | "SUPPORT" | "DIAGNOSTIC" | string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly createdAt: string;
};

export type ListStudioFilesRequest = {
  readonly tenantId?: string;
  readonly fileType?: string;
  readonly sessionId?: string;
  readonly correlationId?: string;
};

export type StudioSessionHistoryItem = {
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly sessionId: string;
  readonly displayName: string;
  readonly sessionType: string;
  readonly status: string;
  readonly baseCatalogHash: string;
  readonly catalogFileId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastOpenedAt: string;
  readonly linkedFileCount: number;
  readonly intentCount: number;
};

export type ListStudioSessionHistoryRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
};

export type RemoveCatalogEntryRequest = {
  readonly tenantId?: string;
  readonly catalogEntryId: string;
};

export type StudioComponentArtifactDraft = {
  readonly fileName: string;
  readonly sha256?: string;
  /** The jar's bytes, base64-encoded; Fabric reads the claim out of them. */
  readonly artifactBase64?: string;
};

export type AdmitCatalogArtifactsRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly artifacts: readonly StudioComponentArtifactDraft[];
};

export type StudioDcpDiagnostic = {
  readonly severity: "ERROR" | "WARNING" | "INFO" | string;
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type StudioClaimVerificationResult = {
  readonly fileName: string;
  readonly status: "VERIFIED" | "REJECTED" | string;
  readonly catalogEntryId: string;
  readonly claimHash: string;
  readonly warnings: readonly string[];
  readonly diagnostics: readonly StudioDcpDiagnostic[];
};

export type AdmitCatalogArtifactsResponse = {
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly status: "VERIFIED" | "REJECTED" | string;
  readonly results: readonly StudioClaimVerificationResult[];
  readonly catalog: ListCatalogVisualsResponse;
  readonly claimBundleArtifact?: StudioExportArtifact;
  readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
};

export type RemoveCatalogEntryResponse = {
  readonly tenantId: string;
  readonly catalogEntryId: string;
  readonly status: "REMOVED" | string;
  readonly catalog: ListCatalogVisualsResponse;
  readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
};

export type StudioCatalogSnapshot = {
  readonly tenantId: string;
  readonly catalogHash: string;
  readonly entries: readonly VisualCatalogEntry[];
  readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
};

export type SaveCatalogSnapshotRequest = {
  readonly tenantId?: string;
};

export type LoadCatalogSnapshotRequest = {
  readonly tenantId?: string;
  readonly snapshot: StudioCatalogSnapshot;
};

export type ExtractNeedsRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly targetApplicationName: string;
  readonly fileNames: readonly string[];
  readonly defaultDeploymentTarget?: string;
};

export type ExtractNeedsResponse = {
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly needsId: string;
  readonly targetApplicationName: string;
  readonly suggestedNeedsYaml: string;
  readonly defaultDeploymentTarget: string;
  readonly warnings: readonly string[];
  readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
};

export type StudioAssemblySummary = {
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly targetApplicationName: string;
  readonly defaultDeploymentTarget: string;
  readonly needsId: string;
  readonly deploymentShape: string;
  readonly currentCandidateId: string;
  readonly sceneRevision: number;
};

export type ListAssembliesRequest = {
  readonly tenantId?: string;
};

export type ListAssembliesResponse = {
  readonly tenantId: string;
  readonly assemblies: readonly StudioAssemblySummary[];
};

export type CreateAssemblyRequest = {
  readonly tenantId?: string;
  readonly assemblyId: string;
  readonly targetApplicationName: string;
  readonly defaultDeploymentTarget?: string;
};

export type SaveDraftRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly targetApplicationName: string;
  readonly needsId?: string;
  readonly deploymentTarget: string;
  readonly deploymentShape: string;
  readonly currentCandidateId?: string;
  readonly sceneRevision?: number;
};

export type SaveDraftResponse = {
  readonly status: "SAVED" | string;
  readonly assembly: StudioAssemblySummary;
  readonly warnings: readonly string[];
  readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
};

export type StudioAssemblySnapshot = {
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly assembly: StudioAssemblySummary;
  readonly layout: StudioLayoutState;
  readonly sessions: readonly StudioDraftSession[];
  readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
};

export type SaveAssemblySnapshotRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
};

export type LoadAssemblySnapshotRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly snapshot: StudioAssemblySnapshot;
};

/** A workbench view (Studio LLD-studio-viewpoints-and-perspectives §3). */
export type StudioViewpoint = "FLOW" | "DATA" | "TOPOLOGY" | "RUNTIME";
/** A perspective overlay (Studio LLD §4). */
export type StudioOverlay = "SECURITY" | "PERFORMANCE" | "RESILIENCE" | "COMPLIANCE";
/** A renderer (Studio LLD §5.2). */
export type StudioRenderer = "THREE_D" | "TWO_D" | "TABLE";
/** A 3D Flow layout. */
export type StudioLayoutMode = "ASSEMBLY" | "EXPLODED";

/**
 * A tenant- and assembly-scoped Studio layout: UI state only, never a validity source (Fabric LLD-fabric-studio-api,
 * Layout state extension). A layout written before the workbench has only `activeView`, the retired tab value, which
 * Studio maps (Studio LLD §5.4); a current one has the view-state fields instead.
 */
export type StudioLayoutState = {
  readonly tenantId: string;
  readonly assemblyId: string;
  /** Read-only: the retired five-tab value, present only on an older layout. */
  readonly activeView?: string;
  readonly semanticZoomLevel: "PARENT_DCP" | "ASSEMBLY_DCP" | "CHILD_DCP" | string;
  readonly selectedSurface: string;
  readonly camera: Record<string, unknown>;
  readonly annotations: readonly string[];
  readonly activeViewpoint?: StudioViewpoint;
  readonly activeOverlays?: readonly StudioOverlay[];
  readonly colourOverlay?: StudioOverlay;
  readonly renderer?: StudioRenderer;
  readonly layout?: StudioLayoutMode;
};

export type LoadLayoutStateRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
};

/** A layout write: always the workbench view state, never the retired `activeView` (Fabric refuses it). */
export type SaveLayoutStateRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly semanticZoomLevel: "PARENT_DCP" | "ASSEMBLY_DCP" | "CHILD_DCP" | string;
  readonly selectedSurface: string;
  readonly camera?: Record<string, unknown>;
  readonly annotations?: readonly string[];
  readonly activeViewpoint: StudioViewpoint;
  readonly activeOverlays: readonly StudioOverlay[];
  readonly colourOverlay?: StudioOverlay;
  readonly renderer: StudioRenderer;
  readonly layout?: StudioLayoutMode;
};

export type DynamicDcpProjectionRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly sessionId?: string;
};

export type DynamicDcpProjectionResponse = {
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly compositionMode: "STATIC" | "DYNAMIC" | string;
  readonly rootNodeId: string;
  readonly focusNodeId: string;
  readonly nodes: readonly DynamicDcpNode[];
  readonly edges: readonly DynamicDcpEdge[];
  readonly substratePorts?: readonly StudioSubstratePort[];
  // Port-level wirings derived from declared needs ↔ offers among the
  // current draft components. Drives the Studio 3D scene's pipe
  // rendering. ?owner=host / ?owner=fabric needs are filtered out
  // server-side because they're external dependencies, not in-scene
  // pipes. Optional for backward compatibility with older clients /
  // mock responses; absent ⇒ treat as empty list.
  readonly connections?: readonly StudioPortConnectionEdge[];
  readonly warnings: readonly string[];
  readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
};

export type DynamicDcpNode = {
  readonly nodeId: string;
  readonly label: string;
  readonly dcpType: "COMPANY" | "SUBSTRATE" | "MODULE" | "COMPONENT" | string;
  readonly level: "PARENT" | "ASSEMBLY" | "CHILD" | string;
  readonly parentNodeId?: string;
  readonly depth?: number;
  readonly catalogEntryId?: string;
  readonly capabilities: readonly string[];
  readonly compatibleDescendants: readonly string[];
  readonly replacementAllowed: boolean;
};

/**
 * One relationship of Fabric's dynamic DCP projection. A `CONTAINS` edge says where it came from
 * (LLD-fabric-studio-api, Containment derived from bindings): `DECLARED` by the claims, or `DERIVED_FROM_BINDINGS` when
 * Fabric nested a component under the component that uses it. Absent from an older Fabric, it reads as declared.
 */
export type DynamicDcpEdge = {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly relationship: "CONTAINS" | "BINDS" | "REPLACES" | string;
  readonly derivation?: "DECLARED" | "DERIVED_FROM_BINDINGS";
};

export type StudioSubstratePort = {
  readonly portId: string;
  readonly capability: string;
  readonly label: string;
  readonly provider: string;
  readonly status: "AVAILABLE" | "BLOCKED" | string;
};

export type StudioPortConnectionEdge = {
  readonly sourceNodeId: string;
  readonly sourcePortId: string;
  readonly targetNodeId: string;
  readonly targetPortId: string;
  readonly capability: string;
  readonly status: "ALLOWED" | "BLOCKED" | string;
  readonly reason: string;
};

export type ReplacementCandidatesRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly componentNodeId: string;
};

export type StudioReplacementCandidate = {
  readonly catalogEntryId: string;
  readonly label: string;
  readonly owner: string;
  readonly shape: string;
  readonly status: "ALLOWED" | "BLOCKED" | string;
  readonly reason: string;
};

export type ReplacementCandidatesResponse = {
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly componentNodeId: string;
  readonly candidates: readonly StudioReplacementCandidate[];
  readonly warnings: readonly string[];
};

// ---- Hover-preview connection candidates --------------------------------
//
// Mirrors the backend's
// GET /studio/tenants/{tenantId}/assemblies/{assemblyId}/dynamic-dcp/connection-candidates?catalogEntryId=...
// surface. Consumed by the Studio palette's hover handler: each hover
// returns the connection edges (OFFER↔DEPENDENCY pairings against the
// current draft) and replacement edges (slot substitutions) for the
// hovered catalog entry, so the 3D scene can light up compatible
// targets before the operator clicks Add.

export type ConnectionCandidatesRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly catalogEntryId: string;
};

export type StudioConnectionEdge = {
  readonly targetNodeId: string;
  readonly targetPortId: string;
  readonly candidatePortId: string;
  readonly direction: "CANDIDATE_OFFERS" | "CANDIDATE_NEEDS" | string;
  readonly status: "ALLOWED" | "BLOCKED" | string;
  readonly reason: string;
};

export type StudioReplacementEdge = {
  readonly targetNodeId: string;
  readonly status: "ALLOWED" | "BLOCKED" | string;
  readonly reason: string;
};

export type ConnectionCandidatesResponse = {
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly catalogEntryId: string;
  readonly connections: readonly StudioConnectionEdge[];
  readonly replacements: readonly StudioReplacementEdge[];
  readonly warnings: readonly string[];
};

export type LoadCompositionViewRequest = {
  readonly contractPath: string;
  readonly substrateProfilePath: string;
};

export type LoadCompositionViewResponse = {
  readonly view: ReadOnlyCompositionView;
};

export type CreateDraftCompositionRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly baseCatalogHash: string;
  readonly catalogFileId?: string;
  readonly displayName?: string;
  readonly needsId?: string;
  readonly trustPolicyId?: string;
  readonly initialCandidateId?: string;
  readonly collaboratorId?: string;
  readonly collaboratorName?: string;
  readonly deploymentPolicy?: DeploymentPolicyDraft;
};

export type CreateDraftCompositionResponse = {
  readonly session: StudioDraftSession;
  readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
};

export type HeartbeatCollaboratorRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly sessionId: string;
  readonly collaboratorId: string;
  readonly displayName?: string;
  readonly selectedSurface?: string;
};

export type SessionEventsRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly sessionId: string;
};

export type StudioSessionEvent = {
  readonly eventId: string;
  readonly type: "session" | string;
  readonly session: StudioDraftSession;
  readonly emittedAt: string;
};

export type CompileDraftCandidateRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly sessionId: string;
  readonly expectedRevision: number;
  readonly sign?: boolean;
  readonly deploymentPolicy?: DeploymentPolicyDraft;
};

export type AuthoringConversationMessage = {
  readonly role: "USER" | "ASSISTANT" | "SYSTEM";
  readonly content: string;
};

export type AuthoringQuestionOption = {
  readonly label: string;
  readonly value: string;
};

export type AuthoringQuestion = {
  readonly id: string;
  readonly label: string;
  readonly type: "SINGLE_SELECT" | "MULTI_SELECT" | "FREE_TEXT" | "TEXT";
  readonly required?: boolean;
  readonly options?: readonly AuthoringQuestionOption[];
};

export type AuthoringQuestionAnswers = Record<string, string | readonly string[]>;

export type AuthoringActionContext = {
  readonly operation: "ADD_COMPONENT" | "REMOVE_COMPONENT" | "REPLACE_COMPONENT" | "CONNECT" | "DISCONNECT" | "CONFIGURE_SUBSTRATE" | string;
  readonly catalogEntryId?: string;
  readonly componentId?: string;
  readonly componentLabel?: string;
  readonly selectedComponentId?: string;
  readonly selectedComponentLabel?: string;
  readonly replacementCatalogEntryId?: string;
  readonly fromPort?: string;
  readonly toPort?: string;
  readonly dependencyPorts?: readonly string[];
  readonly substratePorts?: readonly string[];
  readonly offeredCapabilities?: readonly string[];
  readonly draftSessionId?: string;
  readonly notes?: string;
};

export type AuthoringConverseRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly sessionId?: string;
  readonly catalogFileId?: string;
  readonly displayName?: string;
  readonly conversation: readonly AuthoringConversationMessage[];
  readonly userMessage?: string;
  readonly questionAnswers?: AuthoringQuestionAnswers;
  readonly actionContext?: AuthoringActionContext;
};

export type AuthoringProposal = {
  readonly needsYaml: string;
  readonly intents: readonly AuthoringProposedIntent[];
  readonly deploymentPolicy?: DeploymentPolicyDraft;
  readonly summary: string;
  readonly warnings: readonly string[];
};

export type AuthoringConverseResponse =
  | {
      readonly kind: "clarify";
      readonly questions: readonly AuthoringQuestion[];
      readonly assistantMessage: string;
    }
  | {
      readonly kind: "proposal";
      readonly proposal: AuthoringProposal;
      readonly assistantMessage: string;
    }
  | {
      readonly kind: "gap";
      readonly unmet: readonly string[];
      readonly assistantMessage: string;
    }
  | {
      readonly kind: "execution";
      readonly assistantMessage: string;
      readonly phase?: string;
      readonly step?: number;
      readonly toolCalls: readonly Record<string, unknown>[];
      readonly artifacts: readonly Record<string, unknown>[];
    };

export type DeploymentShape =
  | "IN_PROCESS_LIBRARY"
  | "MODULAR_MONOLITH_MODULE"
  | "STANDALONE_JAVA_APP"
  | "SPRING_BOOT_SERVICE"
  | "REMOTE_MICROSERVICE"
  | "CONTAINERIZED_SERVICE"
  | "MANAGED_EXTERNAL_ADAPTER";

export type DeploymentRuntimePolicyDraft = {
  readonly javaVersion?: string;
  readonly springBoot?: boolean;
  readonly kubernetes?: boolean;
  readonly serviceMesh?: boolean;
  readonly maxServices?: number;
};

export type DeploymentPolicyDraft = {
  readonly preferredShapes: readonly DeploymentShape[];
  readonly disallowedShapes: readonly DeploymentShape[];
  readonly requireIsolationForCapabilityPatterns: readonly string[];
  readonly runtime: DeploymentRuntimePolicyDraft;
};

export type ResolveDeploymentRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly sessionId?: string;
  readonly candidateId?: string;
  readonly baseCatalogHash?: string;
  readonly needsId?: string;
  readonly needsYaml?: string;
  readonly catalogPath?: string;
  readonly needsPath?: string;
  readonly autoSelectBest?: boolean;
  readonly deploymentPolicy?: DeploymentPolicyDraft;
};

/**
 * One component's selected shape. `componentId` is the artifact coordinates the resolver names it by; in session mode
 * `catalogEntryId` is the draft's catalog entry it was resolved for, the key the draft projection's nodes carry
 * (LLD-fabric-studio-api, Deployment Resolution). It is empty in filesystem mode.
 */
export type DeploymentShapeSelection = {
  readonly componentId: string;
  readonly artifactCoordinates: string;
  readonly capability: string;
  readonly deploymentShape: DeploymentShape;
  readonly requiredPorts: readonly string[];
  readonly catalogEntryId?: string;
};

export type ResolveDeploymentResponse =
  | {
      readonly status: "RESOLVED";
      readonly candidateId: string;
      readonly selections: readonly DeploymentShapeSelection[];
      readonly warnings: readonly string[];
      readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
    }
  | {
      readonly status: "INVALID";
      readonly reason: string;
      readonly details: string;
      readonly rejectedShapes: readonly string[];
      /** The typed causes of a `NO_MATCH`, from the same presenter as `details`; empty for any other reason. */
      readonly reasons: readonly StudioMatchFailureReason[];
      /** The trust rejections a filesystem `NO_MATCH` considered; a session applies no trust classification. */
      readonly trustRejections: readonly StudioTrustRejection[];
      readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
    };

/**
 * One typed cause of a failed match (LLD-fabric-studio-api, Structured match failures and trust rejections). `message`
 * is the cause's own text, which names its fix; Studio shows it as Fabric wrote it.
 */
export type StudioMatchFailureReason = {
  readonly kind: "UNMET_NEED" | "CONFLICT";
  /** For an unmet need its reason (`NOT_IN_CATALOG`, ...); for a conflict its variant (`MISSING_CAPABILITY`, ...). */
  readonly reasonCode: string;
  readonly capability?: string;
  /** For a `DEPENDENCY` conflict, the component whose claim declares the dependency. */
  readonly componentCoordinates?: string;
  readonly message: string;
};

/** One reason the trust policy excluded a catalog entry the match considered. */
export type StudioTrustRejection = {
  readonly coordinates: string;
  /** The rejection variant, for example `VendorNotTrusted`. */
  readonly reasonCode: string;
  readonly message: string;
};

/** Why a read model has no value: a stable code and a message naming what changed or is missing. */
export type StudioAbsentReason = {
  readonly code:
    | "COMPILE_REQUIRED"
    | "COMPILE_STALE"
    | "COMPILE_RECORD_UNAVAILABLE"
    | "COMPILE_RECORD_INCONSISTENT"
    | "NOT_SIGNED"
    | "TRUST_KEYS_UNAVAILABLE"
    | (string & {});
  readonly message: string;
};

/** Which compile a compile-derived value came from. */
export type StudioCompileProvenance = {
  readonly sourceRevision: number;
  readonly contractHash: string;
  readonly compiledAt: string;
};

/** The comparison of two compiled contracts, as Fabric's `ContractDiffer` computes it. Every key list is sorted. */
export type StudioContractDiff = {
  readonly leftCanonicalHash: string;
  readonly rightCanonicalHash: string;
  readonly canonicalHashChanged: boolean;
  readonly contractIdChanged: boolean;
  readonly addedSelections: readonly string[];
  readonly removedSelections: readonly string[];
  readonly changedSelections: readonly string[];
  readonly addedDeploymentEntries: readonly string[];
  readonly removedDeploymentEntries: readonly string[];
  readonly changedDeploymentShapes: readonly {
    readonly key: string;
    readonly fromShape: string;
    readonly toShape: string;
    readonly fromPorts: readonly string[];
    readonly toPorts: readonly string[];
  }[];
  readonly leftSubstrateProfileHash?: string;
  readonly rightSubstrateProfileHash?: string;
  readonly substrateProfileHashChanged: boolean;
  readonly ports?: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly changed: readonly string[];
  };
};

/** `GET .../sessions/{sessionId}/contract-diff`: the base record, and the current one or the one at `revision`. */
export type ContractDiffRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly sessionId: string;
  readonly baseRevision: number;
  readonly revision?: number;
  /** The policy Studio would compile with now; Fabric hashes it, Studio never does. */
  readonly deploymentPolicy?: DeploymentPolicyDraft;
};

/** The contract-diff response; when `available` is false, `absentReason` says why and there is no `diff`. */
export type ContractDiffResponse = {
  readonly available: boolean;
  readonly absentReason?: StudioAbsentReason;
  readonly base?: StudioCompileProvenance;
  readonly target?: StudioCompileProvenance;
  readonly historical: boolean;
  readonly diff?: StudioContractDiff;
  readonly diagnosticArtifacts: readonly StudioExportArtifact[];
};

/** A view's id on Fabric's route (LLD-fabric-studio-api, StudioViewProjection). */
export type StudioViewId = "flow" | "data" | "topology" | "runtime";

/**
 * One section of a view projection: Fabric's items, or why there are none. `items` is non-empty exactly when
 * `available` is true; a section with nothing to show is never an empty list.
 */
export type StudioViewSection<T> = {
  readonly available: boolean;
  readonly absentReason?: StudioAbsentReason;
  /** The compile record a compile-derived section was read from. */
  readonly provenance?: StudioCompileProvenance;
  readonly items: readonly T[];
};

/** Every view item names the DCP field it was read from. */
type Sourced = { readonly source: string };

export type StudioExternalOwner = Sourced & {
  readonly boundaryNodeId: string; readonly owner: string; readonly dependency: string; readonly neededByNodeId: string;
};
export type StudioExternalProtocolOffer = Sourced & { readonly nodeId: string; readonly capability: string; readonly protocol: string };
export type StudioOwnedState = Sourced & {
  readonly nodeId: string; readonly concern: string; readonly resource: string; readonly description: string; readonly sensitivity: string;
};
export type StudioOwnedDecision = Sourced & {
  readonly nodeId: string; readonly concern: string; readonly decision: string; readonly description: string; readonly authority: string;
};
export type StudioArtifactRef = { readonly path: string; readonly mediaType: string; readonly sha256: string };
export type StudioOperation = Sourced & {
  readonly nodeId: string; readonly capability: string; readonly operation: string; readonly summary?: string;
  readonly requestSchema: StudioArtifactRef; readonly responseSchema: StudioArtifactRef;
};
export type StudioDataMapping = Sourced & {
  readonly childContractId: string; readonly providerNodeId?: string;
  readonly inbound: Readonly<Record<string, string>>; readonly outbound: Readonly<Record<string, string>>;
};
export type StudioTransport = Sourced & {
  readonly childContractId: string; readonly providerNodeId?: string; readonly kind: string;
  readonly details: Readonly<Record<string, unknown>>;
};
/**
 * A declared monitoring or telemetry port as DCP holds it (HLD-C2 A.9). A member the claim did not write is absent,
 * never defaulted; a valid claim writes every member A.9 requires, and `healthEndpoints` is optional.
 */
export type StudioMonitoring = Sourced & {
  readonly nodeId: string; readonly required?: boolean; readonly healthEndpoints?: readonly string[];
  readonly readinessRequired?: boolean; readonly livenessRequired?: boolean; readonly notes?: string;
};
export type StudioTelemetry = Sourced & {
  readonly nodeId: string; readonly required?: boolean; readonly signals?: readonly string[];
  readonly correlationIdRequired?: boolean; readonly notes?: string;
};

/** `GET .../views/{view}?sessionId`: only the requested view's sections are present. */
export type ViewProjectionRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly sessionId: string;
  readonly view: StudioViewId;
  /** The policy Studio would compile with now; Fabric hashes it, Studio never does. */
  readonly deploymentPolicy?: DeploymentPolicyDraft;
};

export type ViewProjectionResponse = {
  readonly view: StudioViewId;
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly externalOwners?: StudioViewSection<StudioExternalOwner>;
  readonly externalProtocolOffers?: StudioViewSection<StudioExternalProtocolOffer>;
  readonly ownedState?: StudioViewSection<StudioOwnedState>;
  readonly ownedDecisions?: StudioViewSection<StudioOwnedDecision>;
  readonly operations?: StudioViewSection<StudioOperation>;
  readonly dataMappings?: StudioViewSection<StudioDataMapping>;
  readonly transports?: StudioViewSection<StudioTransport>;
  readonly monitoring?: StudioViewSection<StudioMonitoring>;
  readonly telemetry?: StudioViewSection<StudioTelemetry>;
  readonly verification?: VerifyContractResponse;
  readonly diagnostics: readonly StudioDcpDiagnostic[];
  readonly diagnosticArtifacts: readonly StudioExportArtifact[];
};

/** A deployment target, as the CLI's `--target` file holds it (LLD-fabric-studio-api, Deployment Environments). */
export type StudioDeploymentTarget = {
  readonly kind?: string;
  readonly environment?: string;
  readonly region?: string;
  readonly endpoint?: string;
  readonly options: Readonly<Record<string, string>>;
  /** Credential names or labels, never values. */
  readonly credentialRefs: readonly string[];
};

/** The identity-provider binding settings: every reference a `secret://` or `config://` URI, never a value. */
export type StudioDeploymentIdentity = {
  readonly issuer?: string;
  readonly audiences: Readonly<Record<string, string>>;
  readonly tenantClaim?: string;
  readonly rolesClaim?: string;
  readonly permissionsClaim?: string;
  readonly tokenEndpointRef?: string;
  readonly verificationKeysRef?: string;
  readonly clientCredentialsRef?: string;
  readonly serviceCredentials: Readonly<Record<string, string>>;
};

/** The API catalog's documentation settings; `visibility` is a documentation-visibility file's text. */
export type StudioDeploymentDocumentation = {
  readonly visibilityDefault?: string;
  readonly visibility?: string;
  readonly observationIntervalMs?: number;
  readonly observationMaxBackoffMs?: number;
};

/** The runtime-binding inputs, with the meaning the `fabric runtime-bindings` flags give them. */
export type StudioDeploymentBindings = {
  readonly serviceBaseUrls: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly telemetryNamespace?: string;
  readonly identity?: StudioDeploymentIdentity;
  readonly componentConfig: readonly string[];
  readonly documentation?: StudioDeploymentDocumentation;
  readonly disabledBindings: readonly string[];
};

/**
 * A tenant's deployment environment. `revision` grows by one with each save and is for concurrent editing only (a
 * re-created environment starts at 1 again); `contentSha256` is Fabric's hash of its target and bindings.
 */
export type StudioDeploymentEnvironment = {
  readonly name: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly contentSha256: string;
  readonly target: StudioDeploymentTarget;
  readonly bindings: StudioDeploymentBindings;
};

/** `PUT .../deployment-environments/{name}`: 0 creates, the stored revision replaces. */
export type SaveDeploymentEnvironmentRequest = {
  readonly tenantId?: string;
  readonly name: string;
  readonly expectedRevision: number;
  readonly target: StudioDeploymentTarget;
  readonly bindings: StudioDeploymentBindings;
};

/** `DELETE .../deployment-environments/{name}?expectedRevision`. */
export type DeleteDeploymentEnvironmentRequest = {
  readonly tenantId?: string;
  readonly name: string;
  readonly expectedRevision: number;
};

/** One problem of a refused environment save, by field path. */
export type StudioEnvironmentProblem = { readonly path: string; readonly message: string };

/** `GET .../sessions/{sessionId}/emit-plan?environment`. */
export type EmitPlanRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly sessionId: string;
  readonly environment: string;
  /** The policy Studio would compile with now; Fabric hashes it, Studio never does. */
  readonly deploymentPolicy?: DeploymentPolicyDraft;
};

/** One emitted artifact, with this preview run's hash. */
export type EmitPlanArtifact = { readonly path: string; readonly kind: string; readonly sha256: string };

/** One secret the deployment needs, by name only: never a value. */
export type EmitPlanSecretRequest = { readonly name: string; readonly boundComponentId: string; readonly targetStoreHint: string };

/** One generated runtime binding, by reference names only. */
export type EmitPlanBinding = {
  readonly bindingId: string;
  readonly contractId: string;
  /** Null for the root binding. */
  readonly capability?: string;
  readonly providerComponent?: string;
  /** The provider's draft node; absent for the root binding or a provider outside the draft. */
  readonly providerNodeId?: string;
  readonly deploymentKind?: string;
  readonly baseUrl?: string;
  readonly enabled: boolean;
  readonly timeoutMs?: number;
  readonly auditEnabled: boolean;
  readonly telemetryNamespace?: string;
  readonly secretRefNames: readonly string[];
  readonly configRefNames: readonly string[];
};

/** The emit-plan preview (LLD-fabric-studio-api, StudioEmitPlanPreview); available exactly when it has no absent reason. */
export type EmitPlanResponse = {
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly environment: string;
  readonly environmentRevision?: number;
  /** The `contentSha256` of the environment the preview read; Studio pins the answer to it. */
  readonly environmentSha256?: string;
  /** The compile record read, current or not; absent before any compile. */
  readonly provenance?: StudioCompileProvenance;
  readonly available: boolean;
  readonly absentReason?: StudioAbsentReason;
  readonly targetKind?: string;
  readonly artifacts: readonly EmitPlanArtifact[];
  readonly requiredSecrets: readonly EmitPlanSecretRequest[];
  readonly runtimeBindings: readonly EmitPlanBinding[];
  readonly bindingsSha256?: string;
  readonly emitManifestSha256?: string;
  readonly diagnosticArtifacts: readonly StudioExportArtifact[];
};

/** An overlay's id on Fabric's route (LLD-fabric-studio-api, StudioOverlayAnnotations). */
export type StudioOverlayId = "security" | "performance" | "resilience" | "compliance";

/** An overlay annotation on one `/dynamic-dcp` node; provenance is present exactly on compile-derived ones. */
export type StudioOverlayAnnotation = {
  readonly elementId: string;
  /** A `/dynamic-dcp` node, or an edge by its id `RELATIONSHIP:from->to` (P2e, Resilience & Faults' propagation paths). */
  readonly elementKind: "NODE" | "EDGE";
  readonly kind: string;
  readonly severity: "INFO" | "WARNING" | "ERROR";
  readonly label: string;
  readonly detail: string;
  readonly source: string;
  readonly sourceRevision?: number;
  readonly contractHash?: string;
};

/** An overlay-level fact that belongs to no element, such as the decision audit. */
export type StudioOverlayFinding = {
  readonly label: string;
  readonly value: string;
  readonly source: string;
  readonly sourceRevision?: number;
  readonly contractHash?: string;
};

/** A compile-derived source the overlay left out because the record is not current or consistent. */
export type StudioOverlayStaleSource = {
  readonly source: string;
  readonly sourceRevision?: number;
  readonly contractHash?: string;
  readonly reason: StudioAbsentReason;
};

/** `GET .../overlays/{overlay}?sessionId&view`. */
export type OverlayAnnotationsRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly sessionId: string;
  readonly overlay: StudioOverlayId;
  readonly view: StudioViewId;
  /** The policy Studio would compile with now; Fabric hashes it, Studio never does. */
  readonly deploymentPolicy?: DeploymentPolicyDraft;
};

/** An overlay's answer: available exactly when it has annotations or findings; otherwise `absentReason` says why. */
export type OverlayAnnotationsResponse = {
  readonly overlay: StudioOverlayId;
  readonly view: StudioViewId;
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly sessionId: string;
  readonly revision: number;
  /**
   * The compile record Fabric read, for an overlay that reads the compile (performance, compliance) when the session
   * has one, current or not, even when nothing came of it; never set for security, which reads claims only.
   */
  readonly provenance?: StudioCompileProvenance;
  readonly available: boolean;
  readonly absentReason?: StudioAbsentReason;
  readonly annotations: readonly StudioOverlayAnnotation[];
  readonly findings: readonly StudioOverlayFinding[];
  readonly staleSources: readonly StudioOverlayStaleSource[];
  readonly diagnostics: readonly StudioDcpDiagnostic[];
  readonly diagnosticArtifacts: readonly StudioExportArtifact[];
};

/** `POST .../sessions/{sessionId}/verify`: the current record by default, or a past one by revision or contract hash. */
export type VerifyContractRequest = {
  readonly tenantId?: string;
  readonly assemblyId?: string;
  readonly sessionId: string;
  readonly revision?: number;
  readonly contractHash?: string;
  /** The policy Studio would compile with now; Fabric hashes it, Studio never does. */
  readonly deploymentPolicy?: DeploymentPolicyDraft;
};

/** The verify response; an unsigned compile is `NOT_SIGNED`, never verified. */
export type VerifyContractResponse = {
  readonly available: boolean;
  readonly absentReason?: StudioAbsentReason;
  readonly provenance?: StudioCompileProvenance;
  readonly historical: boolean;
  readonly signature?: {
    readonly ok: boolean;
    /** `Ok`, `KeyNotPinned`, `SignatureInvalid` or `HashMismatch`. */
    readonly result: string;
    readonly detail: string;
  };
  readonly catalogDrift?: {
    readonly clean: boolean;
    readonly hashDrifts: readonly { readonly coordinates: string; readonly detail: string }[];
    readonly missingFromCatalog: readonly { readonly coordinates: string; readonly detail: string }[];
  };
  readonly overallOk?: boolean;
  readonly diagnosticArtifacts: readonly StudioExportArtifact[];
};

export type StudioToolCallRequest = {
  readonly callId?: string;
  readonly toolName?: string;
  readonly arguments?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
};

export type StudioToolCallResult = {
  readonly success: boolean;
  readonly output: Record<string, unknown>;
  readonly errorCode?: string;
  readonly errorMessage?: string;
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
      /** The record this compile appended to the session; Studio pins the result to its hashes. */
      readonly compileRecord: StudioCompileRecord;
      readonly supportArtifacts?: readonly StudioExportArtifact[];
      readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
    }
  | {
      readonly status: "STALE_REVISION";
      readonly expectedRevision: number;
      readonly receivedRevision: number;
      readonly supportArtifacts?: readonly StudioExportArtifact[];
      readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
    }
  | {
      readonly status: "INVALID";
      readonly reason: string;
      readonly details: string;
      /** The typed causes of a `NO_MATCH`, from the same presenter as `details`; empty for any other reason. */
      readonly reasons: readonly StudioMatchFailureReason[];
      readonly trustRejections: readonly StudioTrustRejection[];
      readonly supportArtifacts?: readonly StudioExportArtifact[];
      readonly diagnosticArtifacts?: readonly StudioExportArtifact[];
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
  readonly listCatalogVisuals: (request?: ListCatalogVisualsRequest) => Promise<ListCatalogVisualsResponse>;
  readonly listStudioFiles?: (request?: ListStudioFilesRequest) => Promise<readonly StudioFileRecord[]>;
  readonly listSessionHistory?: (request?: ListStudioSessionHistoryRequest) => Promise<readonly StudioSessionHistoryItem[]>;
  readonly admitCatalogArtifacts?: (request: AdmitCatalogArtifactsRequest) => Promise<AdmitCatalogArtifactsResponse>;
  readonly removeCatalogEntry?: (request: RemoveCatalogEntryRequest) => Promise<RemoveCatalogEntryResponse>;
  readonly saveCatalogSnapshot?: (request?: SaveCatalogSnapshotRequest) => Promise<StudioCatalogSnapshot>;
  readonly loadCatalogSnapshot?: (request: LoadCatalogSnapshotRequest) => Promise<ListCatalogVisualsResponse>;
  readonly extractNeeds?: (request: ExtractNeedsRequest) => Promise<ExtractNeedsResponse>;
  readonly listAssemblies?: (request?: ListAssembliesRequest) => Promise<ListAssembliesResponse>;
  readonly createAssembly?: (request: CreateAssemblyRequest) => Promise<StudioAssemblySummary>;
  readonly saveDraft?: (request: SaveDraftRequest) => Promise<SaveDraftResponse>;
  readonly saveAssemblySnapshot?: (request?: SaveAssemblySnapshotRequest) => Promise<StudioAssemblySnapshot>;
  readonly loadAssemblySnapshot?: (request: LoadAssemblySnapshotRequest) => Promise<StudioAssemblySnapshot>;
  readonly loadLayoutState?: (request?: LoadLayoutStateRequest) => Promise<StudioLayoutState>;
  readonly saveLayoutState?: (request: SaveLayoutStateRequest) => Promise<StudioLayoutState>;
  readonly loadDynamicDcpProjection?: (request?: DynamicDcpProjectionRequest) => Promise<DynamicDcpProjectionResponse>;
  readonly loadReplacementCandidates?: (request: ReplacementCandidatesRequest) => Promise<ReplacementCandidatesResponse>;
  readonly loadConnectionCandidates?: (request: ConnectionCandidatesRequest) => Promise<ConnectionCandidatesResponse>;
  readonly loadCompositionView: (request: LoadCompositionViewRequest) => Promise<LoadCompositionViewResponse>;
  readonly createDraftComposition: (request: CreateDraftCompositionRequest) => Promise<CreateDraftCompositionResponse>;
  readonly getDraftSession: (request: string | ({
    readonly tenantId?: string;
    readonly assemblyId?: string;
    readonly sessionId: string;
  })) => Promise<StudioDraftSession>;
  readonly heartbeatCollaborator?: (request: HeartbeatCollaboratorRequest) => Promise<StudioDraftSession>;
  readonly sessionEventsUrl?: (request: SessionEventsRequest) => string;
  readonly applyIntent: (intent: StudioIntent) => Promise<IntentResponse>;
  readonly compileCandidate: (request: CompileDraftCandidateRequest) => Promise<CompileDraftCandidateResponse>;
  readonly callStudioTool?: (request: StudioToolCallRequest & { readonly toolName: string }) => Promise<StudioToolCallResult>;
  readonly converseAuthoring?: (request: AuthoringConverseRequest) => Promise<AuthoringConverseResponse>;
  readonly resolveDeployment?: (request: ResolveDeploymentRequest) => Promise<ResolveDeploymentResponse>;
  /** Compares two compile records of a session (LLD-fabric-studio-api, Contract diff and verification). */
  readonly loadContractDiff?: (request: ContractDiffRequest) => Promise<ContractDiffResponse>;
  /** Verifies a compile record's signed envelope with Fabric's configured trust keys. */
  readonly verifyContract?: (request: VerifyContractRequest) => Promise<VerifyContractResponse>;
  /** One workbench view's typed data (LLD-fabric-studio-api, StudioViewProjection). */
  readonly loadView?: (request: ViewProjectionRequest) => Promise<ViewProjectionResponse>;
  /** The tenant's deployment environments, by name (LLD-fabric-studio-api, Deployment Environments). */
  readonly listEnvironments?: (request: { readonly tenantId?: string }) => Promise<readonly StudioDeploymentEnvironment[]>;
  /** Creates or replaces one; a refusal is a `StudioApiError` with Fabric's problems or current revision. */
  readonly saveEnvironment?: (request: SaveDeploymentEnvironmentRequest) => Promise<StudioDeploymentEnvironment>;
  /** Deletes one, revision-checked. */
  readonly deleteEnvironment?: (request: DeleteDeploymentEnvironmentRequest) => Promise<void>;
  /** The emit-plan preview of the session's current compile for one environment (StudioEmitPlanPreview). */
  readonly loadEmitPlan?: (request: EmitPlanRequest) => Promise<EmitPlanResponse>;
  /** One perspective overlay's annotations and findings (LLD-fabric-studio-api, StudioOverlayAnnotations). */
  readonly loadOverlay?: (request: OverlayAnnotationsRequest) => Promise<OverlayAnnotationsResponse>;
  readonly getVisualAsset: (assetId: string) => Promise<StudioVisualAsset>;
}

export * from "./httpClient.js";
export * from "./mockStudioApi.js";
