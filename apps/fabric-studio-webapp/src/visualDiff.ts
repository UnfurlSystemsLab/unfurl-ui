import type { DraftExportBundle } from "./draftExport.js";
import type { GovernedIntentHistory } from "./intentHistory.js";

export type VisualDiff = {
  readonly revisionFrom: number;
  readonly revisionTo: number;
  readonly changedArtifacts: readonly VisualArtifactChange[];
  readonly intentTypes: readonly string[];
};

export type VisualArtifactChange = {
  readonly kind: string;
  readonly beforeSha256?: string;
  readonly afterSha256?: string;
};

export function buildVisualDiff(
  before: DraftExportBundle,
  after: DraftExportBundle,
  history: GovernedIntentHistory
): VisualDiff {
  return {
    revisionFrom: history.initialRevision,
    revisionTo: history.cursor === 0
      ? history.initialRevision
      : history.records[history.cursor - 1]?.toRevision ?? history.initialRevision,
    changedArtifacts: diffArtifacts(before, after),
    intentTypes: history.records.slice(0, history.cursor).map(record => record.intent.type)
  };
}

export function renderVisualDiffText(diff: VisualDiff): string {
  const lines = [`revision: ${diff.revisionFrom} -> ${diff.revisionTo}`];
  lines.push(`intents: ${diff.intentTypes.join(", ") || "none"}`);
  for (const change of diff.changedArtifacts) {
    lines.push(`${change.kind}: ${change.beforeSha256 ?? "missing"} -> ${change.afterSha256 ?? "missing"}`);
  }
  return lines.join("\n");
}

function diffArtifacts(before: DraftExportBundle, after: DraftExportBundle): readonly VisualArtifactChange[] {
  if (before.status !== "READY" && after.status !== "READY") {
    return [];
  }
  const beforeByKind = new Map(before.status === "READY"
    ? before.items.map(item => [item.kind, item.artifact.sha256])
    : []);
  const afterByKind = new Map(after.status === "READY"
    ? after.items.map(item => [item.kind, item.artifact.sha256])
    : []);
  const kinds = [...new Set([...beforeByKind.keys(), ...afterByKind.keys()])].sort();
  return kinds
    .filter(kind => beforeByKind.get(kind) !== afterByKind.get(kind))
    .map(kind => {
      const beforeSha256 = beforeByKind.get(kind);
      const afterSha256 = afterByKind.get(kind);
      if (beforeSha256 === undefined) {
        return afterSha256 === undefined ? { kind } : { kind, afterSha256 };
      }
      if (afterSha256 === undefined) {
        return { kind, beforeSha256 };
      }
      return { kind, beforeSha256, afterSha256 };
    });
}
