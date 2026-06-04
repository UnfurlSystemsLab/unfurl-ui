import { useState } from "react";
import type { CompileDraftCandidateResponse, StudioFabricClient } from "@unfurl/fabric-validation-client";
import { signingHandoffFromCompile } from "./signingHandoff.js";

export type SigningHandoffPanelProps = {
  readonly client: Pick<StudioFabricClient, "compileCandidate">;
  readonly initialSessionId?: string;
  readonly initialExpectedRevision?: number;
};

export function SigningHandoffPanel({
  client,
  initialSessionId = "studio-session-123",
  initialExpectedRevision = 7
}: SigningHandoffPanelProps) {
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [expectedRevision, setExpectedRevision] = useState(initialExpectedRevision);
  const [sign, setSign] = useState(true);
  const [response, setResponse] = useState<CompileDraftCandidateResponse | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const handoff = signingHandoffFromCompile(response, { signingRequested: sign });

  async function compile() {
    setBusy(true);
    setError(undefined);
    try {
      setResponse(await client.compileCandidate({ sessionId, expectedRevision, sign }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio-page">
      <header className="studio-header">
        <h1>Signing Handoff</h1>
        <p>Prepare compiled artifacts for operator signing and export.</p>
      </header>

      <section className="studio-panel">
        <h2>Compile Request</h2>
        <label>
          Session ID
          <input value={sessionId} onChange={event => setSessionId(event.target.value)} />
        </label>
        <label>
          Expected revision
          <input
            type="number"
            value={expectedRevision}
            onChange={event => setExpectedRevision(Number(event.target.value))}
          />
        </label>
        <label className="studio-checkbox">
          <input type="checkbox" checked={sign} onChange={event => setSign(event.target.checked)} />
          Request signed artifact
        </label>
        <button type="button" disabled={busy} onClick={compile}>{busy ? "Compiling..." : "Compile for Handoff"}</button>
      </section>

      {error && <p className="studio-error">{error}</p>}

      <section className="studio-panel">
        <h2>Handoff Status</h2>
        {handoff.status === "SIGNED" && <p>Signed contract ready: <a href={handoff.signedContractUrl}>{handoff.sha256}</a></p>}
        {handoff.status === "UNSIGNED_READY" && (
          <div className="summary-list">
            <span>{handoff.message}</span>
            <a href={handoff.contractUrl}>contract</a>
            <a href={handoff.profileUrl}>substrate profile</a>
          </div>
        )}
        {handoff.status === "REQUEST_SIGNED_COMPILE" && <p>{handoff.message}</p>}
        {handoff.status === "UNAVAILABLE" && <p>{handoff.reason}</p>}
      </section>
    </div>
  );
}
