import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPositionedStudioGraphView,
  buildStudioGraphView,
  renderStudioGraphText
} from "./graphView.js";
import type { ReadOnlyCompositionView } from "@unfurl/fabric-scene-model";

describe("Fabric Studio graph view", () => {
  it("projects a read-only composition into component port and substrate graph nodes", () => {
    const graph = buildStudioGraphView(view());

    assert.deepEqual(graph.nodes.map(node => [node.id, node.kind]), [
      ["component:storage-s3", "COMPONENT"],
      ["port:storage-s3:storage.put", "PORT"],
      ["port:storage-s3:substrate:secrets.provider", "PORT"],
      ["substrate:secrets.provider", "SUBSTRATE"],
      ["warning:0", "WARNING"]
    ]);
    assert.ok(graph.edges.some(edge => edge.kind === "REQUIRES_SUBSTRATE"));

    const text = renderStudioGraphText(graph);
    assert.match(text, /component:storage-s3/);
    assert.match(text, /REQUIRES_SUBSTRATE/);
  });

  it("can produce a stable positioned graph for 2D inspection", () => {
    const positioned = buildPositionedStudioGraphView(view());

    assert.equal(positioned.nodes[0]?.x, 0);
    assert.equal(positioned.nodes[1]?.x, 160);
    assert.equal(positioned.edges.length, 4);
  });
});

function view(): ReadOnlyCompositionView {
  return {
    contractId: "contract-1",
    candidateId: "cand-1",
    components: [
      {
        componentId: "storage-s3",
        catalogEntryId: "com.unfurl:storage-s3:1.2.0",
        name: "S3 Storage",
        coordinates: "com.unfurl:storage-s3:1.2.0",
        claimHash: "sha256:claim",
        artifactSha256: "sha256:artifact",
        visualStatus: "FALLBACK_SHAPE"
      }
    ],
    ports: [
      {
        componentId: "storage-s3",
        portId: "storage-s3:storage.put",
        capability: "storage.put",
        kind: "OFFER",
        status: "AVAILABLE"
      },
      {
        componentId: "storage-s3",
        portId: "storage-s3:substrate:secrets.provider",
        capability: "substrate:secrets.provider",
        kind: "SUBSTRATE_DEPENDENCY",
        status: "REQUIRED"
      }
    ],
    substrate: [
      {
        port: "secrets.provider",
        status: "REQUIRED",
        profileHash: "sha256:profile"
      }
    ],
    warnings: [
      {
        code: "VISUAL_FALLBACK",
        message: "using fallback shape"
      }
    ]
  };
}
