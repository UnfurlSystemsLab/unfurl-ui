import type { IntentResponse, StudioIntent } from "@unfurl/fabric-validation-client";

export type ValidatedIntentRecord = {
  readonly intent: StudioIntent;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly updatedCandidateId?: string;
  readonly requiredSubstratePorts: readonly string[];
  readonly warnings: readonly string[];
};

export type GovernedIntentHistory = {
  readonly initialRevision: number;
  readonly cursor: number;
  readonly records: readonly ValidatedIntentRecord[];
};

export function createIntentHistory(initialRevision = 0): GovernedIntentHistory {
  return {
    initialRevision,
    cursor: 0,
    records: []
  };
}

export function appendValidatedIntent(
  history: GovernedIntentHistory,
  intent: StudioIntent,
  response: IntentResponse
): GovernedIntentHistory {
  if (response.status !== "VALID") {
    throw new Error(`cannot add ${response.status} intent response to governed history`);
  }
  const current = currentRevision(history);
  if (intent.baseRevision !== current) {
    throw new Error(`intent baseRevision ${intent.baseRevision} does not match current revision ${current}`);
  }

  const records = history.records.slice(0, history.cursor);
  const record: ValidatedIntentRecord = {
    intent,
    fromRevision: intent.baseRevision,
    toRevision: response.newRevision,
    requiredSubstratePorts: response.requiredSubstratePorts,
    warnings: response.warnings
  };
  records.push(response.updatedCandidateId === undefined
    ? record
    : { ...record, updatedCandidateId: response.updatedCandidateId });

  return {
    initialRevision: history.initialRevision,
    cursor: records.length,
    records
  };
}

export function undoIntent(history: GovernedIntentHistory): GovernedIntentHistory {
  if (!canUndo(history)) {
    return history;
  }
  return {
    ...history,
    cursor: history.cursor - 1
  };
}

export function redoIntent(history: GovernedIntentHistory): GovernedIntentHistory {
  if (!canRedo(history)) {
    return history;
  }
  return {
    ...history,
    cursor: history.cursor + 1
  };
}

export function canUndo(history: GovernedIntentHistory): boolean {
  return history.cursor > 0;
}

export function canRedo(history: GovernedIntentHistory): boolean {
  return history.cursor < history.records.length;
}

export function currentRevision(history: GovernedIntentHistory): number {
  if (history.cursor === 0) {
    return history.initialRevision;
  }
  return history.records[history.cursor - 1]?.toRevision ?? history.initialRevision;
}

export function currentIntentRecord(history: GovernedIntentHistory): ValidatedIntentRecord | undefined {
  if (history.cursor === 0) {
    return undefined;
  }
  return history.records[history.cursor - 1];
}
