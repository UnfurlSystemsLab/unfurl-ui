import { useEffect, useState } from "react";
import type { StudioFabricClient } from "@unfurl/fabric-validation-client";
import { loadCatalogPalette, type CatalogPaletteState } from "./catalogPalette.js";

export type CatalogPalettePanelProps = {
  readonly client: Pick<StudioFabricClient, "listCatalogVisuals">;
};

export function CatalogPalettePanel({ client }: CatalogPalettePanelProps) {
  const [query, setQuery] = useState("");
  const [warningsOnly, setWarningsOnly] = useState(false);
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
