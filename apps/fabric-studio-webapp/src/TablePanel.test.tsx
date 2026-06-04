import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { buildStudioTableView } from "./tableView.js";
import { TablePanel } from "./TablePanel.js";

describe("TablePanel", () => {
  it("renders every table section", () => {
    const html = renderToString(<TablePanel table={buildStudioTableView(view())} />);

    assert.match(html, /Composition contract-123/);
    assert.match(html, /Components/);
    assert.match(html, /Ports/);
    assert.match(html, /Substrate/);
    assert.match(html, /Warnings/);
  });
});

function view() {
  return {
    contractId: "contract-123",
    candidateId: "cand-abc123",
    components: [
      {
        componentId: "storage-s3",
        catalogEntryId: "com.unfurl:storage-s3:1.2.0",
        name: "S3 Storage",
        coordinates: "com.unfurl:storage-s3:1.2.0",
        claimHash: "sha256:claim",
        artifactSha256: "sha256:artifact",
        visualStatus: "FALLBACK_SHAPE" as const
      }
    ],
    ports: [],
    substrate: [],
    warnings: []
  };
}
