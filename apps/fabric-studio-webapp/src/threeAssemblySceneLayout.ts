import type { DynamicDcpProjectionResponse, DynamicDcpNode, StudioPortConnectionEdge } from "@unfurl/fabric-validation-client";

// Layout output for one module slot. The scene's rebuildDynamicModules
// loop iterates over these and calls createModule + addModulePorts with
// the given position / scale / accent — geometry stays in
// ThreeAssemblyScene; this module is pure data.
export type LayoutEntry = {
  readonly nodeId: string;
  readonly label: string;
  readonly catalogEntryId: string;
  readonly tier: 0 | 1 | 2;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly accentColor: number;
  readonly portColor: number;
};

// Tier vertical positions. TOP = consumers (agents), MIDDLE = providers
// that are consumed by peers, BOTTOM = isolated nodes (whose needs are
// all external, or whose offers no peer consumes). Z stays constant so
// every module sits on the same depth plane in front of the substrate.
const TIER_Y = { 0: 1.2, 1: -0.4, 2: -1.6 } as const;
const TIER_Z = 0.6;

const TIER_X_MIN = -3.0;
const TIER_X_MAX = 3.0;

const DEFAULT_SCALE: readonly [number, number, number] = [1.2, 0.9, 0.95];

// Accent palette by tier. Purple = agents (top), green = providing
// substrates (middle), blue = isolated / adapter layer (bottom).
const TIER_ACCENTS = {
  0: { accent: 0x7c3aed, port: 0x7c3aed },
  1: { accent: 0x16a34a, port: 0x16a34a },
  2: { accent: 0x2563eb, port: 0x2563eb }
} as const;

/**
 * Pure layout function. Given a {@link DynamicDcpProjectionResponse}
 * and optionally a set of catalog entry ids that are actually in the
 * draft, filter to CHILD-level nodes whose catalogEntryId is in the
 * draft set, classify each into a tier based on its role in the
 * projection's port connections, and assign deterministic positions
 * left-to-right within each tier. Same input ⇒ byte-identical output.
 *
 * <p>{@code draftCatalogEntryIds === undefined} means "no filter" —
 * every CHILD node renders (useful for catalog-browsing previews).
 * An empty set means an empty draft and produces zero modules so the
 * substrate plate alone is visible while the panel's empty-assembly
 * overlay reads correctly.
 */
export function layoutNodes(
  projection: DynamicDcpProjectionResponse | undefined,
  draftCatalogEntryIds?: ReadonlySet<string>
): readonly LayoutEntry[] {
  if (!projection || !projection.nodes || projection.nodes.length === 0) {
    return [];
  }
  const connections = projection.connections ?? [];
  let childNodes = projection.nodes.filter(node => node.level === "CHILD");
  if (draftCatalogEntryIds !== undefined) {
    childNodes = childNodes.filter(node =>
      node.catalogEntryId !== undefined
      && draftCatalogEntryIds.has(node.catalogEntryId));
  }
  if (childNodes.length === 0) {
    return [];
  }

  // Index source / target nodeIds for fast tier classification.
  const sources = new Set<string>();
  const targets = new Set<string>();
  for (const edge of connections) {
    sources.add(edge.sourceNodeId);
    targets.add(edge.targetNodeId);
  }

  const tiered: { tier: 0 | 1 | 2; node: DynamicDcpNode }[] = childNodes
    .map(node => ({ tier: tierFor(node, sources, targets), node }))
    // Stable ordering within a tier so layouts are deterministic
    // across runs and the test fixture matches.
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const aId = a.node.catalogEntryId ?? a.node.nodeId;
      const bId = b.node.catalogEntryId ?? b.node.nodeId;
      return aId.localeCompare(bId);
    });

  // Bucket into tiers so we can space evenly across each tier's x range.
  const byTier: Record<0 | 1 | 2, DynamicDcpNode[]> = { 0: [], 1: [], 2: [] };
  for (const { tier, node } of tiered) {
    byTier[tier].push(node);
  }

  const out: LayoutEntry[] = [];
  for (const tierKey of [0, 1, 2] as const) {
    const tierNodes = byTier[tierKey];
    if (tierNodes.length === 0) continue;
    const y = TIER_Y[tierKey];
    const { accent, port } = TIER_ACCENTS[tierKey];
    const xSpan = TIER_X_MAX - TIER_X_MIN;
    const step = tierNodes.length === 1 ? 0 : xSpan / (tierNodes.length - 1);
    for (let i = 0; i < tierNodes.length; i++) {
      const node = tierNodes[i];
      if (!node) continue;
      const x = tierNodes.length === 1
        ? (TIER_X_MIN + TIER_X_MAX) / 2
        : TIER_X_MIN + step * i;
      out.push({
        nodeId: node.nodeId,
        label: node.label,
        catalogEntryId: node.catalogEntryId ?? "",
        tier: tierKey,
        position: [x, y, TIER_Z] as const,
        scale: DEFAULT_SCALE,
        accentColor: accent,
        portColor: port
      });
    }
  }
  return out;
}

/**
 * Classify a node into one of the three tiers based on its role in the
 * resolved port-connection graph:
 * - Tier 0 (top): consumes a peer but is not consumed by one — pure
 *   consumer (agents like sample-chatbot-agent).
 * - Tier 1 (middle): provides something that a peer consumes —
 *   substrates that other components depend on.
 * - Tier 2 (bottom): neither consumes nor is consumed by a peer —
 *   isolated components whose needs are all external (host-owned /
 *   fabric-owned) or whose offers no peer consumes today (e.g. an
 *   adapter, an unused substrate).
 *
 * Nodes that BOTH consume and are consumed (a substrate that needs
 * another substrate) classify as tier 1 — they belong with the
 * providers visually.
 */
function tierFor(
  node: DynamicDcpNode,
  sources: ReadonlySet<string>,
  targets: ReadonlySet<string>
): 0 | 1 | 2 {
  const isSource = sources.has(node.nodeId);
  const isTarget = targets.has(node.nodeId);
  if (isTarget && !isSource) return 0;
  if (isSource) return 1;
  return 2;
}

/**
 * Look up a layout entry's position by nodeId — used by the pipe
 * rebuild to figure out where each end of a connection edge anchors.
 * Returns {@code undefined} if the node didn't make it into the layout
 * (e.g. PARENT / ASSEMBLY nodes; those don't render as modules).
 */
export function positionForNodeId(
  layout: readonly LayoutEntry[],
  nodeId: string
): readonly [number, number, number] | undefined {
  for (const entry of layout) {
    if (entry.nodeId === nodeId) {
      return entry.position;
    }
  }
  return undefined;
}

export type PipeEndpoint = {
  readonly nodeId: string;
  readonly portId: string;
  readonly position: readonly [number, number, number];
};

export type PipeLayout = {
  readonly id: string;
  readonly source: PipeEndpoint;
  readonly target: PipeEndpoint;
  readonly capability: string;
};

/**
 * Compute pipe endpoints by looking up each edge's source and target
 * node positions in the {@link LayoutEntry} array. Pipes whose
 * endpoints aren't in the layout (e.g. an edge whose source got
 * filtered out somehow) are silently skipped — the scene will just
 * draw fewer pipes than the projection declared.
 */
export function layoutPipes(
  layout: readonly LayoutEntry[],
  connections: readonly StudioPortConnectionEdge[] | undefined
): readonly PipeLayout[] {
  if (!connections || connections.length === 0) {
    return [];
  }
  const out: PipeLayout[] = [];
  for (const edge of connections) {
    const sourcePos = positionForNodeId(layout, edge.sourceNodeId);
    const targetPos = positionForNodeId(layout, edge.targetNodeId);
    if (!sourcePos || !targetPos) {
      continue;
    }
    out.push({
      id: `pipe:${edge.sourceNodeId}:${edge.sourcePortId}->${edge.targetNodeId}:${edge.targetPortId}`,
      source: { nodeId: edge.sourceNodeId, portId: edge.sourcePortId, position: sourcePos },
      target: { nodeId: edge.targetNodeId, portId: edge.targetPortId, position: targetPos },
      capability: edge.capability
    });
  }
  return out;
}
