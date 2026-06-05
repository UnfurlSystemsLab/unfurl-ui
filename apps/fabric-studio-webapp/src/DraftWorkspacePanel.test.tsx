import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import { DraftWorkspacePanel } from "./DraftWorkspacePanel.js";

describe("DraftWorkspacePanel", () => {
  it("renders the governed composition workbench", () => {
    const html = renderToString(<DraftWorkspacePanel client={client()} />);

    assert.match(html, /Unfurl Studio Workbench/);
    assert.match(html, /Guided Tour/);
    assert.match(html, /Start with the catalog/);
    assert.match(html, /Step.*1.*of.*7/s);
    assert.match(html, /Assembly/);
    assert.match(html, /Catalog/);
    assert.match(html, /API Gateway/);
    assert.match(html, /Validation Service/);
    assert.match(html, /Substrate Runtime Layer/);
    assert.match(html, /3D assembly scene/);
    assert.match(html, /Inspector/);
    assert.match(html, /Component Details/);
    assert.match(html, /Selected Scene Part/);
    assert.match(html, /Take Out/);
    assert.match(html, /Replace Component/);
    assert.match(html, /Replacement candidates/);
    assert.match(html, /Customer Policy Validator/);
    assert.match(html, /Fraud-only Validator/);
    assert.match(html, /Blocked/);
    assert.match(html, /Validate &amp; Replace/);
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
