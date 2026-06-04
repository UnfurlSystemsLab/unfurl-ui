import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { VisualDiffPanel } from "./VisualDiffPanel.js";

describe("VisualDiffPanel", () => {
  it("renders artifact diff rows", () => {
    const html = renderToString(<VisualDiffPanel />);

    assert.match(html, /Visual Diff/);
    assert.match(html, /Artifact Changes/);
    assert.match(html, /COMPOSITION_CONTRACT/);
    assert.match(html, /sha256:contract-old/);
  });
});
