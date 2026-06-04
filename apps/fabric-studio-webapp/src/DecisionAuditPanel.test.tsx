import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import { DecisionAuditPanel } from "./DecisionAuditPanel.js";

describe("DecisionAuditPanel", () => {
  it("renders audit source and summary", () => {
    const html = renderToString(<DecisionAuditPanel client={client()} />);

    assert.match(html, /Decision Audit/);
    assert.match(html, /Session ID/);
    assert.match(html, /Load Audit/);
    assert.match(html, /selection mode/);
  });
});

function client() {
  return createHttpStudioFabricClient({
    baseUrl: "http://fixture.unfurl.local",
    fetch: createMockStudioApiFetch()
  });
}
