import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signingHandoffFromCompile } from "./index.js";

describe("signing handoff", () => {
  it("reports signed contract artifacts when Fabric returns them", () => {
    const handoff = signingHandoffFromCompile({
      status: "COMPILED",
      candidateId: "cand-abc123",
      contractArtifact: artifact("contract"),
      substrateProfileArtifact: artifact("profile"),
      signedContractArtifact: artifact("signed"),
      warnings: []
    });

    assert.deepEqual(handoff, {
      status: "SIGNED",
      signedContractUrl: "/studio/assets/signed",
      sha256: "sha256:signed"
    });
  });

  it("offers unsigned handoff when compile succeeded without signing", () => {
    const handoff = signingHandoffFromCompile({
      status: "COMPILED",
      candidateId: "cand-abc123",
      contractArtifact: artifact("contract"),
      substrateProfileArtifact: artifact("profile"),
      warnings: []
    });

    assert.equal(handoff.status, "UNSIGNED_READY");
  });

  it("asks for a signed compile when signing was requested but no artifact exists", () => {
    const handoff = signingHandoffFromCompile({
      status: "COMPILED",
      candidateId: "cand-abc123",
      contractArtifact: artifact("contract"),
      substrateProfileArtifact: artifact("profile"),
      warnings: []
    }, { signingRequested: true });

    assert.equal(handoff.status, "REQUEST_SIGNED_COMPILE");
  });
});

function artifact(name: string) {
  return {
    artifactId: name,
    mediaType: "application/yaml",
    sha256: `sha256:${name}`,
    url: `/studio/assets/${name}`
  };
}
