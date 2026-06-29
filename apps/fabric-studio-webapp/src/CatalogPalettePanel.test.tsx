import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import { AdmissionResults, CatalogPalettePanel, toAdmissionDraft } from "./CatalogPalettePanel.js";

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

  it("renders the downloadable resolved claim bundle when admission returns one", () => {
    const html = renderToString(<AdmissionResults
      results={[]}
      claimBundleArtifact={{
        artifactId: "adm-123",
        mediaType: "application/zip",
        sha256: "sha256:bundle",
        url: "/studio/tenants/tenant-a/catalog/admissions/adm-123/claims.zip?sha256=sha256:bundle"
      }}
    />);

    assert.match(html, /Download Claims Bundle/);
    assert.match(html, /claims\.zip\?sha256=sha256:bundle/);
  });

  it("converts YAML uploads into claim admission drafts", async () => {
    const draft = await toAdmissionDraft(new File(["identity:\n  name: payment\n"], "payment.yaml"));

    assert.deepEqual(draft, {
      fileName: "payment.yaml",
      claimYaml: "identity:\n  name: payment\n"
    });
  });

  it("converts JAR uploads into base64 artifact admission drafts", async () => {
    const draft = await toAdmissionDraft(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "payment.jar"));

    assert.deepEqual(draft, {
      fileName: "payment.jar",
      artifactBase64: "UEsDBA=="
    });
  });
});

function client() {
  return createHttpStudioFabricClient({
    baseUrl: "http://fixture.unfurl.local",
    fetch: createMockStudioApiFetch()
  });
}
