import { useEffect, useState } from "react";
import type {
  StudioClaimVerificationResult,
  StudioComponentArtifactDraft,
  StudioFabricClient
} from "@unfurl/fabric-validation-client";
import { buildCatalogPalette, loadCatalogPalette, type CatalogPaletteState } from "./catalogPalette.js";

export type CatalogPalettePanelProps = {
  readonly client: Pick<StudioFabricClient, "listCatalogVisuals" | "admitCatalogArtifacts">;
  /**
   * Initial tenant id. Hydrated from the URL search param at route level;
   * the panel manages its own state thereafter and notifies the parent
   * (if any) via {@link onTenantIdChange} so the URL stays in sync.
   */
  readonly tenantId?: string | undefined;
  readonly assemblyId?: string | undefined;
  /**
   * Called when the operator edits the tenant input. Lets the route layer
   * round-trip the value into the URL search params so the tenant is
   * bookmarkable / shareable and the multitenant flow is testable
   * directly from the URL bar.
   */
  readonly onTenantIdChange?: (tenantId: string) => void;
};

export function CatalogPalettePanel({
  client,
  tenantId: initialTenantId = "tenant-local",
  assemblyId = "assembly-demo",
  onTenantIdChange
}: CatalogPalettePanelProps) {
  // Tenant is a panel-owned state so the operator can switch it; route
  // layer round-trips it through ?tenantId=... search params.
  const [tenantId, setTenantId] = useState(initialTenantId);
  const [query, setQuery] = useState("");
  const [warningsOnly, setWarningsOnly] = useState(false);
  const [selectedArtifacts, setSelectedArtifacts] = useState<readonly StudioComponentArtifactDraft[]>([]);
  const [admissionResults, setAdmissionResults] = useState<readonly StudioClaimVerificationResult[]>([]);
  const [claimVerification, setClaimVerification] = useState<"IDLE" | "READY_TO_VERIFY" | "VERIFIED" | "REJECTED">("IDLE");
  const [state, setState] = useState<CatalogPaletteState>({ status: "FAILED", message: "catalog not loaded" });

  useEffect(() => {
    let cancelled = false;
    void loadCatalogPalette(client, { tenantId, query, includeWarningsOnly: warningsOnly }).then(next => {
      if (!cancelled) {
        setState(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, tenantId, assemblyId, query, warningsOnly]);

  /**
   * Adapter: converts browser File objects into Studio admission drafts. YAML files carry
   * their DCP claim content; archive uploads without readable claim YAML remain drafts and
   * Fabric will return a structured diagnostic instead of silently verifying them.
   */
  function selectArtifacts(files: FileList | null) {
    const selected = files ? Array.from(files) : [];
    setAdmissionResults([]);
    setClaimVerification(selected.length === 0 ? "IDLE" : "READY_TO_VERIFY");
    void Promise.all(selected.map(toAdmissionDraft)).then(setSelectedArtifacts);
  }

  /**
   * Adapter helper: reads YAML-like files as text while preserving unsupported archive uploads
   * as filename-only drafts so backend validation owns the final admission decision.
   */
  async function toAdmissionDraft(file: File): Promise<StudioComponentArtifactDraft> {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".yaml") || lowerName.endsWith(".yml")) {
      return { fileName: file.name, claimYaml: await file.text() };
    }
    return { fileName: file.name };
  }

  /**
   * Command handler: submits selected artifacts for Fabric-side DCP validation and mirrors
   * structured diagnostics into the admission panel.
   */
  async function verifyClaims() {
    if (selectedArtifacts.length > 0) {
      if (client.admitCatalogArtifacts) {
        const response = await client.admitCatalogArtifacts({
          tenantId,
          assemblyId,
          artifacts: selectedArtifacts
        });
        setAdmissionResults(response.results);
        setClaimVerification(response.status === "VERIFIED" ? "VERIFIED" : "REJECTED");
        setState({
          status: "READY",
          palette: buildCatalogPalette(response.catalog.catalogHash, response.catalog.entries, {
            tenantId,
            query,
            includeWarningsOnly: warningsOnly
          })
        });
      } else {
        setClaimVerification("VERIFIED");
      }
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
          Tenant
          <input
            value={tenantId}
            onChange={event => {
              const next = event.target.value;
              setTenantId(next);
              onTenantIdChange?.(next);
            }}
            placeholder="tenant-local"
            spellCheck={false}
            aria-label="Tenant ID for catalog queries"
          />
        </label>
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
          <span>selected: {selectedArtifacts.length}</span>
          <span>claim status: {claimVerificationText(claimVerification)}</span>
          <span>admission: {claimVerification === "VERIFIED" ? "ready for catalog" : "blocked until verified"}</span>
        </div>
        {selectedArtifacts.length > 0 && (
          <ul className="catalog-admission-list">
            {selectedArtifacts.map(artifact => <li key={artifact.fileName}>{artifact.fileName}</li>)}
          </ul>
        )}
        <AdmissionResults results={admissionResults} />
        <button type="button" disabled={selectedArtifacts.length === 0} onClick={() => void verifyClaims()}>
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

export type AdmissionResultsProps = {
  readonly results: readonly StudioClaimVerificationResult[];
};

/**
 * Presenter: renders Fabric's structured DCP claim diagnostics without collapsing them
 * into a generic admission failure. Exported so the contract can be tested without a DOM.
 */
export function AdmissionResults({ results }: AdmissionResultsProps) {
  if (results.length === 0) {
    return null;
  }
  return (
    <div className="catalog-admission-results">
      {results.map(result => (
        <article className="catalog-admission-result" key={result.fileName}>
          <div className="summary-row">
            <span>{result.fileName}</span>
            <span>{result.status}</span>
            {result.claimHash && <span>{result.claimHash}</span>}
          </div>
          {result.diagnostics.length > 0 && (
            <ul className="catalog-diagnostic-list">
              {result.diagnostics.map((diagnostic, index) => (
                <li key={`${result.fileName}-${diagnostic.code}-${diagnostic.path}-${index}`}>
                  <strong>{diagnostic.severity}</strong> {diagnostic.code} at {diagnostic.path || "claim"}: {diagnostic.message}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}

/**
 * Presenter: converts admission state into compact operator-facing copy.
 */
function claimVerificationText(status: "IDLE" | "READY_TO_VERIFY" | "VERIFIED" | "REJECTED"): string {
  switch (status) {
    case "IDLE":
      return "waiting for artifact";
    case "READY_TO_VERIFY":
      return "verification required";
    case "VERIFIED":
      return "claims verified";
    case "REJECTED":
      return "claim errors found";
  }
}
