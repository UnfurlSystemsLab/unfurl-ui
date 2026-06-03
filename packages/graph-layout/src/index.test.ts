import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gridLayout } from "./index.js";

describe("graph layout", () => {
  it("assigns stable grid positions without changing edges", () => {
    const layout = gridLayout({
      nodes: [
        { id: "a", label: "A", kind: "COMPONENT" },
        { id: "b", label: "B", kind: "PORT" },
        { id: "c", label: "C", kind: "SUBSTRATE" }
      ],
      edges: [
        { id: "a-b", from: "a", to: "b", kind: "OWNS_PORT" }
      ]
    }, { columns: 2, gap: 100 });

    assert.deepEqual(layout.nodes.map(node => [node.id, node.x, node.y]), [
      ["a", 0, 0],
      ["b", 100, 0],
      ["c", 0, 100]
    ]);
    assert.deepEqual(layout.edges, [
      { id: "a-b", from: "a", to: "b", kind: "OWNS_PORT" }
    ]);
  });
});
