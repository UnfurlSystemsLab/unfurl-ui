import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import { DraftWorkspacePanel } from "./DraftWorkspacePanel.js";

describe("DraftWorkspacePanel", () => {
  it("renders the governed composition workbench", () => {
    const html = renderToString(<DraftWorkspacePanel client={client()} />);

    assert.match(html, /Unfurl Studio Workbench/);
    assert.match(html, /Catalog/);
    assert.match(html, /Document Workflow/);
    assert.match(html, /Substrate/);
    assert.match(html, /Inspector/);
    assert.match(html, /Validate Connection/);
  });
});

function client() {
  return createHttpStudioFabricClient({
    baseUrl: "http://fixture.unfurl.local",
    fetch: createMockStudioApiFetch()
  });
}
