import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import type { DynamicDcpProjectionResponse } from "@unfurl/fabric-validation-client";
import { SemanticZoomNavigator } from "./SemanticZoomNavigator.js";

describe("SemanticZoomNavigator", () => {
  it("renders the breadcrumb and contained children for a projection", () => {
    const html = renderToString(<SemanticZoomNavigator projection={projection()} />);

    assert.match(html, /Semantic zoom navigator/);
    assert.match(html, /Unfurl Runtime/); // root crumb (focus starts at root)
    assert.match(html, /Flow Runtime Assembly/); // child contained by root via CONTAINS edge
    assert.match(html, /depth 1/);
    assert.doesNotMatch(html, /No composition projection/);
  });

  it("shows an honest leaf state when the focus has no contained children", () => {
    const html = renderToString(<SemanticZoomNavigator projection={leafProjection()} />);

    assert.match(html, /no further aggregates/i);
    assert.match(html, /Solo Component/);
  });

  it("shows an empty state when there is no projection", () => {
    const html = renderToString(<SemanticZoomNavigator />);

    assert.match(html, /No composition projection available/);
  });

  it("does not fabricate hierarchy beyond what the projection provides", () => {
    const html = renderToString(<SemanticZoomNavigator projection={projection()} />);

    // The infinite-aggregation vision (Smart City -> Colony -> ...) must not
    // appear from thin air — only real projection nodes render.
    assert.doesNotMatch(html, /Smart City|Smart Colony|Smart Home/i);
  });
});

function projection(): DynamicDcpProjectionResponse {
  return {
    tenantId: "tenant-local",
    assemblyId: "assembly-demo",
    compositionMode: "DYNAMIC",
    rootNodeId: "runtime:unfurl",
    focusNodeId: "assembly:unfurl-flow",
    nodes: [
      node("runtime:unfurl", "Unfurl Runtime", "COMPANY", "PARENT"),
      node("assembly:unfurl-flow", "Flow Runtime Assembly", "MODULE", "ASSEMBLY"),
      node("component.flow-orchestrator", "Flow Orchestrator", "COMPONENT", "CHILD")
    ],
    edges: [
      { fromNodeId: "runtime:unfurl", toNodeId: "assembly:unfurl-flow", relationship: "CONTAINS" },
      { fromNodeId: "assembly:unfurl-flow", toNodeId: "component.flow-orchestrator", relationship: "CONTAINS" }
    ],
    connections: [],
    warnings: []
  };
}

function leafProjection(): DynamicDcpProjectionResponse {
  return {
    tenantId: "tenant-local",
    assemblyId: "assembly-demo",
    compositionMode: "DYNAMIC",
    rootNodeId: "leaf:solo",
    focusNodeId: "leaf:solo",
    nodes: [node("leaf:solo", "Solo Component", "COMPONENT", "CHILD")],
    edges: [],
    connections: [],
    warnings: []
  };
}

function node(nodeId: string, label: string, dcpType: string, level: "PARENT" | "ASSEMBLY" | "CHILD") {
  return {
    nodeId,
    label,
    dcpType,
    level,
    capabilities: [] as readonly string[],
    compatibleDescendants: [] as readonly string[],
    replacementAllowed: false
  };
}
