import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { IntentHistoryPanel } from "./IntentHistoryPanel.js";

describe("IntentHistoryPanel", () => {
  it("renders intent history controls", () => {
    const html = renderToString(<IntentHistoryPanel fixture />);

    assert.match(html, /Intent History/);
    assert.match(html, /Add Sample Intent/);
    assert.match(html, /Undo/);
    assert.match(html, /Validated Intents/);
  });
});
