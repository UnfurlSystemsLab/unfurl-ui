import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStudioTableView, renderStudioTableText } from "./tableView.js";

describe("Fabric Studio table view", () => {
  it("builds accessible table sections from a read-only composition view", () => {
    const table = buildStudioTableView({
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
    });

    assert.equal(table.title, "Composition contract-1");
    assert.deepEqual(table.summary, [
      "candidate: cand-1",
      "components: 1",
      "ports: 1",
      "substrate ports: 1",
      "warnings: 1"
    ]);
    assert.deepEqual(table.sections.map(section => section.title), ["Components", "Ports", "Substrate", "Warnings"]);

    const text = renderStudioTableText(table);
    assert.match(text, /S3 Storage/);
    assert.match(text, /storage.put/);
    assert.match(text, /secrets.provider/);
    assert.match(text, /using fallback shape/);
  });
});
