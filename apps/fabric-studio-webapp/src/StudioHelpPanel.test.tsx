import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { StudioHelpPanel } from "./StudioHelpPanel.js";

describe("StudioHelpPanel", () => {
  it("documents the setup prerequisites for Studio", () => {
    const html = renderToString(<StudioHelpPanel />);

    assert.match(html, /Studio Setup Help/);
    assert.match(html, /id="scanned-catalog"/);
    assert.match(html, /id="component-claims"/);
    assert.match(html, /id="substrate-profile"/);
    assert.match(html, /id="trust-policy"/);
    assert.match(html, /id="deployment-policy"/);
    assert.match(html, /fabric scan --catalog/);
  });
});
