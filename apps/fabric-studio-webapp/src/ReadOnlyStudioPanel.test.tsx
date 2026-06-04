import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import { ReadOnlyStudioPanel } from "./ReadOnlyStudioPanel.js";

describe("ReadOnlyStudioPanel", () => {
  it("renders composition inspection inputs", () => {
    const html = renderToString(<ReadOnlyStudioPanel client={client()} />);

    assert.match(html, /Read-Only Studio/);
    assert.match(html, /Contract path/);
    assert.match(html, /Substrate profile path/);
    assert.match(html, /No composition loaded/);
  });
});

function client() {
  return createHttpStudioFabricClient({
    baseUrl: "http://fixture.unfurl.local",
    fetch: createMockStudioApiFetch()
  });
}
