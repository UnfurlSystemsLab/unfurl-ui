import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_STUDIO_ASSEMBLY_ID,
  DEFAULT_STUDIO_TENANT_ID,
  type DynamicDcpProjectionResponse,
  type StudioSessionEvent,
  type StudioReplacementCandidate as FabricReplacementCandidate,
  type StudioLayoutState,
  type StudioFabricClient,
  type ConnectionCandidatesResponse
} from "@unfurl/fabric-validation-client";
import type { VisualCatalogEntry } from "@unfurl/visual-manifest";
import {
  applyDraftIntent,
  compileDraftWorkspace,
  createDraftWorkspace,
  type DraftWorkspaceState
} from "./draftWorkspace.js";
import { buildSigningHandoff } from "./signingHandoff.js";
import type { SemanticDcpSceneProjection, SemanticZoomLevel, ThreeAssemblySelection, ThreeAssemblySurfaceId } from "./ThreeAssemblyScene.js";

const ThreeAssemblyScene = lazy(async () => {
  const module = await import("./ThreeAssemblyScene.js");
  return { default: module.ThreeAssemblyScene };
});

export type DraftWorkspacePanelProps = {
  readonly client: Pick<
    StudioFabricClient,
    "saveDraft" |
    "loadLayoutState" |
    "saveLayoutState" |
    "loadDynamicDcpProjection" |
    "loadReplacementCandidates" |
    "loadConnectionCandidates" |
    "listCatalogVisuals" | "createDraftComposition" | "applyIntent" | "getDraftSession" | "compileCandidate"
    | "heartbeatCollaborator" | "sessionEventsUrl"
  >;
  readonly initialTenantId?: string | undefined;
  readonly initialAssemblyId?: string | undefined;
  readonly initialBaseCatalogHash?: string | undefined;
  readonly initialDraftComponentCount?: number | undefined;
  readonly initialDraftComponentCatalogEntryIds?: readonly string[] | undefined;
  readonly initialDynamicProjection?: DynamicDcpProjectionResponse | undefined;
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

type DraftComponentItem = {
  readonly catalogEntryId: string;
  readonly label: string;
  readonly status: "ADDED" | "VALIDATED";
};

const tutorialStorageKey = "unfurl-studio-workbench-tutorial-dismissed";

export function DraftWorkspacePanel({
  client,
  initialTenantId = DEFAULT_STUDIO_TENANT_ID,
  initialAssemblyId = DEFAULT_STUDIO_ASSEMBLY_ID,
  initialBaseCatalogHash = "sha256:catalog",
  initialDraftComponentCount,
  initialDraftComponentCatalogEntryIds,
  initialDynamicProjection
}: DraftWorkspacePanelProps) {
  const [tenantId, setTenantId] = useState(initialTenantId);
  const [assemblyId, setAssemblyId] = useState(initialAssemblyId);
  const [baseCatalogHash, setBaseCatalogHash] = useState(initialBaseCatalogHash);
  const [targetApplicationName, setTargetApplicationName] = useState("unfurl-flow");
  const [targetDeploymentTarget, setTargetDeploymentTarget] = useState("Customer Runtime Substrate");
  const [catalogEntryId, setCatalogEntryId] = useState("com.unfurl.flow:orchestrator:0.1.0");
  const [fromPort, setFromPort] = useState("state-store");
  const [toPort, setToPort] = useState("postgres-state-store.claim");
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
    label: "Flow Orchestrator"
  });
  const [extractedPartId, setExtractedPartId] = useState<string | undefined>();
  const [replacementEntryId, setReplacementEntryId] = useState("com.unfurl:validation-service:1.1.0");
  // Hover-preview state: populated while the operator's pointer is over a
  // palette button, cleared on mouseleave or after a successful intent.
  // The 3D scene reads these sets to light up compatible targets.
  const [preview, setPreview] = useState<{
    readonly catalogEntryId: string;
    readonly connectionNodes: ReadonlySet<string>;
    readonly replacementNodes: ReadonlySet<string>;
    readonly portIds: ReadonlySet<string>;
  } | undefined>(undefined);
  const hoverDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverGenerationRef = useRef(0);
  const [activeView, setActiveView] = useState("Assembly");
  const [activeInspectorTab, setActiveInspectorTab] = useState("Properties");
  const [tutorialOpen, setTutorialOpen] = useState(() => shouldShowTutorial());
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [saveDraftOpen, setSaveDraftOpen] = useState(false);
  const [saveDeploymentTarget, setSaveDeploymentTarget] = useState(targetDeploymentTarget);
  const [saveDeploymentShape, setSaveDeploymentShape] = useState("CONTAINERIZED_SERVICE");
  const [saveDraftStatus, setSaveDraftStatus] = useState<string | undefined>();
  const [draftComponents, setDraftComponents] = useState<readonly DraftComponentItem[] | undefined>(() => {
    if (initialDraftComponentCatalogEntryIds !== undefined) {
      return initialDraftComponentCatalogEntryIds.map(catalogEntryId => ({
        catalogEntryId,
        label: labelForCatalogEntry(catalogEntryId),
        status: "ADDED" as const
      }));
    }
    const persistedDraft = readDraftInventoryState(initialTenantId, initialAssemblyId);
    if (persistedDraft) {
      return persistedDraft.components;
    }
    return initialDraftComponentCount === 0 ? [] : undefined;
  });
  const [semanticZoomLevel, setSemanticZoomLevel] = useState<SemanticZoomLevel>("ASSEMBLY_DCP");
  const [requestedSemanticZoomLevel, setRequestedSemanticZoomLevel] = useState<SemanticZoomLevel>("ASSEMBLY_DCP");
  const [dynamicProjection, setDynamicProjection] = useState<DynamicDcpProjectionResponse | undefined>(initialDynamicProjection);
  const [dynamicProjectionError, setDynamicProjectionError] = useState<string | undefined>();
  const [fabricReplacementCandidates, setFabricReplacementCandidates] = useState<readonly FabricReplacementCandidate[] | undefined>();
  const [replacementCandidateError, setReplacementCandidateError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    void client.listCatalogVisuals({ tenantId })
      .then(response => {
        if (!cancelled) {
          setBaseCatalogHash(current => current === "sha256:catalog" ? response.catalogHash : current);
          setCatalog(response.entries);
          setCatalogEntryId(response.entries[0]?.catalogEntryId ?? "com.unfurl.flow:orchestrator:0.1.0");
          setReplacementEntryId(response.entries[0]?.catalogEntryId ?? "com.unfurl.flow:orchestrator:0.1.0");
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

  useEffect(() => {
    if (!client.loadDynamicDcpProjection) {
      return;
    }
    let cancelled = false;
    void client.loadDynamicDcpProjection({
      tenantId: tenantId.trim() || DEFAULT_STUDIO_TENANT_ID,
      assemblyId: assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID
    }).then(response => {
      if (!cancelled) {
        setDynamicProjection(response);
        setDynamicProjectionError(undefined);
      }
    }).catch(error => {
      if (!cancelled) {
        setDynamicProjectionError(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, tenantId, assemblyId]);

  useEffect(() => {
    let cancelled = false;
    const fallback = () => {
      const saved = readLayoutState(tenantId, assemblyId);
      if (saved && !cancelled) {
        applyLayoutState(saved);
      }
    };
    if (!client.loadLayoutState) {
      fallback();
      return;
    }
    void client.loadLayoutState({
      tenantId: tenantId.trim() || DEFAULT_STUDIO_TENANT_ID,
      assemblyId: assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID
    }).then(layout => {
      if (!cancelled) {
        applyLayoutState(toLayoutState(layout));
      }
    }).catch(fallback);
    return () => {
      cancelled = true;
    };
  }, [client, tenantId, assemblyId]);

  useEffect(() => {
    const state = {
      activeView,
      semanticZoomLevel,
      selectedSurface: selectedComponent
    };
    writeLayoutState(tenantId, assemblyId, state);
    if (!client.saveLayoutState) {
      return;
    }
    const handle = window.setTimeout(() => {
      void client.saveLayoutState?.({
        tenantId: tenantId.trim() || DEFAULT_STUDIO_TENANT_ID,
        assemblyId: assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID,
        activeView,
        semanticZoomLevel,
        selectedSurface: selectedComponent,
        camera: {},
        annotations: []
      }).catch(() => {
        // Server-side layout persistence is best-effort; local layout state remains available.
      });
    }, 250);
    return () => {
      window.clearTimeout(handle);
    };
  }, [client, tenantId, assemblyId, activeView, semanticZoomLevel, selectedComponent]);

  const readySession = state?.status === "READY" ? state.session : undefined;

  useEffect(() => {
    if (!readySession || !client.sessionEventsUrl || typeof EventSource === "undefined") {
      return;
    }
    const source = new EventSource(client.sessionEventsUrl({
      tenantId: readySession.tenantId,
      assemblyId: readySession.assemblyId,
      sessionId: readySession.sessionId
    }));
    const updateFromEvent = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as StudioSessionEvent;
      setState(current => current?.status === "READY" ? { ...current, session: payload.session } : current);
    };
    source.addEventListener("session", updateFromEvent);
    source.onerror = () => {
      source.close();
    };
    return () => {
      source.removeEventListener("session", updateFromEvent);
      source.close();
    };
  }, [client, readySession?.tenantId, readySession?.assemblyId, readySession?.sessionId]);

  useEffect(() => {
    if (!readySession || !client.heartbeatCollaborator) {
      return;
    }
    let cancelled = false;
    const heartbeat = () => {
      void client.heartbeatCollaborator?.({
        tenantId: readySession.tenantId,
        assemblyId: readySession.assemblyId,
        sessionId: readySession.sessionId,
        collaboratorId: "local-operator",
        displayName: "Local Operator",
        selectedSurface: selectedComponent
      }).then(session => {
        if (!cancelled) {
          setState(current => current?.status === "READY" ? { ...current, session } : current);
        }
      }).catch(() => {
        // Presence is advisory; revisioned Fabric intents remain authoritative.
      });
    };
    heartbeat();
    const handle = window.setInterval(heartbeat, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [client, readySession?.tenantId, readySession?.assemblyId, readySession?.sessionId, selectedComponent]);

  function applyLayoutState(layout: LayoutState) {
    setActiveView(layout.activeView);
    setRequestedSemanticZoomLevel(layout.semanticZoomLevel);
    setSemanticZoomLevel(layout.semanticZoomLevel);
    setSelectedComponent(layout.selectedSurface);
    selectScenePart({
      id: layout.selectedSurface === "substrate" ? "substrate:base" : `component:${layout.selectedSurface}`,
      kind: layout.selectedSurface === "substrate" ? "substrate" : "component",
      surface: layout.selectedSurface,
      label: inspectorDetails[layout.selectedSurface].name
    });
  }

  useEffect(() => {
    const componentNodeId = dynamicProjection ? projectionNodeIdForSelection(selectedPart, dynamicProjection) : undefined;
    if (!client.loadReplacementCandidates || !componentNodeId) {
      setFabricReplacementCandidates(undefined);
      setReplacementCandidateError(undefined);
      return;
    }
    let cancelled = false;
    void client.loadReplacementCandidates({
      tenantId: tenantId.trim() || DEFAULT_STUDIO_TENANT_ID,
      assemblyId: assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID,
      componentNodeId
    }).then(response => {
      if (!cancelled) {
        setFabricReplacementCandidates(response.candidates);
        setReplacementCandidateError(undefined);
      }
    }).catch(error => {
      if (!cancelled) {
        setFabricReplacementCandidates(undefined);
        setReplacementCandidateError(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, tenantId, assemblyId, selectedPart, dynamicProjection]);

  useEffect(() => {
    if (draftComponents === undefined) {
      return;
    }
    writeDraftInventoryState(tenantId, assemblyId, { components: draftComponents });
  }, [tenantId, assemblyId, draftComponents]);

  async function create() {
    setBusy(true);
    try {
      setState(await createDraftWorkspace(client, {
        tenantId: tenantId.trim() || DEFAULT_STUDIO_TENANT_ID,
        assemblyId: assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID,
        baseCatalogHash,
      }));
      setDraftComponents([]);
      setExtractedPartId(undefined);
      selectScenePart({ id: "substrate:base", kind: "substrate", surface: "substrate", label: "Empty assembly base plate" });
    } finally {
      setBusy(false);
    }
  }

  function openSaveDraft() {
    setSaveDeploymentTarget(targetDeploymentTarget);
    setSaveDraftOpen(true);
  }

  async function saveDraft() {
    if (client.saveDraft) {
      const readySession = state?.status === "READY" ? state.session : undefined;
      const response = await client.saveDraft({
        tenantId: tenantId.trim() || DEFAULT_STUDIO_TENANT_ID,
        assemblyId: assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID,
        targetApplicationName,
        needsId: "",
        deploymentTarget: saveDeploymentTarget,
        deploymentShape: saveDeploymentShape,
        ...(readySession?.currentCandidateId === undefined ? {} : { currentCandidateId: readySession.currentCandidateId }),
        sceneRevision: readySession?.sceneRevision ?? 0
      });
      setSaveDraftStatus(`Draft ${response.status.toLowerCase()} for ${response.assembly.defaultDeploymentTarget} using ${response.assembly.deploymentShape}.`);
    } else {
      setSaveDraftStatus(`Draft saved for ${saveDeploymentTarget} using ${saveDeploymentShape}.`);
    }
    setSaveDraftOpen(false);
  }

  async function addComponent(entryId = catalogEntryId) {
    if (!state) {
      return;
    }
    if (!knownCatalogEntryIds.has(entryId)) {
      // Component not in live catalog — UI buttons should already be disabled
      // for these ids; this guard catches programmatic / replay callers.
      setCatalogError(`Component '${entryId}' is not in the catalog`);
      return;
    }
    setBusy(true);
    try {
      setCatalogEntryId(entryId);
      setState(await applyDraftIntent(client, state, { type: "ADD_COMPONENT", catalogEntryId: entryId }));
      setDraftComponents(current => [
        ...(current ?? []),
        {
          catalogEntryId: entryId,
          label: labelForCatalogEntry(entryId),
          status: "ADDED"
        }
      ]);
      selectScenePart({ id: `component:${slugFromCatalogEntry(entryId)}`, kind: "component", surface: "validation", label: labelForCatalogEntry(entryId) });
      clearPreview();
    } finally {
      setBusy(false);
    }
  }

  // ---- Hover-preview wiring -------------------------------------------
  //
  // hoverCandidate is debounced 150 ms so quickly skimming the palette
  // doesn't fire one request per button. Each invocation bumps the
  // hover-generation counter; the eventual fetch checks the counter when
  // it resolves and discards stale responses (operator may have moved on
  // before the network round-trip finished).

  function clearPreview() {
    if (hoverDebounceRef.current !== undefined) {
      clearTimeout(hoverDebounceRef.current);
      hoverDebounceRef.current = undefined;
    }
    hoverGenerationRef.current += 1;
    setPreview(undefined);
  }

  function hoverCandidate(entryId: string) {
    if (!entryId || !knownCatalogEntryIds.has(entryId)) {
      // Skip hover lookups for unknown / blank entries — backend would
      // return a warning, and we'd just clear the existing preview.
      return;
    }
    if (!client.loadConnectionCandidates) {
      return;
    }
    if (hoverDebounceRef.current !== undefined) {
      clearTimeout(hoverDebounceRef.current);
    }
    const generation = ++hoverGenerationRef.current;
    hoverDebounceRef.current = setTimeout(() => {
      hoverDebounceRef.current = undefined;
      void (async () => {
        try {
          const response: ConnectionCandidatesResponse = await client.loadConnectionCandidates!({
            tenantId,
            assemblyId,
            catalogEntryId: entryId
          });
          if (generation !== hoverGenerationRef.current) {
            // Stale response — operator moved on before the round-trip
            // finished. Do not overwrite a fresher preview / cleared
            // state with this result.
            return;
          }
          const connectionNodes = new Set(response.connections.map(edge => edge.targetNodeId));
          const replacementNodes = new Set(response.replacements.map(edge => edge.targetNodeId));
          const portIds = new Set(response.connections.map(edge => edge.targetPortId));
          setPreview({
            catalogEntryId: entryId,
            connectionNodes,
            replacementNodes,
            portIds
          });
        } catch {
          // Silent: hover preview is non-critical UX. A failed lookup
          // leaves the existing preview in place rather than blanking
          // the scene.
        }
      })();
    }, 150);
  }

  async function connectPorts() {
    if (!state) {
      return;
    }
    setBusy(true);
    try {
      setState(await applyDraftIntent(client, state, { type: "CONNECT", fromPort, toPort }));
      selectScenePart({ id: "substrate:base", kind: "substrate", surface: "substrate", label: "Substrate base plate" });
      clearPreview();
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

  function drillTo(level: SemanticZoomLevel) {
    setRequestedSemanticZoomLevel(level);
    setSemanticZoomLevel(level);
    if (level === "PARENT_DCP") {
      setActiveView("Assembly");
    }
    if (level === "CHILD_DCP") {
      setActiveView("Exploded");
    }
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
    if (!knownCatalogEntryIds.has(replacementEntryId)) {
      setCatalogError(`Replacement '${replacementEntryId}' is not in the catalog`);
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
      clearPreview();
    } finally {
      setBusy(false);
    }
  }

  const handoff = state ? buildSigningHandoff(state, { signingRequested: sign }) : undefined;
  const selected = inspectorDetails[selectedComponent];
  const ports = useMemo(() => activePorts(catalog[0]), [catalog]);
  const paletteEntries = catalog.length === 0 ? fallbackCatalog() : catalog;
  // Defence-in-depth: only catalog-registered entries are assemblable. Buttons
  // outside this set are disabled in the UI; the backend rejects the same
  // intents with CATALOG_ENTRY_NOT_FOUND. Derived from the LIVE catalog (not
  // paletteEntries) — when the live catalog is empty we render fallback
  // entries for orientation but they cannot be added.
  const knownCatalogEntryIds = useMemo(
    () => new Set(catalog.map(entry => entry.catalogEntryId)),
    [catalog]
  );
  const draftComponentCount = draftComponents?.length ?? initialDraftComponentCount;
  const showFallbackAssembly = draftComponents === undefined && (draftComponentCount === undefined || draftComponentCount > 0);
  const showEmptyAssembly = draftComponents !== undefined && draftComponents.length === 0;
  const showDraftInventory = draftComponents !== undefined;
  const semanticSceneProjection = useMemo(
    () => dynamicProjection ? toSemanticSceneProjection(dynamicProjection) : undefined,
    [dynamicProjection]
  );
  const replacementCandidates = useMemo(
    () => fabricReplacementCandidates
      ? toReplacementCandidates(fabricReplacementCandidates)
      : buildReplacementCandidates(selectedPart.surface, paletteEntries),
    [fabricReplacementCandidates, selectedPart.surface, paletteEntries]
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
          <a href="/components/fabric-studio/help#substrate-profile">substrate profile</a>,{" "}
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
      action: () => selectScenePart({ id: "component:validation", kind: "component", surface: "validation", label: "Flow Orchestrator" })
    },
    {
      id: "takeout",
      title: "Take parts out for inspection",
      body: "Take Out is visual-only: it helps inspection without changing the CompositionContract or SubstrateProfile.",
      target: "inspector",
      action: () => {
        selectScenePart({ id: "component:validation", kind: "component", surface: "validation", label: "Flow Orchestrator" });
        setExtractedPartId("component:validation");
      }
    },
    {
      id: "replace",
      title: "Replace only when allowed",
      body: "Allowed and blocked replacements are explained here. Validate & Replace sends a Fabric intent; Studio never swaps blindly.",
      target: "replacement",
      action: () => {
        selectScenePart({ id: "component:validation", kind: "component", surface: "validation", label: "Flow Orchestrator" });
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
          <strong>unfurl-flow</strong>
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
              Target runtime
              <input value={targetApplicationName} onChange={event => setTargetApplicationName(event.target.value)} />
            </label>
            <label>
              Substrate target
              <input value={targetDeploymentTarget} onChange={event => setTargetDeploymentTarget(event.target.value)} />
            </label>
            <div className="summary-row">
              <span>runtime: {targetApplicationName}</span>
              <span>substrate: {targetDeploymentTarget}</span>
              <span>profile mode: STRICT</span>
            </div>
          </div>
          <label>
            Catalog hash
            <input value={baseCatalogHash} onChange={event => setBaseCatalogHash(event.target.value)} />
          </label>
          {catalogError && <p className="live-data-notice">Live catalog unavailable; showing generated fallback.</p>}
          <div className="palette-list grouped">
            <CatalogGroup
              title="Flow Components"
              entries={paletteEntries}
              busy={busy}
              ready={state?.status === "READY"}
              knownCatalogEntryIds={knownCatalogEntryIds}
              hoveredCatalogEntryId={preview?.catalogEntryId}
              onSelect={entryId => void addComponent(entryId)}
              onHover={hoverCandidate}
              onHoverEnd={clearPreview}
            />
            <StaticCatalogGroup title="Adapters" names={["Postgres State Store", "Kafka Event Sink", "HTTP Connector", "Foundry Agent Runtime"]} />
            <StaticCatalogGroup title="Substrate Ports" names={["Java Runtime", "Secrets Provider", "Telemetry OTEL", "Container Scheduler"]} />
            <StaticCatalogGroup title="Libraries" names={["Substrate Engine", "DCP Contracts", "Definition Registry"]} />
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
                <button type="button" onClick={() => void saveDraft()}>Save With Deployment</button>
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

            <div className={`composition-plane ${viewClassName(activeView)} ${showEmptyAssembly ? "empty-assembly-plane" : ""}`}>
              {(showFallbackAssembly || draftComponents !== undefined) && (
                <Suspense fallback={<div className="three-assembly-scene" aria-label="3D assembly scene" />}>
                <ThreeAssemblyScene
                  // No `key` prop here: ThreeAssemblyScene's effect is
                  // mount-once now and swaps the DCP sub-groups in place
                  // when semanticProjection changes. Forcing a remount on
                  // every projection change rebuilt the entire WebGL
                  // scene + textures — exactly what we were eliminating.
                  activeView={activeView}
                  selectedSurface={selectedComponent}
                  selectedPartId={selectedPart.id}
                  extractedPartId={extractedPartId}
                  semanticProjection={semanticSceneProjection}
                  requestedSemanticZoomLevel={requestedSemanticZoomLevel}
                  // draftComponents being defined means the scene is now
                  // mirroring real assembly state: slot N is visible iff
                  // index N < draftComponentCount. `undefined` (initial
                  // demo state) preserves the original all-slots view.
                  draftComponentCount={draftComponents === undefined ? undefined : draftComponents.length}
                  // Hover-preview highlight sets — undefined when the
                  // operator isn't hovering anything, so the scene
                  // relaxes to neutral.
                  previewConnectionNodes={preview?.connectionNodes}
                  previewReplacementNodes={preview?.replacementNodes}
                  previewPortIds={preview?.portIds}
                  onSelect={setSelectedComponent}
                  onSelectPart={selectScenePart}
                  onViewChange={setActiveView}
                  onSemanticZoomChange={setSemanticZoomLevel}
                />
              </Suspense>
              )}
            <div className="view-mode-badge">
              <strong>{activeView}</strong>
              <span>{showEmptyAssembly ? "empty governed draft" : viewDescription(activeView)}</span>
            </div>
            <div className="semantic-zoom-badge" aria-label="Semantic DCP zoom">
              <strong>Semantic Zoom</strong>
              <span>{semanticZoomLabel(semanticZoomLevel)}</span>
              <small>{semanticZoomDescription(semanticZoomLevel)}</small>
              <div className="semantic-drill-controls" aria-label="Semantic drill controls">
                <button type="button" onClick={() => drillTo("PARENT_DCP")}>Parent</button>
                <button type="button" onClick={() => drillTo("ASSEMBLY_DCP")}>Assembly</button>
                <button type="button" onClick={() => drillTo("CHILD_DCP")}>Child</button>
              </div>
            </div>
            {showEmptyAssembly && (
              <div className="empty-assembly-state" role="status">
                <strong>Empty Assembly</strong>
                <span>Import or add verified catalog components to begin this draft.</span>
              </div>
            )}
            {showDraftInventory && draftComponents.length > 0 && (
              <div className="draft-assembly-surface" aria-label="Draft assembly components">
                <strong>Draft Assembly</strong>
                <span>{draftComponents.length} component{draftComponents.length === 1 ? "" : "s"} added to this governed draft.</span>
                <div className="draft-component-list">
                  {draftComponents.map(component => (
                    <button
                      type="button"
                      className="draft-component-chip"
                      key={component.catalogEntryId}
                      onClick={() => selectScenePart({
                        id: `component:${slugFromCatalogEntry(component.catalogEntryId)}`,
                        kind: "component",
                        surface: "validation",
                        label: component.label
                      })}
                    >
                      <span className="module-icon purple">{component.label.slice(0, 1) || "C"}</span>
                      <strong>{component.label}</strong>
                      <small>{component.catalogEntryId}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {showFallbackAssembly && (
              <>
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

                <button type="button" className={moduleClass("component-module gateway-module", selectedComponent, "gateway")} onClick={() => selectScenePart({ id: "component:gateway", kind: "component", surface: "gateway", label: "Flow API" })}>
                  <span className="module-icon green">N</span>
                  <strong>Flow API</strong>
                  <span className="module-status">Included</span>
                </button>
                <button type="button" className={moduleClass("component-module order-module", selectedComponent, "order")} onClick={() => selectScenePart({ id: "component:order", kind: "component", surface: "order", label: "Trigger Ingress" })}>
                  <span className="module-icon leaf">S</span>
                  <strong>Trigger Ingress</strong>
                  <span className="port-dot right" />
                  <span className="port-dot bottom" />
                </button>
                <button type="button" className={moduleClass("component-module inventory-module", selectedComponent, "inventory")} onClick={() => selectScenePart({ id: "component:inventory", kind: "component", surface: "inventory", label: "Definition Registry" })}>
                  <span className="module-icon leaf">S</span>
                  <strong>Definition Registry</strong>
                  <span className="port-dot left" />
                  <span className="port-dot right" />
                </button>
                <button type="button" className={moduleClass("component-module validation-module", selectedComponent, "validation")} onClick={() => selectScenePart({ id: "component:validation", kind: "component", surface: "validation", label: "Flow Orchestrator" })}>
                  <span className="module-icon purple">V</span>
                  <strong>Flow Orchestrator</strong>
                  <span className="port-handle offer-port">{ports[0] ?? "workflow.execute"}</span>
                  <span className="port-handle dependency-port">{fromPort}</span>
                  <span className="port-dot left" />
                  <span className="port-dot right" />
                  <span className="port-dot bottom" />
                </button>
                <button type="button" className={moduleClass("component-module payment-module", selectedComponent, "payment")} onClick={() => selectScenePart({ id: "component:payment", kind: "component", surface: "payment", label: "Distributed Worker" })}>
                  <span className="module-icon leaf">P</span>
                  <strong>Distributed Worker</strong>
                  <span className="port-dot left" />
                </button>
                <button type="button" className={moduleClass("component-module audit-module", selectedComponent, "audit")} onClick={() => selectScenePart({ id: "component:audit", kind: "component", surface: "audit", label: "Audit Sink" })}>
                  <span className="module-icon blue">A</span>
                  <strong>Audit Sink</strong>
                  <span className="port-dot right" />
                </button>
                <button type="button" className={moduleClass("component-module notification-module", selectedComponent, "notification")} onClick={() => selectScenePart({ id: "component:notification", kind: "component", surface: "notification", label: "Event Sink" })}>
                  <span className="module-icon orange">F</span>
                  <strong>Event Sink</strong>
                  <span className="port-dot right" />
                </button>
                <button type="button" className={moduleClass("component-module workflow-module", selectedComponent, "workflow")} onClick={() => selectScenePart({ id: "component:workflow", kind: "component", surface: "workflow", label: "Reference Resolver" })}>
                  <span className="module-icon blue">W</span>
                  <strong>Reference Resolver</strong>
                  <span className="port-dot bottom" />
                </button>
                <button type="button" className={moduleClass("component-module adapter-module", selectedComponent, "adapter")} onClick={() => selectScenePart({ id: "component:adapter", kind: "component", surface: "adapter", label: "State Store Adapter" })}>
                  <span className="module-icon red">S</span>
                  <strong>State Store Adapter</strong>
                  <span className="port-dot bottom" />
                </button>
                <button type="button" className={moduleClass("exploded-module", selectedComponent, "validation")} onClick={() => selectScenePart({ id: "component:validation:exploded", kind: "component", surface: "validation", label: "Flow Orchestrator exploded inspection" })}>
                  <span className="module-icon purple">V</span>
                  <strong>Flow Orchestrator</strong>
                  <span>Exploded inspection</span>
                  <span className="port-rack" />
                </button>
              </>
            )}
          </div>

          {showDraftInventory ? (
            <section className="dynamic-dcp-table-panel" aria-label="Draft inventory table view">
              <div>
                <strong>Draft Inventory</strong>
                <span>Components and substrate usage added to this draft session.</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Name</th>
                    <th scope="col">Catalog / Port</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {draftComponents.length === 0 ? (
                    <>
                      <tr>
                        <td>Component</td>
                        <td>No components added</td>
                        <td>select a catalog entry and add it to the draft</td>
                        <td>empty</td>
                      </tr>
                      <tr>
                        <td>Substrate</td>
                        <td>No substrate ports used</td>
                        <td>validated connections will appear here</td>
                        <td>empty</td>
                      </tr>
                    </>
                  ) : (
                    draftComponents.map(component => (
                      <tr key={component.catalogEntryId}>
                        <td>Component</td>
                        <td>{component.label}</td>
                        <td>{component.catalogEntryId}</td>
                        <td>{component.status.toLowerCase()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </section>
          ) : dynamicProjection && (
            <section className="dynamic-dcp-table-panel" aria-label="Accessible dynamic DCP table view">
              <div>
                <strong>2D / Table View</strong>
                <span>Keyboard-accessible projection synchronized with the 3D assembly.</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Level</th>
                    <th scope="col">DCP</th>
                    <th scope="col">Capabilities</th>
                    <th scope="col">Replacement</th>
                  </tr>
                </thead>
                <tbody>
                  {dynamicProjection.nodes.map(node => (
                    <tr key={node.nodeId}>
                      <td>{node.level}</td>
                      <td>{node.label}</td>
                      <td>{node.capabilities.join(", ") || "none declared"}</td>
                      <td>{node.replacementAllowed ? "allowed by Fabric" : "parent-governed"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <div className="substrate-strip" aria-label="Substrate runtime layer">
            <div className="substrate-label">Substrate Runtime Layer</div>
            {showDraftInventory ? (
              <div className="substrate-empty-state">
                <strong>No substrate selected</strong>
                <span>Substrate ports appear after validated component connections.</span>
              </div>
            ) : (
              substrateCapabilities.map(capability => (
                <button type="button" className={selectedComponent === "substrate" ? "substrate-tile selected" : "substrate-tile"} key={capability.name} onClick={() => selectScenePart({ id: "substrate:base", kind: "substrate", surface: "substrate", label: "Substrate base plate" })}>
                  <span className={`substrate-logo ${capability.status}`}>{capability.short}</span>
                  <strong>{capability.name}</strong>
                  <span className="health-dot" />
                </button>
              ))
            )}
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
              <dt>DCP Level</dt><dd>{semanticZoomLabel(semanticZoomLevel)}</dd>
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
            <p className="live-data-notice">
              {fabricReplacementCandidates
                ? "Replacement options are sourced from Fabric's dynamic DCP projection."
                : "Replacement options are using local demo fallback data."}
            </p>
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
            <button type="button" disabled={busy || state?.status !== "READY" || selectedPart.kind !== "component" || selectedReplacement?.status !== "ALLOWED" || !knownCatalogEntryIds.has(replacementEntryId)} onClick={replaceSelectedComponent}>
              Validate & Replace
            </button>
            {state?.status === "READY" && replacementEntryId !== "" && !knownCatalogEntryIds.has(replacementEntryId) && (
              <p className="studio-error">Replacement candidate '{replacementEntryId}' is not in the live catalog and cannot be applied.</p>
            )}
            {selectedReplacement?.status === "BLOCKED" && <p className="studio-error">{selectedReplacement.reason}</p>}
            {replacementCandidateError && <p className="studio-error">{replacementCandidateError}</p>}
            {state?.status !== "READY" && <p className="live-data-notice">Create a draft before governed replacements are allowed.</p>}
            {state?.status === "READY" && state.lastResponse?.status === "INVALID" && <p className="studio-error">{state.lastResponse.reason}: {state.lastResponse.details}</p>}
          </section>
          <section className="inspector-card">
            <h2>{showDraftInventory ? "Draft Inventory" : "Dynamic DCP Projection"}</h2>
            {showDraftInventory ? (
              <>
                <dl>
                  <dt>Components</dt><dd>{draftComponents.length}</dd>
                  <dt>Substrate Ports</dt><dd>0</dd>
                  <dt>Mode</dt><dd>{draftComponents.length === 0 ? "EMPTY_DRAFT" : "DRAFT_EDIT"}</dd>
                </dl>
                <ul>
                  {draftComponents.length === 0 ? (
                    <>
                      <li>No components added</li>
                      <li>No substrate ports used</li>
                    </>
                  ) : (
                    draftComponents.map(component => (
                      <li key={component.catalogEntryId}>
                        <span>{component.label}</span>
                        <small>{component.catalogEntryId}</small>
                      </li>
                    ))
                  )}
                </ul>
              </>
            ) : dynamicProjection ? (
              <>
                <dl>
                  <dt>Mode</dt><dd>{dynamicProjection.compositionMode}</dd>
                  <dt>Root</dt><dd>{nodeLabel(dynamicProjection, dynamicProjection.rootNodeId)}</dd>
                  <dt>Focus</dt><dd>{nodeLabel(dynamicProjection, dynamicProjection.focusNodeId)}</dd>
                </dl>
                <div className="dynamic-dcp-levels">
                  {(["PARENT", "ASSEMBLY", "CHILD"] as const).map(level => (
                    <div key={level}>
                      <strong>{level}</strong>
                      <ul>
                        {dynamicProjection.nodes.filter(node => node.level === level).map(node => (
                          <li key={node.nodeId}>
                            <span>{node.label}</span>
                            <small>{node.dcpType}{node.replacementAllowed ? " / replaceable" : ""}</small>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="live-data-notice">{dynamicProjectionError ?? "Loading dynamic DCP projection..."}</p>
            )}
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
          <strong>Collaborators</strong>
          <span>{state?.status === "READY" ? collaboratorLabel(state.session.collaborators?.length ?? 0) : "waiting for draft"}</span>
        </div>
        <div>
          <strong>Components</strong>
          <span>{draftComponentCount ?? 10}</span>
        </div>
        <div>
          <strong>Connections</strong>
          <span>{showEmptyAssembly ? 0 : 28}</span>
        </div>
        <div>
          <strong>Substrate Ports Used</strong>
          <span>{showEmptyAssembly ? "0 / 12" : "5 / 12"}</span>
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
  knownCatalogEntryIds,
  hoveredCatalogEntryId,
  onSelect,
  onHover,
  onHoverEnd
}: {
  readonly title: string;
  readonly entries: readonly VisualCatalogEntry[];
  readonly ready: boolean;
  readonly busy: boolean;
  readonly knownCatalogEntryIds: ReadonlySet<string>;
  readonly hoveredCatalogEntryId?: string | undefined;
  readonly onSelect: (entryId: string) => void;
  readonly onHover?: (entryId: string) => void;
  readonly onHoverEnd?: () => void;
}) {
  return (
    <section className="catalog-group">
      <h3>{title}</h3>
      {entries.map((entry, index) => {
        const inCatalog = knownCatalogEntryIds.has(entry.catalogEntryId);
        const isHovered = hoveredCatalogEntryId === entry.catalogEntryId;
        const baseClass = index === 0 ? "catalog-row active" : "catalog-row";
        return (
          <button
            type="button"
            className={isHovered ? `${baseClass} previewing` : baseClass}
            key={entry.catalogEntryId}
            onClick={() => onSelect(entry.catalogEntryId)}
            // Hover drives the compatibility preview: the panel debounces
            // the lookup (150 ms) so quickly skimming buttons doesn't
            // fire a request per row. Mouseleave clears the preview so
            // the scene relaxes to neutral the moment focus drifts.
            onMouseEnter={onHover ? () => onHover(entry.catalogEntryId) : undefined}
            onMouseLeave={onHoverEnd}
            onFocus={onHover ? () => onHover(entry.catalogEntryId) : undefined}
            onBlur={onHoverEnd}
            disabled={!ready || busy || !inCatalog}
            title={inCatalog ? undefined : "Not in the live catalog; admit it before assembly"}
          >
            <span className="catalog-glyph purple">{entry.visualManifest?.fallbackShape.kind.slice(0, 1) ?? "C"}</span>
            {paletteLabel(entry)}
          </button>
        );
      })}
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

function labelForCatalogEntry(catalogEntryId: string): string {
  const parts = catalogEntryId.split(":").filter(Boolean);
  const raw = (parts.length >= 3 ? parts.at(-2) : parts.at(-1)) ?? catalogEntryId;
  return raw
    .replace(/\.[^.]+$/, "")
    .split(/[-_.]+/)
    .filter(Boolean)
    .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugFromCatalogEntry(catalogEntryId: string): string {
  return catalogEntryId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "component";
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

function toReplacementCandidates(candidates: readonly FabricReplacementCandidate[]): readonly ReplacementCandidate[] {
  return candidates.map(candidate => ({
    catalogEntryId: candidate.catalogEntryId,
    label: candidate.label,
    owner: candidate.owner,
    shape: candidate.shape,
    status: candidate.status === "ALLOWED" ? "ALLOWED" : "BLOCKED",
    reason: candidate.reason
  }));
}

function projectionNodeIdForSelection(
  selection: ThreeAssemblySelection,
  projection: DynamicDcpProjectionResponse
): string | undefined {
  if (selection.kind !== "component") {
    return undefined;
  }
  const mapped = projectionSurfaceNodeIds[selection.surface];
  if (mapped && projection.nodes.some(node => node.nodeId === mapped)) {
    return mapped;
  }
  const normalizedLabel = normalizeLabel(selection.label);
  return projection.nodes.find(node => node.level === "CHILD" && normalizeLabel(node.label) === normalizedLabel)?.nodeId;
}

function moduleClass(baseClass: string, selected: SelectedSurfaceId, surface: SelectedSurfaceId): string {
  return selected === surface ? `${baseClass} selected` : baseClass;
}

function fallbackCatalog(): readonly VisualCatalogEntry[] {
  return [
    {
      catalogEntryId: "com.unfurl.flow:orchestrator:0.1.0",
      claimHash: "sha256:claim-flow-orchestrator",
      artifactSha256: "sha256:artifact-flow-orchestrator",
      visualManifest: {
        fallbackShape: { kind: "CUBE", category: "WORKFLOW" },
        ports: [],
        interactions: { draggable: true, connectable: true, inspectable: true }
      },
      visualIntegrity: { visualManifestHash: "sha256:visual-flow-orchestrator", assets: [] },
      warnings: []
    }
  ];
}

const inspectorDetails: Record<SelectedSurfaceId, InspectorDetails> = {
  gateway: {
    name: "Flow API",
    icon: "N",
    iconClass: "green",
    type: "Runtime API",
    version: "1.4.0",
    owner: "platform-team",
    status: "Included",
    description: "Exposes workflow.execute and workflow.resolve for governed runtime invocation.",
    bindingMode: "SERVICE",
    deploymentShape: "CONTAINER",
    substrateTarget: "Customer Runtime Substrate",
    isolationPattern: "STRICT",
    providedPorts: ["workflow.execute", "workflow.resolve"],
    requiredPorts: ["identity-context", "event-sink"]
  },
  order: {
    name: "Trigger Ingress",
    icon: "S",
    iconClass: "leaf",
    type: "Flow Component",
    version: "2.0.0",
    owner: "flow-team",
    status: "Included",
    description: "Creates workflow executions from webhook, poll, and schedule triggers.",
    bindingMode: "SERVICE",
    deploymentShape: "CONTAINER",
    substrateTarget: "Customer Runtime Substrate",
    isolationPattern: "STRICT",
    providedPorts: ["trigger.fire", "workflow.start"],
    requiredPorts: ["state-store", "connector-call", "identity-context"]
  },
  inventory: {
    name: "Definition Registry",
    icon: "S",
    iconClass: "leaf",
    type: "Flow Component",
    version: "1.8.2",
    owner: "flow-team",
    status: "Included",
    description: "Provides workflow, prompt, tool, agent, and subgraph definitions to the resolver.",
    bindingMode: "SERVICE",
    deploymentShape: "CONTAINER",
    substrateTarget: "Customer Runtime Substrate",
    isolationPattern: "STRICT",
    providedPorts: ["definition.lookup", "definition.version"],
    requiredPorts: ["state-store", "secrets.provider"]
  },
  validation: {
    name: "Flow Orchestrator",
    icon: "V",
    iconClass: "purple",
    type: "Orchestration Component",
    version: "1.1.0",
    owner: "flow-team",
    status: "Valid",
    description: "Owns deterministic DAG scheduling, readiness, retries, async wait/resume, and run envelopes.",
    bindingMode: "SERVICE",
    deploymentShape: "CONTAINER",
    substrateTarget: "Customer Runtime Substrate",
    isolationPattern: "STRICT",
    providedPorts: ["node.dispatch", "workflow.state.transition", "workflow.status"],
    requiredPorts: ["state-store", "event-sink", "capability-registry"]
  },
  payment: {
    name: "Distributed Worker",
    icon: "P",
    iconClass: "leaf",
    type: "Flow Component",
    version: "1.6.0",
    owner: "flow-team",
    status: "Included",
    description: "Claims leased nodes from the durable floor and invokes the bound component adapters.",
    bindingMode: "SERVICE",
    deploymentShape: "CONTAINER",
    substrateTarget: "Customer Runtime Substrate",
    isolationPattern: "STRICT",
    providedPorts: ["node.execute", "node.complete"],
    requiredPorts: ["state-store", "event-sink", "connector-call"]
  },
  audit: {
    name: "Audit Sink",
    icon: "A",
    iconClass: "blue",
    type: "Compliance Service",
    version: "1.2.3",
    owner: "risk-team",
    status: "Included",
    description: "Receives append-only workflow and node events for compliance review.",
    bindingMode: "EVENT",
    deploymentShape: "CONTAINER",
    substrateTarget: "Customer Runtime Substrate",
    isolationPattern: "STRICT",
    providedPorts: ["audit-sink.write", "audit-sink.query"],
    requiredPorts: ["event-sink"]
  },
  notification: {
    name: "Event Sink",
    icon: "F",
    iconClass: "orange",
    type: "Substrate Adapter",
    version: "1.0.5",
    owner: "platform-team",
    status: "Included",
    description: "Persists ordered workflow events through the selected substrate adapter.",
    bindingMode: "EVENT",
    deploymentShape: "CONTAINER",
    substrateTarget: "Customer Runtime Substrate",
    isolationPattern: "STRICT",
    providedPorts: ["event-sink.append", "event-sink.replay"],
    requiredPorts: ["kafka.producer", "telemetry.otel"]
  },
  workflow: {
    name: "Reference Resolver",
    icon: "W",
    iconClass: "blue",
    type: "Orchestration Service",
    version: "2.3.0",
    owner: "platform-team",
    status: "Included",
    description: "Resolves agentRef, toolRef, promptRef, and subgraphRef nodes into provenance-preserving workflow YAML.",
    bindingMode: "SERVICE",
    deploymentShape: "CONTAINER",
    substrateTarget: "Customer Runtime Substrate",
    isolationPattern: "STRICT",
    providedPorts: ["workflow.resolve", "reference.provenance"],
    requiredPorts: ["definition-registry", "foundry-agent-runtime", "tool-registry"]
  },
  adapter: {
    name: "State Store Adapter",
    icon: "S",
    iconClass: "red",
    type: "Adapter",
    version: "1.3.1",
    owner: "platform-team",
    status: "Warning",
    description: "Binds Flow's durable state store to a closed-world substrate port.",
    bindingMode: "SERVICE",
    deploymentShape: "SIDECAR",
    substrateTarget: "Customer Runtime Substrate",
    isolationPattern: "STRICT",
    providedPorts: ["state-store.claim", "state-store.checkpoint"],
    requiredPorts: ["postgres.jdbc", "secrets.provider"]
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
    substrateTarget: "Customer Runtime Substrate",
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

function semanticZoomLabel(level: SemanticZoomLevel): string {
  return {
    PARENT_DCP: "Parent DCP",
    ASSEMBLY_DCP: "Assembly DCP",
    CHILD_DCP: "Child DCP"
  }[level];
}

function semanticZoomDescription(level: SemanticZoomLevel): string {
  return {
    PARENT_DCP: "zoomed out to tenant/application composition context",
    ASSEMBLY_DCP: "current validated assembly graph",
    CHILD_DCP: "zoomed in to descendant components and internal responsibilities"
  }[level];
}

type LayoutState = {
  readonly activeView: string;
  readonly semanticZoomLevel: SemanticZoomLevel;
  readonly selectedSurface: SelectedSurfaceId;
};

type DraftInventoryState = {
  readonly components: readonly DraftComponentItem[];
};

function readDraftInventoryState(tenantId: string, assemblyId: string): DraftInventoryState | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(draftInventoryStateKey(tenantId, assemblyId));
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<DraftInventoryState>;
    if (!Array.isArray(parsed.components)) {
      return undefined;
    }
    const components = parsed.components.flatMap(component => {
      if (!isDraftComponentItem(component)) {
        return [];
      }
      return [component];
    });
    return { components };
  } catch {
    return undefined;
  }
}

function writeDraftInventoryState(tenantId: string, assemblyId: string, state: DraftInventoryState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(draftInventoryStateKey(tenantId, assemblyId), JSON.stringify(state));
  } catch {
    // Draft inventory persistence is a browser convenience; Fabric remains the source of truth.
  }
}

function draftInventoryStateKey(tenantId: string, assemblyId: string): string {
  return `unfurl-studio-draft-inventory:${tenantId.trim() || DEFAULT_STUDIO_TENANT_ID}:${assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID}`;
}

function isDraftComponentItem(value: unknown): value is DraftComponentItem {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DraftComponentItem>;
  return typeof candidate.catalogEntryId === "string"
    && typeof candidate.label === "string"
    && (candidate.status === "ADDED" || candidate.status === "VALIDATED");
}

function readLayoutState(tenantId: string, assemblyId: string): LayoutState | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(layoutStateKey(tenantId, assemblyId));
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    if (!parsed.activeView || !parsed.semanticZoomLevel || !parsed.selectedSurface) {
      return undefined;
    }
    return {
      activeView: parsed.activeView,
      semanticZoomLevel: parsed.semanticZoomLevel,
      selectedSurface: parsed.selectedSurface
    };
  } catch {
    return undefined;
  }
}

function writeLayoutState(tenantId: string, assemblyId: string, state: LayoutState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(layoutStateKey(tenantId, assemblyId), JSON.stringify(state));
  } catch {
    // Layout state is a convenience only; semantic composition state still comes from Fabric.
  }
}

function layoutStateKey(tenantId: string, assemblyId: string): string {
  return `unfurl-studio-layout:${tenantId.trim() || DEFAULT_STUDIO_TENANT_ID}:${assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID}`;
}

function toLayoutState(layout: StudioLayoutState): LayoutState {
  return {
    activeView: validView(layout.activeView),
    semanticZoomLevel: validSemanticZoomLevel(layout.semanticZoomLevel),
    selectedSurface: validSurface(layout.selectedSurface)
  };
}

function validView(value: string): string {
  return ["Assembly", "Exploded", "Ports", "Substrate", "Validation"].includes(value) ? value : "Assembly";
}

function validSemanticZoomLevel(value: string): SemanticZoomLevel {
  return value === "PARENT_DCP" || value === "CHILD_DCP" || value === "ASSEMBLY_DCP"
    ? value
    : "ASSEMBLY_DCP";
}

function validSurface(value: string): SelectedSurfaceId {
  return Object.prototype.hasOwnProperty.call(inspectorDetails, value)
    ? value as SelectedSurfaceId
    : "validation";
}

function nodeLabel(projection: DynamicDcpProjectionResponse, nodeId: string): string {
  return projection.nodes.find(node => node.nodeId === nodeId)?.label ?? nodeId;
}

function toSemanticSceneProjection(projection: DynamicDcpProjectionResponse): SemanticDcpSceneProjection {
  const root = projection.nodes.find(node => node.nodeId === projection.rootNodeId)
    ?? projection.nodes.find(node => node.level === "PARENT");
  const focus = projection.nodes.find(node => node.nodeId === projection.focusNodeId)
    ?? projection.nodes.find(node => node.level === "ASSEMBLY");
  return {
    parentLabel: root?.label ?? "Parent DCP",
    assemblyLabel: focus?.label ?? "Assembly DCP",
    childNodes: projection.nodes
      .filter(node => node.level === "CHILD")
      .map(node => ({
        nodeId: node.nodeId,
        label: node.label,
        dcpType: node.dcpType,
        replacementAllowed: node.replacementAllowed
      }))
  };
}

function semanticSceneProjectionKey(projection: SemanticDcpSceneProjection | undefined): string {
  if (!projection) {
    return "semantic:fallback";
  }
  return [
    projection.parentLabel,
    projection.assemblyLabel,
    projection.childNodes.map(node => `${node.nodeId}:${node.label}:${node.replacementAllowed}`).join("|")
  ].join("::");
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function collaboratorLabel(count: number): string {
  if (count <= 0) {
    return "solo";
  }
  return count === 1 ? "1 active" : `${count} active`;
}

const projectionSurfaceNodeIds: Partial<Record<ThreeAssemblySurfaceId, string>> = {
  validation: "component.flow-orchestrator",
  adapter: "component.state-store"
};

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
    { catalogEntryId: "com.unfurl.flow:flow-api:0.1.0", label: "Flow API", owner: "flow-team", shape: "CONTAINER", status: "ALLOWED", reason: "offers workflow.execute and workflow.resolve" },
    { catalogEntryId: "com.unfurl.flow:read-only-api:0.1.0", label: "Read-only Flow API", owner: "flow-team", shape: "SIDECAR", status: "BLOCKED", reason: "missing workflow.execute capability" }
  ],
  order: [
    { catalogEntryId: "com.unfurl.flow:trigger-ingress:0.1.0", label: "Trigger Ingress", owner: "flow-team", shape: "CONTAINER", status: "ALLOWED", reason: "supports webhook, poll, and schedule trigger fires" },
    { catalogEntryId: "com.unfurl.flow:schedule-only-trigger:0.1.0", label: "Schedule-only Trigger", owner: "flow-team", shape: "REMOTE", status: "BLOCKED", reason: "missing webhook and poll trigger ingress" }
  ],
  inventory: [
    { catalogEntryId: "com.unfurl.flow:definition-registry:0.1.0", label: "Definition Registry", owner: "flow-team", shape: "CONTAINER", status: "ALLOWED", reason: "resolves workflow, prompt, tool, agent, and subgraph definitions" },
    { catalogEntryId: "com.unfurl.flow:workflow-only-registry:0.1.0", label: "Workflow-only Registry", owner: "flow-team", shape: "ADAPTER", status: "BLOCKED", reason: "missing prompt/tool/agent definition lookup" }
  ],
  validation: [
    { catalogEntryId: "com.unfurl.flow:orchestrator:0.1.0", label: "Flow Orchestrator", owner: "flow-team", shape: "CONTAINER", status: "ALLOWED", reason: "current selected component" },
    { catalogEntryId: "com.unfurl.flow:distributed-orchestrator:0.1.0", label: "Distributed Orchestrator", owner: "flow-team", shape: "CONTAINER", status: "ALLOWED", reason: "offers node dispatch and durable workflow state transitions" },
    { catalogEntryId: "com.unfurl.flow:trigger-ingress:0.1.0", label: "Trigger Ingress", owner: "flow-team", shape: "SERVICE", status: "BLOCKED", reason: "does not own deterministic scheduling" }
  ],
  payment: [
    { catalogEntryId: "com.unfurl.flow:distributed-worker:0.1.0", label: "Distributed Worker", owner: "flow-team", shape: "CONTAINER", status: "ALLOWED", reason: "claims and completes leased nodes" },
    { catalogEntryId: "com.unfurl.flow:batch-runner:0.1.0", label: "Batch Runner", owner: "flow-team", shape: "JOB", status: "BLOCKED", reason: "does not support durable node leasing" }
  ],
  audit: [
    { catalogEntryId: "com.unfurl:audit-service:1.3.0", label: "Audit Service 1.3", owner: "risk-team", shape: "CONTAINER", status: "ALLOWED", reason: "offers audit.write and audit.query" },
    { catalogEntryId: "com.unfurl:log-sink:1.0.0", label: "Log Sink", owner: "observability-team", shape: "SIDECAR", status: "BLOCKED", reason: "logs events but does not provide signed audit.write" }
  ],
  notification: [
    { catalogEntryId: "com.unfurl.flow.adapter:kafka-event-sink:0.1.0", label: "Kafka Event Sink", owner: "platform-team", shape: "SIDECAR", status: "ALLOWED", reason: "offers ordered event append and replay" },
    { catalogEntryId: "com.unfurl.flow.adapter:stdout-event-sink:0.1.0", label: "Stdout Event Sink", owner: "platform-team", shape: "SERVICE", status: "BLOCKED", reason: "not durable enough for STRICT profile mode" }
  ],
  workflow: [
    { catalogEntryId: "com.unfurl.flow:reference-resolver:0.1.0", label: "Reference Resolver", owner: "flow-team", shape: "CONTAINER", status: "ALLOWED", reason: "resolves refs with provenance" },
    { catalogEntryId: "com.unfurl.flow:plain-yaml-loader:0.1.0", label: "Plain YAML Loader", owner: "flow-team", shape: "JOB", status: "BLOCKED", reason: "does not resolve agentRef, toolRef, or promptRef" }
  ],
  adapter: [
    { catalogEntryId: "com.unfurl.flow.adapter:postgres-state-store:0.1.0", label: "Postgres State Store", owner: "platform-team", shape: "SIDECAR", status: "ALLOWED", reason: "offers atomic claim and durable checkpoint guarantees" },
    { catalogEntryId: "com.unfurl.flow.adapter:file-state-store:0.1.0", label: "File State Store", owner: "platform-team", shape: "SIDECAR", status: "ALLOWED", reason: "compatible for local single-node profiles" },
    { catalogEntryId: "com.unfurl.flow.adapter:in-memory-state-store:0.1.0", label: "In-memory State Store", owner: "platform-team", shape: "ADAPTER", status: "BLOCKED", reason: "not durable for STRICT profile mode" }
  ]
};
