import { useEffect, useMemo, useReducer, useState } from "react";
import {
  DEFAULT_STUDIO_ASSEMBLY_ID,
  DEFAULT_STUDIO_TENANT_ID,
  type CompileDraftCandidateResponse,
  type DeploymentShape,
  type StudioFabricClient,
  type StudioLayoutState,
  type StudioOverlay
} from "@unfurl/fabric-validation-client";
import type { VisualCatalogEntry } from "@unfurl/visual-manifest";
import { AuthoringConversationPanel } from "../AuthoringConversationPanel.js";
import { buildDecisionAuditView, renderDecisionAuditText } from "../decisionAuditView.js";
import { DEPLOYMENT_SHAPE_OPTIONS, preferDeploymentShape, setDeploymentRuntime } from "../deploymentPlanner.js";
import { DiagnosticArtifactsPanel } from "../DiagnosticArtifactsPanel.js";
import { buildDraftWorkspaceOverlay } from "../draftOverlays.js";
import type { DraftWorkspaceState } from "../draftWorkspace.js";
import { FallbackAttemptsPanel } from "../FallbackAttemptsPanel.js";
import { IntentHistoryPanel } from "../IntentHistoryPanel.js";
import { IsolationMatchesPanel } from "../IsolationMatchesPanel.js";
import { RejectedShapesPanel } from "../RejectedShapesPanel.js";
import { RequiredPortsPanel } from "../RequiredPortsPanel.js";
import { SelectedShapesPanel } from "../SelectedShapesPanel.js";
import { SemanticZoomNavigator } from "../SemanticZoomNavigator.js";
import { signingHandoffFromCompile } from "../signingHandoff.js";
import type { ThreeAssemblySelection } from "../ThreeAssemblyScene.js";
import {
  catalogFileOptionLabel,
  draftDisplayName,
  entryCapabilities,
  friendlyStudioError,
  labelForCatalogEntry,
  nodeLabel,
  paletteLabel,
  projectionNodeIdForCatalogEntry,
  selectedCatalogFile,
  toSemanticSceneProjection,
  type DraftComponentItem
} from "./draftInventory.js";
import { readLocalViewState, writeLocalViewState } from "./layoutPersistence.js";
import { badgesByElement, evaluateOverlays, OVERLAY_REGISTRY, overlayAvailability, type OverlayResult } from "./overlays.js";
import { projectCompiledContract, projectData, projectFlow, projectRuntime, projectTopology, type ModelNode, type ViewModel } from "./projectors.js";
import { OwnershipMatrixRenderer, TableRenderer, ThreeDRenderer, TwoDRenderer, viewForSceneMode } from "./renderers.js";
import { useWorkbenchComposition, type WorkbenchClient, type WorkbenchComposition } from "./useWorkbenchComposition.js";
import {
  INITIAL_VIEW_STATE,
  layoutWriteFor,
  parseDeepLink,
  rendererTitle,
  RENDERERS,
  supportsRenderer,
  viewStateFromLayout,
  viewStateReducer,
  viewTitle,
  type StudioViewState,
  type WorkbenchPanel
} from "./viewState.js";
import { PROJECTION_UNAVAILABLE, viewDefinition, viewMenu } from "./views.js";
import { CompileRecordsSection } from "./compileRecords.js";
import { currentResponse, currentView, isCurrent, staleMessage, type WorkbenchData } from "./workbenchData.js";

export type WorkbenchProps = {
  readonly client: WorkbenchClient;
  readonly initialTenantId?: string | undefined;
  readonly initialAssemblyId?: string | undefined;
  readonly initialBaseCatalogHash?: string | undefined;
  /** The host's verified operator id: presence and the per-user layout copy. */
  readonly operatorId?: string | undefined;
  /** The workbench deep-link query (`view`, `overlays`, `renderer`, `panel`), LLD §5.3. */
  readonly deepLink?: string | undefined;
  /** Start the planner allowing every shape (`policy=all-shapes`). */
  readonly allShapesPolicy?: boolean | undefined;
};

/**
 * Scope boundary: changing the applied tenant or assembly remounts the workbench, so no state or subscription of one
 * assembly survives into another (VC §2A rule 4).
 */
export function Workbench(props: WorkbenchProps) {
  const [scope, setScope] = useState({
    tenant: props.initialTenantId ?? DEFAULT_STUDIO_TENANT_ID,
    assembly: props.initialAssemblyId ?? DEFAULT_STUDIO_ASSEMBLY_ID
  });
  return <ScopedWorkbench {...props} tenantId={scope.tenant} assemblyId={scope.assembly}
    key={JSON.stringify([scope.tenant, scope.assembly])} onScopeChange={(tenant, assembly) => setScope({ tenant, assembly })} />;
}

type ScopedProps = WorkbenchProps & {
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly onScopeChange: (tenant: string, assembly: string) => void;
};

const SUBSTRATE_SELECTION: ThreeAssemblySelection = { id: "substrate:base", kind: "substrate", surface: "substrate", label: "Substrate base plate" };

/**
 * Facade (the workbench, LLD-studio-viewpoints-and-perspectives §5.1): one screen of three independent choices, the view,
 * the perspective overlays and the renderer, over composition state that comes only from Fabric.
 *
 * View state lives in {@link viewStateReducer} and composition state in {@link useWorkbenchComposition}; they never mix,
 * so toggling a view, overlay or renderer produces no intent (LLD §1 rule 1). A deep link selects the initial view state;
 * otherwise Fabric's saved layout does, mapped from the retired tabs when it is an older one (§5.4).
 */
function ScopedWorkbench({ client, tenantId, assemblyId, initialBaseCatalogHash, operatorId, deepLink, allShapesPolicy, onScopeChange }: ScopedProps) {
  const link = useMemo(() => deepLink === undefined ? undefined : parseDeepLink(new URLSearchParams(deepLink)), [deepLink]);
  const linked = link !== undefined && ["view", "overlays", "renderer", "panel"].some(key => new URLSearchParams(deepLink).has(key));
  const [viewState, dispatch] = useReducer(viewStateReducer, linked ? link.state : INITIAL_VIEW_STATE);
  const [panel, setPanel] = useState<WorkbenchPanel | undefined>(linked ? link.panel : undefined);
  const [notices, setNotices] = useState<readonly string[]>(link?.notices ?? []);
  const [guidedFixExpanded, setGuidedFixExpanded] = useState(false);
  const [selection, setSelection] = useState<ThreeAssemblySelection>(SUBSTRATE_SELECTION);
  const [extractedPartId, setExtractedPartId] = useState<string | undefined>();
  const [layoutRestored, setLayoutRestored] = useState(linked);
  // The per-user layout copy is keyed by the host identity; without one it is shared on this browser only.
  const userId = operatorId ?? "no-host-identity";

  const composition = useWorkbenchComposition({
    client, tenantId, assemblyId, ...(initialBaseCatalogHash ? { initialBaseCatalogHash } : {}),
    ...(operatorId ? { operatorId } : {}), selection, onSelect: select, allShapesPolicy: allShapesPolicy === true,
    activeView: viewState.view
  });

  function select(next: ThreeAssemblySelection) {
    setSelection(next);
    dispatch({ type: "SELECT_SURFACE", surface: next.surface });
  }

  /** Applies a restored layout: its view state, the guided-fix expansion of the retired Validation tab, any notice. */
  function restore(restored: ReturnType<typeof viewStateFromLayout>) {
    dispatch({ type: "RESTORE", state: restored.state });
    setGuidedFixExpanded(restored.guidedFixExpanded);
    if (restored.notice) setNotices(current => [...current, restored.notice!]);
  }

  // Restore Fabric's layout, or the per-user browser copy when Fabric's layout endpoint is unavailable; a deep link wins.
  useEffect(() => {
    if (linked) return;
    let cancelled = false;
    const local = () => {
      const saved = readLocalViewState(tenantId, userId, assemblyId);
      if (saved && !cancelled) restore(saved);
      if (!cancelled) setLayoutRestored(true);
    };
    if (!client.loadLayoutState) { local(); return; }
    void client.loadLayoutState({ tenantId, assemblyId }).then(layout => {
      if (cancelled) return;
      restore(viewStateFromLayout(layout));
      setLayoutRestored(true);
    }).catch(local);
    return () => { cancelled = true; };
  }, [client, tenantId, assemblyId, userId, linked]);

  // Save the view state: the browser copy at once, Fabric's layout debounced. Layout is UI state only.
  useEffect(() => {
    if (!layoutRestored) return;
    writeLocalViewState(tenantId, userId, assemblyId, viewState);
    if (!client.saveLayoutState) return;
    const handle = setTimeout(() => {
      void client.saveLayoutState?.(layoutWriteFor(viewState, { tenantId, assemblyId })).catch(() => {
        // Fabric's layout copy is best effort; the browser copy remains.
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [client, tenantId, assemblyId, userId, viewState, layoutRestored]);

  const data = composition.data;
  const definition = viewDefinition(viewState.view);
  const availability = definition.availability(data);
  const model: ViewModel | undefined = useMemo(() => {
    if (!availability.available || !data.projection) return undefined;
    // Each view's projector over the draft's projection and, where it has one, Fabric's current view data (P2b).
    switch (viewState.view) {
      case "TOPOLOGY": return projectTopology(data.projection, data, currentView(data, "TOPOLOGY"));
      case "DATA": { const view = currentView(data, "DATA"); return view ? projectData(data.projection, view) : undefined; }
      case "RUNTIME": { const view = currentView(data, "RUNTIME"); return view ? projectRuntime(data.projection, view) : undefined; }
      default: return projectFlow(data.projection, currentView(data, "FLOW"));
    }
  }, [availability.available, data, viewState.view]);
  const overlayResults: readonly OverlayResult[] = useMemo(
    () => model ? evaluateOverlays(viewState.overlays, model, data) : [], [model, viewState.overlays, data]);
  const badges = useMemo(() => badgesByElement(overlayResults), [overlayResults]);
  const menu = viewMenu(data);

  return (
    <div className="studio-workbench-page" aria-label="Unfurl Studio Workbench">
      <TopBar composition={composition} panel={panel} onPanel={setPanel} />
      <Subbar viewState={viewState} dispatch={dispatch} menu={menu} model={model} data={data} />
      {notices.length > 0 && (
        <section className="workbench-notices" role="status">
          {notices.map(notice => <p key={notice}>{notice}</p>)}
          <button type="button" className="secondary" onClick={() => setNotices([])}>Dismiss</button>
        </section>
      )}
      <div className="workbench-grid">
        <Palette composition={composition} tenantId={tenantId} assemblyId={assemblyId} onScopeChange={onScopeChange}
          active={viewState.view === "FLOW"} />
        <main className="workbench-stage" aria-label="Composition workbench">
          {composition.syncError && <p role="status">{composition.syncError}</p>}
          <SemanticZoomNavigator projection={data.projection}
            onSelectNode={nodeId => select({ id: `component:${nodeId}`, kind: "component", surface: nodeId, label: nodeLabel(data.projection, nodeId) })} />
          <Stage viewState={viewState} dispatch={dispatch} model={model} badges={badges} composition={composition}
            selection={selection} onSelect={select} extractedPartId={extractedPartId}
            unavailable={availability.available ? undefined : availability.message}
            {...(!availability.available && availability.reasonCode === PROJECTION_UNAVAILABLE ? { onRetry: composition.commands.reloadProjection } : {})} />
          <section className="workbench-assistant" aria-label="Authoring assistant">
            <AuthoringConversationPanel
              key={JSON.stringify([tenantId, assemblyId, composition.readySession?.sessionId, composition.catalog.selectedFileId])}
              client={client}
              tenantId={tenantId}
              assemblyId={assemblyId}
              catalogFileId={composition.catalog.selectedFileId}
              displayName={draftDisplayName(assemblyId, selectedCatalogFile(composition.catalog.files, composition.catalog.selectedFileId))}
              promptSeed={composition.authoringSeed}
              state={composition.state}
              onStateChange={composition.adoptState}
              onDeploymentPolicy={composition.commands.applyAuthoringPolicy}
              onProposalApplied={composition.commands.applyAuthoringInventory}
            />
          </section>
        </main>
        <Inspector viewState={viewState} model={model} overlayResults={overlayResults} composition={composition}
          selection={selection} onSelect={select} extractedPartId={extractedPartId}
          onTakeOut={() => setExtractedPartId(current => current === selection.id ? undefined : selection.id)} />
      </div>
      {panel === "compile" && <CompilePanel composition={composition} onClose={() => setPanel(undefined)}
        onSnapshotLayout={layout => restore(viewStateFromLayout(layout))} />}
      {panel === "history" && (
        <section className="workbench-panel" aria-label="History panel">
          <div className="panel-title"><strong>History</strong><button type="button" className="secondary" onClick={() => setPanel(undefined)}>Close</button></div>
          {composition.state?.status === "READY"
            ? <IntentHistoryPanel validatedHistory={composition.state.history} />
            : <p className="live-data-notice">Start or open a draft to see its validated intent history.</p>}
        </section>
      )}
      <GuidedFixStrip composition={composition} expanded={guidedFixExpanded} onToggle={() => setGuidedFixExpanded(value => !value)} />
      <StatusBar composition={composition} model={model} />
    </div>
  );
}

/** Top bar (LLD §5.1): tenant, assembly, session, the real sync state, and the compile, history and save actions. */
function TopBar({ composition, panel, onPanel }: {
  readonly composition: WorkbenchComposition; readonly panel: WorkbenchPanel | undefined; readonly onPanel: (panel: WorkbenchPanel | undefined) => void;
}) {
  const session = composition.readySession;
  const sync = !session ? "no draft session" : composition.syncError ? "reconnecting to Fabric" : `synced at revision ${session.sceneRevision}`;
  return (
    <header className="workbench-topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">U</span><span className="brand-name">Unfurl Studio</span></div>
      <div className="workbench-context" aria-label="Workspace context">
        <span>Tenant</span><strong>{composition.tenantId}</strong>
        <span>Assembly</span><strong>{composition.assemblyId}</strong>
        <span>Session</span><strong>{session?.sessionId ?? "none"}</strong>
      </div>
      <div className="topbar-spacer" />
      <span className="sync-pill" role="status">{sync}</span>
      <div className="workbench-actions">
        <button type="button" className="secondary" disabled={composition.busy} onClick={() => void composition.commands.create()}>
          {composition.busy ? "Working..." : "New Draft"}
        </button>
        <button type="button" className="secondary" aria-pressed={panel === "history"} onClick={() => onPanel(panel === "history" ? undefined : "history")}>History</button>
        <button type="button" className="primary-cta" aria-pressed={panel === "compile"} onClick={() => onPanel(panel === "compile" ? undefined : "compile")}>
          Compile & Sign
        </button>
      </div>
    </header>
  );
}

/**
 * Subbar (LLD §5.1): the view switcher, "More views" with each unavailable view's reason, the overlay pills (an
 * unavailable overlay is disabled and says why) and the renderer toggle, which disables combinations that do not exist.
 */
function Subbar({ viewState, dispatch, menu, model, data }: {
  readonly viewState: StudioViewState;
  readonly dispatch: (action: Parameters<typeof viewStateReducer>[1]) => void;
  readonly menu: ReturnType<typeof viewMenu>;
  readonly model: ViewModel | undefined;
  readonly data: WorkbenchData;
}) {
  return (
    <div className="workbench-subbar">
      <div className="workbench-view-tabs" role="tablist" aria-label="Views">
        {menu.switcher.map(view => (
          <button type="button" role="tab" key={view.id} aria-selected={viewState.view === view.id}
            className={viewState.view === view.id ? "view-tab active" : "view-tab"} onClick={() => dispatch({ type: "SELECT_VIEW", view: view.id })}>
            {view.title}
          </button>
        ))}
        {menu.more.length > 0 && (
          <details className="more-views">
            <summary>More views</summary>
            <ul>
              {menu.more.map(({ view, reason }) => (
                <li key={view.id}><strong>{view.title}</strong> <span className="absent-reason">{reason.message}</span></li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="workbench-overlay-pills" aria-label="Perspective overlays">
        {OVERLAY_REGISTRY.map(overlay => {
          const available = overlayAvailability(overlay.id, model, data);
          const active = viewState.overlays.includes(overlay.id);
          return (
            <button type="button" key={overlay.id} aria-pressed={active} disabled={!available.available && !active}
              title={available.available ? overlay.title : available.message}
              className={`overlay-pill ${active ? "active" : ""} ${viewState.colourOverlay === overlay.id ? "colour" : ""}`}
              onClick={() => dispatch({ type: "TOGGLE_OVERLAY", overlay: overlay.id })}>
              {overlay.title}
            </button>
          );
        })}
      </div>
      <div className="workbench-renderer-toggle" role="group" aria-label="Renderer">
        {RENDERERS.map(renderer => {
          const supported = supportsRenderer(viewState.view, renderer);
          return (
            <button type="button" key={renderer} aria-pressed={viewState.renderer === renderer} disabled={!supported}
              title={supported ? rendererTitle(renderer) : `${viewTitle(viewState.view)} has no ${rendererTitle(renderer)} renderer`}
              className={viewState.renderer === renderer ? "renderer-button active" : "renderer-button"}
              onClick={() => dispatch({ type: "SELECT_RENDERER", renderer })}>
              {rendererTitle(renderer)}
            </button>
          );
        })}
        {viewState.view === "FLOW" && viewState.renderer === "THREE_D" && (
          <button type="button" className="secondary" onClick={() => dispatch({ type: "SELECT_LAYOUT", layout: viewState.layout === "EXPLODED" ? "ASSEMBLY" : "EXPLODED" })}>
            {viewState.layout === "EXPLODED" ? "Assembly layout" : "Exploded layout"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Palette (LLD §5.1): live catalog browsing, search wired to it, the catalog version and the workspace scope. */
function Palette({ composition, tenantId, assemblyId, onScopeChange, active }: {
  readonly composition: WorkbenchComposition; readonly tenantId: string; readonly assemblyId: string;
  readonly onScopeChange: (tenant: string, assembly: string) => void; readonly active: boolean;
}) {
  const [query, setQuery] = useState("");
  const [tenantDraft, setTenantDraft] = useState(tenantId);
  const [assemblyDraft, setAssemblyDraft] = useState(assemblyId);
  const { catalog } = composition;
  const ready = composition.state?.status === "READY";
  const entries = catalog.entries.filter(entry => {
    const needle = query.trim().toLowerCase();
    return needle === "" || entry.catalogEntryId.toLowerCase().includes(needle) || paletteLabel(entry).toLowerCase().includes(needle);
  });
  return (
    <aside className="workbench-palette" aria-label="Catalog palette">
      <div className="panel-title"><span>Catalog</span><small>{catalog.entries.length} entries</small></div>
      <label>Search<input aria-label="Search catalog" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or catalog id" /></label>
      <label>Tenant<input value={tenantDraft} onChange={event => setTenantDraft(event.target.value)} /></label>
      <label>Assembly<input value={assemblyDraft} onChange={event => setAssemblyDraft(event.target.value)} /></label>
      <button type="button" disabled={!tenantDraft.trim() || !assemblyDraft.trim()} onClick={() => onScopeChange(tenantDraft.trim(), assemblyDraft.trim())}>
        Apply workspace scope
      </button>
      {catalog.files.length > 0 && (
        <label>Catalog version
          <select value={catalog.selectedFileId} disabled={composition.busy} onChange={event => composition.selectCatalogFile(event.target.value)}>
            {catalog.files.map(file => <option value={file.fileId} key={file.fileId}>{catalogFileOptionLabel(file)}</option>)}
          </select>
        </label>
      )}
      {catalog.error && <p className="live-data-notice">Live catalog unavailable: {friendlyStudioError(catalog.error)}</p>}
      {!catalog.error && catalog.entries.length === 0 && <p className="live-data-notice">No catalog entries are admitted for this tenant.</p>}
      {!active && <p className="live-data-notice">Components are added in Flow & Composition.</p>}
      <section className="catalog-group" aria-label="Catalog entries">
        {entries.map(entry => (
          <CatalogRow key={entry.catalogEntryId} entry={entry} disabled={!active || !ready || composition.busy}
            canAssist={Boolean(composition.commands && ready)} hovered={composition.preview?.catalogEntryId === entry.catalogEntryId}
            onAdd={() => void composition.commands.add(entry.catalogEntryId)}
            onAsk={() => composition.commands.ask({
              autoSend: true,
              text: `Help me add and configure ${labelForCatalogEntry(entry.catalogEntryId)} (${entry.catalogEntryId}) in this governed draft. Ask the required configuration, binding, substrate, and external-connection questions before proposing Studio intents.`,
              actionContext: {
                operation: "ADD_COMPONENT", catalogEntryId: entry.catalogEntryId, componentLabel: labelForCatalogEntry(entry.catalogEntryId),
                offeredCapabilities: entryCapabilities(entry, "OFFER"), dependencyPorts: entryCapabilities(entry, "DEPENDENCY"),
                substratePorts: entryCapabilities(entry, "SUBSTRATE_DEPENDENCY"),
                ...(composition.readySession ? { draftSessionId: composition.readySession.sessionId } : {})
              }
            })}
            onHover={() => composition.commands.hover(entry.catalogEntryId)} onHoverEnd={composition.commands.clearPreview} />
        ))}
      </section>
    </aside>
  );
}

/** One live catalog entry: draggable into the 3D scene, addable, and askable; hover asks Fabric what it fits. */
function CatalogRow({ entry, disabled, canAssist, hovered, onAdd, onAsk, onHover, onHoverEnd }: {
  readonly entry: VisualCatalogEntry; readonly disabled: boolean; readonly canAssist: boolean; readonly hovered: boolean;
  readonly onAdd: () => void; readonly onAsk: () => void; readonly onHover: () => void; readonly onHoverEnd: () => void;
}) {
  return (
    <div className={hovered ? "catalog-row previewing" : "catalog-row"} draggable={!disabled}
      onDragStart={event => {
        if (disabled) return;
        event.dataTransfer.setData("application/x-unfurl-catalog-entry", entry.catalogEntryId);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onMouseEnter={onHover} onMouseLeave={onHoverEnd} onFocus={onHover} onBlur={onHoverEnd} aria-disabled={disabled}>
      <button type="button" className="catalog-row-main" aria-label={`Add ${paletteLabel(entry)}`} disabled={disabled} onClick={onAdd}>
        <span>{paletteLabel(entry)}</span>
      </button>
      <button type="button" className="catalog-row-action" disabled={disabled || !canAssist} onClick={onAsk}>Ask</button>
    </div>
  );
}

/**
 * Stage (LLD §5.1): the active renderer for the active view, or the view's reason when it has no data, with Retry when
 * the reason is a failed request that can be repeated (a projection load, §4.3 rule 6).
 */
function Stage({ viewState, dispatch, model, badges, composition, selection, onSelect, extractedPartId, unavailable, onRetry }: {
  readonly viewState: StudioViewState;
  readonly dispatch: (action: Parameters<typeof viewStateReducer>[1]) => void;
  readonly model: ViewModel | undefined;
  readonly badges: ReturnType<typeof badgesByElement>;
  readonly composition: WorkbenchComposition;
  readonly selection: ThreeAssemblySelection;
  readonly onSelect: (selection: ThreeAssemblySelection) => void;
  readonly extractedPartId: string | undefined;
  readonly unavailable: string | undefined;
  readonly onRetry?: () => void;
}) {
  const projection = composition.data.projection;
  const draftIds = useMemo(() => composition.draftComponents === undefined ? undefined
    : new Set(composition.draftComponents.map(component => component.catalogEntryId)), [composition.draftComponents]);
  const semantic = useMemo(() => projection ? toSemanticSceneProjection(projection) : undefined, [projection]);
  if (!model || !projection || !semantic) {
    return (
      <section className="workbench-stage-empty" role="status">
        <strong>{viewTitle(viewState.view)}</strong><span>{unavailable ?? "No data for this view."}</span>
        {onRetry && <button type="button" className="secondary" onClick={onRetry}>Retry</button>}
      </section>
    );
  }
  const notes = model.notes.length > 0 && <ul className="view-notes">{model.notes.map(note => <li key={note}>{note}</li>)}</ul>;
  if (viewState.renderer === "THREE_D") {
    return (
      <div className="composition-plane" aria-label={`${viewTitle(viewState.view)}, 3D`}>
        {notes}
        <ThreeDRenderer view={viewState.view} {...(viewState.layout === undefined ? {} : { layout: viewState.layout })}
          projection={projection} semanticProjection={semantic} requestedZoom={viewState.semanticZoomLevel} selection={selection}
          {...(extractedPartId === undefined ? {} : { extractedPartId })} {...(draftIds === undefined ? {} : { draftCatalogEntryIds: draftIds })}
          {...(composition.preview === undefined ? {} : { preview: composition.preview })}
          onSelect={onSelect}
          onSceneMode={mode => {
            const next = viewForSceneMode(mode);
            if (!next) return;
            dispatch({ type: "SELECT_VIEW", view: next.view });
            if (next.layout) dispatch({ type: "SELECT_LAYOUT", layout: next.layout });
          }}
          onZoom={level => dispatch({ type: "ZOOM", level })}
          onDrop={composition.commands.drop} />
      </div>
    );
  }
  const props = { model, badges, selectedId: selection.surface, onSelect };
  return (
    <div className="composition-plane" aria-label={`${viewTitle(viewState.view)}, ${rendererTitle(viewState.renderer)}`}>
      {notes}
      {viewState.renderer === "TWO_D"
        ? (viewState.view === "DATA" ? <OwnershipMatrixRenderer {...props} /> : <TwoDRenderer {...props} />)
        : <TableRenderer {...props} />}
    </div>
  );
}

/**
 * Inspector (LLD §5.1, §8 fix 4): sections contributed by the selection, the active view and each active overlay. Every
 * value shown is one Fabric supplied; an absent one says so.
 */
function Inspector({ viewState, model, overlayResults, composition, selection, onSelect, extractedPartId, onTakeOut }: {
  readonly viewState: StudioViewState;
  readonly model: ViewModel | undefined;
  readonly overlayResults: readonly OverlayResult[];
  readonly composition: WorkbenchComposition;
  readonly selection: ThreeAssemblySelection;
  readonly onSelect: (selection: ThreeAssemblySelection) => void;
  readonly extractedPartId: string | undefined;
  readonly onTakeOut: () => void;
}) {
  const node = model?.nodes.find(candidate => candidate.id === selection.surface);
  const ready = composition.state?.status === "READY";
  const draftItem = composition.draftComponents?.find(component =>
    selection.surface === `draft:${component.catalogEntryId}`
    || selection.surface === projectionNodeIdForCatalogEntry(composition.data.projection, component.catalogEntryId));
  return (
    <aside className="workbench-inspector" aria-label="Inspector">
      <SelectionSection selection={selection} node={node} draftItem={draftItem} composition={composition} ready={ready}
        renderer3d={viewState.renderer === "THREE_D"} extracted={extractedPartId === selection.id} onTakeOut={onTakeOut} />
      {viewState.view === "FLOW" && <FlowSections composition={composition} selection={selection} node={node} ready={ready} onSelect={onSelect} />}
      {viewState.view === "TOPOLOGY" && <TopologySections composition={composition} ready={ready} />}
      {overlayResults.map(result => result.available ? (
        <section className="inspector-card" key={result.overlay} aria-label={result.section.title}>
          <h2>{result.section.title}</h2>
          <dl>{result.section.facts.map(fact => <FactRow key={fact.label} label={fact.label} value={fact.value} source={fact.source} />)}</dl>
        </section>
      ) : (
        <section className="inspector-card" key={result.overlay}>
          <h2>{OVERLAY_REGISTRY.find(overlay => overlay.id === result.overlay)?.title}</h2>
          <p className="absent-reason">{result.message}</p>
        </section>
      ))}
    </aside>
  );
}

/** One inspector value and the Fabric field it came from. */
function FactRow({ label, value, source }: { readonly label: string; readonly value: string; readonly source: string }) {
  return <><dt>{label}</dt><dd title={`from ${source}`}>{value}</dd></>;
}

/** The selected element: its Fabric facts and the actions that exist for it. */
function SelectionSection({ selection, node, draftItem, composition, ready, renderer3d, extracted, onTakeOut }: {
  readonly selection: ThreeAssemblySelection; readonly node: ModelNode | undefined; readonly draftItem: DraftComponentItem | undefined;
  readonly composition: WorkbenchComposition; readonly ready: boolean; readonly renderer3d: boolean; readonly extracted: boolean;
  readonly onTakeOut: () => void;
}) {
  return (
    <section className="inspector-card" aria-label="Selection">
      <h2>{node?.label ?? selection.label}</h2>
      {node ? (
        <dl>{node.facts.map(fact => <FactRow key={fact.label} label={fact.label} value={fact.value} source={fact.source} />)}</dl>
      ) : selection.surface.startsWith("draft:") ? (
        <p className="live-data-notice">This component is in the draft; Fabric has not projected it yet.</p>
      ) : (
        <p className="live-data-notice">Select an element of the view to inspect what Fabric reports for it.</p>
      )}
      <div className="scene-action-row">
        {renderer3d && selection.kind !== "substrate" && (
          <button type="button" className="secondary" onClick={onTakeOut}>{extracted ? "Return to Assembly" : "Take Out"}</button>
        )}
        {selection.kind === "pipe" && (
          <button type="button" className="secondary" disabled={!ready || composition.busy} onClick={() => void composition.commands.disconnect(selection.id)}>
            Disconnect Pipe
          </button>
        )}
        {draftItem && (
          <>
            <button type="button" className="secondary" disabled={!ready} onClick={() => composition.commands.ask({
              autoSend: true,
              text: `Help me remove ${draftItem.label} (${draftItem.catalogEntryId}) from this draft. Ask about dependent connections, replacement-before-removal, state cleanup, and substrate binding impact before proposing Studio intents.`,
              actionContext: {
                operation: "REMOVE_COMPONENT", componentId: selection.surface, catalogEntryId: draftItem.catalogEntryId, componentLabel: draftItem.label,
                ...(composition.readySession ? { draftSessionId: composition.readySession.sessionId } : {})
              }
            })}>Ask Agent</button>
            <button type="button" className="secondary" disabled={!ready || composition.busy} onClick={() => void composition.commands.remove(draftItem)}>
              Remove Component
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** Flow & Composition's inspector: Fabric's replacement candidates, port connection, and the draft inventory. */
function FlowSections({ composition, selection, node, ready, onSelect }: {
  readonly composition: WorkbenchComposition; readonly selection: ThreeAssemblySelection; readonly node: ModelNode | undefined;
  readonly ready: boolean; readonly onSelect: (selection: ThreeAssemblySelection) => void;
}) {
  const [fromPort, setFromPort] = useState("");
  const [toPort, setToPort] = useState("");
  const { replacement } = composition;
  const chosen = replacement.candidates.find(candidate => candidate.catalogEntryId === replacement.selectedEntryId);
  return (
    <>
      {node && selection.kind === "component" && (
        <section className="inspector-card" aria-label="Replace component">
          <h2>Replace Component</h2>
          {replacement.candidates.length === 0
            ? <p className="live-data-notice">{replacement.error ? friendlyStudioError(replacement.error) : "Fabric reports no replacement candidates for this component."}</p>
            : (
              <div className="replacement-shelf" aria-label="Replacement candidates">
                {replacement.candidates.map(candidate => (
                  <button type="button" key={candidate.catalogEntryId} aria-pressed={replacement.selectedEntryId === candidate.catalogEntryId}
                    className={`replacement-card ${candidate.status.toLowerCase()} ${replacement.selectedEntryId === candidate.catalogEntryId ? "selected" : ""}`}
                    onClick={() => replacement.select(candidate.catalogEntryId)}>
                    <strong>{candidate.label}</strong>
                    <span>{candidate.owner} / {candidate.shape}</span>
                    <small>{candidate.status === "ALLOWED" ? "Allowed" : "Blocked"}: {candidate.reason}</small>
                  </button>
                ))}
              </div>
            )}
          <button type="button" disabled={!ready || composition.busy || chosen?.status !== "ALLOWED"}
            onClick={() => chosen && void composition.commands.replace(node.id, chosen.catalogEntryId)}>
            Validate & Replace
          </button>
        </section>
      )}
      <section className="inspector-card" aria-label="Connect ports">
        <h2>Connect Ports</h2>
        <label>From port<input value={fromPort} onChange={event => setFromPort(event.target.value)} /></label>
        <label>To port<input value={toPort} onChange={event => setToPort(event.target.value)} /></label>
        <button type="button" disabled={!ready || composition.busy || fromPort.trim() === "" || toPort.trim() === ""}
          onClick={() => void composition.commands.connect(fromPort.trim(), toPort.trim())}>Validate Connection</button>
      </section>
      <section className="inspector-card" aria-label="Draft inventory">
        <h2>Draft Inventory</h2>
        {composition.draftComponents === undefined || composition.draftComponents.length === 0
          ? <p className="live-data-notice">{ready ? "No components added yet." : "Start a New Draft to add components."}</p>
          : <ul>{composition.draftComponents.map(component => (
            <li key={component.catalogEntryId}>
              <button type="button" className="link-button" onClick={() => {
                const nodeId = projectionNodeIdForCatalogEntry(composition.data.projection, component.catalogEntryId);
                const surface = nodeId ?? `draft:${component.catalogEntryId}`;
                onSelect({ id: `component:${surface}`, kind: "component", surface, label: component.label });
              }}>{component.label}</button>
              <small>{component.catalogEntryId}</small>
            </li>
          ))}</ul>}
      </section>
    </>
  );
}

/**
 * Substrate & Topology's inspector: the assembly's deployment target as Fabric reports it, the deployment planner, and
 * Fabric's resolution while it is current (§4.3 rule 6).
 */
function TopologySections({ composition, ready }: { readonly composition: WorkbenchComposition; readonly ready: boolean }) {
  const data = composition.data;
  const current = currentResponse(data.deployment, data);
  return (
    <>
      <section className="inspector-card" aria-label="Deployment target">
        <h2>Deployment Target</h2>
        <dl>
          <FactRow label="Target" value={data.assembly?.defaultDeploymentTarget || "not provided by Fabric"} source="assemblies[].defaultDeploymentTarget" />
          <FactRow label="Shape" value={data.assembly?.deploymentShape || "not provided by Fabric"} source="assemblies[].deploymentShape" />
        </dl>
      </section>
      <section className="inspector-card" aria-label="Deployment planner">
        <h2>Deployment Planner</h2>
        <div className="button-row">
          {DEPLOYMENT_SHAPE_OPTIONS.map(option => (
            <button type="button" key={option.shape} title={option.description}
              className={data.deploymentPolicy.preferredShapes[0] === option.shape ? "secondary-active" : "secondary"}
              onClick={() => composition.setPlanner(state => preferDeploymentShape(state, option.shape))}>{option.label}</button>
          ))}
        </div>
        <div className="button-row">
          {(["springBoot", "kubernetes", "serviceMesh"] as const).map(key => (
            <label className="studio-checkbox" key={key}>
              <input type="checkbox" checked={composition.planner.runtime[key] === true}
                onChange={event => composition.setPlanner(state => setDeploymentRuntime(state, { ...state.runtime, [key]: event.target.checked }))} />
              {{ springBoot: "Spring Boot", kubernetes: "Kubernetes", serviceMesh: "Service mesh" }[key]}
            </label>
          ))}
        </div>
        <button type="button" disabled={!ready || composition.busy} onClick={() => void composition.commands.resolveDeployment()}>Resolve deployment</button>
        {data.deployment && !isCurrent(data.deployment, data) && <p className="absent-reason">{staleMessage("the deployment resolution", data.deployment, data, "Resolve again.")}</p>}
        {data.deploymentError && <p className="studio-error">{friendlyStudioError(data.deploymentError)}</p>}
      </section>
      <SelectedShapesPanel response={current} />
      <RejectedShapesPanel response={current} />
      <RequiredPortsPanel response={current} />
      <IsolationMatchesPanel policy={data.deploymentPolicy} />
      <FallbackAttemptsPanel policy={data.deploymentPolicy} response={current} />
      <section className="inspector-card" aria-label="Substrate">
        <h2>Substrate</h2>
        <p className="live-data-notice">The substrate is derived from the deployment profile, not from the catalog; adjust the profile to change it.</p>
        <button type="button" className="secondary" disabled={!ready} onClick={() => composition.commands.ask({
          autoSend: true,
          text: "Help me configure the substrate/runtime layer for this draft. Ask which runtime target, secret/config references, telemetry, audit, and provider bindings should be used before proposing Studio intents or deployment policy.",
          actionContext: {
            operation: "CONFIGURE_SUBSTRATE", componentId: "substrate:base", componentLabel: "Substrate Runtime Layer",
            substratePorts: (data.projection?.substratePorts ?? []).map(port => port.capability || port.portId),
            ...(composition.readySession ? { draftSessionId: composition.readySession.sessionId } : {})
          }
        })}>Ask Agent For Configuration</button>
      </section>
    </>
  );
}

/**
 * Compile panel (LLD §5.3): signing request, compile, and the result while it is current. Signing, the decision audit and
 * the contract artifacts live here; an out-of-date compile says so and shows no stale values (§4.3 rule 6).
 */
function CompilePanel({ composition, onClose, onSnapshotLayout }: {
  readonly composition: WorkbenchComposition;
  readonly onClose: () => void;
  /** Restores the layout a loaded snapshot carries (§6), so its view state is shown and then saved. */
  readonly onSnapshotLayout: (layout: StudioLayoutState) => void;
}) {
  const data = composition.data;
  const ready = composition.state?.status === "READY";
  const [target, setTarget] = useState(data.assembly?.defaultDeploymentTarget ?? "");
  const [shape, setShape] = useState<DeploymentShape>(data.deploymentPolicy.preferredShapes[0] ?? "CONTAINERIZED_SERVICE");
  const compile = data.compile;
  const current = currentResponse(compile, data);
  const handoff = current ? signingHandoffFromCompile(current, { signingRequested: data.signingRequested }) : undefined;
  // Only an audit Fabric returned; the builder's empty case is not a Fabric value.
  const audit = current?.status === "COMPILED" && current.decisionAudit ? renderDecisionAuditText(buildDecisionAuditView(current.decisionAudit)).split("\n") : undefined;
  return (
    <section className="workbench-panel" aria-label="Compile panel">
      <div className="panel-title"><strong>Compile & Sign</strong><button type="button" className="secondary" onClick={onClose}>Close</button></div>
      <label className="studio-checkbox">
        <input type="checkbox" checked={composition.sign} onChange={event => composition.setSign(event.target.checked)} />Request signed compile
      </label>
      <button type="button" className="primary-cta" disabled={!ready || composition.busy} onClick={() => void composition.commands.compile()}>Compile & Validate</button>
      {!ready && <p className="live-data-notice">Start a draft to compile.</p>}
      {compile && !current && <p className="absent-reason">{staleMessage("the compiled contract", compile, data, "Compile again.")}</p>}
      {current?.status === "INVALID" && <p className="studio-error">{current.reason}: {current.details}</p>}
      {current?.status === "STALE_REVISION" && <p className="studio-error">Fabric expected revision {current.expectedRevision}, the request had {current.receivedRevision}. Refresh and compile again.</p>}
      {current?.status === "COMPILED" && (
        <>
          <dl>
            <FactRow label="Candidate" value={current.candidateId} source="compile candidateId" />
            <FactRow label="Signing" value={handoff?.status ?? "unavailable"} source="compile signedContractArtifact" />
            <FactRow label="Compiled at revision" value={`${compile!.revision} of session ${compile!.sessionId}`} source="session at compile" />
          </dl>
          {current.warnings.length > 0 && <ul>{current.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          <DiagnosticArtifactsPanel artifacts={[current.contractArtifact, current.substrateProfileArtifact,
            ...(current.signedContractArtifact ? [current.signedContractArtifact] : []), ...(current.diagnosticArtifacts ?? [])]} />
          {audit && <section aria-label="Decision audit"><h3>Decision audit</h3><ul>{audit.map(line => <li key={line}>{line}</li>)}</ul></section>}
        </>
      )}
      <CompileRecordsSection composition={composition} />
      <h3>Save</h3>
      <label>Deployment target<input value={target} onChange={event => setTarget(event.target.value)} /></label>
      <label>Deployment shape
        <select value={shape} onChange={event => setShape(event.target.value as DeploymentShape)}>
          {DEPLOYMENT_SHAPE_OPTIONS.map(option => <option value={option.shape} key={option.shape}>{option.label}</option>)}
        </select>
      </label>
      <div className="button-row">
        <button type="button" disabled={composition.busy || target.trim() === ""} onClick={() => void composition.commands.saveDraft(target.trim(), shape)}>Save With Deployment</button>
        <button type="button" className="secondary" disabled={composition.busy} onClick={() => void composition.commands.saveSnapshot()}>Save Assembly</button>
        <label className="file-action-button">Load Assembly
          <input type="file" accept="application/json,.json" onChange={event => {
            const file = event.currentTarget.files?.[0];
            if (file) void composition.commands.loadSnapshot(file, onSnapshotLayout);
          }} />
        </label>
      </div>
      {composition.status && <p className="live-data-notice">{composition.status}</p>}
    </section>
  );
}

/**
 * Guided-fix strip (LLD §4.3 rule 5): always on. It renders Fabric's planning warnings, intent results and compile
 * failures as plain-language cards (`buildDraftWorkspaceOverlay`), plus the last command failure. A `NO_MATCH` gives one
 * card per typed cause and trust rejection, in Fabric's words (LLD-fabric-studio-api, Structured match failures and
 * trust rejections). No fix is applied from a card: Fabric's causes name their fix in text and carry no fix action.
 *
 * Compile cards come from the pinned compile only while it is current (§4.3 rule 6), never from the state machine's
 * `lastCompile`, which a failed or superseded compile leaves in place; the compile panel names an out-of-date one.
 */
function GuidedFixStrip({ composition, expanded, onToggle }: {
  readonly composition: WorkbenchComposition; readonly expanded: boolean; readonly onToggle: () => void;
}) {
  const state = composition.state;
  const overlayState = state && withCurrentCompile(state, currentResponse(composition.data.compile, composition.data));
  const items = [
    ...(overlayState ? buildDraftWorkspaceOverlay(overlayState).items : []),
    // A Fabric request that failed (compile or intent) is shown, never silent; the state machine keeps it until the next success.
    ...(state?.status === "READY" && state.lastError
      ? [{ severity: "ERROR" as const, code: "FABRIC_REQUEST_FAILED", message: friendlyStudioError(state.lastError) }] : []),
    ...(composition.commandError ? [{ severity: "ERROR" as const, code: "COMMAND_FAILED", message: friendlyStudioError(composition.commandError) }] : [])
  ];
  const problems = items.filter(item => item.severity !== "INFO");
  return (
    <section className={`guided-fix-strip ${expanded ? "expanded" : ""}`} aria-label="Guided fixes">
      <button type="button" className="secondary" aria-expanded={expanded} onClick={onToggle}>
        {problems.length === 0 ? "No problems reported by Fabric" : `${problems.length} item${problems.length === 1 ? "" : "s"} to review`}
      </button>
      {(expanded || problems.length > 0) && (
        <ul>{items.map(item => (
          <li key={`${item.code}:${item.message}`} className={`guided-fix ${item.severity.toLowerCase()}`}><strong>{item.code}</strong> {item.message}</li>
        ))}</ul>
      )}
    </section>
  );
}

/**
 * The draft state as the guided-fix strip reads it: its `lastCompile` replaced by the pinned compile when that is
 * current, and removed otherwise, so a failed or superseded compile never yields a card that reads as current
 * (§4.3 rule 6). Other states pass through unchanged.
 */
function withCurrentCompile(state: DraftWorkspaceState, compile: CompileDraftCandidateResponse | undefined): DraftWorkspaceState {
  if (state.status !== "READY") return state;
  const { lastCompile: _unpinned, ...rest } = state;
  return compile ? { ...rest, lastCompile: compile } : rest;
}

/** Status bar (LLD §5.1): counts and revision, only as Fabric reports them. */
function StatusBar({ composition, model }: { readonly composition: WorkbenchComposition; readonly model: ViewModel | undefined }) {
  const session = composition.readySession;
  const projection = composition.data.projection;
  return (
    <footer className="workbench-bottom">
      <div><strong>Revision</strong><span>{session ? session.sceneRevision : "no draft"}</span></div>
      <div><strong>Components</strong><span>{composition.draftComponents?.length ?? "no draft"}</span></div>
      <div><strong>Connections</strong><span>{projection ? projection.connections?.length ?? 0 : "projection not loaded"}</span></div>
      <div><strong>Substrate ports</strong><span>{projection ? projection.substratePorts?.length ?? 0 : "projection not loaded"}</span></div>
      <div><strong>Collaborators</strong><span>{session?.collaborators?.length ?? 0}</span></div>
      <div><strong>Last intent</strong><span>{composition.state?.status === "READY" ? composition.state.lastResponse?.status ?? "none" : "no draft"}</span></div>
      <div><strong>View elements</strong><span>{model ? model.nodes.length : 0}</span></div>
    </footer>
  );
}

/** Overlay ids in pill order, for tests and deep links. */
export const WORKBENCH_OVERLAYS: readonly StudioOverlay[] = OVERLAY_REGISTRY.map(overlay => overlay.id);

export type CompiledContractWorkbenchProps = {
  readonly client: Pick<StudioFabricClient, "loadCompositionView">;
  readonly contractPath: string;
  readonly substrateProfilePath: string;
  readonly deepLink?: string;
};

/**
 * Read-only workbench (`read-only` deep link, LLD §5.3): Flow & Composition over a supplied compiled contract, loaded
 * through Fabric's composition view and drawn by the same renderers as a draft (Table by default, 2D on request). It
 * changes nothing: there is no draft session, so no intent can be sent.
 */
export function CompiledContractWorkbench({ client, contractPath, substrateProfilePath, deepLink }: CompiledContractWorkbenchProps) {
  const link = useMemo(() => parseDeepLink(new URLSearchParams(deepLink ?? "")), [deepLink]);
  const [renderer, setRenderer] = useState<"TWO_D" | "TABLE">(link.state.renderer === "TWO_D" ? "TWO_D" : "TABLE");
  const [model, setModel] = useState<ViewModel | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [selection, setSelection] = useState<ThreeAssemblySelection>(SUBSTRATE_SELECTION);
  useEffect(() => {
    let cancelled = false;
    if (!client.loadCompositionView) {
      setError("This client cannot load compiled contracts.");
      return;
    }
    void client.loadCompositionView({ contractPath, substrateProfilePath })
      .then(response => { if (!cancelled) { setModel(projectCompiledContract(response.view)); setError(undefined); } })
      .catch(caught => { if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { cancelled = true; };
  }, [client, contractPath, substrateProfilePath]);
  const props = model ? { model, badges: new Map(), selectedId: selection.surface, onSelect: setSelection } : undefined;
  return (
    <div className="studio-workbench-page" aria-label="Unfurl Studio Workbench, compiled contract">
      <header className="workbench-topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">U</span><span className="brand-name">Unfurl Studio</span></div>
        <div className="workbench-context"><span>Compiled contract</span><strong>{contractPath}</strong></div>
      </header>
      <div className="workbench-subbar">
        <div className="workbench-view-tabs" role="tablist" aria-label="Views">
          <button type="button" role="tab" aria-selected className="view-tab active">{viewTitle("FLOW")}</button>
        </div>
        <div className="workbench-renderer-toggle" role="group" aria-label="Renderer">
          {(["TWO_D", "TABLE"] as const).map(option => (
            <button type="button" key={option} aria-pressed={renderer === option} className={renderer === option ? "renderer-button active" : "renderer-button"}
              onClick={() => setRenderer(option)}>{rendererTitle(option)}</button>
          ))}
          <button type="button" disabled title="A compiled contract has no 3D renderer here; open its draft in the workbench">3D</button>
        </div>
      </div>
      {link.notices.length > 0 && <section className="workbench-notices" role="status">{link.notices.map(notice => <p key={notice}>{notice}</p>)}</section>}
      {error && <p className="studio-error">{friendlyStudioError(error)}</p>}
      {!model && !error && <p role="status">Loading the compiled contract from Fabric.</p>}
      {props && (
        <main className="workbench-stage" aria-label="Compiled contract">
          {props.model.notes.length > 0 && <ul className="view-notes">{props.model.notes.map(note => <li key={note}>{note}</li>)}</ul>}
          {renderer === "TWO_D" ? <TwoDRenderer {...props} /> : <TableRenderer {...props} />}
        </main>
      )}
    </div>
  );
}
