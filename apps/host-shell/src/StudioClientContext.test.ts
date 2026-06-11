import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { studioAssemblyId, studioMode, studioTenantId } from "./StudioClientContext.js";

describe("Studio client mode", () => {
  it("defaults to live mode so the React app talks to the real Studio backend; fixture is opt-in", () => {
    // Flipped intentionally in the catalog/tenant campaign — the silent
    // fixture default was hiding every backend change behind a mock that
    // only knew the example tenant. Fixture stays available via
    // VITE_STUDIO_MODE=fixture for offline dev / demos / screenshots.
    assert.equal(studioMode(), "live");
  });

  it("defaults to the local tenant and demo assembly scope", () => {
    assert.equal(studioTenantId(), "tenant-local");
    assert.equal(studioAssemblyId(), "assembly-demo");
  });
});
