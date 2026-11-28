import type { DynamicDcpProjectionResponse } from "@unfurl/fabric-validation-client";
import type { OverlayAnnotation } from "./overlays.js";
import type { Fact, ModelEdge, ModelNode, ViewModel } from "./projectors.js";

/**
 * Depth scoping for the 2D and Table renderers (LLD-studio-viewpoints-and-perspectives §5.6). The `SemanticZoomNavigator`
 * holds a focus path down the projection's `CONTAINS` tree, and these renderers draw the active view's model scoped to
 * that focus: the focus and its direct children, deeper nodes rolled up into the child they sit under, the boundary
 * elements the subtree reaches, and the edges mapped onto what is drawn.
 *
 * Projector (pure): the same model, projection and focus always give the same scoped model, so it is testable without a
 * DOM, and the 2D and Table renderers keep their parity at every depth.
 */

/** The navigator's focus path: projection node ids from the root down to the focus. View state only (VC §24). */
export type FocusPath = readonly string[];

/** The projection's `CONTAINS` tree: each node's parent, and the nodes it has. */
type ContainsTree = {
  readonly root: string;
  readonly parentOf: ReadonlyMap<string, string>;
  readonly nodes: ReadonlyMap<string, DynamicDcpProjectionResponse["nodes"][number]>;
};

/** The model scoped to a focus, and where each hidden element went, for rolling up overlay annotations. */
export type ScopedModel = {
  readonly model: ViewModel;
  /** The drawn element each hidden element is represented by: a node id, or a lifted edge's id. */
  readonly representedBy: ReadonlyMap<string, string>;
};

/** Where a model node goes at this focus: drawn as itself, represented by another drawn node, or out of scope. */
type Placement =
  | { readonly kind: "DRAWN" }
  | { readonly kind: "HIDDEN"; readonly by: string }
  | { readonly kind: "OUTSIDE" }
  | { readonly kind: "BOUNDARY" };

/** Node kinds that sit outside the composition: drawn only when a scoped edge reaches them (§5.6 rule 3). */
const BOUNDARY_KINDS = new Set(["SUBSTRATE_PORT", "EXTERNAL_OWNER"]);
/** Node kinds that belong to their owner component and follow it (§5.6 rule 2). */
const OWNED_KINDS = new Set(["OWNED_STATE", "OWNED_DECISION"]);

/**
 * The navigator's path against the current `CONTAINS` tree (§5.6 rule 6). The focus is the deepest segment that still
 * exists, and the path is rebuilt as that node's chain of ancestors from the root. So when Fabric's containment moves a
 * node (an adapter derived under the engine that uses it), the breadcrumb, the depth and Zoom Out follow it. The path is
 * the root alone when no segment exists or the focus does not reach the root through `CONTAINS` edges, and empty with
 * no projection.
 */
export function validFocusPath(path: FocusPath, projection: DynamicDcpProjectionResponse | undefined): FocusPath {
  if (!projection) return [];
  const tree = containsTree(projection);
  const focus = [...path].reverse().find(id => tree.nodes.has(id));
  if (focus === undefined) return [projection.rootNodeId];
  const chain: string[] = [];
  const seen = new Set<string>();
  for (let node: string | undefined = focus; node !== undefined && !seen.has(node); node = tree.parentOf.get(node)) {
    seen.add(node);
    chain.push(node);
  }
  return chain[chain.length - 1] === projection.rootNodeId ? chain.reverse() : [projection.rootNodeId];
}

/**
 * Scopes a view's model to the navigator's focus (§5.6 rules 1 to 4).
 *
 * @param model      the active view's whole model, as its projector built it.
 * @param projection the draft's projection, whose `CONTAINS` edges give the nesting.
 * @param focusId    the focused projection node.
 * @returns the scoped model, and the representative of every hidden element.
 */
export function scopeModelToFocus(model: ViewModel, projection: DynamicDcpProjectionResponse, focusId: string): ScopedModel {
  const tree = containsTree(projection);
  const placements = new Map<string, Placement>();
  for (const node of model.nodes) placements.set(node.id, placeTreeNode(node.id, tree, focusId));
  // Owned state and decisions follow their owner (rule 2), which an OWNS_* edge names.
  for (const edge of model.edges) {
    const owned = model.nodes.find(node => node.id === edge.to && OWNED_KINDS.has(node.kind));
    if (!owned) continue;
    const owner = placeTreeNode(edge.from, tree, focusId);
    placements.set(owned.id, owner.kind === "DRAWN" ? { kind: "DRAWN" } : owner.kind === "HIDDEN" ? { kind: "HIDDEN", by: owner.by } : { kind: "OUTSIDE" });
  }
  for (const node of model.nodes) {
    if (BOUNDARY_KINDS.has(node.kind)) placements.set(node.id, { kind: "BOUNDARY" });
  }

  const representedBy = new Map<string, string>();
  const endpoint = (id: string): string | undefined => {
    const placement = placements.get(id) ?? placeTreeNode(id, tree, focusId);
    if (placement.kind === "DRAWN" || placement.kind === "BOUNDARY") return id;
    if (placement.kind === "HIDDEN") return placement.by;
    return undefined;
  };

  // Edges (rule 4): kept, lifted onto representatives and merged, internal, or out of scope.
  const kept: ModelEdge[] = [];
  const lifted = new Map<string, ModelEdge[]>();
  const liftedEnds = new Map<string, { readonly from: string; readonly to: string; readonly kind: string }>();
  for (const edge of model.edges) {
    const from = endpoint(edge.from);
    const to = endpoint(edge.to);
    if (from === undefined || to === undefined) continue;
    if (from === to) {
      representedBy.set(edge.id, from);
      continue;
    }
    if (from === edge.from && to === edge.to) {
      kept.push(edge);
      continue;
    }
    const id = `LIFTED:${edge.kind}:${from}->${to}`;
    lifted.set(id, [...(lifted.get(id) ?? []), edge]);
    liftedEnds.set(id, { from, to, kind: edge.kind });
    representedBy.set(edge.id, id);
  }
  const edges: ModelEdge[] = [...kept, ...[...lifted].map(([id, group]) => liftedEdge(id, liftedEnds.get(id)!, group))];

  // Boundary elements are drawn only when a scoped edge reaches them (rule 3).
  const reached = new Set(edges.flatMap(edge => [edge.from, edge.to]));
  // Roll-up counts by representative (rule 2).
  const hiddenComponents = new Map<string, number>();
  const hiddenOwned = new Map<string, { state: number; decisions: number }>();
  for (const node of model.nodes) {
    const placement = placements.get(node.id)!;
    if (placement.kind !== "HIDDEN") continue;
    representedBy.set(node.id, placement.by);
    if (OWNED_KINDS.has(node.kind)) {
      const owned = hiddenOwned.get(placement.by) ?? { state: 0, decisions: 0 };
      if (node.kind === "OWNED_STATE") owned.state += 1; else owned.decisions += 1;
      hiddenOwned.set(placement.by, owned);
    }
  }
  // Components are counted from the projection, so a view that draws only some of them still counts what is below.
  for (const id of tree.nodes.keys()) {
    const placement = placeTreeNode(id, tree, focusId);
    if (placement.kind === "HIDDEN") hiddenComponents.set(placement.by, (hiddenComponents.get(placement.by) ?? 0) + 1);
  }

  const drawn = new Set<string>();
  const nodes: ModelNode[] = [];
  for (const node of model.nodes) {
    const placement = placements.get(node.id)!;
    if (placement.kind === "DRAWN" || (placement.kind === "BOUNDARY" && reached.has(node.id))) {
      drawn.add(node.id);
      nodes.push(withRollUp(node, hiddenComponents.get(node.id), hiddenOwned.get(node.id)));
    }
  }
  // A representative this view's model does not include is drawn from the projection, with its roll-up facts only, when
  // it stands for something hidden or an edge reaches it: the elements below it are real, so they are never lost.
  const aggregates: ModelNode[] = [];
  for (const id of new Set([...representedBy.values(), ...reached])) {
    if (drawn.has(id) || id.startsWith("LIFTED:")) continue;
    const projected = tree.nodes.get(id);
    if (!projected) continue;
    drawn.add(id);
    aggregates.push(withRollUp({ id, label: projected.label, kind: "COMPONENT", level: projected.level, facts: [] },
      hiddenComponents.get(id), hiddenOwned.get(id)));
  }
  return { model: { ...model, nodes: [...aggregates, ...nodes], edges }, representedBy };
}

/**
 * Rolls a hidden element's overlay annotations up to the element that represents it (§5.6 rule 5): each drawn element
 * that stands for annotated hidden ones gets one "N below" badge, as severe as the most severe of them, whose detail
 * lists them. Annotations on drawn elements are kept as they are.
 *
 * @param badges        the overlay annotations by element, evaluated on the unscoped model.
 * @param scoped        the scoped model and its representatives.
 * @param labelOf       the label of an element of the unscoped model, for the summary's detail.
 */
export function scopeBadges(
  badges: ReadonlyMap<string, readonly OverlayAnnotation[]>,
  scoped: ScopedModel,
  labelOf: (elementId: string) => string
): ReadonlyMap<string, readonly OverlayAnnotation[]> {
  const drawnIds = new Set([...scoped.model.nodes.map(node => node.id), ...scoped.model.edges.map(edge => edge.id)]);
  const result = new Map<string, OverlayAnnotation[]>();
  const rolled = new Map<string, { readonly annotation: OverlayAnnotation; readonly on: string }[]>();
  for (const [elementId, annotations] of badges) {
    if (drawnIds.has(elementId)) {
      result.set(elementId, [...annotations]);
      continue;
    }
    const representative = scoped.representedBy.get(elementId);
    if (representative === undefined || !drawnIds.has(representative)) continue;
    rolled.set(representative, [...(rolled.get(representative) ?? []), ...annotations.map(annotation => ({ annotation, on: labelOf(elementId) }))]);
  }
  for (const [representative, items] of rolled) {
    const summary: OverlayAnnotation = {
      elementId: representative,
      label: `${items.length} below`,
      severity: mostSevereOf(items.map(item => item.annotation.severity)),
      detail: items.map(item => `${item.annotation.label} on ${item.on}: ${item.annotation.detail}`).join("\n"),
      source: "rolled up from the elements below (LLD §5.6 rule 5)"
    };
    result.set(representative, [...(result.get(representative) ?? []), summary]);
  }
  return result;
}

/** The projection's `CONTAINS` tree. */
function containsTree(projection: DynamicDcpProjectionResponse): ContainsTree {
  const nodes = new Map(projection.nodes.map(node => [node.nodeId, node]));
  const parentOf = new Map<string, string>();
  for (const edge of projection.edges) {
    if (edge.relationship === "CONTAINS" && nodes.has(edge.fromNodeId) && nodes.has(edge.toNodeId)) parentOf.set(edge.toNodeId, edge.fromNodeId);
  }
  return { root: projection.rootNodeId, parentOf, nodes };
}

/**
 * Where a projection node goes at this focus (rule 1): the focus and its direct children are drawn, a deeper node in
 * the focus subtree is represented by the focus child above it, and anything else is outside. An id that is not a
 * projection node is outside too; boundary and owned kinds are placed by their own rules.
 */
function placeTreeNode(id: string, tree: ContainsTree, focusId: string): Placement {
  if (!tree.nodes.has(id)) return { kind: "OUTSIDE" };
  if (id === focusId || tree.parentOf.get(id) === focusId) return { kind: "DRAWN" };
  // Walk up to the focus; the last node passed before it is the focus child that represents this one.
  let child = id;
  const seen = new Set<string>([id]);
  for (let parent = tree.parentOf.get(id); parent !== undefined; parent = tree.parentOf.get(parent)) {
    if (parent === focusId) return { kind: "HIDDEN", by: child };
    if (seen.has(parent)) break; // a malformed cycle is outside, never an endless walk
    seen.add(parent);
    child = parent;
  }
  return { kind: "OUTSIDE" };
}

/** One merged lifted edge (rule 4): how many it stands for when more than one, blocked when any of them is. */
function liftedEdge(id: string, ends: { readonly from: string; readonly to: string; readonly kind: string }, group: readonly ModelEdge[]): ModelEdge {
  const blocked = group.some(edge => edge.status === "BLOCKED");
  const statuses = new Set(group.map(edge => edge.status));
  const status = blocked ? "BLOCKED" : statuses.size === 1 ? group[0]!.status : undefined;
  const label = group.length === 1 ? group[0]!.label : `${group.length} connections`;
  return {
    id, from: ends.from, to: ends.to, kind: ends.kind,
    ...(label === undefined ? {} : { label }),
    ...(status === undefined ? {} : { status }),
    ...(group.length === 1 && group[0]!.reason !== undefined ? { reason: group[0]!.reason } : {})
  };
}

/** A drawn node with its roll-up facts appended (rule 2), when it represents hidden components or owned items. */
function withRollUp(node: ModelNode, components: number | undefined, owned: { state: number; decisions: number } | undefined): ModelNode {
  const facts: Fact[] = [];
  if (components) {
    facts.push({ label: "Contains", value: `${components} component${components === 1 ? "" : "s"} below; drill in to see them`, source: "dynamic-dcp CONTAINS edges" });
  }
  if (owned) {
    const parts = [owned.state > 0 ? `${owned.state} state` : "", owned.decisions > 0 ? `${owned.decisions} decision${owned.decisions === 1 ? "" : "s"}` : ""].filter(Boolean);
    facts.push({ label: "Owned below", value: parts.join(", "), source: "views/data ownedState, ownedDecisions" });
  }
  return facts.length === 0 ? node : { ...node, facts: [...node.facts, ...facts] };
}

/** The most severe of some severities. */
function mostSevereOf(severities: readonly OverlayAnnotation["severity"][]): OverlayAnnotation["severity"] {
  return severities.includes("ERROR") ? "ERROR" : severities.includes("WARNING") ? "WARNING" : "INFO";
}
