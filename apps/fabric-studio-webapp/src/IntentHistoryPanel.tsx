import { useState } from "react";
import {
  appendValidatedIntent,
  createIntentHistory,
  redoIntent,
  undoIntent,
  type GovernedIntentHistory
} from "./intentHistory.js";

export type IntentHistoryPanelProps = {
  readonly initialRevision?: number;
};

export function IntentHistoryPanel({ initialRevision = 7 }: IntentHistoryPanelProps) {
  const [history, setHistory] = useState<GovernedIntentHistory>(() => createIntentHistory(initialRevision));

  function addSampleIntent() {
    const baseRevision = history.cursor === 0
      ? history.initialRevision
      : history.records[history.cursor - 1]?.toRevision ?? history.initialRevision;
    setHistory(current => appendValidatedIntent(current, {
      sessionId: "studio-session-123",
      baseRevision,
      type: "REPLACE_COMPONENT",
      oldComponentId: "storage-s3",
      newCatalogEntryId: "com.unfurl:storage-blob:1.1.0"
    }, {
      status: "VALID",
      newRevision: baseRevision + 1,
      updatedCandidateId: "cand-abc123",
      requiredSubstratePorts: ["secrets.provider"],
      warnings: []
    }));
  }

  return (
    <div className="studio-page">
      <header className="studio-header">
        <h1>Intent History</h1>
        <p>Review validated operator intents and move through undo/redo cursor state.</p>
      </header>

      <section className="studio-panel">
        <h2>Controls</h2>
        <div className="button-row">
          <button type="button" onClick={addSampleIntent}>Add Sample Intent</button>
          <button type="button" className="secondary" onClick={() => setHistory(current => undoIntent(current))}>Undo</button>
          <button type="button" className="secondary" onClick={() => setHistory(current => redoIntent(current))}>Redo</button>
        </div>
        <div className="summary-row">
          <span>initial revision: {history.initialRevision}</span>
          <span>cursor: {history.cursor}</span>
          <span>records: {history.records.length}</span>
        </div>
      </section>

      <section className="studio-panel">
        <h2>Validated Intents</h2>
        <table>
          <thead><tr><th>Type</th><th>Revision</th><th>Candidate</th><th>Substrate Ports</th><th>Warnings</th></tr></thead>
          <tbody>
            {history.records.length === 0 && <tr><td colSpan={5}>No validated intents.</td></tr>}
            {history.records.map((record, index) => (
              <tr key={`${record.intent.type}-${index}`}>
                <td>{record.intent.type}</td>
                <td>{record.fromRevision} {"->"} {record.toRevision}</td>
                <td>{record.updatedCandidateId ?? "none"}</td>
                <td>{record.requiredSubstratePorts.join(", ") || "none"}</td>
                <td>{record.warnings.join(", ") || "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
