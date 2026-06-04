import { useState } from "react";
import type { StudioFabricClient, StudioDecisionAudit } from "@unfurl/fabric-validation-client";
import { buildDecisionAuditView } from "./decisionAuditView.js";

export type DecisionAuditPanelProps = {
  readonly client: Pick<StudioFabricClient, "compileCandidate">;
  readonly initialSessionId?: string;
  readonly initialExpectedRevision?: number;
};

export function DecisionAuditPanel({
  client,
  initialSessionId = "studio-session-123",
  initialExpectedRevision = 7
}: DecisionAuditPanelProps) {
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [expectedRevision, setExpectedRevision] = useState(initialExpectedRevision);
  const [audit, setAudit] = useState<StudioDecisionAudit | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const view = buildDecisionAuditView(audit);

  async function load() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await client.compileCandidate({ sessionId, expectedRevision });
      if (response.status === "COMPILED") {
        setAudit(response.decisionAudit);
      } else {
        setAudit(undefined);
        setError(response.status === "INVALID"
          ? `${response.reason}: ${response.details}`
          : `stale revision: expected ${response.expectedRevision}, received ${response.receivedRevision}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio-page">
      <header className="studio-header">
        <h1>Decision Audit</h1>
        <p>Inspect deterministic candidate alternatives, score factors, and planning warnings.</p>
      </header>

      <section className="studio-panel">
        <h2>Audit Source</h2>
        <label>
          Session ID
          <input value={sessionId} onChange={event => setSessionId(event.target.value)} />
        </label>
        <label>
          Expected revision
          <input type="number" value={expectedRevision} onChange={event => setExpectedRevision(Number(event.target.value))} />
        </label>
        <button type="button" disabled={busy} onClick={load}>{busy ? "Loading..." : "Load Audit"}</button>
      </section>

      {error && <p className="studio-error">{error}</p>}

      <section className="studio-panel">
        <h2>Summary</h2>
        <div className="summary-list">
          <span>selection mode: {view.selectionMode}</span>
          <span>selected candidate: {view.selectedCandidateId ?? "none"}</span>
          <span>alternatives: {view.alternatives.length}</span>
          <span>score factors: {view.scores.length}</span>
          <span>warnings: {view.warnings.length}</span>
        </div>
      </section>

      <div className="panel-grid">
        <section className="studio-panel">
          <h2>Alternatives</h2>
          <table>
            <thead><tr><th>Candidate</th><th>Score</th><th>Selected</th><th>Reason</th></tr></thead>
            <tbody>
              {view.alternatives.map(row => (
                <tr key={row.candidateId}><td>{row.candidateId}</td><td>{row.score}</td><td>{row.selected}</td><td>{row.reason}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="studio-panel">
          <h2>Score Breakdown</h2>
          <table>
            <thead><tr><th>Factor</th><th>Value</th><th>Explanation</th></tr></thead>
            <tbody>
              {view.scores.map(row => (
                <tr key={row.factor}><td>{row.factor}</td><td>{row.value}</td><td>{row.explanation}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
