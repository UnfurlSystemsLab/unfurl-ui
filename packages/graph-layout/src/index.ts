export type GraphNode = {
  readonly id: string;
  readonly label: string;
  readonly kind: "COMPONENT" | "PORT" | "SUBSTRATE" | "WARNING";
};

export type GraphEdge = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: "OWNS_PORT" | "REQUIRES_SUBSTRATE" | "HAS_WARNING";
};

export type GraphLayout = {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
};

export type PositionedGraphNode = GraphNode & {
  readonly x: number;
  readonly y: number;
};

export type PositionedGraphLayout = {
  readonly nodes: readonly PositionedGraphNode[];
  readonly edges: readonly GraphEdge[];
};

export function gridLayout(graph: GraphLayout, options: { readonly columns?: number; readonly gap?: number } = {}): PositionedGraphLayout {
  const columns = options.columns ?? 4;
  const gap = options.gap ?? 160;
  return {
    nodes: graph.nodes.map((node, index) => ({
      ...node,
      x: (index % columns) * gap,
      y: Math.floor(index / columns) * gap
    })),
    edges: graph.edges
  };
}
