import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDecisionAuditView, renderDecisionAuditText } from "./index.js";

describe("decision audit view", () => {
  it("projects audit alternatives scores and warnings into operator text", () => {
    const view = buildDecisionAuditView({
      selectionMode: "AUTO_BEST_SCORE",
      alternativesConsidered: [
        { candidateId: "cand-a", score: 0.7, selected: false, reason: "lower score" },
        { candidateId: "cand-b", score: 0.9, selected: true, reason: "highest score" }
      ],
      scoreBreakdown: [
        { factor: "trust", value: 1, explanation: "trusted vendor" }
      ],
      planningWarnings: ["No trust policy supplied."]
    });

    assert.equal(view.selectedCandidateId, "cand-b");
    assert.match(renderDecisionAuditText(view), /selection mode: AUTO_BEST_SCORE/);
    assert.match(renderDecisionAuditText(view), /score trust: 1.000 trusted vendor/);
  });
});
