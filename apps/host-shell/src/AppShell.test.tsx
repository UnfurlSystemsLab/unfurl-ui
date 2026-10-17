import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "./routes.js";
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
    assert.match(html, /Deployment/);
    assert.match(html, /fixture.*mode/s);
    assert.match(html, /tenant-local/);
    assert.match(html, /assembly-demo/);
  });

  it("renders the active tenant and assembly context", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/components/fabric-studio/workspace"]}>
        <StudioClientProvider mode="fixture">
          <AppShell mode="fixture" tenantId="tenant-payments" assemblyId="checkout-platform" />
        </StudioClientProvider>
      </MemoryRouter>
    );

    assert.match(html, /tenant-payments/);
    assert.match(html, /checkout-platform/);
  });

  it("passes workspace tenant and assembly query params into Studio", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/components/fabric-studio/workspace?tenantId=tenant-retail&assemblyId=checkout-platform"]}>
        <StudioClientProvider mode="fixture">
          <AppRoutes />
        </StudioClientProvider>
      </MemoryRouter>
    );

    assert.match(html, /tenant-retail/);
    assert.match(html, /checkout-platform/);
  });

  for (const [path, text] of [
    ["/components/fabric-studio/catalog", "Catalog Palette"],
    ["/components/fabric-studio/workspace", "Unfurl Studio Workbench"],
    ["/components/fabric-studio/read-only", "Read-Only Studio"],
    ["/components/fabric-studio/signing", "Signing Handoff"],
    ["/components/fabric-studio/graph", "Graph View"],
    ["/components/fabric-studio/audit", "Decision Audit"],
    ["/components/fabric-studio/intents", "Intent History"],
    ["/components/fabric-studio/diff", "Visual Diff"],
    ["/components/fabric-studio/help", "Studio Setup Help"]
  ] as const) {
    it(`renders ${path}`, () => {
      const html = renderToString(
        <MemoryRouter initialEntries={[path]}>
          <StudioClientProvider mode="fixture">
            <AppRoutes />
          </StudioClientProvider>
        </MemoryRouter>
      );

      assert.match(html, new RegExp(text));
    });
  }
});
