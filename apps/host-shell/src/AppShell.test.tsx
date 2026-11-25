import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "./routes.js";
import { AppShell } from "./AppShell.js";
import { StudioClientProvider } from "./StudioClientContext.js";

describe("AppShell", () => {
  it("renders the workbench in fixture mode with Studio's three navigation entries", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/components/fabric-studio/workspace"]}>
        <StudioClientProvider mode="fixture">
          <AppShell mode="fixture" />
        </StudioClientProvider>
      </MemoryRouter>
    );

    assert.match(html, /Unfurl Studio/);
    assert.match(html, /fixture.*mode/s);
    assert.match(html, /tenant-local/);
    assert.match(html, /assembly-demo/);
    const links = [...html.matchAll(/href="\/components\/fabric-studio\/([a-z-]+)/g)].map(match => match[1]);
    assert.deepEqual([...new Set(links)], ["workspace", "catalog", "help"]);
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
