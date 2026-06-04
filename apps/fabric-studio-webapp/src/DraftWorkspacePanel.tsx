import { useEffect, useMemo, useState } from "react";
import type { StudioFabricClient } from "@unfurl/fabric-validation-client";
import type { VisualCatalogEntry } from "@unfurl/visual-manifest";
import {
  applyDraftIntent,
  compileDraftWorkspace,
  createDraftWorkspace,
  type DraftWorkspaceState
} from "./draftWorkspace.js";
import { buildSigningHandoff } from "./signingHandoff.js";

export type DraftWorkspacePanelProps = {
  readonly client: Pick<
    StudioFabricClient,
    "listCatalogVisuals" | "createDraftComposition" | "applyIntent" | "getDraftSession" | "compileCandidate"
  >;
  readonly initialBaseCatalogHash?: string | undefined;
};

export function DraftWorkspacePanel({ client, initialBaseCatalogHash = "sha256:catalog" }: DraftWorkspacePanelProps) {
  const [baseCatalogHash, setBaseCatalogHash] = useState(initialBaseCatalogHash);
  const [needsId, setNeedsId] = useState("");
  const [catalogEntryId, setCatalogEntryId] = useState("com.unfurl:storage-s3:1.2.0");
  const [fromPort, setFromPort] = useState("workflow.storage.required");
  const [toPort, setToPort] = useState("storage-s3.storage.put");
  const [sign, setSign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<DraftWorkspaceState | undefined>();
  const [catalog, setCatalog] = useState<readonly VisualCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | undefined>();
  const [selectedComponent, setSelectedComponent] = useState<"workflow" | "storage" | "substrate">("storage");

  useEffect(() => {
    let cancelled = false;
    void client.listCatalogVisuals()
      .then(response => {
        if (!cancelled) {
          setBaseCatalogHash(current => current === "sha256:catalog" ? response.catalogHash : current);
          setCatalog(response.entries);
          setCatalogEntryId(response.entries[0]?.catalogEntryId ?? "com.unfurl:storage-s3:1.2.0");
        }
      })
      .catch(error => {
        if (!cancelled) {
          setCatalogError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function create() {
    setBusy(true);
    try {
      setState(await createDraftWorkspace(client, {
        baseCatalogHash,
        ...(needsId.trim() === "" ? {} : { needsId: needsId.trim() })
      }));
    } finally {
      setBusy(false);
    }
  }

  async function addComponent(entryId = catalogEntryId) {
    if (!state) {
      return;
    }
    setBusy(true);
    try {
      setCatalogEntryId(entryId);
      setState(await applyDraftIntent(client, state, { type: "ADD_COMPONENT", catalogEntryId: entryId }));
      setSelectedComponent("storage");
    } finally {
      setBusy(false);
    }
  }

  async function connectPorts() {
    if (!state) {
      return;
    }
    setBusy(true);
    try {
      setState(await applyDraftIntent(client, state, { type: "CONNECT", fromPort, toPort }));
      setSelectedComponent("substrate");
    } finally {
      setBusy(false);
    }
  }

  async function compile() {
    if (!state) {
      return;
    }
    setBusy(true);
    try {
      setState(await compileDraftWorkspace(client, state, { sign }));
    } finally {
      setBusy(false);
    }
  }

  const handoff = state ? buildSigningHandoff(state, { signingRequested: sign }) : undefined;
  const selectedLabel = selectedComponent === "workflow"
    ? "Workflow Requirement"
    : selectedComponent === "storage"
      ? paletteLabel(catalog[0]) || "S3 Storage Component"
      : "Substrate Base Plate";
  const ports = useMemo(() => activePorts(catalog[0]), [catalog]);

  return (
    <div className="studio-workbench-page">
      <header className="workbench-topbar">
        <div>
          <h1>Unfurl Studio Workbench</h1>
          <p>Assemble governed components visually. Every meaningful change is sent to Fabric as a validated intent.</p>
        </div>
        <div className="workbench-actions">
          <button type="button" disabled={busy} onClick={create}>{busy ? "Working..." : "New Draft"}</button>
          <button type="button" className="secondary" disabled={busy || state?.status !== "READY"} onClick={compile}>Compile</button>
        </div>
      </header>

      <div className="workbench-grid">
        <aside className="workbench-palette" aria-label="Catalog palette">
          <div className="panel-title">
            <span>Catalog</span>
            <small>{catalog.length} entries</small>
          </div>
          <label>
            Needs ID
            <input value={needsId} onChange={event => setNeedsId(event.target.value)} />
          </label>
          <label>
            Catalog hash
            <input value={baseCatalogHash} onChange={event => setBaseCatalogHash(event.target.value)} />
          </label>
          {catalogError && <p className="studio-error">{catalogError}</p>}
          <div className="palette-list">
            {(catalog.length === 0 ? fallbackCatalog() : catalog).map(entry => (
              <button
                type="button"
                className="palette-item"
                key={entry.catalogEntryId}
                onClick={() => void addComponent(entry.catalogEntryId)}
                disabled={state?.status !== "READY" || busy}
              >
                <span>{paletteLabel(entry)}</span>
                <small>{entry.visualManifest?.fallbackShape.category ?? "WORKFLOW"} / {entry.visualManifest?.fallbackShape.kind ?? "CUBE"}</small>
              </button>
            ))}
          </div>
        </aside>

        <main className="workbench-stage" aria-label="Composition workbench">
          <div className="stage-toolbar">
            <span>candidate: {state?.status === "READY" ? state.session.currentCandidateId ?? "draft" : "not started"}</span>
            <span>revision: {state?.status === "READY" ? state.session.sceneRevision : "-"}</span>
            <span>validation: {state?.status === "READY" ? state.lastResponse?.status ?? "ready" : "waiting for draft"}</span>
          </div>

          <div className="composition-plane">
            <svg className="pipe-overlay" viewBox="0 0 860 520" aria-hidden="true">
              <path className="pipe pipe-valid" d="M270 206 C360 206 410 206 500 206" />
              <path className="pipe pipe-substrate" d="M620 295 C620 350 620 390 620 430" />
              <path className="pipe pipe-pending" d="M245 278 C350 330 500 350 615 430" />
            </svg>

            <button type="button" className="component-block workflow-block" onClick={() => setSelectedComponent("workflow")}>
              <span className="component-kind">WORKFLOW</span>
              <strong>Document Workflow</strong>
              <span className="port-handle dependency-port">storage.required</span>
              <span className="port-handle audit-port">audit.write</span>
            </button>

            <button type="button" className="component-block storage-block" onClick={() => setSelectedComponent("storage")}>
              <span className="component-kind">STORAGE</span>
              <strong>{paletteLabel(catalog[0]) || "S3 Storage"}</strong>
              <span className="port-handle offer-port">{ports[0] ?? "storage.put"}</span>
              <span className="port-handle offer-port lower">{ports[1] ?? "storage.get"}</span>
              <span className="port-handle substrate-port">secrets.provider</span>
            </button>

            <button type="button" className="substrate-plate" onClick={() => setSelectedComponent("substrate")}>
              <span>Substrate</span>
              <strong>Closed-world runtime surface</strong>
              <span className="substrate-socket active">secrets.provider</span>
              <span className="substrate-socket inactive">telemetry.otel</span>
              <span className="substrate-socket missing">storage.blob</span>
            </button>
          </div>
        </main>

        <aside className="workbench-inspector" aria-label="Inspector">
          <div className="panel-title">
            <span>Inspector</span>
            <small>{selectedComponent}</small>
          </div>
          <h2>{selectedLabel}</h2>
          <div className="inspector-stack">
            <label>
              Catalog entry intent
              <input value={catalogEntryId} onChange={event => setCatalogEntryId(event.target.value)} />
            </label>
            <label>
              From port
              <input value={fromPort} onChange={event => setFromPort(event.target.value)} />
            </label>
            <label>
              To port
              <input value={toPort} onChange={event => setToPort(event.target.value)} />
            </label>
            <button type="button" disabled={busy || state?.status !== "READY"} onClick={connectPorts}>Validate Connection</button>
            <label className="studio-checkbox">
              <input type="checkbox" checked={sign} onChange={event => setSign(event.target.checked)} />
              Request signed compile
            </label>
          </div>
          <section className="inspector-result">
            <h3>Governance</h3>
            <p>{state?.status === "READY" ? "Semantic changes are validated by Fabric before contract state changes." : "Create a draft session to start governed editing."}</p>
            {state?.status === "FAILED" && <p className="studio-error">{state.message}</p>}
          </section>
        </aside>
      </div>

      <footer className="workbench-bottom">
        <div>
          <strong>Draft</strong>
          <span>{state?.status === "READY" ? state.session.sessionId : "not created"}</span>
        </div>
        <div>
          <strong>Substrate</strong>
          <span>{state?.status === "READY" ? state.lastResponse?.status ?? "ready" : "waiting"}</span>
        </div>
        <div>
          <strong>Compile</strong>
          <span>{state?.status === "READY" ? state.lastCompile?.status ?? "not compiled" : "not available"}</span>
        </div>
        <div>
          <strong>Handoff</strong>
          <span>{handoff?.status ?? "unavailable"}</span>
        </div>
      </footer>
    </div>
  );
}

function paletteLabel(entry: VisualCatalogEntry | undefined): string {
  if (!entry) {
    return "";
  }
  return entry.catalogEntryId.split(":").slice(1).join(":") || entry.catalogEntryId;
}

function activePorts(entry: VisualCatalogEntry | undefined): readonly string[] {
  return entry?.visualManifest?.ports.map(port => port.id) ?? [];
}

function fallbackCatalog(): readonly VisualCatalogEntry[] {
  return [
    {
      catalogEntryId: "com.unfurl:storage-s3:1.2.0",
      claimHash: "sha256:claim-storage-s3",
      artifactSha256: "sha256:artifact-storage-s3",
      visualManifest: {
        fallbackShape: { kind: "CUBE", category: "STORAGE" },
        ports: [],
        interactions: { draggable: true, connectable: true, inspectable: true }
      },
      visualIntegrity: { visualManifestHash: "sha256:visual-storage-s3", assets: [] },
      warnings: []
    }
  ];
}
