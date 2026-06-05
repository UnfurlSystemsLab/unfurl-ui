import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDraftExportBundle, createIntentHistory, renderDraftExportText, type DraftWorkspaceState } from "./index.js";
import type { CompileDraftCandidateResponse } from "@unfurl/fabric-validation-client";

describe("draft export bundle", () => {
  it("exposes contract profile and signed contract artifacts from Fabric compile output", () => {
    const bundle = buildDraftExportBundle(readyState({
      status: "COMPILED",
      candidateId: "cand-abc123",
      contractArtifact: artifact("contract"),
      substrateProfileArtifact: artifact("profile"),
      signedContractArtifact: artifact("signed"),
      warnings: ["signature will expire in 7 days"]
    }));

    assert.equal(bundle.status, "READY");
    assert.deepEqual(bundle.status === "READY" ? bundle.items.map(item => item.kind) : [], [
      "COMPOSITION_CONTRACT",
      "SUBSTRATE_PROFILE",
      "SIGNED_CONTRACT"
    ]);
    assert.match(renderDraftExportText(bundle), /SIGNED_CONTRACT: \/studio\/assets\/signed/);
  });

  it("keeps export unavailable until Fabric has compiled the draft", () => {
    const bundle = buildDraftExportBundle(readyState(undefined));

    assert.deepEqual(bundle, {
      status: "UNAVAILABLE",
      reason: "draft has not been compiled"
    });
  });

  it("does not export stale or invalid compile results", () => {
    assert.equal(
      buildDraftExportBundle(readyState({
        status: "STALE_REVISION",
        expectedRevision: 9,
        receivedRevision: 7
      })).status,
      "UNAVAILABLE"
    );

    assert.match(renderDraftExportText(buildDraftExportBundle(readyState({
      status: "INVALID",
      reason: "No candidate",
      details: "No valid candidate is selected."
    }))), /No candidate/);
  });
});

function readyState(lastCompile: CompileDraftCandidateResponse | undefined): DraftWorkspaceState {
  const base = {
    status: "READY" as const,
    session: {
      tenantId: "tenant-local",
      assemblyId: "assembly-demo",
      sessionId: "studio-session-123",
      baseCatalogHash: "sha256:catalog",
      sceneRevision: 7,
      warnings: []
    },
    history: createIntentHistory(7)
  };
  return lastCompile === undefined ? base : { ...base, lastCompile };
}

function artifact(name: string) {
  return {
    artifactId: name,
    mediaType: "application/yaml",
    sha256: `sha256:${name}`,
    url: `/studio/assets/${name}`
  };
}
