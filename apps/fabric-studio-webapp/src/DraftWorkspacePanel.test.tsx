import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import { DraftWorkspacePanel } from "./DraftWorkspacePanel.js";

describe("DraftWorkspacePanel", () => {
  it("renders the governed composition workbench", () => {
    const html = renderToString(<DraftWorkspacePanel client={client()} />);

    assert.match(html, /Unfurl Studio Workbench/);
    assert.match(html, /Assembly/);
    assert.match(html, /Catalog/);
    assert.match(html, /API Gateway/);
    assert.match(html, /Validation Service/);
    assert.match(html, /Substrate Runtime Layer/);
    assert.match(html, /Inspector/);
    assert.match(html, /Component Details/);
    assert.match(html, /Validate Connection/);
  });

  it("renders inspectable component-specific metadata", () => {
    const html = renderToString(<DraftWorkspacePanel client={client()} />);

    assert.match(html, /Payment Service/);
    assert.match(html, /Storage Adapter/);
    assert.match(html, /Provided Ports/);
    assert.match(html, /customer.query/);
    assert.match(html, /policy.evaluate/);
    assert.match(html, /rules.fetch/);
  });
});

function client() {
  return createHttpStudioFabricClient({
    baseUrl: "http://fixture.unfurl.local",
    fetch: createMockStudioApiFetch()
  });
}
