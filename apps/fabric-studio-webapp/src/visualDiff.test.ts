import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appendValidatedIntent,
  buildVisualDiff,
  createIntentHistory,
  exportBundleFromCompile,
  renderVisualDiffText
} from "./index.js";

describe("visual diff", () => {
  it("shows artifact hash changes and validated intent path", () => {
    const history = appendValidatedIntent(createIntentHistory(7), {
      sessionId: "studio-session-123",
      baseRevision: 7,
      type: "REPLACE_COMPONENT",
      oldComponentId: "storage-s3",
      newCatalogEntryId: "storage-blob"
    }, {
      status: "VALID",
      newRevision: 8,
      requiredSubstratePorts: [],
      warnings: []
    });

    const diff = buildVisualDiff(
      exportBundleFromCompile(compiled("old")),
      exportBundleFromCompile(compiled("new")),
      history
    );

    assert.equal(diff.revisionTo, 8);
    assert.deepEqual(diff.intentTypes, ["REPLACE_COMPONENT"]);
    assert.match(renderVisualDiffText(diff), /COMPOSITION_CONTRACT: sha256:contract-old -> sha256:contract-new/);
  });
});

function compiled(suffix: string) {
  return {
    status: "COMPILED" as const,
    candidateId: `cand-${suffix}`,
    contractArtifact: artifact(`contract-${suffix}`),
    substrateProfileArtifact: artifact(`profile-${suffix}`),
    warnings: []
  };
}

function artifact(name: string) {
  return {
    artifactId: name,
    mediaType: "application/yaml",
    sha256: `sha256:${name}`,
    url: `/studio/assets/${name}`
  };
}
