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
        tenantId: "tenant-local",
        assemblyId: "assembly-demo",
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
        tenantId: "tenant-local",
        assemblyId: "assembly-demo",
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
        reasons: [],
        trustRejections: [],
        reason: "No candidate",
        details: "No valid candidate is selected."
      }
    };

    const text = renderDraftWorkspaceOverlayText(buildDraftWorkspaceOverlay(state));

    assert.match(text, /ERROR INTENT_INVALID: Capability version conflict/);
    assert.match(text, /ERROR COMPILE_INVALID: No candidate/);
  });

  it("renders a NO_MATCH as one card per typed cause and trust rejection, in Fabric's words", () => {
    const state: DraftWorkspaceState = {
      status: "READY",
      session: { tenantId: "tenant-local", assemblyId: "assembly-demo", sessionId: "s", baseCatalogHash: "h", sceneRevision: 2, warnings: [] },
      history: createIntentHistory(2),
      lastCompile: {
        status: "INVALID",
        reason: "NO_MATCH",
        details: "the needs require agent.run ^0.1, but no selected component offers agent.run; add a component that offers it",
        reasons: [{ kind: "CONFLICT", reasonCode: "MISSING_CAPABILITY", capability: "agent.run",
          message: "the needs require agent.run ^0.1, but no selected component offers agent.run; add a component that offers it" }],
        trustRejections: [{ coordinates: "com.acme:agent:1.0.0", reasonCode: "VendorNotTrusted", message: "vendor Acme is not trusted" }]
      }
    };

    const items = buildDraftWorkspaceOverlay(state).items;

    assert.deepEqual(items.map(item => item.code), ["NO_MATCH:MISSING_CAPABILITY", "TRUST_REJECTED:VendorNotTrusted"]);
    assert.equal(items[0]!.message, "the needs require agent.run ^0.1, but no selected component offers agent.run; add a component that offers it");
    assert.equal(items[1]!.message, "com.acme:agent:1.0.0: vendor Acme is not trusted");
  });
});
