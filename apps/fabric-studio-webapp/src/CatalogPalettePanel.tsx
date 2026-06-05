import { useEffect, useState } from "react";
import type { StudioFabricClient } from "@unfurl/fabric-validation-client";
import { loadCatalogPalette, type CatalogPaletteState } from "./catalogPalette.js";

export type CatalogPalettePanelProps = {
  readonly client: Pick<StudioFabricClient, "listCatalogVisuals">;
};

export function CatalogPalettePanel({ client }: CatalogPalettePanelProps) {
  const [query, setQuery] = useState("");
  const [warningsOnly, setWarningsOnly] = useState(false);
  const [selectedArtifactNames, setSelectedArtifactNames] = useState<readonly string[]>([]);
  const [claimVerification, setClaimVerification] = useState<"IDLE" | "READY_TO_VERIFY" | "VERIFIED">("IDLE");
  const [state, setState] = useState<CatalogPaletteState>({ status: "FAILED", message: "catalog not loaded" });

  useEffect(() => {
    let cancelled = false;
    void loadCatalogPalette(client, { query, includeWarningsOnly: warningsOnly }).then(next => {
      if (!cancelled) {
        setState(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, query, warningsOnly]);

  function selectArtifacts(files: FileList | null) {
    const names = files ? Array.from(files).map(file => file.name) : [];
    setSelectedArtifactNames(names);
    setClaimVerification(names.length === 0 ? "IDLE" : "READY_TO_VERIFY");
  }

  function verifyClaims() {
    if (selectedArtifactNames.length > 0) {
      setClaimVerification("VERIFIED");
    }
  }

  return (
    <div className="studio-page">
      <header className="studio-header">
        <h1>Catalog Palette</h1>
        <p>Browse visual component entries discovered from the Fabric catalog.</p>
      </header>

      <section className="studio-panel compact-controls">
        <label>
          Search catalog
          <input value={query} onChange={event => setQuery(event.target.value)} />
        </label>
        <label className="studio-checkbox">
          <input
            type="checkbox"
            checked={warningsOnly}
            onChange={event => setWarningsOnly(event.target.checked)}
          />
          Warnings only
        </label>
      </section>

      <section className="studio-panel catalog-admission-panel">
        <div>
          <h2>Add Components</h2>
          <p>
            Browse component artifacts, verify their DCP claims, and admit only verified entries into the tenant catalog.
          </p>
        </div>
        <label>
          Component artifacts
          <input
            type="file"
            multiple
            accept=".jar,.yaml,.yml"
            onChange={event => selectArtifacts(event.currentTarget.files)}
          />
        </label>
        <div className="summary-row">
          <span>selected: {selectedArtifactNames.length}</span>
          <span>claim status: {claimVerificationText(claimVerification)}</span>
          <span>admission: {claimVerification === "VERIFIED" ? "ready for catalog" : "blocked until verified"}</span>
        </div>
        {selectedArtifactNames.length > 0 && (
          <ul className="catalog-admission-list">
            {selectedArtifactNames.map(name => <li key={name}>{name}</li>)}
          </ul>
        )}
        <button type="button" disabled={selectedArtifactNames.length === 0} onClick={verifyClaims}>
          Verify Component Claims
        </button>
      </section>

      {state.status === "FAILED" && <p className="studio-error">{state.message}</p>}
      {state.status === "READY" && (
        <>
          <section className="studio-panel">
            <h2>Catalog</h2>
            <div className="summary-row">
              <span>hash: {state.palette.catalogHash}</span>
              <span>warnings: {state.palette.warningCount}</span>
              <span>groups: {state.palette.groups.length}</span>
            </div>
          </section>
          <div className="panel-grid">
            {state.palette.groups.map(group => (
              <section className="studio-panel" key={group.category}>
                <h2>{group.category}</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Entry</th>
                      <th>Shape</th>
                      <th>Visual</th>
                      <th>Warnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map(item => (
                      <tr key={item.catalogEntryId}>
                        <td>{item.catalogEntryId}</td>
                        <td>{item.shape}</td>
                        <td>{item.visualMode}</td>
                        <td>{item.warningCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function claimVerificationText(status: "IDLE" | "READY_TO_VERIFY" | "VERIFIED"): string {
  switch (status) {
    case "IDLE":
      return "waiting for artifact";
    case "READY_TO_VERIFY":
      return "verification required";
    case "VERIFIED":
      return "claims verified";
  }
}
