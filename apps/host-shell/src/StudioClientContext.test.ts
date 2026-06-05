import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { studioMode } from "./StudioClientContext.js";

describe("Studio client mode", () => {
  it("defaults to fixture mode so standalone Studio does not call a missing live API", () => {
    assert.equal(studioMode(), "fixture");
  });
});
