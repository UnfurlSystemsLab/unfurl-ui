import { useEffect, useRef, useState } from "react";
import type {
  StudioClaimVerificationResult,
  StudioCatalogSnapshot,
  StudioComponentArtifactDraft,
  StudioExportArtifact,
  StudioFabricClient
} from "@unfurl/fabric-validation-client";
import { buildCatalogPalette, loadCatalogPalette, type CatalogPaletteState } from "./catalogPalette.js";
import { appendArtifactDrafts, createBrowseSequencer, removeArtifactDrafts, SelectionRevision } from "./artifactSelection.js";
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
  const [checkedArtifacts, setCheckedArtifacts] = useState<ReadonlySet<string>>(new Set());
  const [admissionResults, setAdmissionResults] = useState<readonly StudioClaimVerificationResult[]>([]);
  const [claimBundleArtifact, setClaimBundleArtifact] = useState<StudioExportArtifact | undefined>(undefined);
  const [diagnosticArtifacts, setDiagnosticArtifacts] = useState<readonly StudioExportArtifact[]>([]);
  const [catalogActionMessage, setCatalogActionMessage] = useState("");
  // What the Add Components panel needs to tell the operator: a file that could not be read, or a verification answered
  // for a selection that has since changed. Shown in that panel, cleared by the next browse, removal or verification.
  const [admissionMessage, setAdmissionMessage] = useState("");
  const [claimVerification, setClaimVerification] = useState<"IDLE" | "READY_TO_VERIFY" | "VERIFIED" | "REJECTED">("IDLE");
  const [state, setState] = useState<CatalogPaletteState>({ status: "FAILED", message: "catalog not loaded" });
  // Browses whose files are still being read, and whether a verification is in flight: verifying waits for both (§3.5).
  const [pendingReads, setPendingReads] = useState(0);
  const [verifying, setVerifying] = useState(false);
  // The selection's revision: every browse (when it is made) and every removal advances it, and a verification is shown
  // only for the revision it was asked for (§3.5).
  const selectionRevision = useRef(new SelectionRevision());
  // Applies browses in browse order, whatever order their reads finish in (§3.5).
  const browseSequencer = useRef(createBrowseSequencer<readonly StudioComponentArtifactDraft[]>(
    drafts => {
      selectionRevision.current.advance();
      setSelectedArtifacts(current => appendArtifactDrafts(current, drafts));
    },
    () => setPendingReads(count => count - 1),
    error => setAdmissionMessage(`A selected file could not be read: ${error instanceof Error ? error.message : String(error)}`)
  ));

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
   * Adapter: converts browser File objects into Studio admission drafts and appends them to the selection (§3.5): a
   * second browse adds to the first, and a jar whose file name is already selected replaces that entry. The previous
   * verification no longer describes the selection, so it is cleared. Archive uploads without a readable claim stay
   * drafts, and Fabric answers them with a structured diagnostic instead of verifying them silently.
   */
  function selectArtifacts(files: FileList | null) {
    const chosen = files ? Array.from(files) : [];
    if (chosen.length === 0) return;
    // The selection changes now, before the files are read, so a verification already in flight cannot be shown for it.
    selectionRevision.current.advance();
    clearVerification();
    setAdmissionMessage("");
    setClaimVerification("READY_TO_VERIFY");
    setPendingReads(count => count + 1);
    void browseSequencer.current(Promise.all(chosen.map(toAdmissionDraft)));
  }

  /**
   * Command handler: removes jars from the selection (one by its ×, or the checked ones), and clears the previous
   * verification, which described the selection before the change.
   */
  function removeArtifacts(fileNames: ReadonlySet<string>) {
    selectionRevision.current.advance();
    const remaining = removeArtifactDrafts(selectedArtifacts, fileNames);
    setSelectedArtifacts(remaining);
    setCheckedArtifacts(current => new Set([...current].filter(name => !fileNames.has(name))));
    clearVerification();
    setAdmissionMessage("");
    setClaimVerification(remaining.length === 0 ? "IDLE" : "READY_TO_VERIFY");
  }

  /** Forgets the last verification's results and artifacts. */
  function clearVerification() {
    setAdmissionResults([]);
    setClaimBundleArtifact(undefined);
    setDiagnosticArtifacts([]);
  }

  /**
   * Command handler: submits the selection for Fabric-side DCP validation and mirrors structured diagnostics into the
   * admission panel. It runs only when no browse is being read and no verification is in flight. The answer is shown
   * only if the selection is still at the revision it was asked for (§3.5). A later answer still refreshes the catalog,
   * because Fabric admitted what it was sent, but it never marks the changed selection verified.
   */
  async function verifyClaims() {
    if (selectedArtifacts.length === 0 || pendingReads > 0 || verifying) return;
    if (!client.admitCatalogArtifacts) {
      setClaimVerification("REJECTED");
      setAdmissionMessage("Claim verification is unavailable. No artifacts were verified or admitted.");
      return;
    }
    const askedRevision = selectionRevision.current.current;
    setAdmissionMessage("");
    setVerifying(true);
    try {
      const response = await client.admitCatalogArtifacts({ tenantId, assemblyId, artifacts: selectedArtifacts });
      setState({
        status: "READY",
        palette: buildCatalogPalette(response.catalog.catalogHash, response.catalog.entries, {
          tenantId,
          query,
          includeWarningsOnly: warningsOnly
        })
      });
      if (!selectionRevision.current.isCurrent(askedRevision)) {
        setAdmissionMessage("The selection changed while it was being verified; verify it again.");
        return;
      }
      setAdmissionResults(response.results);
      setClaimBundleArtifact(response.claimBundleArtifact);
      setDiagnosticArtifacts(response.diagnosticArtifacts ?? []);
      setClaimVerification(response.status === "VERIFIED" ? "VERIFIED" : "REJECTED");
    } finally {
      setVerifying(false);
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
        <label className="file-action-button">
          Add component artifacts…
          <input
            type="file"
            multiple
            accept=".jar"
            aria-label="Add component artifacts"
            onChange={event => {
              const input = event.currentTarget;
              selectArtifacts(input.files);
              // Cleared so the same jar can be chosen again (for example after rebuilding it).
              input.value = "";
            }}
          />
        </label>
        <div className="summary-row">
          <span>selected: {selectedArtifacts.length}</span>
          {pendingReads > 0 && <span>reading selected files…</span>}
          <span>claim status: {verifying ? "verifying…" : claimVerificationText(claimVerification)}</span>
          <span>admission: {claimVerification === "VERIFIED" ? "ready for catalog" : "blocked until verified"}</span>
        </div>
        <SelectedArtifacts
          artifacts={selectedArtifacts}
          checked={checkedArtifacts}
          onCheckedChange={setCheckedArtifacts}
          onRemove={removeArtifacts}
        />
        {admissionMessage && <p className="studio-status" role="status">{admissionMessage}</p>}
        <AdmissionResults
          results={admissionResults}
          claimBundleArtifact={claimBundleArtifact}
          diagnosticArtifacts={diagnosticArtifacts}
        />
        <button type="button" disabled={selectedArtifacts.length === 0 || pendingReads > 0 || verifying} onClick={() => void verifyClaims()}>
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

export type SelectedArtifactsProps = {
  readonly artifacts: readonly StudioComponentArtifactDraft[];
  /** The file names whose checkbox is ticked. */
  readonly checked: ReadonlySet<string>;
  readonly onCheckedChange: (checked: ReadonlySet<string>) => void;
  /** Removes these file names from the selection. */
  readonly onRemove: (fileNames: ReadonlySet<string>) => void;
};

/**
 * Presenter: the jars selected for admission (§3.5), each with a checkbox and a remove (×) action, under a "Select all"
 * checkbox and a "Remove selected" action. Renders nothing when nothing is selected. Exported so it can be rendered
 * without the panel's state.
 */
export function SelectedArtifacts({ artifacts, checked, onCheckedChange, onRemove }: SelectedArtifactsProps) {
  if (artifacts.length === 0) return null;
  const checkedCount = artifacts.filter(artifact => checked.has(artifact.fileName)).length;
  const allChecked = checkedCount === artifacts.length;
  const toggle = (fileName: string) => {
    const next = new Set(checked);
    if (next.has(fileName)) next.delete(fileName); else next.add(fileName);
    onCheckedChange(next);
  };
  return (
    <div className="catalog-admission-selection">
      <div className="button-row">
        <label className="studio-checkbox">
          <input type="checkbox" checked={allChecked}
            ref={input => { if (input) input.indeterminate = checkedCount > 0 && !allChecked; }}
            onChange={() => onCheckedChange(allChecked ? new Set() : new Set(artifacts.map(artifact => artifact.fileName)))} />
          Select all
        </label>
        <button type="button" className="secondary" disabled={checkedCount === 0}
          onClick={() => onRemove(new Set(artifacts.filter(artifact => checked.has(artifact.fileName)).map(artifact => artifact.fileName)))}>
          Remove selected ({checkedCount})
        </button>
      </div>
      <ul className="catalog-admission-list" aria-label="Selected component artifacts">
        {artifacts.map(artifact => (
          <li key={artifact.fileName}>
            <label className="studio-checkbox">
              <input type="checkbox" checked={checked.has(artifact.fileName)} onChange={() => toggle(artifact.fileName)} />
              {artifact.fileName}
            </label>
            <button type="button" className="catalog-admission-remove" aria-label={`Remove ${artifact.fileName}`}
              title={`Remove ${artifact.fileName}`} onClick={() => onRemove(new Set([artifact.fileName]))}>×</button>
          </li>
        ))}
      </ul>
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
 * Adapter helper: turns a JAR into a base64 artifact draft so Fabric reads META-INF/unfurl-catalog.yaml out of the
 * jar itself during DCP admission. A claim is admitted only from the artifact that carries it (DCP HLD-C §3.10), so any
 * other file is sent by name alone and Fabric reports why it was refused.
 */
export async function toAdmissionDraft(file: File): Promise<StudioComponentArtifactDraft> {
  const lowerName = file.name.toLowerCase();
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
