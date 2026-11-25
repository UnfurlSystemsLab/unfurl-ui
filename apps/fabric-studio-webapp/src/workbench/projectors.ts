import type { DynamicDcpProjectionResponse, ResolveDeploymentResponse, StudioViewpoint } from "@unfurl/fabric-validation-client";
import type { ReadOnlyCompositionView } from "@unfurl/fabric-scene-model";
import { isCurrent, staleMessage, type WorkbenchData } from "./workbenchData.js";

/**
 * Renderer-neutral view model (LLD-studio-viewpoints-and-perspectives §7): what every renderer of a view draws. Each fact
 * carries the Fabric field it came from, so the inspector can say where a value came from and shows only values Fabric
 * supplied (§8 conformance fix 1). Element ids are Fabric's `/dynamic-dcp` node and substrate-port ids, so selection and
 * overlays line up across views and renderers.
 */
export type Fact = {
  readonly label: string;
  readonly value: string;
  readonly source: string;
};

export type ModelNode = {
  readonly id: string;
  readonly label: string;
  readonly kind: "COMPONENT" | "SUBSTRATE_PORT";
  readonly level?: string;
  readonly parentId?: string;
  readonly facts: readonly Fact[];
};

export type ModelEdge = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly label?: string;
  readonly status?: string;
  readonly reason?: string;
};

export type ViewModel = {
  readonly view: StudioViewpoint;
  readonly nodes: readonly ModelNode[];
  readonly edges: readonly ModelEdge[];
  /** Section-level notes: absent or out-of-date data, never filled in. */
  readonly notes: readonly string[];
};

/** Fabric's pseudo-node ids for the substrate end of a connection. */
const SUBSTRATE_ENDPOINTS = new Set(["substrate", "substrate:runtime"]);

/**
 * Projector: Flow & Composition (§3.1) from the draft's `/dynamic-dcp` projection: components and their nesting, the
 * projection's relationships, and needs-to-offers wiring with each connection's status and reason.
 */
export function projectFlow(projection: DynamicDcpProjectionResponse): ViewModel {
  const nodes = projection.nodes.map(node => ({
    id: node.nodeId,
    label: node.label,
    kind: "COMPONENT" as const,
    level: node.level,
    ...(node.parentNodeId === undefined ? {} : { parentId: node.parentNodeId }),
    facts: componentFacts(node)
  }));
  const known = new Set(nodes.map(node => node.id));
  const edges: ModelEdge[] = projection.edges
    .filter(edge => known.has(edge.fromNodeId) && known.has(edge.toNodeId))
    .map(edge => ({
      id: `${edge.relationship}:${edge.fromNodeId}->${edge.toNodeId}`,
      from: edge.fromNodeId,
      to: edge.toNodeId,
      kind: edge.relationship
    }));
  for (const connection of projection.connections ?? []) {
    if (!known.has(connection.sourceNodeId) || !known.has(connection.targetNodeId)) continue;
    edges.push(connectionEdge(connection));
  }
  return { view: "FLOW", nodes, edges, notes: [] };
}

/**
 * Projector: Substrate & Topology (§3.3): the draft's components, the substrate ports its connections use, and the
 * component-to-substrate wiring. Deployment shapes come from the last resolution only while it is current (§4.3 rule 6);
 * an out-of-date or failed resolution is a note, never shown as the current shapes.
 */
export function projectTopology(projection: DynamicDcpProjectionResponse, data: WorkbenchData): ViewModel {
  const notes: string[] = [];
  const shapes = shapesByComponent(data, notes);
  const components: ModelNode[] = projection.nodes.map(node => {
    const shape = node.catalogEntryId === undefined ? undefined : shapes.get(node.catalogEntryId);
    return {
      id: node.nodeId,
      label: node.label,
      kind: "COMPONENT",
      level: node.level,
      ...(node.parentNodeId === undefined ? {} : { parentId: node.parentNodeId }),
      facts: [
        ...componentFacts(node),
        ...(shape === undefined ? [] : [
          { label: "Deployment shape", value: shape.shape, source: "deployment/resolve selections[].deploymentShape" },
          { label: "Required ports", value: shape.requiredPorts.join(", ") || "none", source: "deployment/resolve selections[].requiredPorts" }
        ])
      ]
    };
  });
  const ports: ModelNode[] = (projection.substratePorts ?? []).map(port => ({
    id: port.portId,
    label: port.label,
    kind: "SUBSTRATE_PORT",
    facts: [
      { label: "Capability", value: port.capability, source: "dynamic-dcp substratePorts[].capability" },
      { label: "Provider", value: port.provider, source: "dynamic-dcp substratePorts[].provider" },
      { label: "Status", value: port.status, source: "dynamic-dcp substratePorts[].status" }
    ]
  }));
  const componentIds = new Set(components.map(node => node.id));
  const portIds = new Set(ports.map(node => node.id));
  const edges: ModelEdge[] = [];
  for (const connection of projection.connections ?? []) {
    const toSubstrate = SUBSTRATE_ENDPOINTS.has(connection.targetNodeId);
    const fromSubstrate = SUBSTRATE_ENDPOINTS.has(connection.sourceNodeId);
    if (toSubstrate && componentIds.has(connection.sourceNodeId) && portIds.has(connection.targetPortId)) {
      edges.push({ ...connectionEdge(connection), to: connection.targetPortId, kind: "REQUIRES_SUBSTRATE" });
    } else if (fromSubstrate && componentIds.has(connection.targetNodeId) && portIds.has(connection.sourcePortId)) {
      edges.push({ ...connectionEdge(connection), from: connection.sourcePortId, kind: "REQUIRES_SUBSTRATE" });
    }
  }
  return { view: "TOPOLOGY", nodes: [...components, ...ports], edges, notes };
}

/**
 * Projector: a supplied compiled contract (`read-only` deep link, §5.3) in the same model, so the Table renderer draws a
 * compiled contract exactly as it draws a draft.
 */
export function projectCompiledContract(view: ReadOnlyCompositionView): ViewModel {
  const nodes: ModelNode[] = view.components.map(component => ({
    id: component.componentId,
    label: component.name,
    kind: "COMPONENT",
    facts: [
      { label: "Catalog entry", value: component.catalogEntryId, source: "composition-view components[].catalogEntryId" },
      { label: "Coordinates", value: component.coordinates, source: "composition-view components[].coordinates" },
      { label: "Claim hash", value: component.claimHash, source: "composition-view components[].claimHash" },
      { label: "Artifact SHA-256", value: component.artifactSha256, source: "composition-view components[].artifactSha256" }
    ]
  }));
  const substrate: ModelNode[] = view.substrate.map(row => ({
    id: `substrate:${row.port}`,
    label: row.port,
    kind: "SUBSTRATE_PORT",
    facts: [
      { label: "Status", value: row.status, source: "composition-view substrate[].status" },
      { label: "Profile hash", value: row.profileHash, source: "composition-view substrate[].profileHash" }
    ]
  }));
  const edges: ModelEdge[] = view.ports.map(port => ({
    id: `port:${port.componentId}:${port.portId}`,
    from: port.componentId,
    to: port.componentId,
    kind: port.kind,
    label: port.capability,
    status: port.status
  }));
  return { view: "FLOW", nodes: [...nodes, ...substrate], edges, notes: view.warnings.map(warning => `${warning.code}: ${warning.message}`) };
}

/** The facts of a projection node: only the fields Fabric supplies. */
function componentFacts(node: DynamicDcpProjectionResponse["nodes"][number]): readonly Fact[] {
  return [
    { label: "DCP type", value: node.dcpType, source: "dynamic-dcp nodes[].dcpType" },
    { label: "Level", value: node.level, source: "dynamic-dcp nodes[].level" },
    ...(node.catalogEntryId === undefined ? [] : [{ label: "Catalog entry", value: node.catalogEntryId, source: "dynamic-dcp nodes[].catalogEntryId" }]),
    { label: "Capabilities", value: node.capabilities.join(", ") || "none declared", source: "dynamic-dcp nodes[].capabilities" },
    { label: "Replacement", value: node.replacementAllowed ? "allowed by Fabric" : "governed by the parent", source: "dynamic-dcp nodes[].replacementAllowed" }
  ];
}

/** A connection as a model edge, with its status and reason. */
function connectionEdge(connection: NonNullable<DynamicDcpProjectionResponse["connections"]>[number]): ModelEdge {
  return {
    id: `connection:${connection.sourceNodeId}:${connection.sourcePortId}->${connection.targetNodeId}:${connection.targetPortId}`,
    from: connection.sourceNodeId,
    to: connection.targetNodeId,
    kind: "CONNECTION",
    label: connection.capability,
    status: connection.status,
    reason: connection.reason
  };
}

/** The current resolution's shapes by component id, or a note saying why there are none. */
function shapesByComponent(data: WorkbenchData, notes: string[]): Map<string, { readonly shape: string; readonly requiredPorts: readonly string[] }> {
  const shapes = new Map<string, { shape: string; requiredPorts: readonly string[] }>();
  const deployment = data.deployment;
  if (!deployment) {
    notes.push(data.deploymentError
      ? `Deployment shapes are unavailable: ${data.deploymentError}`
      : "Deployment shapes appear after Fabric resolves the deployment for this draft.");
    return shapes;
  }
  if (!isCurrent(deployment, data)) {
    notes.push(staleMessage("the deployment resolution", deployment, data, "Resolve again."));
    return shapes;
  }
  const response: ResolveDeploymentResponse = deployment.response;
  if (response.status === "INVALID") {
    notes.push(`Deployment could not be resolved: ${response.reason}: ${response.details}`);
    return shapes;
  }
  for (const selection of response.selections) {
    shapes.set(selection.componentId, { shape: selection.deploymentShape, requiredPorts: selection.requiredPorts });
  }
  return shapes;
}
