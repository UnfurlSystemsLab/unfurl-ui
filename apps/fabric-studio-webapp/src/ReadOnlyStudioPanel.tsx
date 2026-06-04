import { useState } from "react";
import type { StudioFabricClient } from "@unfurl/fabric-validation-client";
import { loadReadOnlyStudio, type ReadOnlyStudioState } from "./readOnlyStudio.js";
import { TablePanel } from "./TablePanel.js";

export type ReadOnlyStudioPanelProps = {
  readonly client: Pick<StudioFabricClient, "loadCompositionView">;
  readonly initialContractPath?: string;
  readonly initialSubstrateProfilePath?: string;
};

export function ReadOnlyStudioPanel({
  client,
  initialContractPath = "",
  initialSubstrateProfilePath = ""
}: ReadOnlyStudioPanelProps) {
  const [contractPath, setContractPath] = useState(initialContractPath);
  const [substrateProfilePath, setSubstrateProfilePath] = useState(initialSubstrateProfilePath);
  const [state, setState] = useState<ReadOnlyStudioState | undefined>();
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      setState(await loadReadOnlyStudio(client, { contractPath, substrateProfilePath }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio-page">
      <header className="studio-header">
        <h1>Read-Only Studio</h1>
        <p>Inspect an existing CompositionContract and SubstrateProfile as tables and scene metadata.</p>
      </header>

      <section className="studio-panel">
        <h2>Inputs</h2>
        <label>
          Contract path
          <input value={contractPath} onChange={event => setContractPath(event.target.value)} />
        </label>
        <label>
          Substrate profile path
          <input value={substrateProfilePath} onChange={event => setSubstrateProfilePath(event.target.value)} />
        </label>
        <button type="button" disabled={busy} onClick={load}>{busy ? "Loading..." : "Load Composition"}</button>
      </section>

      {!state && <section className="studio-panel"><h2>Composition</h2><p>No composition loaded.</p></section>}
      {state?.status === "FAILED" && <p className="studio-error">{state.message}</p>}
      {state?.status === "READY" && (
        <>
          <section className="studio-panel">
            <h2>Scene</h2>
            <div className="summary-row">
              <span>components: {state.renderScene.components.length}</span>
              <span>ports: {state.renderScene.ports.length}</span>
              <span>pipes: {state.renderScene.pipes.length}</span>
              <span>substrate sockets: {state.renderScene.substrateSockets.length}</span>
            </div>
          </section>
          <TablePanel table={state.table} />
        </>
      )}
    </div>
  );
}
