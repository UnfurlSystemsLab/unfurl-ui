import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import { DraftWorkspacePanel } from "./DraftWorkspacePanel.js";

describe("DraftWorkspacePanel", () => {
  it("renders session, intent, compile, and handoff sections", () => {
    const html = renderToString(<DraftWorkspacePanel client={client()} />);

    assert.match(html, /Draft Workspace/);
    assert.match(html, /Create Draft/);
    assert.match(html, /Add Component/);
    assert.match(html, /Connect Ports/);
    assert.match(html, /Signing Handoff/);
  });
});

function client() {
  return createHttpStudioFabricClient({
    baseUrl: "http://fixture.unfurl.local",
    fetch: createMockStudioApiFetch()
  });
}
