import type {
  DynamicDcpProjectionResponse, EmitPlanBinding, ResolveDeploymentResponse, StudioViewSection, StudioViewpoint, ViewProjectionResponse
} from "@unfurl/fabric-validation-client";
import type { ReadOnlyCompositionView } from "@unfurl/fabric-scene-model";
import { currentEmitPlan, isCurrent, staleMessage, type WorkbenchData } from "./workbenchData.js";

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

/** What a model element is: a component, a substrate port, an owner outside the catalog, or owned state or a decision. */
export type ModelNodeKind = "COMPONENT" | "SUBSTRATE_PORT" | "EXTERNAL_OWNER" | "OWNED_STATE" | "OWNED_DECISION";

export type ModelNode = {
  readonly id: string;
  readonly label: string;
  readonly kind: ModelNodeKind;
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
export function projectFlow(projection: DynamicDcpProjectionResponse, flow?: ViewProjectionResponse): ViewModel {
  const protocols = itemsByNode(flow?.externalProtocolOffers, offer => offer.nodeId);
  const nodes: ModelNode[] = projection.nodes.map(node => ({
    id: node.nodeId,
    label: node.label,
    kind: "COMPONENT" as const,
    level: node.level,
    ...(node.parentNodeId === undefined ? {} : { parentId: node.parentNodeId }),
    facts: [
      ...componentFacts(node),
      ...(protocols.get(node.nodeId) ?? []).map(offer => ({
        label: "External protocol", value: `${offer.capability} over ${offer.protocol}`, source: `views/flow ${offer.source}`
      }))
    ]
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
  // External owners (§3.1): one boundary node per owner Fabric names, joined to each component that needs it.
  for (const owner of flow?.externalOwners?.available ? flow.externalOwners.items : []) {
    if (!known.has(owner.neededByNodeId)) continue;
    if (!known.has(owner.boundaryNodeId)) {
      known.add(owner.boundaryNodeId);
      nodes.push({ id: owner.boundaryNodeId, label: `${owner.owner} (outside the catalog)`, kind: "EXTERNAL_OWNER",
        facts: [{ label: "Owner", value: owner.owner, source: "views/flow externalOwners[].owner" }] });
    }
    edges.push({ id: `NEEDS_OWNER:${owner.neededByNodeId}->${owner.boundaryNodeId}:${owner.dependency}`, from: owner.neededByNodeId,
      to: owner.boundaryNodeId, kind: "NEEDS_OWNER", label: owner.dependency });
  }
  return { view: "FLOW", nodes, edges, notes: [] };
}

/**
 * Projector: Data & State (§3.2) from Fabric's data view: the components that own something, each owned resource and
 * decision as its own element joined to its owner (labelled with its sensitivity or authority), each documented
 * operation and data mapping as a fact on its component. A section Fabric reports as unavailable is a note with its
 * reason, never an empty layer.
 */
export function projectData(projection: DynamicDcpProjectionResponse, data: ViewProjectionResponse): ViewModel {
  const labels = new Map(projection.nodes.map(node => [node.nodeId, node.label]));
  const operations = itemsByNode(data.operations, operation => operation.nodeId);
  const mappings = itemsByNode(data.dataMappings, mapping => mapping.providerNodeId ?? "");
  const owners = new Set<string>([
    ...(data.ownedState?.items ?? []).map(item => item.nodeId),
    ...(data.ownedDecisions?.items ?? []).map(item => item.nodeId),
    ...operations.keys(),
    ...[...mappings.keys()].filter(id => id !== "")
  ]);
  const nodes: ModelNode[] = [...owners].filter(id => labels.has(id)).map(id => ({
    id, label: labels.get(id)!, kind: "COMPONENT" as const,
    facts: [
      ...(operations.get(id) ?? []).map(operation => ({
        label: `Operation ${operation.capability}/${operation.operation}`,
        value: `request ${operation.requestSchema.path}, response ${operation.responseSchema.path}`, source: `views/data ${operation.source}`
      })),
      ...(mappings.get(id) ?? []).map(mapping => ({
        label: "Data mapping", value: `${mapping.childContractId}: ${Object.keys(mapping.inbound).length} inbound, ${Object.keys(mapping.outbound).length} outbound`,
        source: `views/data ${mapping.source}`
      }))
    ]
  }));
  const edges: ModelEdge[] = [];
  for (const state of data.ownedState?.items ?? []) {
    if (!labels.has(state.nodeId)) continue;
    const id = `state:${state.nodeId}:${state.resource}`;
    nodes.push({ id, label: state.resource, kind: "OWNED_STATE", facts: [
      { label: "Concern", value: state.concern, source: `views/data ${state.source}` },
      { label: "Sensitivity", value: state.sensitivity, source: `views/data ${state.source}.sensitivity` },
      { label: "Description", value: state.description, source: `views/data ${state.source}.description` }] });
    edges.push({ id: `OWNS_STATE:${state.nodeId}->${id}`, from: state.nodeId, to: id, kind: "OWNS_STATE", label: state.sensitivity });
  }
  for (const decision of data.ownedDecisions?.items ?? []) {
    if (!labels.has(decision.nodeId)) continue;
    const id = `decision:${decision.nodeId}:${decision.decision}`;
    nodes.push({ id, label: decision.decision, kind: "OWNED_DECISION", facts: [
      { label: "Concern", value: decision.concern, source: `views/data ${decision.source}` },
      { label: "Authority", value: decision.authority, source: `views/data ${decision.source}.authority` },
      { label: "Description", value: decision.description, source: `views/data ${decision.source}.description` }] });
    edges.push({ id: `OWNS_DECISION:${decision.nodeId}->${id}`, from: decision.nodeId, to: id, kind: "OWNS_DECISION", label: decision.authority });
  }
  return { view: "DATA", nodes, edges, notes: absentNotes([
    ["Owned state", data.ownedState], ["Owned decisions", data.ownedDecisions], ["Operations", data.operations], ["Data mappings", data.dataMappings]]) };
}

/**
 * Projector: Runtime & Telemetry (§3.4) from Fabric's runtime view: each component's declared monitoring and telemetry
 * as facts, and the current compile's verification as a note. Unavailable sections are notes with Fabric's reasons.
 */
export function projectRuntime(projection: DynamicDcpProjectionResponse, runtime: ViewProjectionResponse): ViewModel {
  const monitoring = itemsByNode(runtime.monitoring, item => item.nodeId);
  const telemetry = itemsByNode(runtime.telemetry, item => item.nodeId);
  const nodes: ModelNode[] = projection.nodes
    .filter(node => monitoring.has(node.nodeId) || telemetry.has(node.nodeId))
    .map(node => ({
      id: node.nodeId, label: node.label, kind: "COMPONENT" as const,
      facts: [
        // Members are shown as DCP holds them: one the claim did not write reads "not declared", never a default.
        ...(monitoring.get(node.nodeId) ?? []).flatMap(item => [
          { label: "Health endpoints", value: item.healthEndpoints === undefined ? NOT_DECLARED : item.healthEndpoints.join(", ") || "none", source: `views/runtime ${item.source}.health_endpoints` },
          { label: "Readiness check", value: requiredText(item.readinessRequired), source: `views/runtime ${item.source}.readiness_required` },
          { label: "Liveness check", value: requiredText(item.livenessRequired), source: `views/runtime ${item.source}.liveness_required` }
        ]),
        ...(telemetry.get(node.nodeId) ?? []).flatMap(item => [
          { label: "Telemetry signals", value: item.signals === undefined ? NOT_DECLARED : item.signals.join(", ") || "none", source: `views/runtime ${item.source}.signals` },
          { label: "Correlation id", value: requiredText(item.correlationIdRequired), source: `views/runtime ${item.source}.correlation_id_required` }
        ])
      ]
    }));
  const verification = runtime.verification;
  const verificationNote = verification === undefined ? [] : [verification.available
    ? `Verification: ${verification.overallOk ? "verified" : "not verified"} (signature ${verification.signature?.result ?? "unknown"}, catalog ${verification.catalogDrift?.clean ? "clean" : "drifted"}).`
    : `Verification: ${verification.absentReason?.code ?? "UNAVAILABLE"}: ${verification.absentReason?.message ?? ""}`];
  return { view: "RUNTIME", nodes, edges: [], notes: [...absentNotes([["Monitoring", runtime.monitoring], ["Telemetry", runtime.telemetry]]), ...verificationNote] };
}

/** How a port member the claim did not write reads: never as a default. */
const NOT_DECLARED = "not declared";

/** A required/not-required flag as DCP holds it, or "not declared" when the claim did not write it. */
function requiredText(flag: boolean | undefined): string {
  return flag === undefined ? NOT_DECLARED : flag ? "required" : "not required";
}

/** A section's items grouped by the node they belong to; none when the section is unavailable. */
function itemsByNode<T>(section: StudioViewSection<T> | undefined, nodeOf: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of section?.available ? section.items : []) {
    const key = nodeOf(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

/** Notes for the sections Fabric reported as unavailable, each with its code and message. */
function absentNotes(sections: readonly (readonly [string, StudioViewSection<unknown> | undefined])[]): string[] {
  return sections
    .filter(([, section]) => section !== undefined && !section.available)
    .map(([title, section]) => `${title}: ${section!.absentReason?.code ?? "UNAVAILABLE"}: ${section!.absentReason?.message ?? ""}`);
}

/**
 * Projector: Substrate & Topology (§3.3): the draft's components, the substrate ports its connections use, and the
 * component-to-substrate wiring. Deployment shapes come from the last resolution only while it is current (§4.3 rule 6);
 * an out-of-date or failed resolution is a note, never shown as the current shapes.
 */
export function projectTopology(projection: DynamicDcpProjectionResponse, data: WorkbenchData, topology?: ViewProjectionResponse): ViewModel {
  const notes: string[] = [];
  const shapes = shapesByComponent(data, notes);
  // Transports come from the current compile record (LLD-fabric-studio-api, StudioViewProjection); an unavailable section
  // is a note with Fabric's reason, never a guessed transport.
  const transports = itemsByNode(topology?.transports, transport => transport.providerNodeId ?? "");
  if (topology?.transports && !topology.transports.available) notes.push(...absentNotes([["Transports", topology.transports]]));
  // Runtime bindings come from the current emit plan for the chosen environment (LLD-fabric-studio-api,
  // StudioEmitPlanPreview), each on its provider node; an out-of-date plan contributes nothing (§4.3 rule 6).
  const bindings = runtimeBindingsByNode(data);
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
        ]),
        ...(transports.get(node.nodeId) ?? []).map(transport => ({
          label: "Transport", value: `${transport.kind} (${transport.childContractId})`, source: `views/topology ${transport.source}`
        })),
        ...(bindings.get(node.nodeId) ?? []).map(binding => ({
          label: `Runtime binding (${binding.capability})`,
          value: `${binding.deploymentKind ?? "deployment kind not given"}${binding.baseUrl ? ` at ${binding.baseUrl}` : ""}${binding.enabled ? "" : ", disabled"}`,
          source: `emit-plan runtimeBindings[${binding.bindingId}]`
        }))
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
 * The current emit plan's child bindings by provider node: only a current, available plan's, and only bindings Fabric
 * mapped to a draft node. Shared by Substrate & Topology and the overlays' runtime facts.
 */
export function runtimeBindingsByNode(data: WorkbenchData): ReadonlyMap<string, readonly EmitPlanBinding[]> {
  const plan = currentEmitPlan(data);
  const byNode = new Map<string, EmitPlanBinding[]>();
  if (!plan?.available) return byNode;
  for (const binding of plan.runtimeBindings) {
    if (binding.capability === undefined || binding.providerNodeId === undefined) continue;
    byNode.set(binding.providerNodeId, [...(byNode.get(binding.providerNodeId) ?? []), binding]);
  }
  return byNode;
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
