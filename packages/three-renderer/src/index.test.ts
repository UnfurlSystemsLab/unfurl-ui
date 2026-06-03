import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReadOnlyRenderScene } from "./index.js";
import type { ReadOnlyCompositionView } from "@unfurl/fabric-scene-model";

describe("read-only render scene", () => {
  it("projects components ports substrate sockets and pipes into renderer DTOs", () => {
    const scene = buildReadOnlyRenderScene(view());

    assert.deepEqual(scene.components.map(component => [component.id, component.shape.category]), [
      ["storage-s3", "STORAGE"]
    ]);
    assert.deepEqual(scene.ports.map(port => [port.id, port.kind]), [
      ["port:storage-s3:storage.put", "OFFER"],
      ["port:storage-s3:substrate:secrets.provider", "SUBSTRATE_DEPENDENCY"]
    ]);
    assert.deepEqual(scene.substrateSockets.map(socket => socket.id), ["substrate:secrets.provider"]);
    assert.deepEqual(scene.pipes.map(pipe => [pipe.from, pipe.to, pipe.kind]), [
      ["port:storage-s3:substrate:secrets.provider", "substrate:secrets.provider", "SUBSTRATE_PIPE"]
    ]);
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
    warnings: []
  };
}
