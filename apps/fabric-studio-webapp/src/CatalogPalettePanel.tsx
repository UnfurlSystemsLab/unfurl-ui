import { useEffect, useState } from "react";
import type {
  StudioClaimVerificationResult,
  StudioCatalogSnapshot,
  StudioComponentArtifactDraft,
  StudioExportArtifact,
  StudioFabricClient
} from "@unfurl/fabric-validation-client";
import { buildCatalogPalette, loadCatalogPalette, type CatalogPaletteState } from "./catalogPalette.js";
import { DiagnosticArtifactsPanel } from "./DiagnosticArtifactsPanel.js";

export type CatalogPalettePanelProps = {
  readonly client: Pick<StudioFabricClient, "listCatalogVisuals" | "admitCatalogArtifacts" | "removeCatalogEntry" | "saveCatalogSnapshot" | "loadCatalogSnapshot">;
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
  const [claimBundleArtifact, setClaimBundleArtifact] = useState<StudioExportArtifact | undefined>(undefined);
  const [diagnosticArtifacts, setDiagnosticArtifacts] = useState<readonly StudioExportArtifact[]>([]);
  const [catalogActionMessage, setCatalogActionMessage] = useState("");
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
    setClaimBundleArtifact(undefined);
    setDiagnosticArtifacts([]);
    setClaimVerification(selected.length === 0 ? "IDLE" : "READY_TO_VERIFY");
    void Promise.all(selected.map(toAdmissionDraft)).then(setSelectedArtifacts);
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
        setClaimBundleArtifact(response.claimBundleArtifact);
        setDiagnosticArtifacts(response.diagnosticArtifacts ?? []);
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
        setClaimVerification("REJECTED");
        setCatalogActionMessage("Claim verification is unavailable. No artifacts were verified or admitted.");
      }
    }
  }

  /**
   * Command handler: removes a tenant-scoped catalog entry through Fabric and
   * replaces the palette with the returned catalog snapshot.
   */
  async function removeCatalogEntry(catalogEntryId: string) {
    if (!client.removeCatalogEntry) {
      setCatalogActionMessage("catalog removal is not available from this client");
      return;
    }
    const response = await client.removeCatalogEntry({ tenantId, catalogEntryId });
    setDiagnosticArtifacts(response.diagnosticArtifacts ?? []);
    setCatalogActionMessage(`removed ${response.catalogEntryId}`);
    setState({
      status: "READY",
      palette: buildCatalogPalette(response.catalog.catalogHash, response.catalog.entries, {
        tenantId,
        query,
        includeWarningsOnly: warningsOnly
      })
    });
  }

  /**
   * Command handler: asks Fabric for a tenant-scoped catalog snapshot and downloads
   * the returned DCP-backed read model as JSON.
   */
  async function saveCatalogSnapshot() {
    if (!client.saveCatalogSnapshot) {
      setCatalogActionMessage("catalog save is not available from this client");
      return;
    }
    const snapshot = await client.saveCatalogSnapshot({ tenantId });
    downloadJson(`catalog-${safeFilePart(tenantId)}.json`, snapshot);
    setDiagnosticArtifacts(snapshot.diagnosticArtifacts ?? []);
    setCatalogActionMessage("catalog snapshot saved");
  }

  /**
   * Command handler: reads a JSON catalog snapshot and asks Fabric to load it into
   * the active tenant before rebuilding the palette from Fabric's response.
   */
  async function loadCatalogSnapshot(files: FileList | null) {
    if (!client.loadCatalogSnapshot) {
      setCatalogActionMessage("catalog load is not available from this client");
      return;
    }
    const file = files?.[0];
    if (!file) {
      return;
    }
    const snapshot = JSON.parse(await file.text()) as StudioCatalogSnapshot;
    const response = await client.loadCatalogSnapshot({ tenantId, snapshot });
    setDiagnosticArtifacts(response.diagnosticArtifacts ?? []);
    setCatalogActionMessage(`loaded ${response.entries.length} catalog entries`);
    setState({
      status: "READY",
      palette: buildCatalogPalette(response.catalogHash, response.entries, {
        tenantId,
        query,
        includeWarningsOnly: warningsOnly
      })
    });
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
        <AdmissionResults
          results={admissionResults}
          claimBundleArtifact={claimBundleArtifact}
          diagnosticArtifacts={diagnosticArtifacts}
        />
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
            <div className="button-row">
              <button type="button" className="secondary" disabled={!client.saveCatalogSnapshot} onClick={() => void saveCatalogSnapshot()}>
                Save Catalog
              </button>
              <label className="file-action-button">
                Load Catalog
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={!client.loadCatalogSnapshot}
                  onChange={event => void loadCatalogSnapshot(event.currentTarget.files)}
                />
              </label>
            </div>
            {catalogActionMessage && <p className="studio-status">{catalogActionMessage}</p>}
            <DiagnosticArtifactsPanel artifacts={diagnosticArtifacts} />
          </section>
          <div className="panel-grid">
            {state.palette.groups.map(group => (
              <section className="studio-panel" key={group.category}>
                <h2>{group.category}</h2>
                <div className="catalog-tree" role="list">
                  {group.items.map(item => (
                    <article className="catalog-tree-item" key={item.catalogEntryId} role="listitem">
                      <div className="catalog-entry-cell">
                        <span className="catalog-entry-id" title={item.catalogEntryId}>{item.catalogEntryId}</span>
                        <button
                          type="button"
                          className="catalog-remove-button"
                          disabled={!client.removeCatalogEntry}
                          aria-label={`Remove ${item.catalogEntryId} from catalog`}
                          title="Remove from catalog"
                          onClick={() => void removeCatalogEntry(item.catalogEntryId)}
                        >
                          X
                        </button>
                      </div>
                      <dl className="catalog-entry-properties">
                        <div>
                          <dt>Shape</dt>
                          <dd>{item.shape}</dd>
                        </div>
                        <div>
                          <dt>Visual</dt>
                          <dd>{item.visualMode}</dd>
                        </div>
                        <div>
                          <dt>Warnings</dt>
                          <dd>{item.warningCount}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
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
  readonly claimBundleArtifact?: StudioExportArtifact | undefined;
  readonly diagnosticArtifacts?: readonly StudioExportArtifact[] | undefined;
};

/**
 * Presenter: renders Fabric's structured DCP claim diagnostics without collapsing them
 * into a generic admission failure. Exported so the contract can be tested without a DOM.
 */
export function AdmissionResults({ results, claimBundleArtifact, diagnosticArtifacts = [] }: AdmissionResultsProps) {
  const artifacts = [
    ...(claimBundleArtifact ? [claimBundleArtifact] : []),
    ...diagnosticArtifacts
  ];
  if (results.length === 0 && artifacts.length === 0) {
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
      <DiagnosticArtifactsPanel artifacts={artifacts} />
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

/**
 * Adapter helper: reads YAML-like files as claim text and JAR files as base64 archive
 * drafts so Fabric can extract META-INF/unfurl-catalog.yaml during DCP admission.
 */
export async function toAdmissionDraft(file: File): Promise<StudioComponentArtifactDraft> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".yaml") || lowerName.endsWith(".yml")) {
    return { fileName: file.name, claimYaml: await file.text() };
  }
  if (lowerName.endsWith(".jar")) {
    return { fileName: file.name, artifactBase64: await fileToBase64(file) };
  }
  return { fileName: file.name };
}

/**
 * Browser adapter: downloads Studio snapshot objects as formatted JSON.
 */
function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Filename normalizer: keeps tenant ids readable while avoiding path characters
 * in generated snapshot file names.
 */
function safeFilePart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "tenant-local";
}

/**
 * Encoding helper: converts a browser File into transport-safe base64 without relying
 * on Node-only Buffer APIs, keeping Studio uploads usable in browser and test runtimes.
 */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
