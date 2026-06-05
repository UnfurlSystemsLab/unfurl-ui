import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_STUDIO_ASSEMBLY_ID,
  DEFAULT_STUDIO_TENANT_ID,
  type StudioFabricClient
} from "@unfurl/fabric-validation-client";
import type { VisualCatalogEntry } from "@unfurl/visual-manifest";
import {
  applyDraftIntent,
  compileDraftWorkspace,
  createDraftWorkspace,
  type DraftWorkspaceState
} from "./draftWorkspace.js";
import { buildSigningHandoff } from "./signingHandoff.js";
import type { ThreeAssemblySelection, ThreeAssemblySurfaceId } from "./ThreeAssemblyScene.js";

const ThreeAssemblyScene = lazy(async () => {
  const module = await import("./ThreeAssemblyScene.js");
  return { default: module.ThreeAssemblyScene };
});

export type DraftWorkspacePanelProps = {
  readonly client: Pick<
    StudioFabricClient,
    "extractNeeds" |
    "listCatalogVisuals" | "createDraftComposition" | "applyIntent" | "getDraftSession" | "compileCandidate"
  >;
  readonly initialTenantId?: string | undefined;
  readonly initialAssemblyId?: string | undefined;
  readonly initialBaseCatalogHash?: string | undefined;
};

type SelectedSurfaceId = ThreeAssemblySurfaceId;

type InspectorDetails = {
  readonly name: string;
  readonly icon: string;
  readonly iconClass: string;
  readonly type: string;
  readonly version: string;
  readonly owner: string;
  readonly status: string;
  readonly description: string;
  readonly bindingMode: string;
  readonly deploymentShape: string;
  readonly substrateTarget: string;
  readonly isolationPattern: string;
  readonly providedPorts: readonly string[];
  readonly requiredPorts: readonly string[];
};

type ReplacementCandidate = {
  readonly catalogEntryId: string;
  readonly label: string;
  readonly owner: string;
  readonly shape: string;
  readonly status: "ALLOWED" | "BLOCKED";
  readonly reason: string;
};

type TutorialStep = {
  readonly id: string;
  readonly title: string;
  readonly body: ReactNode;
  readonly target: "catalog" | "stage" | "views" | "inspector" | "replacement" | "substrate" | "compile";
  readonly action?: () => void;
};

const tutorialStorageKey = "unfurl-studio-workbench-tutorial-dismissed";

export function DraftWorkspacePanel({
  client,
  initialTenantId = DEFAULT_STUDIO_TENANT_ID,
  initialAssemblyId = DEFAULT_STUDIO_ASSEMBLY_ID,
  initialBaseCatalogHash = "sha256:catalog"
}: DraftWorkspacePanelProps) {
  const [tenantId, setTenantId] = useState(initialTenantId);
  const [assemblyId, setAssemblyId] = useState(initialAssemblyId);
  const [baseCatalogHash, setBaseCatalogHash] = useState(initialBaseCatalogHash);
  const [needsId, setNeedsId] = useState("");
  const [targetApplicationName, setTargetApplicationName] = useState("E-Commerce Platform");
  const [targetDeploymentTarget, setTargetDeploymentTarget] = useState("On-Prem Cluster");
  const [targetApplicationFiles, setTargetApplicationFiles] = useState<readonly string[]>([]);
  const [needsExtractionStatus, setNeedsExtractionStatus] = useState<"IDLE" | "READY" | "EXTRACTED">("IDLE");
  const [catalogEntryId, setCatalogEntryId] = useState("com.unfurl:storage-s3:1.2.0");
  const [fromPort, setFromPort] = useState("workflow.storage.required");
  const [toPort, setToPort] = useState("storage-s3.storage.put");
  const [sign, setSign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<DraftWorkspaceState | undefined>();
  const [catalog, setCatalog] = useState<readonly VisualCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | undefined>();
  const [selectedComponent, setSelectedComponent] = useState<SelectedSurfaceId>("validation");
  const [selectedPart, setSelectedPart] = useState<ThreeAssemblySelection>({
    id: "component:validation",
    kind: "component",
    surface: "validation",
    label: "Validation Service"
  });
  const [extractedPartId, setExtractedPartId] = useState<string | undefined>();
  const [replacementEntryId, setReplacementEntryId] = useState("com.unfurl:validation-service:1.1.0");
  const [activeView, setActiveView] = useState("Assembly");
  const [activeInspectorTab, setActiveInspectorTab] = useState("Properties");
  const [tutorialOpen, setTutorialOpen] = useState(() => shouldShowTutorial());
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [saveDraftOpen, setSaveDraftOpen] = useState(false);
  const [saveDeploymentTarget, setSaveDeploymentTarget] = useState(targetDeploymentTarget);
  const [saveDeploymentShape, setSaveDeploymentShape] = useState("CONTAINERIZED_SERVICE");
  const [saveDraftStatus, setSaveDraftStatus] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    void client.listCatalogVisuals({ tenantId })
      .then(response => {
        if (!cancelled) {
          setBaseCatalogHash(current => current === "sha256:catalog" ? response.catalogHash : current);
          setCatalog(response.entries);
          setCatalogEntryId(response.entries[0]?.catalogEntryId ?? "com.unfurl:storage-s3:1.2.0");
          setReplacementEntryId(response.entries[0]?.catalogEntryId ?? "com.unfurl:validation-service:1.1.0");
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
  }, [client, tenantId]);

  async function create() {
    setBusy(true);
    try {
      setState(await createDraftWorkspace(client, {
        tenantId: tenantId.trim() || DEFAULT_STUDIO_TENANT_ID,
        assemblyId: assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID,
        baseCatalogHash,
        ...(needsId.trim() === "" ? {} : { needsId: needsId.trim() })
      }));
    } finally {
      setBusy(false);
    }
  }

  function loadTargetApplication(files: FileList | null) {
    const names = files ? Array.from(files).map(file => file.name) : [];
    setTargetApplicationFiles(names);
    setNeedsExtractionStatus(names.length === 0 ? "IDLE" : "READY");
  }

  async function extractNeeds() {
    const normalizedAssembly = assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID;
    if (client.extractNeeds) {
      const response = await client.extractNeeds({
        tenantId: tenantId.trim() || DEFAULT_STUDIO_TENANT_ID,
        assemblyId: normalizedAssembly,
        targetApplicationName,
        fileNames: targetApplicationFiles,
        defaultDeploymentTarget: targetDeploymentTarget
      });
      setNeedsId(response.needsId);
    } else {
      setNeedsId(`${normalizedAssembly}-extracted-needs`);
    }
    setNeedsExtractionStatus("EXTRACTED");
  }

  function openSaveDraft() {
    setSaveDeploymentTarget(targetDeploymentTarget);
    setSaveDraftOpen(true);
  }

  function saveDraft() {
    setSaveDraftStatus(`Draft saved for ${saveDeploymentTarget} using ${saveDeploymentShape}.`);
    setSaveDraftOpen(false);
  }

  async function addComponent(entryId = catalogEntryId) {
    if (!state) {
      return;
    }
    setBusy(true);
    try {
      setCatalogEntryId(entryId);
      setState(await applyDraftIntent(client, state, { type: "ADD_COMPONENT", catalogEntryId: entryId }));
      selectScenePart({ id: "component:validation", kind: "component", surface: "validation", label: "Validation Service" });
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
      selectScenePart({ id: "substrate:base", kind: "substrate", surface: "substrate", label: "Substrate base plate" });
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

  function selectScenePart(selection: ThreeAssemblySelection) {
    setSelectedComponent(selection.surface);
    setSelectedPart(selection);
  }

  function toggleTakeOut() {
    setExtractedPartId(current => current === selectedPart.id ? undefined : selectedPart.id);
  }

  async function disconnectSelectedPipe() {
    if (state?.status !== "READY" || selectedPart.kind !== "pipe") {
      return;
    }
    setBusy(true);
    try {
      setState(await applyDraftIntent(client, state, { type: "DISCONNECT", pipeId: selectedPart.id }));
      setExtractedPartId(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function replaceSelectedComponent() {
    if (state?.status !== "READY" || selectedPart.kind !== "component" || selectedReplacement?.status !== "ALLOWED") {
      return;
    }
    setBusy(true);
    try {
      setState(await applyDraftIntent(client, state, {
        type: "REPLACE_COMPONENT",
        oldComponentId: selectedPart.surface,
        newCatalogEntryId: replacementEntryId
      }));
      setCatalogEntryId(replacementEntryId);
      setExtractedPartId(undefined);
    } finally {
      setBusy(false);
    }
  }

  const handoff = state ? buildSigningHandoff(state, { signingRequested: sign }) : undefined;
  const selected = inspectorDetails[selectedComponent];
  const ports = useMemo(() => activePorts(catalog[0]), [catalog]);
  const paletteEntries = catalog.length === 0 ? fallbackCatalog() : catalog;
  const replacementCandidates = useMemo(
    () => buildReplacementCandidates(selectedPart.surface, paletteEntries),
    [selectedPart.surface, paletteEntries]
  );
  const selectedReplacement = replacementCandidates.find(candidate => candidate.catalogEntryId === replacementEntryId) ?? replacementCandidates[0];
  const tutorialSteps = useMemo<readonly TutorialStep[]>(() => [
    {
      id: "intro",
      title: "Welcome to Unfurl Studio",
      body: (
        <>
          Studio is a governed visual workbench for assembling Intelligent Components into a Fabric composition.
          Before you compile, set up a{" "}
          <a href="/components/fabric-studio/help#scanned-catalog">scanned catalog</a>,{" "}
          <a href="/components/fabric-studio/help#component-claims">component claims</a>,{" "}
          <a href="/components/fabric-studio/help#needs">needs</a>,{" "}
          <a href="/components/fabric-studio/help#trust-policy">trust policy</a>, and{" "}
          <a href="/components/fabric-studio/help#deployment-policy">deployment policy</a>.
        </>
      ),
      target: "stage"
    },
    {
      id: "catalog",
      title: "Start with the catalog",
      body: "Catalog entries are visual projections of DCP/Fabric facts. Additions and replacements remain governed by Fabric validation.",
      target: "catalog"
    },
    {
      id: "camera",
      title: "Move through the assembly",
      body: "Drag to rotate, right-drag to pan, wheel to zoom, double-click a component to focus it, and press 1-5 to switch views.",
      target: "stage"
    },
    {
      id: "select",
      title: "Select real scene parts",
      body: "Components, pipes, connectors, and the substrate base are selectable. The inspector changes based on the selected part.",
      target: "inspector",
      action: () => selectScenePart({ id: "component:validation", kind: "component", surface: "validation", label: "Validation Service" })
    },
    {
      id: "takeout",
      title: "Take parts out for inspection",
      body: "Take Out is visual-only: it helps inspection without changing the CompositionContract or SubstrateProfile.",
      target: "inspector",
      action: () => {
        selectScenePart({ id: "component:validation", kind: "component", surface: "validation", label: "Validation Service" });
        setExtractedPartId("component:validation");
      }
    },
    {
      id: "replace",
      title: "Replace only when allowed",
      body: "Allowed and blocked replacements are explained here. Validate & Replace sends a Fabric intent; Studio never swaps blindly.",
      target: "replacement",
      action: () => {
        selectScenePart({ id: "component:validation", kind: "component", surface: "validation", label: "Validation Service" });
        setActiveInspectorTab("Properties");
      }
    },
    {
      id: "substrate",
      title: "Review the runtime base",
      body: "Substrate view shows the closed-world runtime surface: only required substrate ports should be active.",
      target: "substrate",
      action: () => {
        setActiveView("Substrate");
        selectScenePart({ id: "substrate:base", kind: "substrate", surface: "substrate", label: "Substrate base plate" });
      }
    },
    {
      id: "compile",
      title: "Compile after validation",
      body: "Create a draft, validate changes, then compile. The button stays guarded until the draft is ready.",
      target: "compile"
    }
  ], []);
  const activeTutorialStep = tutorialSteps[tutorialStepIndex] ?? tutorialSteps[0];

  useEffect(() => {
    if (!replacementCandidates.some(candidate => candidate.catalogEntryId === replacementEntryId)) {
      setReplacementEntryId(replacementCandidates[0]?.catalogEntryId ?? "");
    }
  }, [replacementCandidates, replacementEntryId]);

  useEffect(() => {
    activeTutorialStep?.action?.();
  }, [activeTutorialStep]);

  function openTutorial() {
    setTutorialStepIndex(0);
    setTutorialOpen(true);
  }

  function closeTutorial(persist: boolean) {
    setTutorialOpen(false);
    setExtractedPartId(undefined);
    if (persist) {
      try {
        window.localStorage.setItem(tutorialStorageKey, "true");
      } catch {
        // Ignore storage failures; the tutorial can still be dismissed for this render.
      }
    }
  }

  function nextTutorialStep() {
    setTutorialStepIndex(current => Math.min(current + 1, tutorialSteps.length - 1));
  }

  function previousTutorialStep() {
    setTutorialStepIndex(current => Math.max(current - 1, 0));
  }

  return (
    <div className={`studio-workbench-page ${tutorialOpen ? `tutorial-active tutorial-target-${activeTutorialStep?.target}` : ""}`} aria-label="Unfurl Studio Workbench">
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
          <button type="button" className="secondary" onClick={openTutorial}>Guided Tour</button>
          <button type="button" className="secondary" disabled={busy} onClick={openSaveDraft}>Save Draft</button>
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
            Tenant
            <input value={tenantId} onChange={event => setTenantId(event.target.value)} />
          </label>
          <label>
            Assembly
            <input value={assemblyId} onChange={event => setAssemblyId(event.target.value)} />
          </label>
          <div className="target-app-loader">
            <label>
              Target application
              <input value={targetApplicationName} onChange={event => setTargetApplicationName(event.target.value)} />
            </label>
            <label>
              Default deployment
              <input value={targetDeploymentTarget} onChange={event => setTargetDeploymentTarget(event.target.value)} />
            </label>
            <label>
              Load target app
              <input
                type="file"
                multiple
                accept=".yaml,.yml,.json"
                onChange={event => loadTargetApplication(event.currentTarget.files)}
              />
            </label>
            <div className="summary-row">
              <span>target: {targetApplicationName}</span>
              <span>deployment: {targetDeploymentTarget}</span>
              <span>files: {targetApplicationFiles.length}</span>
              <span>needs: {needsExtractionText(needsExtractionStatus)}</span>
            </div>
            <button type="button" className="secondary" disabled={targetApplicationFiles.length === 0} onClick={() => void extractNeeds()}>
              Extract Needs
            </button>
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
          {saveDraftOpen && (
            <section className="save-draft-panel" aria-label="Save draft deployment options">
              <div>
                <strong>Save Draft</strong>
                <span>Confirm deployment for this assembly before saving.</span>
              </div>
              <label>
                Deployment target
                <input value={saveDeploymentTarget} onChange={event => setSaveDeploymentTarget(event.target.value)} />
              </label>
              <label>
                Deployment shape
                <select value={saveDeploymentShape} onChange={event => setSaveDeploymentShape(event.target.value)}>
                  <option value="IN_PROCESS_LIBRARY">In-process library</option>
                  <option value="SPRING_BOOT_SERVICE">Spring Boot service</option>
                  <option value="CONTAINERIZED_SERVICE">Containerized service</option>
                  <option value="REMOTE_MICROSERVICE">Remote microservice</option>
                </select>
              </label>
              <div className="button-row">
                <button type="button" onClick={saveDraft}>Save With Deployment</button>
                <button type="button" className="secondary" onClick={() => setSaveDraftOpen(false)}>Cancel</button>
              </div>
            </section>
          )}
          {saveDraftStatus && <p className="live-data-notice">{saveDraftStatus}</p>}
          <div className="stage-toolbar" aria-label="Workbench tools">
            {["Select", "Move", "Rotate", "Pan", "Zoom", "Isolate", "Hide", "Show All", "Connections", "Measure", "Reset View"].map(tool => (
              <button type="button" className={tool === "Select" ? "tool-button active" : "tool-button"} key={tool}>
                <span>{toolGlyph(tool)}</span>
                {tool}
              </button>
            ))}
          </div>

            <div className={`composition-plane ${viewClassName(activeView)}`}>
              <Suspense fallback={<div className="three-assembly-scene" aria-label="3D assembly scene" />}>
              <ThreeAssemblyScene
                activeView={activeView}
                selectedSurface={selectedComponent}
                selectedPartId={selectedPart.id}
                extractedPartId={extractedPartId}
                onSelect={setSelectedComponent}
                onSelectPart={selectScenePart}
                onViewChange={setActiveView}
              />
            </Suspense>
            <div className="view-mode-badge">
              <strong>{activeView}</strong>
              <span>{viewDescription(activeView)}</span>
            </div>
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

            <button type="button" className={moduleClass("component-module gateway-module", selectedComponent, "gateway")} onClick={() => selectScenePart({ id: "component:gateway", kind: "component", surface: "gateway", label: "API Gateway" })}>
              <span className="module-icon green">N</span>
              <strong>API Gateway</strong>
              <span className="module-status">Included</span>
            </button>
            <button type="button" className={moduleClass("component-module order-module", selectedComponent, "order")} onClick={() => selectScenePart({ id: "component:order", kind: "component", surface: "order", label: "Order Service" })}>
              <span className="module-icon leaf">S</span>
              <strong>Order Service</strong>
              <span className="port-dot right" />
              <span className="port-dot bottom" />
            </button>
            <button type="button" className={moduleClass("component-module inventory-module", selectedComponent, "inventory")} onClick={() => selectScenePart({ id: "component:inventory", kind: "component", surface: "inventory", label: "Inventory Service" })}>
              <span className="module-icon leaf">S</span>
              <strong>Inventory Service</strong>
              <span className="port-dot left" />
              <span className="port-dot right" />
            </button>
            <button type="button" className={moduleClass("component-module validation-module", selectedComponent, "validation")} onClick={() => selectScenePart({ id: "component:validation", kind: "component", surface: "validation", label: "Validation Service" })}>
              <span className="module-icon purple">V</span>
              <strong>Validation Service</strong>
              <span className="port-handle offer-port">{ports[0] ?? "validate.order"}</span>
              <span className="port-handle dependency-port">{fromPort}</span>
              <span className="port-dot left" />
              <span className="port-dot right" />
              <span className="port-dot bottom" />
            </button>
            <button type="button" className={moduleClass("component-module payment-module", selectedComponent, "payment")} onClick={() => selectScenePart({ id: "component:payment", kind: "component", surface: "payment", label: "Payment Service" })}>
              <span className="module-icon leaf">P</span>
              <strong>Payment Service</strong>
              <span className="port-dot left" />
            </button>
            <button type="button" className={moduleClass("component-module audit-module", selectedComponent, "audit")} onClick={() => selectScenePart({ id: "component:audit", kind: "component", surface: "audit", label: "Audit Service" })}>
              <span className="module-icon blue">A</span>
              <strong>Audit Service</strong>
              <span className="port-dot right" />
            </button>
            <button type="button" className={moduleClass("component-module notification-module", selectedComponent, "notification")} onClick={() => selectScenePart({ id: "component:notification", kind: "component", surface: "notification", label: "Notification Service" })}>
              <span className="module-icon orange">F</span>
              <strong>Notification Service</strong>
              <span className="port-dot right" />
            </button>
            <button type="button" className={moduleClass("component-module workflow-module", selectedComponent, "workflow")} onClick={() => selectScenePart({ id: "component:workflow", kind: "component", surface: "workflow", label: "Workflow Service" })}>
              <span className="module-icon blue">W</span>
              <strong>Workflow Service</strong>
              <span className="port-dot bottom" />
            </button>
            <button type="button" className={moduleClass("component-module adapter-module", selectedComponent, "adapter")} onClick={() => selectScenePart({ id: "component:adapter", kind: "component", surface: "adapter", label: "Storage Adapter" })}>
              <span className="module-icon red">S</span>
              <strong>Storage Adapter</strong>
              <span className="port-dot bottom" />
            </button>
            <button type="button" className={moduleClass("exploded-module", selectedComponent, "validation")} onClick={() => selectScenePart({ id: "component:validation:exploded", kind: "component", surface: "validation", label: "Validation Service exploded inspection" })}>
              <span className="module-icon purple">V</span>
              <strong>Validation Service</strong>
              <span>Exploded inspection</span>
              <span className="port-rack" />
            </button>
          </div>

          <div className="substrate-strip" aria-label="Substrate runtime layer">
            <div className="substrate-label">Substrate Runtime Layer</div>
            {substrateCapabilities.map(capability => (
              <button type="button" className={selectedComponent === "substrate" ? "substrate-tile selected" : "substrate-tile"} key={capability.name} onClick={() => selectScenePart({ id: "substrate:base", kind: "substrate", surface: "substrate", label: "Substrate base plate" })}>
                <span className={`substrate-logo ${capability.status}`}>{capability.short}</span>
                <strong>{capability.name}</strong>
                <span className="health-dot" />
              </button>
            ))}
          </div>
        </main>

        <aside className="workbench-inspector" aria-label="Inspector">
          <div className="inspector-selected">
            <span className={`module-icon ${selected.iconClass}`}>{selected.icon}</span>
            <div>
              <strong>{selected.name}</strong>
              <span className="valid-pill">{selected.status}</span>
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
            <h2>Selected Scene Part</h2>
            <dl>
              <dt>Part</dt><dd>{selectedPart.label}</dd>
              <dt>Kind</dt><dd>{selectedPart.kind}</dd>
              <dt>State</dt><dd>{extractedPartId === selectedPart.id ? "Taken out for inspection" : "Installed"}</dd>
            </dl>
            <div className="scene-action-row">
              <button type="button" className="secondary" onClick={toggleTakeOut}>
                {extractedPartId === selectedPart.id ? "Return to Assembly" : "Take Out"}
              </button>
              <button type="button" className="secondary" disabled={busy || state?.status !== "READY" || selectedPart.kind !== "pipe"} onClick={disconnectSelectedPipe}>
                Disconnect Pipe
              </button>
            </div>
          </section>
          <section className="inspector-card">
            <h2>Replace Component</h2>
            <div className="replacement-shelf" aria-label="Replacement candidates">
              {replacementCandidates.map(candidate => (
                <button
                  type="button"
                  className={replacementEntryId === candidate.catalogEntryId ? `replacement-card selected ${candidate.status.toLowerCase()}` : `replacement-card ${candidate.status.toLowerCase()}`}
                  key={candidate.catalogEntryId}
                  onClick={() => setReplacementEntryId(candidate.catalogEntryId)}
                >
                  <strong>{candidate.label}</strong>
                  <span>{candidate.owner} / {candidate.shape}</span>
                  <small>{candidate.status === "ALLOWED" ? "Allowed" : "Blocked"}: {candidate.reason}</small>
                </button>
              ))}
            </div>
            <button type="button" disabled={busy || state?.status !== "READY" || selectedPart.kind !== "component" || selectedReplacement?.status !== "ALLOWED"} onClick={replaceSelectedComponent}>
              Validate & Replace
            </button>
            {selectedReplacement?.status === "BLOCKED" && <p className="studio-error">{selectedReplacement.reason}</p>}
            {state?.status !== "READY" && <p className="live-data-notice">Create a draft before governed replacements are allowed.</p>}
            {state?.status === "READY" && state.lastResponse?.status === "INVALID" && <p className="studio-error">{state.lastResponse.reason}: {state.lastResponse.details}</p>}
          </section>
          <section className="inspector-card">
            <h2>Component Details</h2>
            <dl>
              <dt>Type</dt><dd>{selected.type}</dd>
              <dt>Version</dt><dd>{selected.version}</dd>
              <dt>Owner</dt><dd>{selected.owner}</dd>
              <dt>Status</dt><dd><span className="included-dot" /> {selected.status}</dd>
            </dl>
            <p>{selected.description}</p>
          </section>
          <section className="inspector-card">
            <h2>Deployment</h2>
            <dl>
              <dt>Binding Mode</dt><dd>{selected.bindingMode}</dd>
              <dt>Deployment Shape</dt><dd><span className="shape-pill">{selected.deploymentShape}</span></dd>
              <dt>Substrate Target</dt><dd>{selected.substrateTarget}</dd>
              <dt>Isolation Pattern</dt><dd><span className="strict-pill">{selected.isolationPattern}</span></dd>
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
            <h2>Provided Ports ({selected.providedPorts.length})</h2>
            <PortList kind="provided" names={selected.providedPorts} />
          </section>
          <section className="inspector-card">
            <h2>Required Ports ({selected.requiredPorts.length})</h2>
            <PortList kind="required" names={selected.requiredPorts} />
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
      {tutorialOpen && activeTutorialStep && (
        <div className="tutorial-overlay" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
          <div className={`tutorial-card tutorial-card-${activeTutorialStep.target}`}>
            <div className="tutorial-progress">
              <span>Step {tutorialStepIndex + 1} of {tutorialSteps.length}</span>
              <button type="button" className="icon-button" onClick={() => closeTutorial(true)}>Skip</button>
            </div>
            <h2 id="tutorial-title">{activeTutorialStep.title}</h2>
            <p>{activeTutorialStep.body}</p>
            <div className="tutorial-dots" aria-hidden="true">
              {tutorialSteps.map((step, index) => (
                <span className={index === tutorialStepIndex ? "active" : ""} key={step.id} />
              ))}
            </div>
            <div className="tutorial-actions">
              <button type="button" className="secondary" disabled={tutorialStepIndex === 0} onClick={previousTutorialStep}>Back</button>
              {tutorialStepIndex === tutorialSteps.length - 1 ? (
                <button type="button" onClick={() => closeTutorial(true)}>Finish</button>
              ) : (
                <button type="button" onClick={nextTutorialStep}>Next</button>
              )}
            </div>
          </div>
        </div>
      )}
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

function shouldShowTutorial(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return window.localStorage.getItem(tutorialStorageKey) !== "true";
  } catch {
    return true;
  }
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

function buildReplacementCandidates(
  surface: ThreeAssemblySurfaceId,
  catalogEntries: readonly VisualCatalogEntry[]
): readonly ReplacementCandidate[] {
  if (surface === "substrate") {
    return [
      {
        catalogEntryId: "substrate:base",
        label: "Runtime Base Plate",
        owner: "runtime-platform",
        shape: "RUNTIME",
        status: "BLOCKED",
        reason: "substrate base is derived from profile, not replaced from catalog"
      }
    ];
  }

  const local = replacementMatrix[surface] ?? [];
  const catalog = catalogEntries.map(entry => ({
    catalogEntryId: entry.catalogEntryId,
    label: paletteLabel(entry),
    owner: "catalog",
    shape: entry.visualManifest?.fallbackShape.category ?? "COMPONENT",
    status: "ALLOWED" as const,
    reason: "catalog entry maps to a DCP-declared component capability"
  }));

  const byId = new Map<string, ReplacementCandidate>();
  for (const candidate of [...local, ...catalog]) {
    byId.set(candidate.catalogEntryId, candidate);
  }
  return [...byId.values()];
}

function moduleClass(baseClass: string, selected: SelectedSurfaceId, surface: SelectedSurfaceId): string {
  return selected === surface ? `${baseClass} selected` : baseClass;
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

const inspectorDetails: Record<SelectedSurfaceId, InspectorDetails> = {
  gateway: {
    name: "API Gateway",
    icon: "N",
    iconClass: "green",
    type: "Application Edge",
    version: "1.4.0",
    owner: "platform-team",
    status: "Included",
    description: "Routes external commerce traffic into the governed service composition.",
    bindingMode: "SERVICE",
    deploymentShape: "CONTAINER",
    substrateTarget: "On-Prem Cluster",
    isolationPattern: "STRICT",
    providedPorts: ["http.route", "auth.forward"],
    requiredPorts: ["validation.order", "payment.authorize"]
  },
  order: {
    name: "Order Service",
    icon: "S",
    iconClass: "leaf",
    type: "Application Service",
    version: "2.0.0",
    owner: "orders-team",
    status: "Included",
    description: "Owns order intake and coordinates validation, inventory, and payment steps.",
    bindingMode: "SERVICE",
    deploymentShape: "CONTAINER",
    substrateTarget: "On-Prem Cluster",
    isolationPattern: "STRICT",
    providedPorts: ["order.create", "order.query"],
    requiredPorts: ["validate.order", "inventory.reserve", "payment.authorize"]
  },
  inventory: {
    name: "Inventory Service",
    icon: "S",
    iconClass: "leaf",
    type: "Application Service",
    version: "1.8.2",
    owner: "inventory-team",
    status: "Included",
    description: "Checks item availability and reserves stock for validated orders.",
    bindingMode: "SERVICE",
    deploymentShape: "CONTAINER",
    substrateTarget: "On-Prem Cluster",
    isolationPattern: "STRICT",
    providedPorts: ["inventory.reserve", "inventory.release"],
    requiredPorts: ["db.query", "event.publish"]
  },
  validation: {
    name: "Validation Service",
    icon: "V",
    iconClass: "purple",
    type: "Application Service",
    version: "1.1.0",
    owner: "payments-team",
    status: "Valid",
    description: "Validates orders, inventory, and payment requests using business rules and customer policies.",
    bindingMode: "SERVICE",
    deploymentShape: "CONTAINER",
    substrateTarget: "On-Prem Cluster",
    isolationPattern: "STRICT",
    providedPorts: ["validate.order", "validate.payment", "validate.inventory"],
    requiredPorts: ["customer.query", "policy.evaluate", "rules.fetch"]
  },
  payment: {
    name: "Payment Service",
    icon: "P",
    iconClass: "leaf",
    type: "Application Service",
    version: "1.6.0",
    owner: "payments-team",
    status: "Included",
    description: "Authorizes and captures payments after validation and order checks pass.",
    bindingMode: "SERVICE",
    deploymentShape: "CONTAINER",
    substrateTarget: "On-Prem Cluster",
    isolationPattern: "STRICT",
    providedPorts: ["payment.authorize", "payment.capture"],
    requiredPorts: ["validate.payment", "vault.secret"]
  },
  audit: {
    name: "Audit Service",
    icon: "A",
    iconClass: "blue",
    type: "Compliance Service",
    version: "1.2.3",
    owner: "risk-team",
    status: "Included",
    description: "Records signed decision and runtime events for compliance review.",
    bindingMode: "EVENT",
    deploymentShape: "CONTAINER",
    substrateTarget: "On-Prem Cluster",
    isolationPattern: "STRICT",
    providedPorts: ["audit.write", "audit.query"],
    requiredPorts: ["event.publish"]
  },
  notification: {
    name: "Notification Service",
    icon: "F",
    iconClass: "orange",
    type: "Application Service",
    version: "1.0.5",
    owner: "customer-exp-team",
    status: "Included",
    description: "Sends order lifecycle notifications after workflow checkpoints complete.",
    bindingMode: "EVENT",
    deploymentShape: "CONTAINER",
    substrateTarget: "On-Prem Cluster",
    isolationPattern: "STRICT",
    providedPorts: ["notify.email", "notify.sms"],
    requiredPorts: ["event.consume"]
  },
  workflow: {
    name: "Workflow Service",
    icon: "W",
    iconClass: "blue",
    type: "Orchestration Service",
    version: "2.3.0",
    owner: "platform-team",
    status: "Included",
    description: "Coordinates the e-commerce composition and enforces ordered execution.",
    bindingMode: "SERVICE",
    deploymentShape: "CONTAINER",
    substrateTarget: "On-Prem Cluster",
    isolationPattern: "STRICT",
    providedPorts: ["workflow.start", "workflow.status"],
    requiredPorts: ["order.create", "audit.write", "event.publish"]
  },
  adapter: {
    name: "Storage Adapter",
    icon: "S",
    iconClass: "red",
    type: "Adapter",
    version: "1.3.1",
    owner: "platform-team",
    status: "Warning",
    description: "Binds object storage operations to the substrate target selected by policy.",
    bindingMode: "SERVICE",
    deploymentShape: "SIDECAR",
    substrateTarget: "On-Prem Cluster",
    isolationPattern: "STRICT",
    providedPorts: ["storage.put", "storage.get"],
    requiredPorts: ["vault.secret", "storage.blob"]
  },
  substrate: {
    name: "Substrate Base Plate",
    icon: "S",
    iconClass: "blue",
    type: "Runtime Surface",
    version: "profile:sha256",
    owner: "runtime-platform",
    status: "Reachable",
    description: "Closed-world runtime layer containing only the substrate capabilities required by the derived profile.",
    bindingMode: "SUBSTRATE",
    deploymentShape: "RUNTIME",
    substrateTarget: "On-Prem Cluster",
    isolationPattern: "STRICT",
    providedPorts: ["db.query", "event.publish", "vault.secret", "telemetry.otel", "container.schedule"],
    requiredPorts: []
  }
};

function toolGlyph(tool: string): string {
  return {
    Select: "SEL",
    Move: "MOV",
    Rotate: "ROT",
    Pan: "PAN",
    Zoom: "ZOM",
    Isolate: "ISO",
    Hide: "HID",
    "Show All": "ALL",
    Connections: "CON",
    Measure: "MEA",
    "Reset View": "RST"
  }[tool] ?? "DOT";
}

function needsExtractionText(status: "IDLE" | "READY" | "EXTRACTED"): string {
  switch (status) {
    case "IDLE":
      return "load target app first";
    case "READY":
      return "ready to extract";
    case "EXTRACTED":
      return "extracted";
  }
}

function viewClassName(view: string): string {
  return `view-${view.toLowerCase()}`;
}

function viewDescription(view: string): string {
  return {
    Assembly: "complete governed composition",
    Exploded: "selected component pulled forward",
    Ports: "offers, requirements, and handles emphasized",
    Substrate: "runtime layer and closed-world sockets emphasized",
    Validation: "policy and compatibility status emphasized"
  }[view] ?? "composition surface";
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

const replacementMatrix: Partial<Record<Exclude<ThreeAssemblySurfaceId, "substrate">, readonly ReplacementCandidate[]>> = {
  gateway: [
    { catalogEntryId: "com.unfurl:nginx-api-gateway:1.4.0", label: "Nginx API Gateway", owner: "platform-team", shape: "CONTAINER", status: "ALLOWED", reason: "offers http.route and auth.forward" },
    { catalogEntryId: "com.unfurl:edge-router-lite:0.9.0", label: "Edge Router Lite", owner: "edge-team", shape: "SIDECAR", status: "BLOCKED", reason: "missing auth.forward capability" }
  ],
  order: [
    { catalogEntryId: "com.unfurl:order-service:2.0.1", label: "Order Service 2.0.1", owner: "orders-team", shape: "CONTAINER", status: "ALLOWED", reason: "same required/provided port contract" },
    { catalogEntryId: "com.unfurl:legacy-order-service:1.0.0", label: "Legacy Order Service", owner: "orders-team", shape: "REMOTE", status: "BLOCKED", reason: "requires storage.put@^1 instead of current storage.put@^2" }
  ],
  inventory: [
    { catalogEntryId: "com.unfurl:inventory-service:1.9.0", label: "Inventory Service 1.9", owner: "inventory-team", shape: "CONTAINER", status: "ALLOWED", reason: "satisfies inventory.reserve and inventory.release" },
    { catalogEntryId: "com.unfurl:warehouse-adapter:1.0.0", label: "Warehouse Adapter", owner: "supply-team", shape: "ADAPTER", status: "BLOCKED", reason: "refuses direct payment validation responsibility" }
  ],
  validation: [
    { catalogEntryId: "com.unfurl:validation-service:1.1.0", label: "Validation Service", owner: "payments-team", shape: "CONTAINER", status: "ALLOWED", reason: "current selected component" },
    { catalogEntryId: "com.unfurl:customer-policy-validator:1.2.0", label: "Customer Policy Validator", owner: "risk-team", shape: "CONTAINER", status: "ALLOWED", reason: "offers validate.order, validate.payment, and validate.inventory" },
    { catalogEntryId: "com.unfurl:fraud-only-validator:1.0.0", label: "Fraud-only Validator", owner: "risk-team", shape: "SERVICE", status: "BLOCKED", reason: "does not offer validate.inventory" }
  ],
  payment: [
    { catalogEntryId: "com.unfurl:payment-service:1.6.1", label: "Payment Service 1.6.1", owner: "payments-team", shape: "CONTAINER", status: "ALLOWED", reason: "same payment authorize/capture contract" },
    { catalogEntryId: "com.unfurl:stripe-adapter:1.0.0", label: "Stripe Adapter", owner: "payments-team", shape: "MANAGED_EXTERNAL_ADAPTER", status: "BLOCKED", reason: "external adapter cannot own payment orchestration" }
  ],
  audit: [
    { catalogEntryId: "com.unfurl:audit-service:1.3.0", label: "Audit Service 1.3", owner: "risk-team", shape: "CONTAINER", status: "ALLOWED", reason: "offers audit.write and audit.query" },
    { catalogEntryId: "com.unfurl:log-sink:1.0.0", label: "Log Sink", owner: "observability-team", shape: "SIDECAR", status: "BLOCKED", reason: "logs events but does not provide signed audit.write" }
  ],
  notification: [
    { catalogEntryId: "com.unfurl:notification-service:1.1.0", label: "Notification Service 1.1", owner: "customer-exp-team", shape: "CONTAINER", status: "ALLOWED", reason: "satisfies email and sms notification ports" },
    { catalogEntryId: "com.unfurl:email-only-notifier:1.0.0", label: "Email-only Notifier", owner: "customer-exp-team", shape: "SERVICE", status: "BLOCKED", reason: "missing notify.sms" }
  ],
  workflow: [
    { catalogEntryId: "com.unfurl:workflow-service:2.4.0", label: "Workflow Service 2.4", owner: "platform-team", shape: "CONTAINER", status: "ALLOWED", reason: "same orchestration interface contract" },
    { catalogEntryId: "com.unfurl:batch-runner:1.0.0", label: "Batch Runner", owner: "platform-team", shape: "JOB", status: "BLOCKED", reason: "does not offer workflow.start" }
  ],
  adapter: [
    { catalogEntryId: "com.unfurl:storage-adapter-s3:1.3.1", label: "S3 Storage Adapter", owner: "platform-team", shape: "SIDECAR", status: "ALLOWED", reason: "offers storage.put and storage.get" },
    { catalogEntryId: "com.unfurl:storage-adapter-blob:1.2.0", label: "Azure Blob Adapter", owner: "platform-team", shape: "SIDECAR", status: "ALLOWED", reason: "compatible object storage capability range" },
    { catalogEntryId: "com.unfurl:read-only-storage-adapter:1.0.0", label: "Read-only Storage Adapter", owner: "platform-team", shape: "ADAPTER", status: "BLOCKED", reason: "missing storage.put" }
  ]
};
