import type { StudioDecisionAudit } from "@unfurl/fabric-validation-client";

export type DecisionAuditView = {
  readonly selectionMode: string;
  readonly selectedCandidateId?: string;
  readonly alternatives: readonly DecisionAlternativeRow[];
  readonly scores: readonly DecisionScoreRow[];
  readonly warnings: readonly string[];
};

export type DecisionAlternativeRow = {
  readonly candidateId: string;
  readonly score: string;
  readonly selected: "YES" | "NO";
  readonly reason: string;
};

export type DecisionScoreRow = {
  readonly factor: string;
  readonly value: string;
  readonly explanation: string;
};

export function buildDecisionAuditView(audit: StudioDecisionAudit | undefined): DecisionAuditView {
  if (!audit) {
    return {
      selectionMode: "UNKNOWN",
      alternatives: [],
      scores: [],
      warnings: []
    };
  }
  const selected = audit.alternativesConsidered.find(alternative => alternative.selected);
  const base = {
    selectionMode: audit.selectionMode,
    alternatives: audit.alternativesConsidered.map(alternative => ({
      candidateId: alternative.candidateId,
      score: alternative.score.toFixed(3),
      selected: alternative.selected ? "YES" as const : "NO" as const,
      reason: alternative.reason
    })),
    scores: audit.scoreBreakdown.map(score => ({
      factor: score.factor,
      value: score.value.toFixed(3),
      explanation: score.explanation
    })),
    warnings: audit.planningWarnings
  };
  return selected === undefined ? base : { ...base, selectedCandidateId: selected.candidateId };
}

export function renderDecisionAuditText(view: DecisionAuditView): string {
  const lines = [`selection mode: ${view.selectionMode}`];
  if (view.selectedCandidateId) {
    lines.push(`selected candidate: ${view.selectedCandidateId}`);
  }
  for (const alternative of view.alternatives) {
    lines.push(`alternative ${alternative.candidateId}: ${alternative.score} selected=${alternative.selected} ${alternative.reason}`);
  }
  for (const score of view.scores) {
    lines.push(`score ${score.factor}: ${score.value} ${score.explanation}`);
  }
  for (const warning of view.warnings) {
    lines.push(`WARNING: ${warning}`);
  }
  return lines.join("\n");
}
