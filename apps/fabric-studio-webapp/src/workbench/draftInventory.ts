import {
  DEFAULT_STUDIO_ASSEMBLY_ID,
  DEFAULT_STUDIO_TENANT_ID,
  type AuthoringProposedIntent,
  type DynamicDcpProjectionResponse,
  type StudioAssemblySnapshot,
  type StudioFileRecord,
  type StudioReplacementCandidate
} from "@unfurl/fabric-validation-client";
import type { VisualCatalogEntry } from "@unfurl/visual-manifest";
import type { DraftWorkspaceState } from "../draftWorkspace.js";
import type { SemanticDcpSceneProjection } from "../ThreeAssemblyScene.js";

/**
 * Draft-inventory helpers moved from the retired `DraftWorkspacePanel` (LLD-studio-viewpoints-and-perspectives §7: reuse
 * rather than rewrite). Fabric is authoritative for the draft; the inventory is a browser convenience that keeps the
 * operator's view of accepted components across route remounts, rebuilt from Fabric's intent log when a snapshot loads.
 */

/** One component accepted into the draft. */
export type DraftComponentItem = {
  readonly catalogEntryId: string;
  readonly label: string;
  readonly status: "ADDED" | "VALIDATED";
};

/** A Fabric replacement candidate, as the inspector lists it; Fabric's allow/block decision is kept unchanged. */
export type ReplacementCandidate = {
  readonly catalogEntryId: string;
  readonly label: string;
  readonly owner: string;
  readonly shape: string;
  readonly status: "ALLOWED" | "BLOCKED";
  readonly reason: string;
};

/**
 * Projector: narrows Fabric's dynamic projection to the draft inventory for display. Fabric may return a broader,
 * catalog-derived projection, but the workbench shows only components that are in the governed draft; the parent and
 * assembly context is kept so the DCP frame stays navigable.
 */
export function filterProjectionForDraftDisplay(
  projection: DynamicDcpProjectionResponse | undefined,
  draftComponents: readonly Pick<DraftComponentItem, "catalogEntryId">[] | undefined
): DynamicDcpProjectionResponse | undefined {
  if (!projection || draftComponents === undefined) {
    return projection;
  }
  const draftCatalogEntryIds = new Set(draftComponents.map(component => component.catalogEntryId));
  const keptNodeIds = new Set<string>();
  const nodes = projection.nodes.filter(node => {
    const keep = node.level !== "CHILD"
      || (node.catalogEntryId !== undefined && draftCatalogEntryIds.has(node.catalogEntryId));
    if (keep) keptNodeIds.add(node.nodeId);
    return keep;
  });
  const connections = (projection.connections ?? []).filter(edge =>
    endpointVisibleInDraft(edge.sourceNodeId, keptNodeIds) && endpointVisibleInDraft(edge.targetNodeId, keptNodeIds));
  const usedSubstratePortIds = new Set(
    connections.flatMap(edge => [
      isSubstrateEndpoint(edge.sourceNodeId) ? edge.sourcePortId : undefined,
      isSubstrateEndpoint(edge.targetNodeId) ? edge.targetPortId : undefined
    ]).filter((portId): portId is string => typeof portId === "string" && portId.length > 0)
  );
  return {
    ...projection,
    nodes,
    edges: (projection.edges ?? []).filter(edge => keptNodeIds.has(edge.fromNodeId) && keptNodeIds.has(edge.toNodeId)),
    connections,
    substratePorts: (projection.substratePorts ?? []).filter(port => usedSubstratePortIds.has(port.portId)),
    warnings: projection.warnings
  };
}

/** Substrate pseudo-nodes are visible pipe endpoints; component endpoints must survive the draft filter. */
function endpointVisibleInDraft(nodeId: string, keptNodeIds: ReadonlySet<string>): boolean {
  return isSubstrateEndpoint(nodeId) || keptNodeIds.has(nodeId);
}

/** Fabric's runtime substrate pseudo-node ids in connection edges. */
export function isSubstrateEndpoint(nodeId: string): boolean {
  return nodeId === "substrate" || nodeId === "substrate:runtime";
}

/**
 * Projector: replays the subset of authoring-proposal intents Fabric accepted into the inventory. Rejected proposal
 * suffixes stay invisible.
 */
export function replayDraftInventoryIntents(
  components: readonly DraftComponentItem[],
  intents: readonly AuthoringProposedIntent[]
): readonly DraftComponentItem[] {
  let next = components;
  for (const intent of intents) {
    if (intent.type === "ADD_COMPONENT") {
      next = appendDraftComponentItem(next, intent.catalogEntryId);
    }
    if (intent.type === "REMOVE_COMPONENT") {
      next = removeDraftComponentItem(next, intent.catalogEntryId ?? catalogEntryIdFromComponentId(intent.componentId));
    }
    if (intent.type === "REPLACE_COMPONENT") {
      const oldCatalogEntryId = intent.oldCatalogEntryId ?? catalogEntryIdFromComponentId(intent.oldComponentId);
      const oldComponent = next.find(component => component.catalogEntryId === oldCatalogEntryId);
      next = replaceDraftComponentItem(next, oldComponent, intent.newCatalogEntryId);
    }
  }
  return next;
}

/**
 * Projector: rebuilds the inventory from Fabric's intent log after a snapshot load. Adds, removes and replaces are all
 * replayed, so a removed component is never resurrected.
 */
export function draftComponentsFromSession(session: StudioAssemblySnapshot["sessions"][number]): readonly DraftComponentItem[] {
  let components: readonly DraftComponentItem[] = [];
  for (const intent of session.intentLog ?? []) {
    if (intent.type === "ADD_COMPONENT") {
      const catalogEntryId = String(intent.payload.catalogEntryId ?? "");
      if (catalogEntryId) {
        components = [...components, { catalogEntryId, label: labelForCatalogEntry(catalogEntryId), status: "VALIDATED" as const }];
      }
    }
    if (intent.type === "REMOVE_COMPONENT") {
      const catalogEntryId = String(intent.payload.catalogEntryId ?? "");
      const componentId = String(intent.payload.componentId ?? "");
      components = removeDraftComponentItem(components, catalogEntryId || catalogEntryIdFromComponentId(componentId));
    }
    if (intent.type === "REPLACE_COMPONENT") {
      const oldCatalogEntryId = String(intent.payload.oldCatalogEntryId ?? "");
      const oldComponentId = String(intent.payload.oldComponentId ?? "");
      const newCatalogEntryId = String(intent.payload.newCatalogEntryId ?? "");
      components = removeDraftComponentItem(components, oldCatalogEntryId || catalogEntryIdFromComponentId(oldComponentId));
      if (newCatalogEntryId) {
        components = [...components, { catalogEntryId: newCatalogEntryId, label: labelForCatalogEntry(newCatalogEntryId), status: "VALIDATED" as const }];
      }
    }
  }
  return components;
}

/** Appends an accepted component. */
export function appendDraftComponentItem(components: readonly DraftComponentItem[], catalogEntryId: string): readonly DraftComponentItem[] {
  return [...components, { catalogEntryId, label: labelForCatalogEntry(catalogEntryId), status: "ADDED" }];
}

/** Removes the first matching item, so duplicate additions stay separate. */
export function removeDraftComponentItem(components: readonly DraftComponentItem[], catalogEntryId: string): readonly DraftComponentItem[] {
  let removed = false;
  return components.filter(component => {
    if (!removed && component.catalogEntryId === catalogEntryId) {
      removed = true;
      return false;
    }
    return true;
  });
}

/** Replaces one item after Fabric accepts a replacement; appends when the old item is not cached. */
export function replaceDraftComponentItem(
  components: readonly DraftComponentItem[],
  oldComponent: DraftComponentItem | undefined,
  newCatalogEntryId: string
): readonly DraftComponentItem[] {
  const replacement: DraftComponentItem = { catalogEntryId: newCatalogEntryId, label: labelForCatalogEntry(newCatalogEntryId), status: "ADDED" };
  if (!oldComponent) return [...components, replacement];
  let replaced = false;
  const next = components.map(component => {
    if (!replaced && component.catalogEntryId === oldComponent.catalogEntryId) {
      replaced = true;
      return replacement;
    }
    return component;
  });
  return replaced ? next : [...next, replacement];
}

/** A pending draft component id (`draft:<catalogEntryId>`) back to its catalog entry id. */
export function catalogEntryIdFromComponentId(componentId: string): string {
  return componentId.startsWith("draft:") ? componentId.slice("draft:".length) : componentId;
}

/** The CHILD-level projection node of a catalog entry, when Fabric has projected it. */
export function projectionNodeIdForCatalogEntry(projection: DynamicDcpProjectionResponse | undefined, catalogEntryId: string): string | undefined {
  return projection?.nodes.find(node => node.level === "CHILD" && node.catalogEntryId === catalogEntryId)?.nodeId;
}

/** The inventory item a projection node stands for. */
export function draftComponentForNodeId(
  nodeId: string,
  projection: DynamicDcpProjectionResponse | undefined,
  components: readonly DraftComponentItem[] | undefined
): DraftComponentItem | undefined {
  const catalogEntryId = projection?.nodes.find(node => node.nodeId === nodeId)?.catalogEntryId;
  return components?.find(component => component.catalogEntryId === catalogEntryId);
}

/** A readable component name from a catalog entry id, for inventory chips before Fabric projects the component. */
export function labelForCatalogEntry(catalogEntryId: string): string {
  const parts = catalogEntryId.split(":").filter(Boolean);
  const raw = (parts.length >= 3 ? parts.at(-2) : parts.at(-1)) ?? catalogEntryId;
  return raw
    .replace(/\.[^.]+$/, "")
    .split(/[-_.]+/)
    .filter(Boolean)
    .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

/** The palette label of a catalog entry; empty for none, so no identity is fabricated. */
export function paletteLabel(entry: VisualCatalogEntry | undefined): string {
  if (!entry) return "";
  return entry.catalogEntryId.split(":").slice(1).join(":") || entry.catalogEntryId;
}

/** The capability names of one port kind in a catalog entry's DCP-backed visual manifest. */
export function entryCapabilities(
  entry: VisualCatalogEntry | undefined,
  kind: "OFFER" | "DEPENDENCY" | "SUBSTRATE_DEPENDENCY" | "REFUSAL"
): readonly string[] {
  return entry?.visualManifest?.ports
    .filter(port => port.kind === kind)
    .map(port => capabilityFromMapsTo(port.mapsTo) || port.id)
    .filter(Boolean) ?? [];
}

/** Trims visual-manifest `mapsTo` prefixes to capability names. */
function capabilityFromMapsTo(mapsTo: string): string {
  return mapsTo
    .replace(/^claim\.offers\./, "")
    .replace(/^claim\.dependencies\./, "")
    .replace(/^claim\.substrateDependencies\./, "")
    .replace(/^claim\.substrate_dependencies\./, "");
}

/** The first offer port of a catalog entry, from its visual manifest only. */
export function firstOfferPortId(catalogEntryId: string, catalogEntries: readonly VisualCatalogEntry[]): string | undefined {
  return catalogEntries.find(entry => entry.catalogEntryId === catalogEntryId)?.visualManifest?.ports.find(port => port.kind === "OFFER")?.id;
}

/** Fabric's replacement candidates in the inspector's shape, with Fabric's decision unchanged. */
export function toReplacementCandidates(candidates: readonly StudioReplacementCandidate[]): readonly ReplacementCandidate[] {
  return candidates.map(candidate => ({
    catalogEntryId: candidate.catalogEntryId,
    label: candidate.label,
    owner: candidate.owner,
    shape: candidate.shape,
    status: candidate.status === "ALLOWED" ? "ALLOWED" : "BLOCKED",
    reason: candidate.reason
  }));
}

/** Whether Fabric accepted the last intent. */
export function intentAccepted(state: DraftWorkspaceState): boolean {
  return state.status === "READY" && state.lastResponse?.status === "VALID";
}

/** A projection node's label, or its id. */
export function nodeLabel(projection: DynamicDcpProjectionResponse | undefined, nodeId: string): string {
  return projection?.nodes.find(node => node.nodeId === nodeId)?.label ?? nodeId;
}

/** The small semantic projection the 3D scene's zoom controls consume. */
export function toSemanticSceneProjection(projection: DynamicDcpProjectionResponse): SemanticDcpSceneProjection {
  const root = projection.nodes.find(node => node.nodeId === projection.rootNodeId) ?? projection.nodes.find(node => node.level === "PARENT");
  const focus = projection.nodes.find(node => node.nodeId === projection.focusNodeId) ?? projection.nodes.find(node => node.level === "ASSEMBLY");
  return {
    parentLabel: root?.label ?? "Parent DCP",
    assemblyLabel: focus?.label ?? "Assembly DCP",
    childNodes: projection.nodes.filter(node => node.level === "CHILD").map(node => ({
      nodeId: node.nodeId, label: node.label, dcpType: node.dcpType, replacementAllowed: node.replacementAllowed
    }))
  };
}

/** Operator-facing copy for transport and server failures; unknown messages are kept for debugging. */
export function friendlyStudioError(message: string): string {
  if (/HTTP\s+5\d\d|Internal Server Error/i.test(message)) return "Fabric is temporarily unavailable. Retry the action.";
  if (/timed out|timeout|AbortError/i.test(message)) return "Fabric Studio request timed out. The draft session is still active; retry the action.";
  if (/socket hang up|ECONNRESET/i.test(message)) return "Fabric Studio connection dropped. The draft session is still active; retry the action.";
  if (/Failed to fetch|ECONNREFUSED|NetworkError/i.test(message)) return "Fabric cannot be reached. Check that the local Fabric service is running.";
  return message;
}

/** The selected tenant catalog file, for draft creation metadata. */
export function selectedCatalogFile(files: readonly StudioFileRecord[], selectedFileId: string): StudioFileRecord | undefined {
  return files.find(file => file.fileId === selectedFileId) ?? files[0];
}

/** A catalog file version for the catalog-version picker. */
export function catalogFileOptionLabel(file: StudioFileRecord): string {
  const version = Number.isFinite(file.version) ? `v${file.version}` : "version";
  return `${file.fileTitle || file.fileName} (${version})`;
}

/** A readable draft title from the assembly and the catalog file. */
export function draftDisplayName(assemblyId: string, catalogFile: StudioFileRecord | undefined): string {
  return `${assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID} - ${catalogFile?.fileTitle ?? "Current Catalog"}`;
}

/** Restores the inventory cache, validating each item. */
export function readDraftInventory(tenantId: string, assemblyId: string): readonly DraftComponentItem[] | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(inventoryKey(tenantId, assemblyId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { readonly components?: unknown };
    return Array.isArray(parsed.components) ? parsed.components.filter(isDraftComponentItem) : undefined;
  } catch {
    return undefined;
  }
}

/** Writes the inventory cache; a storage failure is ignored because Fabric can always reload the draft. */
export function writeDraftInventory(tenantId: string, assemblyId: string, components: readonly DraftComponentItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(inventoryKey(tenantId, assemblyId), JSON.stringify({ components }));
  } catch {
    // A browser convenience only; Fabric remains the source of truth.
  }
}

function inventoryKey(tenantId: string, assemblyId: string): string {
  return `unfurl-studio-draft-inventory:${tenantId.trim() || DEFAULT_STUDIO_TENANT_ID}:${assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID}`;
}

function isDraftComponentItem(value: unknown): value is DraftComponentItem {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<DraftComponentItem>;
  return typeof candidate.catalogEntryId === "string" && typeof candidate.label === "string"
    && (candidate.status === "ADDED" || candidate.status === "VALIDATED");
}

/** Downloads a Fabric-authored object as formatted JSON. */
export function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** A readable, path-safe file-name part. */
export function safeFilePart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "studio";
}
