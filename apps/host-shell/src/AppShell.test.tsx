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
});
