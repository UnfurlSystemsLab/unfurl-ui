import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import { SigningHandoffPanel } from "./SigningHandoffPanel.js";

describe("SigningHandoffPanel", () => {
  it("renders compile request and handoff status", () => {
    const html = renderToString(<SigningHandoffPanel client={client()} />);

    assert.match(html, /Signing Handoff/);
    assert.match(html, /Session ID/);
    assert.match(html, /Expected revision/);
    assert.match(html, /Compile for Handoff/);
  });
});

function client() {
  return createHttpStudioFabricClient({
    baseUrl: "http://fixture.unfurl.local",
    fetch: createMockStudioApiFetch()
  });
}
