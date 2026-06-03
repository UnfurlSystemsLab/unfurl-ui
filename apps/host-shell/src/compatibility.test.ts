import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkWebappCompatibility, versionSatisfiesRange } from "./compatibility.js";

describe("host compatibility checks", () => {
  it("supports bounded semver comparator ranges", () => {
    assert.equal(versionSatisfiesRange("1.4.0", ">=1.0.0 <2.0.0"), true);
    assert.equal(versionSatisfiesRange("2.0.0", ">=1.0.0 <2.0.0"), false);
    assert.equal(versionSatisfiesRange("0.9.9", ">=1.0.0 <2.0.0"), false);
  });

  it("reports incompatible host contract fields", () => {
    const result = checkWebappCompatibility({
      hostShell: ">=1.0.0 <2.0.0",
      hostShellApi: ">=2.0.0 <3.0.0",
      microAppProps: ">=1.0.0 <2.0.0",
      eventBus: ">=1.0.0 <2.0.0",
      themeSystem: ">=1.0.0 <2.0.0",
      componentContract: "rag@1.x"
    }, {
      hostShell: "1.0.0",
      hostShellApi: "1.0.0",
      microAppProps: "1.0.0",
      eventBus: "1.0.0",
      themeSystem: "1.0.0"
    });

    assert.equal(result.compatible, false);
    if (!result.compatible) {
      assert.deepEqual(result.failures.map(failure => failure.field), ["hostShellApi"]);
    }
  });
});
