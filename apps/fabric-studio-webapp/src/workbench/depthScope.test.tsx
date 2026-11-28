import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DynamicDcpProjectionResponse } from "@unfurl/fabric-validation-client";
import { scopeBadges, scopeModelToFocus, validFocusPath } from "./depthScope.js";
import type { OverlayAnnotation } from "./overlays.js";
import { projectData, projectFlow, projectTopology } from "./projectors.js";
import { renderToString } from "react-dom/server";
import { OwnershipMatrixRenderer, TableRenderer, TwoDRenderer, twoDLayout, NODE_BOX_HEIGHT, NODE_BOX_WIDTH } from "./renderers.js";
import type { ViewModel } from "./projectors.js";
import type { WorkbenchData } from "./workbenchData.js";

/**
 * Depth scoping (LLD-studio-viewpoints-and-perspectives §5.6) and the 2D renderer's single coordinate system (§5.7 rule
 * 1), over a three-level projection: the company, its assembly, and three components, two of them wired to substrate
 * ports and to each other.
 */

const node = (nodeId: string, level: string, parentNodeId?: string, catalogEntryId?: string) => ({
  nodeId, label: nodeId.toUpperCase(), dcpType: level === "CHILD" ? "COMPONENT" : "MODULE", level,
  ...(parentNodeId === undefined ? {} : { parentNodeId }), ...(catalogEntryId === undefined ? {} : { catalogEntryId }),
  capabilities: [], compatibleDescendants: [], replacementAllowed: level === "CHILD"
});

const PROJECTION: DynamicDcpProjectionResponse = {
  tenantId: "tenant-a", assemblyId: "assembly-a", compositionMode: "DYNAMIC", rootNodeId: "company", focusNodeId: "assembly",
  nodes: [
    node("company", "PARENT"),
    node("assembly", "ASSEMBLY", "company"),
    node("flow", "CHILD", "assembly", "uploaded:flow.jar"),
    node("foundry", "CHILD", "assembly", "uploaded:foundry.jar"),
    node("rag", "CHILD", "assembly", "uploaded:rag.jar")
  ],
  edges: [
    { fromNodeId: "company", toNodeId: "assembly", relationship: "CONTAINS" },
    { fromNodeId: "assembly", toNodeId: "flow", relationship: "CONTAINS" },
    { fromNodeId: "assembly", toNodeId: "foundry", relationship: "CONTAINS" },
    { fromNodeId: "assembly", toNodeId: "rag", relationship: "CONTAINS" }
  ],
  substratePorts: [
    { portId: "port.http", capability: "substrate.http.client", label: "HTTP client", provider: "substrate", status: "AVAILABLE" },
    { portId: "port.rag", capability: "rag.corpus", label: "RAG corpus", provider: "substrate", status: "AVAILABLE" }
  ],
  connections: [
    { sourceNodeId: "flow", sourcePortId: "agent", targetNodeId: "foundry", targetPortId: "agent.run", capability: "agent.run", status: "ALLOWED", reason: "offered" },
    { sourceNodeId: "flow", sourcePortId: "http", targetNodeId: "substrate", targetPortId: "port.http", capability: "substrate.http.client", status: "ALLOWED", reason: "substrate" },
    { sourceNodeId: "foundry", sourcePortId: "http", targetNodeId: "substrate", targetPortId: "port.http", capability: "substrate.http.client", status: "BLOCKED", reason: "no port" },
    { sourceNodeId: "rag", sourcePortId: "corpus", targetNodeId: "substrate", targetPortId: "port.rag", capability: "rag.corpus", status: "ALLOWED", reason: "substrate" }
  ],
  warnings: []
};

const DATA = { deploymentPolicy: { preferredShapes: [], disallowedShapes: [], requireIsolationForCapabilityPatterns: [], runtime: {} },
  signingRequested: false } as WorkbenchData;

const ids = (items: readonly { readonly id: string }[]) => items.map(item => item.id).sort();
const fact = (model: { readonly nodes: readonly { readonly id: string; readonly facts: readonly { readonly label: string; readonly value: string }[] }[] }, id: string, label: string) =>
  model.nodes.find(candidate => candidate.id === id)?.facts.find(candidate => candidate.label === label)?.value;

describe("depth scoping (§5.6)", () => {
  it("draws only the focus and its direct children at the root, rolling the rest up into the assembly", () => {
    const topology = projectTopology(PROJECTION, DATA);
    const scoped = scopeModelToFocus(topology, PROJECTION, "company");
    // Boundary substrate ports are drawn because lifted edges reach them across the assembly's boundary.
    assert.deepEqual(ids(scoped.model.nodes), ["assembly", "company", "port.http", "port.rag"]);
    assert.equal(fact(scoped.model, "assembly", "Contains"), "3 components below; drill in to see them");
    assert.equal(fact(scoped.model, "company", "Contains"), undefined, "the company's direct child is drawn, nothing of its own is hidden");
  });

  it("lifts edges to hidden nodes onto their representative and merges them, blocked when any is", () => {
    const scoped = scopeModelToFocus(projectTopology(PROJECTION, DATA), PROJECTION, "company");
    const toHttp = scoped.model.edges.find(edge => edge.id === "LIFTED:REQUIRES_SUBSTRATE:assembly->port.http")!;
    assert.equal(toHttp.label, "2 connections");
    assert.equal(toHttp.status, "BLOCKED", "foundry's blocked wiring keeps the merged edge blocked");
    const toRag = scoped.model.edges.find(edge => edge.id === "LIFTED:REQUIRES_SUBSTRATE:assembly->port.rag")!;
    assert.equal(toRag.label, "rag.corpus", "one lifted edge keeps its own label");
    assert.equal(scoped.model.edges.length, 2);
  });

  it("drops edges internal to a representative and keeps edges between drawn nodes with their ids", () => {
    const flow = projectFlow(PROJECTION);
    const atRoot = scopeModelToFocus(flow, PROJECTION, "company");
    assert.deepEqual(atRoot.model.edges.map(edge => edge.id), ["CONTAINS:company->assembly"], "flow->foundry is internal to the assembly");
    const atAssembly = scopeModelToFocus(flow, PROJECTION, "assembly");
    assert.deepEqual(ids(atAssembly.model.nodes), ["assembly", "flow", "foundry", "rag"]);
    assert.ok(atAssembly.model.edges.some(edge => edge.id === "connection:flow:agent->foundry:agent.run"), "drawn ends keep the edge's id");
  });

  it("drills to a leaf: the focus alone, with its own boundary wiring", () => {
    const scoped = scopeModelToFocus(projectTopology(PROJECTION, DATA), PROJECTION, "rag");
    assert.deepEqual(ids(scoped.model.nodes), ["port.rag", "rag"]);
    assert.deepEqual(scoped.model.edges.map(edge => edge.to), ["port.rag"]);
  });

  it("draws a representative the view leaves out from the projection, and follows owned state with its owner", () => {
    const data = projectData(PROJECTION, {
      tenantId: "tenant-a", assemblyId: "assembly-a", sessionId: "s1", revision: 4, view: "data", diagnostics: [], diagnosticArtifacts: [],
      ownedState: { available: true, items: [{ nodeId: "flow", concern: "runs", resource: "workflow-runs", description: "Run state", sensitivity: "CONFIDENTIAL", source: "claim" }] },
      ownedDecisions: { available: true, items: [] }, operations: { available: true, items: [] }, dataMappings: { available: true, items: [] }
    });
    const scoped = scopeModelToFocus(data, PROJECTION, "company");
    // The data view draws owners only; the assembly stands for them, so it is drawn from the projection.
    assert.deepEqual(ids(scoped.model.nodes), ["assembly"]);
    assert.equal(fact(scoped.model, "assembly", "Owned below"), "1 state");
    assert.equal(fact(scoped.model, "assembly", "Contains"), "3 components below; drill in to see them");
    const atAssembly = scopeModelToFocus(data, PROJECTION, "assembly");
    assert.deepEqual(ids(atAssembly.model.nodes), ["flow", "state:flow:workflow-runs"], "drilled in, the owner and its state are drawn");
  });

  it("rolls hidden elements' annotations up into one 'N below' badge, as severe as the worst", () => {
    const topology = projectTopology(PROJECTION, DATA);
    const scoped = scopeModelToFocus(topology, PROJECTION, "company");
    const badges = new Map<string, readonly OverlayAnnotation[]>([
      ["flow", [{ elementId: "flow", label: "fault F1", detail: "degrades", severity: "WARNING", source: "resilience" }]],
      ["foundry", [{ elementId: "foundry", label: "fault F2", detail: "blocks", severity: "ERROR", source: "resilience" }]],
      ["company", [{ elementId: "company", label: "trusted network", detail: "no identity", severity: "INFO", source: "security" }]]
    ]);
    const rolled = scopeBadges(badges, scoped, id => topology.nodes.find(candidate => candidate.id === id)?.label ?? id);
    assert.equal(rolled.get("company")?.[0]?.label, "trusted network", "a drawn element keeps its own annotations");
    const summary = rolled.get("assembly")!;
    assert.equal(summary.length, 1);
    assert.equal(summary[0]!.label, "2 below");
    assert.equal(summary[0]!.severity, "ERROR");
    assert.match(summary[0]!.detail, /fault F1 on FLOW: degrades\nfault F2 on FOUNDRY: blocks/);
  });

  it("focuses the deepest segment that still exists, and returns to the root when none is left", () => {
    assert.deepEqual(validFocusPath(["company", "assembly", "gone"], PROJECTION), ["company", "assembly"]);
    assert.deepEqual(validFocusPath(["gone"], PROJECTION), ["company"]);
    assert.deepEqual(validFocusPath(["company"], undefined), []);
  });

  it("regression: rebuilds the path when Fabric's containment moves the focused node", () => {
    // The adapter was focused under the assembly; Fabric now nests it under the flow component that uses it.
    const reparented: DynamicDcpProjectionResponse = { ...PROJECTION,
      nodes: [...PROJECTION.nodes, node("adapter", "CHILD", "flow", "uploaded:adapter.jar")],
      edges: [...PROJECTION.edges, { fromNodeId: "flow", toNodeId: "adapter", relationship: "CONTAINS", derivation: "DERIVED_FROM_BINDINGS" }] };
    const path = validFocusPath(["company", "assembly", "adapter"], reparented);
    assert.deepEqual(path, ["company", "assembly", "flow", "adapter"], "the breadcrumb follows the node to where it sits");
    assert.equal(path.length, 4, "its depth is its real depth");
    assert.deepEqual(path.slice(0, -1), ["company", "assembly", "flow"], "Zoom Out reaches the flow component first");
  });

  it("returns to the root when the focus no longer reaches it through CONTAINS edges", () => {
    const orphaned: DynamicDcpProjectionResponse = { ...PROJECTION,
      nodes: [...PROJECTION.nodes, node("stray", "CHILD", undefined, "uploaded:stray.jar")] };
    assert.deepEqual(validFocusPath(["company", "assembly", "stray"], orphaned), ["company"]);
  });
});

describe("2D renderer layout (§5.7 rule 1)", () => {
  it("ends every edge inside its two nodes' boxes, in one coordinate system the canvas is sized to", () => {
    for (const model of [projectFlow(PROJECTION), projectTopology(PROJECTION, DATA)]) {
      const layout = twoDLayout(model);
      for (const edge of model.edges) {
        const line = layout.edges.get(edge.id)!;
        const from = layout.boxes.get(edge.from)!;
        const to = layout.boxes.get(edge.to)!;
        const inside = (x: number, y: number, box: { left: number; top: number }) =>
          x >= box.left && x <= box.left + NODE_BOX_WIDTH && y >= box.top && y <= box.top + NODE_BOX_HEIGHT;
        assert.ok(inside(line.x1, line.y1, from), `${edge.id} starts on ${edge.from}`);
        assert.ok(inside(line.x2, line.y2, to), `${edge.id} ends on ${edge.to}`);
      }
      for (const box of layout.boxes.values()) {
        assert.ok(box.left + NODE_BOX_WIDTH <= layout.width && box.top + NODE_BOX_HEIGHT <= layout.height, "the canvas holds every box");
      }
    }
  });

  it("never lets boxes overlap, in a row or between rows", () => {
    const many = projectTopology({ ...PROJECTION, nodes: [...PROJECTION.nodes,
      ...Array.from({ length: 6 }, (_, i) => node(`extra${i}`, "CHILD", "assembly", `uploaded:extra${i}.jar`))] }, DATA);
    const tops = [...new Set([...twoDLayout(many).boxes.values()].map(box => box.top))].sort((a, b) => a - b);
    assert.ok(tops.length > 1, "the fixture spans more than one row");
    for (let i = 1; i < tops.length; i++) assert.ok(tops[i]! - tops[i - 1]! >= NODE_BOX_HEIGHT, "a row starts below the boxes above");
  });

  it("never lets two boxes in a row overlap", () => {
    const layout = twoDLayout(projectTopology(PROJECTION, DATA));
    const lefts = [...layout.boxes.values()].filter(box => box.top === [...layout.boxes.values()][0]!.top).map(box => box.left).sort((a, b) => a - b);
    for (let i = 1; i < lefts.length; i++) assert.ok(lefts[i]! - lefts[i - 1]! >= NODE_BOX_WIDTH, "a box is narrower than its column");
  });
});

/** React's escaping of text, so a fact value can be looked for in rendered HTML. */
const html = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

/** Every fact of every element of a model, as rendered text: what each renderer must show. */
const factTexts = (model: ViewModel) => model.nodes.flatMap(element => element.facts.map(fact => html(fact.value)));

describe("2D renderers show each element's facts (§5.7 rules 1 and 2)", () => {
  it("draws the Topology facts and the depth roll-up in 2D, exactly as the Table lists them", () => {
    for (const focus of ["company", "assembly"]) {
      const scoped = scopeModelToFocus(projectTopology(PROJECTION, DATA), PROJECTION, focus).model;
      const props = { model: scoped, badges: new Map(), onSelect: () => undefined };
      const twoD = renderToString(<TwoDRenderer {...props} />);
      const table = renderToString(<TableRenderer {...props} />);
      for (const text of factTexts(scoped)) {
        assert.ok(twoD.includes(text), `2D shows "${text}" at ${focus}`);
        assert.ok(table.includes(text), `Table shows "${text}" at ${focus}`);
      }
    }
    const atRoot = renderToString(<TwoDRenderer model={scopeModelToFocus(projectTopology(PROJECTION, DATA), PROJECTION, "company").model}
      badges={new Map()} onSelect={() => undefined} />);
    assert.match(atRoot, /3 components below; drill in to see them/);
    const drilled = renderToString(<TwoDRenderer model={scopeModelToFocus(projectTopology(PROJECTION, DATA), PROJECTION, "assembly").model}
      badges={new Map()} onSelect={() => undefined} />);
    assert.match(drilled, /Deployment shape<\/span> not resolved: resolve the deployment/);
    assert.match(drilled, /title="Runtime binding: no environment chosen \(from emit-plan runtimeBindings\[\]\)"/, "the full text is the line's title");
  });

  it("names owned data hidden at a collapsed depth in the ownership matrix, and shows owned items' facts once drilled in", () => {
    const data = projectData(PROJECTION, {
      tenantId: "tenant-a", assemblyId: "assembly-a", sessionId: "s1", revision: 4, view: "data", diagnostics: [], diagnosticArtifacts: [],
      ownedState: { available: true, items: [{ nodeId: "flow", concern: "runs", resource: "workflow-runs", description: "Run state", sensitivity: "CONFIDENTIAL", source: "claim" }] },
      ownedDecisions: { available: true, items: [] }, operations: { available: true, items: [] }, dataMappings: { available: true, items: [] }
    });
    const collapsed = renderToString(<OwnershipMatrixRenderer model={scopeModelToFocus(data, PROJECTION, "company").model}
      badges={new Map()} onSelect={() => undefined} />);
    assert.match(collapsed, /Owned below<\/span> 1 state/);
    assert.match(collapsed, /Contains<\/span> 3 components below/);
    const drilled = scopeModelToFocus(data, PROJECTION, "assembly").model;
    const matrix = renderToString(<OwnershipMatrixRenderer model={drilled} badges={new Map()} onSelect={() => undefined} />);
    for (const text of factTexts(drilled)) assert.ok(matrix.includes(text), `the matrix shows "${text}"`);
    assert.match(matrix, /Sensitivity<\/span> CONFIDENTIAL/);
  });
});
