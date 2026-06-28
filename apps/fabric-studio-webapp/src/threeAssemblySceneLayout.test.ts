import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DynamicDcpProjectionResponse } from "@unfurl/fabric-validation-client";
import { layoutNodes, layoutPipes } from "./threeAssemblySceneLayout.js";

describe("threeAssemblySceneLayout", () => {
  it("places consumers, providers, and isolated adapters into deterministic tiers", () => {
    const first = layoutNodes(projection());
    const second = layoutNodes(projection());

    assert.deepEqual(second, first);
    assert.deepEqual(
      first.map(entry => [entry.nodeId, entry.tier]),
      [
        ["component.agent", 0],
        ["component.rag", 1],
        ["component.host-bean", 2]
      ]
    );
    assert.deepEqual(first.map(entry => entry.position[1]), [1.2, -0.4, -1.6]);
  });

  it("derives stable pipe ids from resolved port connection edges", () => {
    const projectionFixture = projection();
    const pipes = layoutPipes(
      layoutNodes(projectionFixture),
      projectionFixture.connections,
      projectionFixture.substratePorts
    );

    assert.deepEqual(
      pipes.map(pipe => pipe.id),
      [
        "pipe:component.rag:offer-rag->component.agent:need-rag",
        "pipe:substrate:runtime:substrate:event-sink->component.agent:need-event-sink"
      ]
    );
    assert.equal(pipes[0]?.capability, "rag.query");
    assert.equal(pipes[1]?.source.kind, "substrate");
  });

  it("keeps aggregation components in the 3D layout", () => {
    const projectionFixture = projection();
    const aggregation = child(
      "component.infinite-aggregation",
      "Infinite Aggregation",
      "uploaded:infinite-aggregation-0.1.0-SNAPSHOT.jar"
    );
    const layout = layoutNodes({
      ...projectionFixture,
      nodes: [...projectionFixture.nodes, aggregation]
    });

    assert.ok(layout.some(entry => entry.nodeId === "component.infinite-aggregation"));
    assert.ok(layout.some(entry => entry.label === "Infinite Aggregation"));
  });
});

function projection(): DynamicDcpProjectionResponse {
  return {
    tenantId: "tenant-local",
    assemblyId: "assembly-demo",
    compositionMode: "DYNAMIC",
    rootNodeId: "company:foundry",
    focusNodeId: "assembly:agent-demo",
    nodes: [
      parent("company:foundry", "Foundry"),
      assembly("assembly:agent-demo", "Agent Demo"),
      child("component.agent", "Research Agent", "com.unfurl:sample-research-agent:1.0.0"),
      child("component.rag", "RAG Substrate", "com.unfurl:foundry-substrate-rag:1.0.0"),
      child("component.host-bean", "Host Bean Adapter", "com.unfurl:host-bean-adapter:1.0.0")
    ],
    edges: [],
    substratePorts: [
      {
        portId: "substrate:event-sink",
        capability: "event-sink",
        label: "Event Sink",
        provider: "kafka",
        status: "AVAILABLE"
      }
    ],
    connections: [
      {
        sourceNodeId: "component.rag",
        sourcePortId: "offer-rag",
        targetNodeId: "component.agent",
        targetPortId: "need-rag",
        capability: "rag.query",
        status: "ALLOWED",
        reason: "RAG Substrate offers rag.query required by Research Agent"
      },
      {
        sourceNodeId: "substrate:runtime",
        sourcePortId: "substrate:event-sink",
        targetNodeId: "component.agent",
        targetPortId: "need-event-sink",
        capability: "event-sink",
        status: "ALLOWED",
        reason: "Unfurl substrate offers event-sink required by Research Agent"
      }
    ],
    warnings: []
  };
}

function parent(nodeId: string, label: string) {
  return {
    nodeId,
    label,
    dcpType: "COMPANY",
    level: "PARENT" as const,
    capabilities: [],
    compatibleDescendants: [],
    replacementAllowed: false
  };
}

function assembly(nodeId: string, label: string) {
  return {
    nodeId,
    label,
    dcpType: "MODULE",
    level: "ASSEMBLY" as const,
    capabilities: [],
    compatibleDescendants: [],
    replacementAllowed: false
  };
}

function child(nodeId: string, label: string, catalogEntryId: string) {
  return {
    nodeId,
    label,
    dcpType: "COMPONENT",
    level: "CHILD" as const,
    catalogEntryId,
    capabilities: [],
    compatibleDescendants: [],
    replacementAllowed: true
  };
}
