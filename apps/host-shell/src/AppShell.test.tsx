import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "./AppShell.js";
import { StudioClientProvider } from "./StudioClientContext.js";

describe("AppShell", () => {
  it("renders the deployment planner route in fixture mode", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/components/fabric-studio/deployment-planner"]}>
        <StudioClientProvider mode="fixture">
          <AppShell mode="fixture" />
        </StudioClientProvider>
      </MemoryRouter>
    );

    assert.match(html, /Unfurl Studio/);
    assert.match(html, /Deployment Planner/);
    assert.match(html, /fixture.*mode/s);
  });

  for (const [path, text] of [
    ["/components/fabric-studio/catalog", "Catalog Palette"],
    ["/components/fabric-studio/workspace", "Unfurl Studio Workbench"],
    ["/components/fabric-studio/read-only", "Read-Only Studio"],
    ["/components/fabric-studio/signing", "Signing Handoff"],
    ["/components/fabric-studio/graph", "Graph View"],
    ["/components/fabric-studio/audit", "Decision Audit"],
    ["/components/fabric-studio/intents", "Intent History"],
    ["/components/fabric-studio/diff", "Visual Diff"]
  ] as const) {
    it(`renders ${path}`, () => {
      const html = renderToString(
        <MemoryRouter initialEntries={[path]}>
          <StudioClientProvider mode="fixture">
            <AppShell mode="fixture" />
          </StudioClientProvider>
        </MemoryRouter>
      );

      assert.match(html, new RegExp(text));
      assert.match(html, /Catalog Palette/);
      assert.match(html, /Studio Workbench/);
      assert.match(html, /Read-Only Studio/);
      assert.match(html, /Signing Handoff/);
      assert.match(html, /Graph View/);
      assert.match(html, /Decision Audit/);
      assert.match(html, /Intent History/);
      assert.match(html, /Visual Diff/);
    });
  }
});
