import type { ReadOnlyCompositionView } from "@unfurl/fabric-scene-model";
import { gridLayout, type GraphLayout, type PositionedGraphLayout } from "@unfurl/graph-layout";

export function buildStudioGraphView(view: ReadOnlyCompositionView): GraphLayout {
  const componentNodes = view.components.map(component => ({
    id: componentNodeId(component.componentId),
    label: component.name,
    kind: "COMPONENT" as const
  }));
  const portNodes = view.ports.map(port => ({
    id: portNodeId(port.portId),
    label: `${port.capability} (${port.kind})`,
    kind: "PORT" as const
  }));
  const substrateNodes = view.substrate.map(row => ({
    id: substrateNodeId(row.port),
    label: row.port,
    kind: "SUBSTRATE" as const
  }));
  const warningNodes = view.warnings.map((warning, index) => ({
    id: warningNodeId(index),
    label: `${warning.code}: ${warning.message}`,
    kind: "WARNING" as const
  }));

  return {
    nodes: [...componentNodes, ...portNodes, ...substrateNodes, ...warningNodes],
    edges: [
      ...view.ports.map(port => ({
        id: `${componentNodeId(port.componentId)}->${portNodeId(port.portId)}`,
        from: componentNodeId(port.componentId),
        to: portNodeId(port.portId),
        kind: "OWNS_PORT" as const
      })),
      ...view.substrate.flatMap(row => substrateEdges(view, row.port)),
      ...view.warnings.map((_warning, index) => ({
        id: `${view.contractId}->${warningNodeId(index)}`,
        from: componentNodeId(view.components[0]?.componentId ?? view.contractId),
        to: warningNodeId(index),
        kind: "HAS_WARNING" as const
      }))
    ]
  };
}

export function buildPositionedStudioGraphView(view: ReadOnlyCompositionView): PositionedGraphLayout {
  return gridLayout(buildStudioGraphView(view));
}

export function renderStudioGraphText(graph: GraphLayout): string {
  return [
    "Nodes",
    ...graph.nodes.map(node => `- ${node.id} [${node.kind}] ${node.label}`),
    "",
    "Edges",
    ...graph.edges.map(edge => `- ${edge.from} -> ${edge.to} [${edge.kind}]`)
  ].join("\n");
}

function substrateEdges(view: ReadOnlyCompositionView, substratePort: string) {
  return view.ports
    .filter(port => port.kind === "SUBSTRATE_DEPENDENCY" && normalizedCapability(port.capability) === substratePort)
    .map(port => ({
      id: `${portNodeId(port.portId)}->${substrateNodeId(substratePort)}`,
      from: portNodeId(port.portId),
      to: substrateNodeId(substratePort),
      kind: "REQUIRES_SUBSTRATE" as const
    }));
}

function normalizedCapability(capability: string): string {
  return capability.startsWith("substrate:") ? capability.slice("substrate:".length) : capability;
}

function componentNodeId(componentId: string): string {
  return `component:${componentId}`;
}

function portNodeId(portId: string): string {
  return `port:${portId}`;
}

function substrateNodeId(port: string): string {
  return `substrate:${port}`;
}

function warningNodeId(index: number): string {
  return `warning:${index}`;
}
