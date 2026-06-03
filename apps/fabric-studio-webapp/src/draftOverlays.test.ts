import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDraftWorkspaceOverlay,
  createIntentHistory,
  renderDraftWorkspaceOverlayText,
  type DraftWorkspaceState
} from "./index.js";

describe("draft workspace overlays", () => {
  it("surfaces candidate revision substrate ports and warnings for ready drafts", () => {
    const overlay = buildDraftWorkspaceOverlay({
      status: "READY",
      session: {
        sessionId: "studio-session-123",
        baseCatalogHash: "sha256:catalog",
        currentCandidateId: "cand-abc123",
        sceneRevision: 7,
        warnings: [{ code: "TRUST_POLICY_PERMISSIVE", message: "No trust policy supplied." }]
      },
      history: createIntentHistory(7),
      lastResponse: {
        status: "VALID",
        newRevision: 8,
        updatedCandidateId: "cand-next",
        requiredSubstratePorts: ["secrets.provider"],
        warnings: ["optional audit component was not selected"]
      }
    });

    assert.equal(overlay.candidateId, "cand-abc123");
    assert.equal(overlay.revision, 7);
    assert.deepEqual(overlay.requiredSubstratePorts, ["secrets.provider"]);
    assert.deepEqual(overlay.items.map(item => item.code), [
      "TRUST_POLICY_PERMISSIVE",
      "INTENT_VALID",
      "INTENT_WARNING"
    ]);
  });

  it("renders invalid intent and compile failures as errors", () => {
    const state: DraftWorkspaceState = {
      status: "READY",
      session: {
        sessionId: "studio-session-123",
        baseCatalogHash: "sha256:catalog",
        sceneRevision: 7,
        warnings: []
      },
      history: createIntentHistory(7),
      lastResponse: {
        status: "INVALID",
        reason: "Capability version conflict",
        details: "storage.put@2.0 cannot satisfy storage.put@^1"
      },
      lastCompile: {
        status: "INVALID",
        reason: "No candidate",
        details: "No valid candidate is selected."
      }
    };

    const text = renderDraftWorkspaceOverlayText(buildDraftWorkspaceOverlay(state));

    assert.match(text, /ERROR INTENT_INVALID: Capability version conflict/);
    assert.match(text, /ERROR COMPILE_INVALID: No candidate/);
  });
});
