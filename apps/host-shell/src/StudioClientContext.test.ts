import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { studioAssemblyId, studioMode, studioTenantId } from "./StudioClientContext.js";

describe("Studio client mode", () => {
  it("defaults to fixture mode so standalone Studio does not call a missing live API", () => {
    assert.equal(studioMode(), "fixture");
  });

  it("defaults to the local tenant and demo assembly scope", () => {
    assert.equal(studioTenantId(), "tenant-local");
    assert.equal(studioAssemblyId(), "assembly-demo");
  });
});
