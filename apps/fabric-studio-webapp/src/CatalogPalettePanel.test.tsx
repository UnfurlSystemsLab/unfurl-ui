import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import { AdmissionResults, CatalogPalettePanel } from "./CatalogPalettePanel.js";

describe("CatalogPalettePanel", () => {
  it("renders catalog controls and loading-safe structure", () => {
    const html = renderToString(<CatalogPalettePanel client={client()} />);

    assert.match(html, /Catalog Palette/);
    assert.match(html, /Search catalog/);
    assert.match(html, /Warnings only/);
    assert.match(html, /Add Components/);
    assert.match(html, /Component artifacts/);
    assert.match(html, /Verify Component Claims/);
    assert.match(html, /blocked until verified/);
  });

  it("renders DCP admission diagnostics with code path and message", () => {
    const html = renderToString(<AdmissionResults results={[{
      fileName: "broken.yaml",
      status: "REJECTED",
      catalogEntryId: "",
      claimHash: "",
      warnings: ["metadata.dcp_version: metadata.dcp_version must be >= 0.2.0"],
      diagnostics: [{
        severity: "ERROR",
        code: "DCP_VERSION_UNSUPPORTED",
        path: "metadata.dcp_version",
        message: "metadata.dcp_version must be >= 0.2.0"
      }]
    }]} />);

    assert.match(html, /broken\.yaml/);
    assert.match(html, /DCP_VERSION_UNSUPPORTED/);
    assert.match(html, /metadata\.dcp_version/);
    assert.match(html, /must be &gt;= 0\.2\.0/);
  });
});

function client() {
  return createHttpStudioFabricClient({
    baseUrl: "http://fixture.unfurl.local",
    fetch: createMockStudioApiFetch()
  });
}
