import type { VisualCatalogEntry } from "@unfurl/visual-manifest";

export type Vector3 = readonly [number, number, number];

export type VisualComponent = {
  readonly id: string;
  readonly catalogEntryId: string;
  readonly name: string;
  readonly category: "STORAGE" | "AUTH" | "AI" | "AUDIT" | "WORKFLOW";
  readonly modelUrl?: string;
  readonly fallbackShape: "CUBE" | "SPHERE" | "CYLINDER" | "SHIELD" | "GEAR";
  readonly position: Vector3;
  readonly rotation: Vector3;
  readonly ports: readonly VisualPort[];
};

export type VisualPort = {
  readonly id: string;
  readonly capability: string;
  readonly kind: "OFFER" | "DEPENDENCY" | "SUBSTRATE_DEPENDENCY" | "REFUSAL";
  readonly anchor: string;
  readonly connectorShape: "ROUND" | "SQUARE" | "HEX" | "PIPE" | "LOCK";
  readonly status: "AVAILABLE" | "CONNECTED" | "MISSING" | "INVALID" | "INACTIVE";
};

export type StudioDraftSession = {
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly sessionId: string;
  readonly baseCatalogHash: string;
  readonly compositionMode?: "STATIC" | "DYNAMIC";
  readonly needsId?: string;
  readonly trustPolicyId?: string;
  readonly currentCandidateId?: string;
  readonly sceneRevision: number;
  readonly warnings: readonly PlanningWarning[];
  readonly collaborators?: readonly StudioCollaborator[];
  readonly intentLog?: readonly StudioIntentRecord[];
};

export type PlanningWarning = {
  readonly code: string;
  readonly message: string;
};

export type StudioCollaborator = {
  readonly collaboratorId: string;
  readonly displayName: string;
  readonly selectedSurface: string;
  readonly lastSeenAt: string;
};

export type StudioIntentRecord = {
  readonly revision: number;
  readonly collaboratorId: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly acceptedAt: string;
};

export type ReadOnlyCompositionInput = {
  readonly contractId: string;
  readonly candidateId: string;
  readonly selections: readonly CompositionSelection[];
  readonly substrateProfile: SubstrateProfileView;
  readonly visualCatalog: readonly VisualCatalogEntry[];
  readonly warnings?: readonly PlanningWarning[];
};

export type CompositionSelection = {
  readonly componentId: string;
  readonly catalogEntryId: string;
  readonly name: string;
  readonly coordinates: string;
  readonly claimHash: string;
  readonly artifactSha256: string;
  readonly capabilities: readonly string[];
  readonly dependencies: readonly string[];
  readonly refusals: readonly string[];
};

export type SubstrateProfileView = {
  readonly profileHash: string;
  readonly requiredPorts: readonly string[];
};

export type ReadOnlyCompositionView = {
  readonly contractId: string;
  readonly candidateId: string;
  readonly components: readonly ComponentTableRow[];
  readonly ports: readonly PortTableRow[];
  readonly substrate: readonly SubstrateTableRow[];
  readonly warnings: readonly PlanningWarning[];
};

export type ComponentTableRow = {
  readonly componentId: string;
  readonly catalogEntryId: string;
  readonly name: string;
  readonly coordinates: string;
  readonly claimHash: string;
  readonly artifactSha256: string;
  readonly visualStatus: "CUSTOM_MODEL" | "FALLBACK_SHAPE" | "NO_VISUAL_MANIFEST";
};

export type PortTableRow = {
  readonly componentId: string;
  readonly portId: string;
  readonly capability: string;
  readonly kind: "OFFER" | "DEPENDENCY" | "SUBSTRATE_DEPENDENCY" | "REFUSAL";
  readonly status: "AVAILABLE" | "REQUIRED" | "REFUSED";
};

export type SubstrateTableRow = {
  readonly port: string;
  readonly status: "REQUIRED";
  readonly profileHash: string;
};

export function buildReadOnlyCompositionView(input: ReadOnlyCompositionInput): ReadOnlyCompositionView {
  const visualByCatalogId = new Map(input.visualCatalog.map(entry => [entry.catalogEntryId, entry]));
  return {
    contractId: input.contractId,
    candidateId: input.candidateId,
    components: input.selections.map(selection => componentRow(selection, visualByCatalogId.get(selection.catalogEntryId))),
    ports: input.selections.flatMap(selection => portRows(selection)),
    substrate: [...input.substrateProfile.requiredPorts]
      .sort()
      .map((port: string) => ({
        port,
        status: "REQUIRED" as const,
        profileHash: input.substrateProfile.profileHash
      })),
    warnings: input.warnings ?? []
  };
}

function componentRow(selection: CompositionSelection, visual: VisualCatalogEntry | undefined): ComponentTableRow {
  return {
    componentId: selection.componentId,
    catalogEntryId: selection.catalogEntryId,
    name: selection.name,
    coordinates: selection.coordinates,
    claimHash: selection.claimHash,
    artifactSha256: selection.artifactSha256,
    visualStatus: visualStatus(visual)
  };
}

function visualStatus(visual: VisualCatalogEntry | undefined): ComponentTableRow["visualStatus"] {
  if (!visual?.visualManifest) {
    return "NO_VISUAL_MANIFEST";
  }
  return visual.visualManifest.model ? "CUSTOM_MODEL" : "FALLBACK_SHAPE";
}

function portRows(selection: CompositionSelection): readonly PortTableRow[] {
  return [
    ...selection.capabilities.map(capability => ({
      componentId: selection.componentId,
      portId: `${selection.componentId}:${capability}`,
      capability,
      kind: "OFFER" as const,
      status: "AVAILABLE" as const
    })),
    ...selection.dependencies.map(capability => ({
      componentId: selection.componentId,
      portId: `${selection.componentId}:${capability}`,
      capability,
      kind: dependencyKind(capability),
      status: "REQUIRED" as const
    })),
    ...selection.refusals.map(capability => ({
      componentId: selection.componentId,
      portId: `${selection.componentId}:${capability}`,
      capability,
      kind: "REFUSAL" as const,
      status: "REFUSED" as const
    }))
  ];
}

function dependencyKind(capability: string): "DEPENDENCY" | "SUBSTRATE_DEPENDENCY" {
  return capability.startsWith("substrate:") ? "SUBSTRATE_DEPENDENCY" : "DEPENDENCY";
}
