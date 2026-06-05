import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import { CatalogPalettePanel } from "./CatalogPalettePanel.js";

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
});

function client() {
  return createHttpStudioFabricClient({
    baseUrl: "http://fixture.unfurl.local",
    fetch: createMockStudioApiFetch()
  });
}
