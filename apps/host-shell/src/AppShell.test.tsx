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
    ["/components/fabric-studio/workspace", "Draft Workspace"],
    ["/components/fabric-studio/read-only", "Read-Only Studio"],
    ["/components/fabric-studio/signing", "Signing Handoff"]
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
      assert.match(html, /Draft Workspace/);
      assert.match(html, /Read-Only Studio/);
      assert.match(html, /Signing Handoff/);
    });
  }
});
