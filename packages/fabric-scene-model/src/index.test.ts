import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReadOnlyCompositionView } from "./index.js";

describe("read-only composition view", () => {
  it("builds accessible table rows for components ports and substrate requirements", () => {
    const view = buildReadOnlyCompositionView({
      contractId: "contract-1",
      candidateId: "cand-abc",
      selections: [
        {
          componentId: "storage-s3",
          catalogEntryId: "com.unfurl:storage-s3:1.2.0",
          name: "S3 Storage",
          coordinates: "com.unfurl:storage-s3:1.2.0",
          claimHash: "sha256:claim",
          artifactSha256: "sha256:artifact",
          capabilities: ["storage.put", "storage.get"],
          dependencies: ["substrate:secrets.provider"],
          refusals: ["identity-management"]
        }
      ],
      substrateProfile: {
        profileHash: "sha256:profile",
        requiredPorts: ["secrets.provider", "telemetry.otel"]
      },
      visualCatalog: [
        {
          catalogEntryId: "com.unfurl:storage-s3:1.2.0",
          claimHash: "sha256:claim",
          artifactSha256: "sha256:artifact",
          visualManifest: {
            fallbackShape: { kind: "CUBE", category: "STORAGE" },
            ports: [],
            interactions: { draggable: true, connectable: true, inspectable: true }
          },
          visualIntegrity: { assets: [] },
          warnings: []
        }
      ],
      warnings: [{ code: "INFO", message: "read-only" }]
    });

    assert.equal(view.components[0]?.visualStatus, "FALLBACK_SHAPE");
    assert.deepEqual(view.ports.map(port => port.kind), ["OFFER", "OFFER", "SUBSTRATE_DEPENDENCY", "REFUSAL"]);
    assert.deepEqual(view.substrate.map(row => row.port), ["secrets.provider", "telemetry.otel"]);
    assert.equal(view.warnings[0]?.message, "read-only");
  });
});
