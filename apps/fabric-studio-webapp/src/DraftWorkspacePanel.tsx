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
  const [activeView, setActiveView] = useState("Assembly");
  const [activeInspectorTab, setActiveInspectorTab] = useState("Properties");

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
      ? paletteLabel(catalog[0]) || "Validation Service"
      : "Substrate Base Plate";
  const ports = useMemo(() => activePorts(catalog[0]), [catalog]);
  const paletteEntries = catalog.length === 0 ? fallbackCatalog() : catalog;

  return (
    <div className="studio-workbench-page" aria-label="Unfurl Studio Workbench">
      <header className="workbench-topbar">
        <div className="workbench-breadcrumbs">
          <span>Studio</span>
          <span>Compositions</span>
          <strong>E-Commerce Platform</strong>
        </div>
        <div className="workbench-view-tabs" aria-label="Workbench views">
          {["Assembly", "Exploded", "Ports", "Substrate", "Validation"].map(view => (
            <button type="button" className={activeView === view ? "view-tab active" : "view-tab"} key={view} onClick={() => setActiveView(view)}>
              {view}
            </button>
          ))}
        </div>
        <div className="workbench-actions">
          <button type="button" className="secondary" disabled={busy}>Save Draft</button>
          <button type="button" disabled={busy} onClick={create}>{busy ? "Working..." : "New Draft"}</button>
          <button type="button" disabled={busy || state?.status !== "READY"} onClick={compile}>Compile & Validate</button>
        </div>
      </header>

      <div className="workbench-grid">
        <aside className="workbench-palette" aria-label="Catalog palette">
          <div className="panel-title">
            <span>Catalog</span>
            <small>{catalog.length} entries</small>
          </div>
          <div className="catalog-tabs">
            <button type="button" className="catalog-tab active">Components</button>
            <button type="button" className="catalog-tab">Substrate</button>
          </div>
          <div className="catalog-search">
            <input aria-label="Search components" placeholder="Search components..." />
            <button type="button" className="icon-button" aria-label="Filter catalog">Filter</button>
          </div>
          <label>
            Needs ID
            <input value={needsId} onChange={event => setNeedsId(event.target.value)} />
          </label>
          <label>
            Catalog hash
            <input value={baseCatalogHash} onChange={event => setBaseCatalogHash(event.target.value)} />
          </label>
          {catalogError && <p className="live-data-notice">Live catalog unavailable; showing generated fallback.</p>}
          <div className="palette-list grouped">
            <CatalogGroup title="Application Services" entries={paletteEntries} busy={busy} ready={state?.status === "READY"} onSelect={entryId => void addComponent(entryId)} />
            <StaticCatalogGroup title="Adapters" names={["Stripe Adapter", "SendGrid Adapter", "Twilio Adapter", "Salesforce Adapter"]} />
            <StaticCatalogGroup title="Infrastructure Services" names={["PostgreSQL Database", "Redis Cache", "Kafka Broker", "Object Storage"]} />
            <StaticCatalogGroup title="Libraries" names={["Common Library", "Security Library", "ML Inference Library"]} />
          </div>
          <div className="drop-target">Drag component here to add to composition</div>
        </aside>

        <main className="workbench-stage" aria-label="Composition workbench">
          <div className="stage-toolbar" aria-label="Workbench tools">
            {["Select", "Move", "Rotate", "Pan", "Zoom", "Isolate", "Hide", "Show All", "Connections", "Measure", "Reset View"].map(tool => (
              <button type="button" className={tool === "Select" ? "tool-button active" : "tool-button"} key={tool}>
                <span>{toolGlyph(tool)}</span>
                {tool}
              </button>
            ))}
          </div>

          <div className="composition-plane">
            <div className="assembly-cabinet" aria-hidden="true">
              <span className="cabinet-bolt top-left" />
              <span className="cabinet-bolt top-right" />
              <span className="cabinet-bolt bottom-left" />
              <span className="cabinet-bolt bottom-right" />
            </div>
            <svg className="pipe-overlay" viewBox="0 0 940 620" aria-hidden="true">
              <path className="pipe pipe-valid" d="M252 218 C345 178 410 172 506 204" />
              <path className="pipe pipe-valid" d="M252 310 C356 324 436 316 554 310" />
              <path className="pipe pipe-valid" d="M598 212 C672 176 730 182 806 230" />
              <path className="pipe pipe-substrate" d="M575 384 C575 452 585 496 610 542" />
              <path className="pipe pipe-pending" d="M312 382 C410 450 510 464 610 542" />
            </svg>

            <button type="button" className="component-module gateway-module" onClick={() => setSelectedComponent("workflow")}>
              <span className="module-icon green">N</span>
              <strong>API Gateway</strong>
              <span className="module-status">Included</span>
            </button>
            <button type="button" className="component-module order-module" onClick={() => setSelectedComponent("workflow")}>
              <span className="module-icon leaf">S</span>
              <strong>Order Service</strong>
              <span className="port-dot right" />
              <span className="port-dot bottom" />
            </button>
            <button type="button" className="component-module inventory-module" onClick={() => setSelectedComponent("storage")}>
              <span className="module-icon leaf">S</span>
              <strong>Inventory Service</strong>
              <span className="port-dot left" />
              <span className="port-dot right" />
            </button>
            <button type="button" className="component-module validation-module selected" onClick={() => setSelectedComponent("storage")}>
              <span className="module-icon purple">V</span>
              <strong>Validation Service</strong>
              <span className="port-handle offer-port">{ports[0] ?? "validate.order"}</span>
              <span className="port-handle dependency-port">{fromPort}</span>
              <span className="port-dot left" />
              <span className="port-dot right" />
              <span className="port-dot bottom" />
            </button>
            <button type="button" className="component-module payment-module" onClick={() => setSelectedComponent("storage")}>
              <span className="module-icon leaf">P</span>
              <strong>Payment Service</strong>
              <span className="port-dot left" />
            </button>
            <button type="button" className="component-module audit-module" onClick={() => setSelectedComponent("workflow")}>
              <span className="module-icon blue">A</span>
              <strong>Audit Service</strong>
              <span className="port-dot right" />
            </button>
            <button type="button" className="component-module notification-module" onClick={() => setSelectedComponent("workflow")}>
              <span className="module-icon orange">F</span>
              <strong>Notification Service</strong>
              <span className="port-dot right" />
            </button>
            <button type="button" className="component-module workflow-module" onClick={() => setSelectedComponent("workflow")}>
              <span className="module-icon blue">W</span>
              <strong>Workflow Service</strong>
              <span className="port-dot bottom" />
            </button>
            <button type="button" className="component-module adapter-module" onClick={() => setSelectedComponent("substrate")}>
              <span className="module-icon red">S</span>
              <strong>Storage Adapter</strong>
              <span className="port-dot bottom" />
            </button>
            <button type="button" className="exploded-module" onClick={() => setSelectedComponent("storage")}>
              <span className="module-icon purple">V</span>
              <strong>Validation Service</strong>
              <span>Exploded inspection</span>
              <span className="port-rack" />
            </button>
          </div>

          <div className="substrate-strip" aria-label="Substrate runtime layer">
            <div className="substrate-label">Substrate Runtime Layer</div>
            {substrateCapabilities.map(capability => (
              <button type="button" className="substrate-tile" key={capability.name} onClick={() => setSelectedComponent("substrate")}>
                <span className={`substrate-logo ${capability.status}`}>{capability.short}</span>
                <strong>{capability.name}</strong>
                <span className="health-dot" />
              </button>
            ))}
          </div>
        </main>

        <aside className="workbench-inspector" aria-label="Inspector">
          <div className="inspector-selected">
            <span className="module-icon purple">V</span>
            <div>
              <strong>{selectedLabel}</strong>
              <span className="valid-pill">Valid</span>
            </div>
          </div>
          <div className="inspector-tabs">
            {["Properties", "Bindings", "Diagnostics", "Audit"].map(tab => (
              <button type="button" className={activeInspectorTab === tab ? "inspector-tab active" : "inspector-tab"} key={tab} onClick={() => setActiveInspectorTab(tab)}>
                {tab}
              </button>
            ))}
          </div>
          <section className="inspector-card">
            <h2>Component Details</h2>
            <dl>
              <dt>Type</dt><dd>Application Service</dd>
              <dt>Version</dt><dd>1.1.0</dd>
              <dt>Owner</dt><dd>payments-team</dd>
              <dt>Status</dt><dd><span className="included-dot" /> Included</dd>
            </dl>
            <p>Validates orders, inventory, and payment requests using business rules and customer policies.</p>
          </section>
          <section className="inspector-card">
            <h2>Deployment</h2>
            <dl>
              <dt>Binding Mode</dt><dd>SERVICE</dd>
              <dt>Deployment Shape</dt><dd><span className="shape-pill">CONTAINER</span></dd>
              <dt>Substrate Target</dt><dd>On-Prem Cluster</dd>
              <dt>Isolation Pattern</dt><dd><span className="strict-pill">STRICT</span></dd>
            </dl>
          </section>
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
          <section className="inspector-card">
            <h2>Provided Ports (3)</h2>
            <PortList kind="provided" names={["validate.order", "validate.payment", "validate.inventory"]} />
          </section>
          <section className="inspector-card">
            <h2>Required Ports (3)</h2>
            <PortList kind="required" names={["customer.query", "policy.evaluate", "rules.fetch"]} />
          </section>
          <section className="inspector-card">
            <h2>Validation Status</h2>
            <ul className="validation-list">
              <li>Deployment shape compatible</li>
              <li>All required ports satisfied</li>
              <li>Substrate target reachable</li>
              <li>Isolation policy satisfied</li>
            </ul>
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
          <strong>Components</strong>
          <span>10</span>
        </div>
        <div>
          <strong>Connections</strong>
          <span>28</span>
        </div>
        <div>
          <strong>Substrate Ports Used</strong>
          <span>5 / 12</span>
        </div>
        <div>
          <strong>Validation</strong>
          <span>{state?.status === "READY" ? state.lastResponse?.status ?? "all validations passed" : "waiting for draft"}</span>
        </div>
        <div>
          <strong>Handoff</strong>
          <span>{handoff?.status ?? "unavailable"}</span>
        </div>
      </footer>
    </div>
  );
}

function CatalogGroup({
  title,
  entries,
  ready,
  busy,
  onSelect
}: {
  readonly title: string;
  readonly entries: readonly VisualCatalogEntry[];
  readonly ready: boolean;
  readonly busy: boolean;
  readonly onSelect: (entryId: string) => void;
}) {
  return (
    <section className="catalog-group">
      <h3>{title}</h3>
      {entries.map((entry, index) => (
        <button
          type="button"
          className={index === 0 ? "catalog-row active" : "catalog-row"}
          key={entry.catalogEntryId}
          onClick={() => onSelect(entry.catalogEntryId)}
          disabled={!ready || busy}
        >
          <span className="catalog-glyph purple">{entry.visualManifest?.fallbackShape.kind.slice(0, 1) ?? "C"}</span>
          {paletteLabel(entry)}
        </button>
      ))}
    </section>
  );
}

function StaticCatalogGroup({ title, names }: { readonly title: string; readonly names: readonly string[] }) {
  return (
    <section className="catalog-group">
      <h3>{title}</h3>
      {names.map(name => (
        <button type="button" className="catalog-row" key={name}>
          <span className="catalog-glyph">{name.slice(0, 1)}</span>
          {name}
        </button>
      ))}
    </section>
  );
}

function PortList({ kind, names }: { readonly kind: "provided" | "required"; readonly names: readonly string[] }) {
  return (
    <div className="port-list">
      {names.map(name => (
        <span className={kind === "provided" ? "port-chip provided" : "port-chip required"} key={name}>
          {name}
          <small>HTTP</small>
        </span>
      ))}
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
      catalogEntryId: "com.unfurl:validation-service:1.1.0",
      claimHash: "sha256:claim-validation-service",
      artifactSha256: "sha256:artifact-validation-service",
      visualManifest: {
        fallbackShape: { kind: "CUBE", category: "WORKFLOW" },
        ports: [],
        interactions: { draggable: true, connectable: true, inspectable: true }
      },
      visualIntegrity: { visualManifestHash: "sha256:visual-validation-service", assets: [] },
      warnings: []
    }
  ];
}

function toolGlyph(tool: string): string {
  return {
    Select: "↖",
    Move: "✣",
    Rotate: "⟳",
    Pan: "✥",
    Zoom: "⌕",
    Isolate: "□",
    Hide: "◌",
    "Show All": "◎",
    Connections: "⌁",
    Measure: "⌞",
    "Reset View": "⟲"
  }[tool] ?? "•";
}

const substrateCapabilities = [
  { name: "Java 21", short: "J", status: "active" },
  { name: "Spring Boot", short: "S", status: "active" },
  { name: "PostgreSQL", short: "P", status: "active" },
  { name: "Redis", short: "R", status: "active" },
  { name: "Kafka", short: "K", status: "active" },
  { name: "Nginx", short: "N", status: "active" },
  { name: "Docker", short: "D", status: "available" },
  { name: "Kubernetes", short: "K8", status: "available" },
  { name: "Vault", short: "V", status: "missing" },
  { name: "Prometheus", short: "P", status: "available" },
  { name: "Grafana", short: "G", status: "available" }
] as const;
