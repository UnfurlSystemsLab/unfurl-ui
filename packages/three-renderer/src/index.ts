import type { PortTableRow, ReadOnlyCompositionView, Vector3 } from "@unfurl/fabric-scene-model";

export type RenderAsset = {
  readonly assetId: string;
  readonly url: string;
  readonly sha256: string;
  readonly mediaType: "model/gltf-binary" | "image/png";
};

export type GeneratedShapeRequest = {
  readonly fallbackShape: "CUBE" | "SPHERE" | "CYLINDER" | "SHIELD" | "GEAR";
  readonly category: string;
};

export type RenderScene = {
  readonly components: readonly RenderComponent[];
  readonly ports: readonly RenderPortHandle[];
  readonly pipes: readonly RenderPipe[];
  readonly substrateSockets: readonly RenderSubstrateSocket[];
};

export type RenderComponent = {
  readonly id: string;
  readonly label: string;
  readonly position: Vector3;
  readonly rotation: Vector3;
  readonly shape: GeneratedShapeRequest;
};

export type RenderPortHandle = {
  readonly id: string;
  readonly componentId: string;
  readonly capability: string;
  readonly kind: PortTableRow["kind"];
  readonly status: PortTableRow["status"];
  readonly position: Vector3;
};

export type RenderPipe = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: "SUBSTRATE_PIPE";
  readonly status: "REQUIRED";
};

export type RenderSubstrateSocket = {
  readonly id: string;
  readonly port: string;
  readonly status: "REQUIRED";
  readonly position: Vector3;
};

export function buildReadOnlyRenderScene(view: ReadOnlyCompositionView): RenderScene {
  const components = view.components.map((component, index) => ({
    id: component.componentId,
    label: component.name,
    position: [index * 4, 0, 0] as const,
    rotation: [0, 0, 0] as const,
    shape: {
      fallbackShape: fallbackShape(component.visualStatus),
      category: categoryFromComponentId(component.componentId)
    }
  }));

  const componentIndex = new Map(components.map((component, index) => [component.id, index]));
  const ports = view.ports.map((port, index) => portHandle(port, componentIndex.get(port.componentId) ?? 0, index));
  const substrateSockets = view.substrate.map((row, index) => ({
    id: substrateSocketId(row.port),
    port: row.port,
    status: "REQUIRED" as const,
    position: [index * 3, -4, 0] as const
  }));

  return {
    components,
    ports,
    substrateSockets,
    pipes: ports
      .filter(port => port.kind === "SUBSTRATE_DEPENDENCY")
      .map(port => ({
        id: `${port.id}->${substrateSocketId(normalizedCapability(port.capability))}`,
        from: port.id,
        to: substrateSocketId(normalizedCapability(port.capability)),
        kind: "SUBSTRATE_PIPE" as const,
        status: "REQUIRED" as const
      }))
  };
}

function portHandle(port: PortTableRow, componentIndex: number, portIndex: number): RenderPortHandle {
  return {
    id: portHandleId(port.portId),
    componentId: port.componentId,
    capability: port.capability,
    kind: port.kind,
    status: port.status,
    position: [
      componentIndex * 4 + 1.5,
      port.kind === "SUBSTRATE_DEPENDENCY" ? -1 : 1,
      (portIndex % 4) - 1.5
    ] as const
  };
}

function fallbackShape(visualStatus: string): GeneratedShapeRequest["fallbackShape"] {
  return visualStatus === "NO_VISUAL_MANIFEST" ? "CUBE" : "GEAR";
}

function categoryFromComponentId(componentId: string): string {
  if (componentId.includes("storage")) {
    return "STORAGE";
  }
  if (componentId.includes("auth") || componentId.includes("identity")) {
    return "AUTH";
  }
  if (componentId.includes("ai") || componentId.includes("llm") || componentId.includes("gemini")) {
    return "AI";
  }
  if (componentId.includes("audit")) {
    return "AUDIT";
  }
  return "WORKFLOW";
}

function portHandleId(portId: string): string {
  return `port:${portId}`;
}

function substrateSocketId(port: string): string {
  return `substrate:${port}`;
}

function normalizedCapability(capability: string): string {
  return capability.startsWith("substrate:") ? capability.slice("substrate:".length) : capability;
}
