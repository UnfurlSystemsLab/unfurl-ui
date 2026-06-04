import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import { GraphPanel } from "./GraphPanel.js";

describe("GraphPanel", () => {
  it("renders the 2D graph controls by default", () => {
    const html = renderToString(<GraphPanel client={client()} />);

    assert.match(html, /Graph View/);
    assert.match(html, /Load Graph/);
    assert.match(html, /2D/);
    assert.match(html, /3D/);
  });

  it("renders the 3D not-yet-implemented message", () => {
    const html = renderToString(<GraphPanel client={client()} initialRenderer="3d" />);

    assert.match(html, /Graph View/);
    assert.match(html, /3D/);
  });
});

function client() {
  return createHttpStudioFabricClient({
    baseUrl: "http://fixture.unfurl.local",
    fetch: createMockStudioApiFetch()
  });
}
