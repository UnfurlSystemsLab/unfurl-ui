import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sceneChildNodes, type SemanticDcpSceneProjection } from "./ThreeAssemblyScene.js";

describe("ThreeAssemblyScene semantic child projection", () => {
  it("keeps an empty governed draft empty instead of substituting demo children", () => {
    const projection: SemanticDcpSceneProjection = {
      parentLabel: "Unfurl Runtime",
      assemblyLabel: "Assembly DCP",
      childNodes: []
    };

    assert.deepEqual(sceneChildNodes(projection), []);
  });

  it("caps child render nodes without changing their identities", () => {
    const projection: SemanticDcpSceneProjection = {
      parentLabel: "Unfurl Runtime",
      assemblyLabel: "Assembly DCP",
      childNodes: Array.from({ length: 6 }, (_, index) => ({
        nodeId: `component.${index}`,
        label: `Component ${index}`,
        dcpType: "COMPONENT",
        replacementAllowed: true
      }))
    };

    assert.deepEqual(
      sceneChildNodes(projection).map(node => node.nodeId),
      ["component.0", "component.1", "component.2", "component.3", "component.4"]
    );
  });
});
