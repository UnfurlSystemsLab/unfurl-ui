import { reconcileSession, watchSession } from "./sessionReconciliation.js";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_STUDIO_ASSEMBLY_ID,
  DEFAULT_STUDIO_TENANT_ID,
  type DynamicDcpProjectionResponse,
  type DeploymentPolicyDraft,
  type DeploymentShape,
  type StudioAssemblySnapshot,
  type StudioReplacementCandidate as FabricReplacementCandidate,
  type StudioLayoutState,
  type StudioFabricClient,
  type ConnectionCandidatesResponse,
  type AuthoringProposal,
  type AuthoringProposedIntent,
  type StudioFileRecord
} from "@unfurl/fabric-validation-client";
import type { VisualCatalogEntry } from "@unfurl/visual-manifest";
import {
  applyDraftIntent,
  compileDraftWorkspace,
  createDraftWorkspace,
  type DraftWorkspaceState
} from "./draftWorkspace.js";
import {
  DEPLOYMENT_SHAPE_OPTIONS,
  createDefaultDeploymentPlannerState,
  deploymentPolicyFromPlannerState,
  preferDeploymentShape,
  setDeploymentRuntime,
  type DeploymentPlannerState
} from "./deploymentPlanner.js";
import { buildSigningHandoff } from "./signingHandoff.js";
import { createIntentHistory } from "./intentHistory.js";
import { DiagnosticArtifactsPanel } from "./DiagnosticArtifactsPanel.js";
import { AuthoringConversationPanel, type AuthoringPromptSeed } from "./AuthoringConversationPanel.js";
import { SemanticZoomNavigator } from "./SemanticZoomNavigator.js";
import type { SceneDropTarget, SemanticDcpSceneProjection, SemanticZoomLevel, ThreeAssemblySelection, ThreeAssemblySurfaceId } from "./ThreeAssemblyScene.js";

const ThreeAssemblyScene = lazy(async () => {
  const module = await import("./ThreeAssemblyScene.js");
  return { default: module.ThreeAssemblyScene };
});

/**
 * Props contract for the governed draft workspace panel. The client is narrowed to Fabric Studio
 * operations that validate, persist, project, and compile drafts so the UI cannot bypass Fabric's
 * source-of-truth APIs.
 */
export type DraftWorkspacePanelProps = {
  readonly client: Pick<
    StudioFabricClient,
    "saveDraft" |
    "saveAssemblySnapshot" |
    "loadAssemblySnapshot" |
    "loadLayoutState" |
    "saveLayoutState" |
    "loadDynamicDcpProjection" |
    "loadReplacementCandidates" |
    "loadConnectionCandidates" |
    "listCatalogVisuals" | "listStudioFiles" | "listSessionHistory" | "createDraftComposition" | "applyIntent" | "getDraftSession" | "compileCandidate" | "resolveDeployment" | "converseAuthoring"
    | "heartbeatCollaborator" | "sessionEventsUrl"
  >;
  readonly initialTenantId?: string | undefined;
  readonly initialAssemblyId?: string | undefined;
  readonly initialBaseCatalogHash?: string | undefined;
  readonly initialDraftComponentCount?: number | undefined;
  readonly initialDraftComponentCatalogEntryIds?: readonly string[] | undefined;
  readonly initialDynamicProjection?: DynamicDcpProjectionResponse | undefined;
  /**
   * When {@code true}, the panel falls back to generated demo content
   * (a sample catalog, a hardcoded sample assembly, and local demo
   * replacement options) whenever the backend returns nothing. Default
   * {@code false} — a governed workbench should show real Fabric data or
   * an honest empty/error state, never fictional ungoverned content.
   * Enable for offline UI development, demos, or screenshot generation
   * (wired from {@code VITE_STUDIO_DEMO_FALLBACKS} in the host shell).
   */
  readonly demoFallbacks?: boolean | undefined;
};

type SelectedSurfaceId = ThreeAssemblySurfaceId;

/**
 * View-model record: inspector details shown for the selected scene surface. Projection-backed
 * details are preferred; static values are only used when demo fallbacks are explicitly enabled.
 */
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

/**
 * View-model record: local replacement candidate state after Fabric candidates and catalog-derived
 * options are normalized into the same UI table shape.
 */
type ReplacementCandidate = {
  readonly catalogEntryId: string;
  readonly label: string;
  readonly owner: string;
  readonly shape: string;
  readonly status: "ALLOWED" | "BLOCKED";
  readonly reason: string;
};

/**
 * View-model record: one guided tutorial step. Actions are optional because most steps only explain
 * an existing workbench region while a few can drive the view to a safer starting point.
 */
type TutorialStep = {
  readonly id: string;
  readonly title: string;
  readonly body: ReactNode;
  readonly target: "catalog" | "stage" | "views" | "inspector" | "replacement" | "substrate" | "compile";
  readonly action?: () => void;
};

/**
 * Persistence record: minimal draft inventory stored in browser localStorage so route remounts can
 * preserve visual draft chips while Fabric remains the authoritative composition state.
 */
type DraftComponentItem = {
  readonly catalogEntryId: string;
  readonly label: string;
  readonly status: "ADDED" | "VALIDATED";
};

const tutorialStorageKey = "unfurl-studio-workbench-tutorial-dismissed";

/**
 * Facade component: coordinates Fabric-backed draft creation, dynamic DCP projection, semantic zoom,
 * deployment planning, and visual selection state. It stores only layout/convenience UI state locally;
 * contract truth and validation stay behind the Fabric client.
 */
function ScopedDraftWorkspacePanel({
  client,
  initialTenantId = DEFAULT_STUDIO_TENANT_ID,
  initialAssemblyId = DEFAULT_STUDIO_ASSEMBLY_ID,
  initialBaseCatalogHash = "sha256:catalog",
  initialDraftComponentCount,
  initialDraftComponentCatalogEntryIds,
  initialDynamicProjection,
  demoFallbacks = false,
  onScopeChange
}: DraftWorkspacePanelProps & { readonly onScopeChange: (tenant: string, assembly: string) => void }) {
  const tenantId = initialTenantId;
  const [tenantDraft, setTenantDraft] = useState(tenantId);
  const assemblyId = initialAssemblyId;
  const [assemblyDraft, setAssemblyDraft] = useState(assemblyId);
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
  const [catalogFiles, setCatalogFiles] = useState<readonly StudioFileRecord[]>([]);
  const [selectedCatalogFileId, setSelectedCatalogFileId] = useState("");
  const [catalogError, setCatalogError] = useState<string | undefined>();
  const [selectedComponent, setSelectedComponent] = useState<SelectedSurfaceId>("validation");
  const [selectedPart, setSelectedPart] = useState<ThreeAssemblySelection>({
    id: "component:validation",
    kind: "component",
    surface: "validation",
    label: "Flow Orchestrator"
  });
  const [extractedPartId, setExtractedPartId] = useState<string | undefined>();
  const [replacementEntryId, setReplacementEntryId] = useState("com.unfurl.flow:orchestrator:0.1.0");
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
  const authoringPromptSeedCounter = useRef(0);
  const [activeView, setActiveView] = useState("Assembly");
  const [activeInspectorTab, setActiveInspectorTab] = useState("Properties");
  const [tutorialOpen, setTutorialOpen] = useState(() => shouldShowTutorial());
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [saveDraftOpen, setSaveDraftOpen] = useState(false);
  const [saveDeploymentTarget, setSaveDeploymentTarget] = useState(targetDeploymentTarget);
  const [saveDeploymentShape, setSaveDeploymentShape] = useState("CONTAINERIZED_SERVICE");
  const [saveDraftStatus, setSaveDraftStatus] = useState<string | undefined>();
  const [deploymentPlanner, setDeploymentPlanner] = useState<DeploymentPlannerState>(() => createDefaultDeploymentPlannerState());
  const [authoringPromptSeed, setAuthoringPromptSeed] = useState<AuthoringPromptSeed | undefined>();
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
  const [sessionSyncError, setSessionSyncError] = useState<string | undefined>();
  const readySession = state?.status === "READY" ? state.session : undefined;

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      const scopedTenantId = tenantId.trim() || DEFAULT_STUDIO_TENANT_ID;
      let catalogFileId = selectedCatalogFileId;
      if (client.listStudioFiles) {
        const files = await client.listStudioFiles({ tenantId: scopedTenantId, fileType: "CATALOG" });
        if (!cancelled) {
          setCatalogFiles(files);
        }
        if (catalogFileId === "" || !files.some(file => file.fileId === catalogFileId)) {
          catalogFileId = files[0]?.fileId ?? "";
          if (!cancelled) {
            setSelectedCatalogFileId(catalogFileId);
          }
        }
      }
      const response = await client.listCatalogVisuals({
        tenantId: scopedTenantId,
        ...(catalogFileId === "" ? {} : { catalogFileId })
      });
      if (!cancelled) {
        setBaseCatalogHash(response.catalogHash);
        setCatalog(response.entries);
        setCatalogEntryId(response.entries[0]?.catalogEntryId ?? "com.unfurl.flow:orchestrator:0.1.0");
        setReplacementEntryId(response.entries[0]?.catalogEntryId ?? "com.unfurl.flow:orchestrator:0.1.0");
        setCatalogError(undefined);
      }
    }
    void loadCatalog()
      .catch(error => {
        if (!cancelled) {
          setCatalogError(error instanceof Error ? error.message : String(error));
        }
      })
    return () => {
      cancelled = true;
    };
  }, [client, tenantId, selectedCatalogFileId]);

  useEffect(() => {
    if (!client.loadDynamicDcpProjection) {
      return;
    }
    let cancelled = false;
    const projectionRequest = {
      tenantId: tenantId.trim() || DEFAULT_STUDIO_TENANT_ID,
      assemblyId: assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID,
      ...(readySession ? { sessionId: readySession.sessionId } : {})
    };
    void client.loadDynamicDcpProjection(projectionRequest).then(response => {
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
  }, [client, tenantId, assemblyId, readySession?.sessionId, readySession?.sceneRevision]);

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

  // Snapshot reconciliation uses the authenticated client and retries after transient failures.
  useEffect(() => {
    if (!readySession) return;
    return watchSession(() => client.getDraftSession({ tenantId: readySession.tenantId,
      assemblyId: readySession.assemblyId, sessionId: readySession.sessionId }),
      session => setState(current => current?.status === "READY"
        ? { ...current, session: reconcileSession(current.session, session) } : current),
      connected => setSessionSyncError(connected ? undefined : "Session updates disconnected. Retrying authoritative snapshot reads."));
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
          setState(current => current?.status === "READY" ? { ...current, session: reconcileSession(current.session, session) } : current);
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

  /**
   * State adapter: applies server/browser layout state into React view, zoom, and selection state.
   * The selection is rebuilt from layout values so the inspector and scene stay synchronized.
   */
  function applyLayoutState(layout: LayoutState) {
    setActiveView(layout.activeView);
    setRequestedSemanticZoomLevel(layout.semanticZoomLevel);
    setSemanticZoomLevel(layout.semanticZoomLevel);
    setSelectedComponent(layout.selectedSurface);
    selectScenePart({
      id: layout.selectedSurface === "substrate" ? "substrate:base" : `component:${layout.selectedSurface}`,
      kind: layout.selectedSurface === "substrate" ? "substrate" : "component",
      surface: layout.selectedSurface,
      label: inspectorDetails[layout.selectedSurface]?.name ?? layout.selectedSurface
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

  /**
   * Command handler: creates a new Fabric-backed draft workspace and resets local draft-only UI
   * affordances to an empty assembly base plate.
   */
  async function create() {
    setBusy(true);
    setCatalogError(undefined);
    try {
      setState(await createDraftWorkspace(client, {
        tenantId: tenantId.trim() || DEFAULT_STUDIO_TENANT_ID,
        assemblyId: assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID,
        baseCatalogHash,
        ...(selectedCatalogFileId === "" ? {} : { catalogFileId: selectedCatalogFileId }),
        displayName: draftDisplayName(assemblyId, selectedCatalogFile(catalogFiles, selectedCatalogFileId))
      }));
      setDraftComponents([]);
      setExtractedPartId(undefined);
      selectScenePart({ id: "substrate:base", kind: "substrate", surface: "substrate", label: "Empty assembly base plate" });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Dialog handler: seeds the save-draft dialog from the current deployment planner so the operator
   * edits the same policy that will be sent to Fabric.
   */
  function openSaveDraft() {
    setSaveDeploymentTarget(targetDeploymentTarget);
    setSaveDeploymentShape(deploymentPolicy.preferredShapes[0] ?? saveDeploymentShape);
    setSaveDraftOpen(true);
  }

  /**
   * Command handler: persists the current draft through Fabric when available, otherwise records an
   * honest local status for demos where the save endpoint is absent.
   */
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

  /**
   * Command handler: downloads a Fabric-authored assembly workspace snapshot so
   * operators can move or archive Studio state without serializing scene truth in
   * the browser.
   */
  async function saveAssemblySnapshot() {
    if (!client.saveAssemblySnapshot) {
      setSaveDraftStatus("Assembly snapshot save is not available from this client.");
      return;
    }
    const snapshot = await client.saveAssemblySnapshot({
      tenantId: tenantId.trim() || DEFAULT_STUDIO_TENANT_ID,
      assemblyId: assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID
    });
    downloadJson(`assembly-${safeFilePart(snapshot.tenantId)}-${safeFilePart(snapshot.assemblyId)}.json`, snapshot);
    setSaveDraftStatus(`Assembly snapshot saved for ${snapshot.assemblyId}.`);
  }

  /**
   * Command handler: loads a portable assembly snapshot through Fabric, then
   * applies the returned layout and active draft session to the workspace view.
   */
  async function loadAssemblySnapshot(files: FileList | null) {
    if (!client.loadAssemblySnapshot) {
      setSaveDraftStatus("Assembly snapshot load is not available from this client.");
      return;
    }
    const file = files?.[0];
    if (!file) {
      return;
    }
    const input = JSON.parse(await file.text()) as StudioAssemblySnapshot;
    const snapshot = await client.loadAssemblySnapshot({
      tenantId: tenantId.trim() || DEFAULT_STUDIO_TENANT_ID,
      assemblyId: assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID,
      snapshot: input
    });
    applyLayoutState(toLayoutState(snapshot.layout));
    if (snapshot.sessions[0]) {
      setState({
        status: "READY",
        session: snapshot.sessions[0],
        history: createIntentHistory(snapshot.sessions[0].sceneRevision)
      });
      setDraftComponents(draftComponentsFromSession(snapshot.sessions[0]));
    }
    setSaveDraftStatus(`Assembly snapshot loaded for ${snapshot.assemblyId}.`);
  }

  /**
   * Action-assist command: seeds the server-side authoring panel with one
   * visual-edit action context. Foundry may ask clarifying questions or propose
   * normal Studio intents; the UI does not mutate draft state from this helper.
   */
  function requestAuthoringAssist(seed: Omit<AuthoringPromptSeed, "id">) {
    authoringPromptSeedCounter.current += 1;
    setAuthoringPromptSeed({
      ...seed,
      id: authoringPromptSeedCounter.current
    });
  }

  /**
   * Action-assist command: asks the authoring agent what configuration is
   * needed before a catalog component is added to the current draft.
   */
  function askAuthoringForAdd(entryId = catalogEntryId) {
    const entry = catalog.find(item => item.catalogEntryId === entryId);
    const label = labelForCatalogEntry(entryId);
    requestAuthoringAssist({
      autoSend: true,
      text: `Help me add and configure ${label} (${entryId}) in this governed draft. Ask the required configuration, binding, substrate, and external-connection questions before proposing Studio intents.`,
      actionContext: {
        operation: "ADD_COMPONENT",
        catalogEntryId: entryId,
        componentLabel: label,
        offeredCapabilities: entryCapabilities(entry, "OFFER"),
        dependencyPorts: entryCapabilities(entry, "DEPENDENCY"),
        substratePorts: entryCapabilities(entry, "SUBSTRATE_DEPENDENCY"),
        ...(readySession ? { draftSessionId: readySession.sessionId } : {})
      }
    });
  }

  /**
   * Action-assist command: asks the authoring agent to analyze removal impact
   * before the operator submits a governed REMOVE_COMPONENT intent.
   */
  function askAuthoringForRemoval(component: DraftComponentItem) {
    const componentId = projectionNodeIdForCatalogEntry(dynamicProjection, component.catalogEntryId)
      ?? selectedComponentIdForDraftItem(component, selectedPart);
    requestAuthoringAssist({
      autoSend: true,
      text: `Help me remove ${component.label} (${component.catalogEntryId}) from this draft. Ask about dependent connections, replacement-before-removal, state cleanup, and substrate binding impact before proposing Studio intents.`,
      actionContext: {
        operation: "REMOVE_COMPONENT",
        componentId,
        catalogEntryId: component.catalogEntryId,
        componentLabel: component.label,
        substratePorts: liveSubstratePorts.map(port => port.capability || port.portId),
        ...(readySession ? { draftSessionId: readySession.sessionId } : {})
      }
    });
  }

  /**
   * Action-assist command: asks the authoring agent to validate replacement
   * configuration before the selected replacement candidate is applied.
   */
  function askAuthoringForReplacement() {
    if (selectedPart.kind !== "component" || replacementEntryId === "") {
      return;
    }
    const replacementEntry = catalog.find(entry => entry.catalogEntryId === replacementEntryId);
    requestAuthoringAssist({
      autoSend: true,
      text: `Help me replace ${selectedPart.label} with ${labelForCatalogEntry(replacementEntryId)} (${replacementEntryId}). Ask which bindings should be preserved and what configuration changes are needed before proposing Studio intents.`,
      actionContext: {
        operation: "REPLACE_COMPONENT",
        selectedComponentId: selectedPart.surface,
        selectedComponentLabel: selectedPart.label,
        ...(selectedDraftComponent ? { catalogEntryId: selectedDraftComponent.catalogEntryId } : {}),
        replacementCatalogEntryId: replacementEntryId,
        componentLabel: labelForCatalogEntry(replacementEntryId),
        offeredCapabilities: entryCapabilities(replacementEntry, "OFFER"),
        dependencyPorts: entryCapabilities(replacementEntry, "DEPENDENCY"),
        substratePorts: entryCapabilities(replacementEntry, "SUBSTRATE_DEPENDENCY"),
        ...(readySession ? { draftSessionId: readySession.sessionId } : {})
      }
    });
  }

  /**
   * Action-assist command: asks the authoring agent to gather endpoint,
   * credential, and policy details before a port connection is validated.
   */
  function askAuthoringForConnection() {
    requestAuthoringAssist({
      autoSend: true,
      text: `Help me configure and validate the connection from ${fromPort} to ${toPort}. Ask for endpoint, credential reference, protocol, and policy details before proposing Studio intents.`,
      actionContext: {
        operation: "CONNECT",
        fromPort,
        toPort,
        ...(readySession ? { draftSessionId: readySession.sessionId } : {})
      }
    });
  }

  /**
   * Action-assist command: asks the authoring agent for substrate/runtime
   * configuration choices without changing the profile directly in the UI.
   */
  function askAuthoringForSubstrateConfiguration() {
    requestAuthoringAssist({
      autoSend: true,
      text: "Help me configure the substrate/runtime layer for this draft. Ask which runtime target, secret/config references, telemetry, audit, and provider bindings should be used before proposing Studio intents or deployment policy.",
      actionContext: {
        operation: "CONFIGURE_SUBSTRATE",
        componentId: "substrate:base",
        componentLabel: "Substrate Runtime Layer",
        substratePorts: liveSubstratePorts.map(port => port.capability || port.portId),
        ...(readySession ? { draftSessionId: readySession.sessionId } : {})
      }
    });
  }

  /**
   * Command handler: submits an ADD_COMPONENT intent through Fabric validation and mirrors the
   * accepted draft component into local inventory for selection continuity.
   */
  async function addComponent(entryId = catalogEntryId) {
    if (state?.status !== "READY") {
      return;
    }
    if (!knownCatalogEntryIds.has(entryId)) {
      // Component not in live catalog — UI buttons should already be disabled
      // for these ids; this guard catches programmatic / replay callers.
      setCatalogError(`Component '${entryId}' is not in the catalog`);
      return;
    }
    setBusy(true);
    setCatalogError(undefined);
    try {
      setCatalogEntryId(entryId);
      const next = await applyDraftIntent(client, state, { type: "ADD_COMPONENT", catalogEntryId: entryId });
      setState(next);
      if (intentAccepted(next)) {
        setDraftComponents(current => [
          ...(current ?? []),
          {
            catalogEntryId: entryId,
            label: labelForCatalogEntry(entryId),
            status: "ADDED"
          }
        ]);
        selectScenePart(draftComponentSelection(entryId, labelForCatalogEntry(entryId), dynamicProjection));
        clearPreview();
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Command handler: adds a catalog component and immediately connects its first offer port to a
   * validated target port, surfacing partial success if the component has no offer to connect.
   */
  async function addComponentAndConnect(entryId: string, targetPortId: string) {
    if (state?.status !== "READY") {
      return;
    }
    setBusy(true);
    setCatalogError(undefined);
    try {
      const added = await applyDraftIntent(client, state, { type: "ADD_COMPONENT", catalogEntryId: entryId });
      if (added.status !== "READY") {
        setState(added);
        return;
      }
      setState(added);
      if (!intentAccepted(added)) {
        return;
      }
      setDraftComponents(current => appendDraftComponentItem(current ?? [], entryId));
      selectScenePart(draftComponentSelection(entryId, labelForCatalogEntry(entryId), dynamicProjection));
      const sourcePortId = firstOfferPortId(entryId, catalog);
      if (!sourcePortId) {
        setState(added);
        setCatalogEntryId(entryId);
        setCatalogError(`Added ${labelForCatalogEntry(entryId)}, but no offer port was available to connect.`);
        clearPreview();
        return;
      }
      const connected = await applyDraftIntent(client, added, { type: "CONNECT", fromPort: sourcePortId, toPort: targetPortId });
      setState(connected);
      setCatalogEntryId(entryId);
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

  /**
   * Hover-preview lifecycle helper: cancels pending compatibility lookups, invalidates stale
   * generations, and clears the scene highlight state.
   */
  function clearPreview() {
    if (hoverDebounceRef.current !== undefined) {
      clearTimeout(hoverDebounceRef.current);
      hoverDebounceRef.current = undefined;
    }
    hoverGenerationRef.current += 1;
    setPreview(undefined);
  }

  /**
   * Hover-preview command: debounces Fabric connection-candidate lookups and applies only the latest
   * generation so slow network responses cannot overwrite newer operator intent.
   */
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

  /**
   * Command handler: submits a CONNECT intent through Fabric and returns focus to the substrate base
   * so the scene reflects that the connection has been validated.
   */
  async function connectPorts() {
    if (state?.status !== "READY") {
      return;
    }
    setBusy(true);
    try {
      const next = await applyDraftIntent(client, state, { type: "CONNECT", fromPort, toPort });
      setState(next);
      if (intentAccepted(next)) {
        selectScenePart({ id: "substrate:base", kind: "substrate", surface: "substrate", label: "Substrate base plate" });
        clearPreview();
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Command handler: compiles the ready draft through Fabric using the current signing and deployment
   * planner state; UI state is updated only with Fabric's response.
   */
  async function compile() {
    if (state?.status !== "READY") {
      return;
    }
    setBusy(true);
    try {
      setState(await compileDraftWorkspace(client, state, { sign, deploymentPolicy }));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Adapter helper: folds an accepted authoring proposal's deployment policy into the local planner
   * without applying any unvalidated composition intent.
   */
  function applyAuthoringDeploymentPolicy(proposal: { readonly deploymentPolicy?: DeploymentPolicyDraft }) {
    const policy = proposal.deploymentPolicy;
    if (!policy) {
      return;
    }
    setDeploymentPlanner(current => ({
      ...current,
      preferredShapes: policy.preferredShapes,
      disallowedShapes: policy.disallowedShapes,
      requireIsolationForCapabilityPatterns: policy.requireIsolationForCapabilityPatterns,
      runtime: policy.runtime
    }));
    const preferred = policy.preferredShapes[0];
    if (preferred) {
      setSaveDeploymentShape(preferred);
    }
  }

  /**
   * Planner command: marks a deployment shape as preferred in both the planner and save-draft dialog
   * so later compile/save commands share the same operator choice.
   */
  function preferAssemblyDeploymentShape(shape: DeploymentShape) {
    setDeploymentPlanner(current => preferDeploymentShape(current, shape));
    setSaveDeploymentShape(shape);
  }

  /**
   * Selection command: synchronizes the selected scene surface and full selection object used by the
   * inspector, replacement panel, and semantic scene.
   */
  function selectScenePart(selection: ThreeAssemblySelection) {
    setSelectedComponent(selection.surface);
    setSelectedPart(selection);
  }

  /**
   * Navigation command: updates semantic DCP zoom and chooses a supporting visual view that makes the
   * selected projection depth visible.
   */
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

  /**
   * View command: toggles exploded/take-out focus for the currently selected scene part.
   */
  function toggleTakeOut() {
    setExtractedPartId(current => current === selectedPart.id ? undefined : selectedPart.id);
  }

  /**
   * Command handler: validates a DISCONNECT intent for the selected pipe and clears extracted focus
   * once Fabric accepts the change.
   */
  async function disconnectSelectedPipe() {
    if (state?.status !== "READY" || selectedPart.kind !== "pipe") {
      return;
    }
    setBusy(true);
    try {
      const next = await applyDraftIntent(client, state, { type: "DISCONNECT", pipeId: selectedPart.id });
      setState(next);
      if (intentAccepted(next)) {
        setExtractedPartId(undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Command handler: removes a draft component through Fabric's governed intent API, then mirrors
   * the accepted removal into the local draft-inventory cache used for display continuity.
   */
  async function removeDraftComponent(component: DraftComponentItem) {
    if (state?.status !== "READY") {
      return;
    }
    const componentId = projectionNodeIdForCatalogEntry(dynamicProjection, component.catalogEntryId)
      ?? selectedComponentIdForDraftItem(component, selectedPart);
    setBusy(true);
    try {
      const next = await applyDraftIntent(client, state, {
        type: "REMOVE_COMPONENT",
        componentId,
        catalogEntryId: component.catalogEntryId
      });
      setState(next);
      if (intentAccepted(next)) {
        setDraftComponents(current => removeDraftComponentItem(current ?? [], component.catalogEntryId));
        if (selectedPart.kind === "component" && selectedPartMatchesDraftItem(selectedPart, component, dynamicProjection)) {
          selectScenePart({ id: "substrate:base", kind: "substrate", surface: "substrate", label: "Substrate base plate" });
        }
        setExtractedPartId(undefined);
        clearPreview();
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Adapter command: mirrors Fabric-accepted AI proposal intents into the local draft inventory so
   * the visual assembly uses the same validated intent subset that the authoring flow applied.
   */
  function applyAuthoringDraftInventory(proposal: AuthoringProposal, appliedIntentCount: number) {
    setDraftComponents(current =>
      replayDraftInventoryIntents(current ?? [], proposal.intents.slice(0, appliedIntentCount))
    );
  }

  /**
   * Command handler: replaces the selected component through Fabric only when the selected candidate
   * is allowed and present in the live catalog.
   */
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
      const oldComponent = selectedDraftComponent;
      const next = await applyDraftIntent(client, state, {
        type: "REPLACE_COMPONENT",
        oldComponentId: selectedPart.surface,
        ...(oldComponent === undefined ? {} : { oldCatalogEntryId: oldComponent.catalogEntryId }),
        newCatalogEntryId: replacementEntryId
      });
      setState(next);
      if (intentAccepted(next)) {
        setDraftComponents(current => replaceDraftComponentItem(current ?? [], oldComponent, replacementEntryId));
        setCatalogEntryId(replacementEntryId);
        selectScenePart(draftComponentSelection(replacementEntryId, labelForCatalogEntry(replacementEntryId), dynamicProjection));
        setExtractedPartId(undefined);
        clearPreview();
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Command handler: replaces a component identified by a projection node, used by drag/drop targets
   * after hover compatibility has identified a valid replacement.
   */
  async function replaceComponentAtNode(entryId: string, nodeId: string) {
    if (state?.status !== "READY") {
      return;
    }
    setBusy(true);
    try {
      const oldComponent = draftComponentForNodeId(nodeId, dynamicProjection, draftComponents);
      const next = await applyDraftIntent(client, state, {
        type: "REPLACE_COMPONENT",
        oldComponentId: nodeId,
        ...(oldComponent === undefined ? {} : { oldCatalogEntryId: oldComponent.catalogEntryId }),
        newCatalogEntryId: entryId
      });
      setState(next);
      if (intentAccepted(next)) {
        setDraftComponents(current => replaceDraftComponentItem(current ?? [], oldComponent, entryId));
        setReplacementEntryId(entryId);
        setCatalogEntryId(entryId);
        selectScenePart(draftComponentSelection(entryId, labelForCatalogEntry(entryId), dynamicProjection));
        setExtractedPartId(undefined);
        clearPreview();
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Drag/drop dispatcher: routes catalog drops to add, connect, or replace commands based on the
   * scene target and the latest Fabric compatibility preview.
   */
  function handleCatalogEntryDrop(entryId: string, target: SceneDropTarget) {
    if (busy) {
      return;
    }
    setCatalogError(undefined);
    if (target.kind === "empty") {
      void addComponent(entryId);
      return;
    }
    if (target.kind === "component") {
      const replacementNodes = preview?.catalogEntryId === entryId ? preview.replacementNodes : new Set<string>();
      if (replacementNodes.has(target.nodeId)) {
        void replaceComponentAtNode(entryId, target.nodeId);
      } else {
        setCatalogError(`${labelForCatalogEntry(entryId)} is not a valid replacement for ${nodeLabel(dynamicProjection, target.nodeId)}.`);
      }
      return;
    }
    const portIds = preview?.catalogEntryId === entryId ? preview.portIds : new Set<string>();
    if (portIds.has(target.portId)) {
      void addComponentAndConnect(entryId, target.portId);
    } else {
      setCatalogError(`${labelForCatalogEntry(entryId)} cannot connect to ${target.portId}.`);
    }
  }

  const handoff = state ? buildSigningHandoff(state, { signingRequested: sign }) : undefined;
  const displayDynamicProjection = useMemo(
    () => filterProjectionForDraftDisplay(dynamicProjection, draftComponents),
    [dynamicProjection, draftComponents]
  );
  const selected = inspectorDetailsFor(selectedComponent, displayDynamicProjection, demoFallbacks);
  // A draft component the operator selected that the projection has no
  // governed node for yet (surface carries the `draft:` sentinel). We show
  // its real label with a "pending" note rather than "No component selected".
  const pendingDraftComponentLabel = !selected
    && selectedPart.kind === "component"
    && selectedPart.surface.startsWith("draft:")
    ? selectedPart.label
    : undefined;
  const selectedDraftComponent = draftComponents?.find(component =>
    selectedPartMatchesDraftItem(selectedPart, component, dynamicProjection)
  );
  const hasInspectableSelection = selected !== undefined || pendingDraftComponentLabel !== undefined;
  useEffect(() => {
    if (activeView === "Exploded" && !hasInspectableSelection) {
      setActiveView("Assembly");
    }
  }, [activeView, hasInspectableSelection]);
  const ports = useMemo(() => activePorts(catalog[0]), [catalog]);
  const paletteEntries = catalog.length === 0 && demoFallbacks ? fallbackCatalog() : catalog;
  const deploymentPolicy = useMemo(
    () => deploymentPolicyFromPlannerState(deploymentPlanner),
    [deploymentPlanner]
  );
  const preferredDeploymentShape = deploymentPolicy.preferredShapes[0] ?? "CONTAINERIZED_SERVICE";
  // Defence-in-depth: only catalog-registered entries are assemblable. Buttons
  // outside this set are disabled in the UI; the backend rejects the same
  // intents with CATALOG_ENTRY_NOT_FOUND. Derived from the LIVE catalog (not
  // paletteEntries) — when the live catalog is empty we render fallback
  // entries for orientation but they cannot be added.
  const knownCatalogEntryIds = useMemo(
    () => new Set(paletteEntries.map(entry => entry.catalogEntryId)),
    [paletteEntries]
  );
  // Allow-set the 3D scene filters its modules through. When the
  // operator's draft has zero components, this is an empty set and the
  // scene shows only the substrate plate — so the empty-assembly
  // overlay reads correctly instead of overlapping a 3D rendering of
  // the entire catalog. `undefined` when draftComponents hasn't loaded
  // yet (e.g. fixture mode without a draft session) so the scene
  // skips the filter and shows everything in the projection.
  const draftCatalogEntryIdSet = useMemo(
    () => draftComponents === undefined
      ? undefined
      : new Set(draftComponents.map(component => component.catalogEntryId)),
    [draftComponents]
  );
  const draftComponentCount = draftComponents?.length ?? initialDraftComponentCount;
  const liveConnectionCount = displayDynamicProjection?.connections?.length ?? 0;
  const liveSubstratePorts = displayDynamicProjection?.substratePorts ?? [];
  const visibleSubstrateCapabilities = liveSubstratePorts.length > 0
    ? liveSubstratePorts.map(port => ({
      name: port.label,
      short: shortSubstrateLabel(port.label),
      status: port.status === "AVAILABLE" ? "healthy" : "muted"
    }))
    : substrateCapabilities;
  const showFallbackAssembly = demoFallbacks
    && dynamicProjection === undefined
    && draftComponents === undefined
    && (draftComponentCount === undefined || draftComponentCount > 0);
  // With demo fallbacks off and no draft yet and no live projection, the
  // scene has nothing real to render. Surface an honest prompt instead of
  // a blank plane or fictional sample modules.
  const showNoAssemblyData = !demoFallbacks
    && dynamicProjection === undefined
    && draftComponents === undefined;
  const showEmptyAssembly = draftComponents !== undefined && draftComponents.length === 0;
  const showDraftInventory = draftComponents !== undefined;
  const semanticSceneProjection = useMemo(
    () => displayDynamicProjection ? toSemanticSceneProjection(displayDynamicProjection) : undefined,
    [displayDynamicProjection]
  );
  const replacementCandidates = useMemo(
    () => fabricReplacementCandidates
      ? toReplacementCandidates(fabricReplacementCandidates)
      : demoFallbacks
        ? buildReplacementCandidates(selectedPart.surface, paletteEntries)
        : [],
    [fabricReplacementCandidates, selectedPart.surface, paletteEntries, demoFallbacks]
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

  /**
   * Tutorial command: restarts the guided tour at the first step for the current render.
   */
  function openTutorial() {
    setTutorialStepIndex(0);
    setTutorialOpen(true);
  }

  /**
   * Tutorial command: closes the guided tour and optionally persists dismissal as local-only UI
   * preference, leaving Fabric draft state untouched.
   */
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

  /**
   * Tutorial navigation helper: advances the guided tour without exceeding the available steps.
   */
  function nextTutorialStep() {
    setTutorialStepIndex(current => Math.min(current + 1, tutorialSteps.length - 1));
  }

  /**
   * Tutorial navigation helper: moves the guided tour backward without underflowing the first step.
   */
  function previousTutorialStep() {
    setTutorialStepIndex(current => Math.max(current - 1, 0));
  }

  return (
    <div className={`studio-workbench-page ${tutorialOpen ? `tutorial-active tutorial-target-${activeTutorialStep?.target}` : ""}`} aria-label="Unfurl Studio Workbench">
      <header className="workbench-topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">U</span>
          <span className="brand-name">Unfurl Studio</span>
        </div>
        <div className="workbench-context" aria-label="Workspace context">
          <span>Composition</span>
          <strong>{targetApplicationName}</strong>
        </div>
        <div className="topbar-spacer" />
        <span className="sync-pill"><span className="sync-dot" aria-hidden="true" />Fabric synced</span>
        <span className="assembly-chip">{assemblyId}</span>
        <span className="user-avatar" aria-hidden="true">DR</span>
      </header>

      <div className="workbench-subbar">
        <div className="workbench-breadcrumbs">
          <span>studio</span>
          <span className="sep">/</span>
          <span>composition</span>
          <span className="sep">/</span>
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
          <button type="button" className="secondary" disabled={busy} onClick={create}>{busy ? "Working..." : "New Draft"}</button>
          <button
            type="button"
            className="primary-cta"
            disabled={busy || state?.status !== "READY"}
            title={state?.status === "READY" ? "Compile and validate the current draft." : "Start a New Draft before compiling."}
            onClick={compile}
          >
            Compile & Validate
          </button>
          {state?.status !== "READY" && <span className="action-hint">Start a draft to compile.</span>}
        </div>
      </div>
      {(Boolean(dynamicProjection?.diagnosticArtifacts?.length)
        || (state?.status === "READY" && Boolean(state.lastCompile))) && (
        <section className="studio-panel">
          <h2>Diagnostics</h2>
          <DiagnosticArtifactsPanel
            artifacts={[
              ...(dynamicProjection?.diagnosticArtifacts ?? []),
              ...(state?.status === "READY" ? state.lastCompile?.diagnosticArtifacts ?? [] : [])
            ]}
            localArtifact={state?.status === "READY"
              ? {
                  label: "download draft session",
                  fileName: "draft-session.json",
                  value: state.session
                }
              : undefined}
          />
        </section>
      )}

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
            <input value={tenantDraft} onChange={event => setTenantDraft(event.target.value)} />
          </label>
          <label>
            Assembly
            <input value={assemblyDraft} onChange={event => setAssemblyDraft(event.target.value)} />
          </label>
          <button type="button" disabled={!tenantDraft.trim() || !assemblyDraft.trim()} onClick={() => onScopeChange(tenantDraft.trim(), assemblyDraft.trim())}>Apply workspace scope</button>
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
          {catalogFiles.length > 0 && (
            <label>
              Catalog version
              <select
                value={selectedCatalogFileId}
                disabled={busy}
                onChange={event => setSelectedCatalogFileId(event.target.value)}
              >
                {catalogFiles.map(file => (
                  <option value={file.fileId} key={file.fileId}>
                    {catalogFileOptionLabel(file)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Catalog hash
            <input value={baseCatalogHash} onChange={event => setBaseCatalogHash(event.target.value)} />
          </label>
          {catalogError && (
            <p className="live-data-notice">
              {demoFallbacks
                ? "Live catalog unavailable; showing generated fallback."
                : "Live catalog unavailable."}
            </p>
          )}
          {state?.status === "READY" && state.lastError && (
            <p className="studio-error">{friendlyStudioError(state.lastError)}</p>
          )}
          {!catalogError && paletteEntries.length === 0 && (
            <p className="live-data-notice">No catalog entries available for this tenant.</p>
          )}
          <div className="palette-list grouped">
            <CatalogGroup
              title="Flow Components"
              entries={paletteEntries}
              busy={busy}
              ready={state?.status === "READY"}
              canAssist={Boolean(client.converseAuthoring)}
              knownCatalogEntryIds={knownCatalogEntryIds}
              hoveredCatalogEntryId={preview?.catalogEntryId}
              onSelect={entryId => void addComponent(entryId)}
              onAssist={entryId => askAuthoringForAdd(entryId)}
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
          {sessionSyncError && <p role="status">{sessionSyncError}</p>}
          <AuthoringConversationPanel
            key={JSON.stringify([tenantId, assemblyId, readySession?.sessionId, selectedCatalogFileId])}
            client={client}
            tenantId={tenantId.trim() || DEFAULT_STUDIO_TENANT_ID}
            assemblyId={assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID}
            catalogFileId={selectedCatalogFileId}
            displayName={draftDisplayName(assemblyId, selectedCatalogFile(catalogFiles, selectedCatalogFileId))}
            promptSeed={authoringPromptSeed}
            state={state}
            onStateChange={setState}
            onDeploymentPolicy={applyAuthoringDeploymentPolicy}
            onProposalApplied={applyAuthoringDraftInventory}
          />
          <section className="save-draft-panel" aria-label="Assembly deployment planner">
            <div>
              <strong>Assembly Deployment Plan</strong>
              <span>Compile and save with this policy for the current draft assembly.</span>
            </div>
            <div className="summary-row">
              <span>preferred: {deploymentPolicy.preferredShapes.join(", ") || "none"}</span>
              <span>disallowed: {deploymentPolicy.disallowedShapes.join(", ") || "none"}</span>
              <span>runtime: {deploymentRuntimeSummary(deploymentPolicy.runtime)}</span>
            </div>
            <div className="button-row">
              {DEPLOYMENT_SHAPE_OPTIONS.map(option => (
                <button
                  type="button"
                  className={preferredDeploymentShape === option.shape ? "secondary-active" : "secondary"}
                  key={option.shape}
                  onClick={() => preferAssemblyDeploymentShape(option.shape)}
                  title={option.description}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="button-row">
              <label className="studio-checkbox">
                <input
                  type="checkbox"
                  checked={deploymentPlanner.runtime.springBoot === true}
                  onChange={event => setDeploymentPlanner(current => setDeploymentRuntime(current, {
                    ...current.runtime,
                    springBoot: event.target.checked
                  }))}
                />
                Spring Boot
              </label>
              <label className="studio-checkbox">
                <input
                  type="checkbox"
                  checked={deploymentPlanner.runtime.kubernetes === true}
                  onChange={event => setDeploymentPlanner(current => setDeploymentRuntime(current, {
                    ...current.runtime,
                    kubernetes: event.target.checked
                  }))}
                />
                Kubernetes
              </label>
              <label className="studio-checkbox">
                <input
                  type="checkbox"
                  checked={deploymentPlanner.runtime.serviceMesh === true}
                  onChange={event => setDeploymentPlanner(current => setDeploymentRuntime(current, {
                    ...current.runtime,
                    serviceMesh: event.target.checked
                  }))}
                />
                Service mesh
              </label>
            </div>
          </section>
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
          <div className="button-row">
            <button type="button" className="secondary" disabled={!client.saveAssemblySnapshot} onClick={() => void saveAssemblySnapshot()}>
              Save Assembly
            </button>
            <label className="file-action-button">
              Load Assembly
              <input
                type="file"
                accept="application/json,.json"
                disabled={!client.loadAssemblySnapshot}
                onChange={event => void loadAssemblySnapshot(event.currentTarget.files)}
              />
            </label>
          </div>
          <div className="stage-toolbar" aria-label="Workbench tools">
            {["Select", "Move", "Rotate", "Pan", "Zoom", "Isolate", "Hide", "Show All", "Connections", "Measure", "Reset View"].map(tool => (
              <button type="button" className={tool === "Select" ? "tool-button active" : "tool-button"} key={tool}>
                <span>{toolGlyph(tool)}</span>
                {tool}
              </button>
            ))}
          </div>

          <SemanticZoomNavigator
            projection={displayDynamicProjection}
            onSelectNode={nodeId => selectScenePart({
              id: `component:${nodeId}`,
              kind: "component",
              surface: nodeId,
              label: nodeLabel(displayDynamicProjection, nodeId)
            })}
          />

            <div className={`composition-plane ${viewClassName(activeView)} ${showEmptyAssembly || showNoAssemblyData ? "empty-assembly-plane" : ""}`}>
              {(showFallbackAssembly || draftComponents !== undefined || displayDynamicProjection !== undefined) && (
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
                  dynamicProjection={displayDynamicProjection}
                  // Visual guard: draft-session projections should already
                  // contain only accepted draft components, while catalog
                  // preview projections still need a local allow-list.
                  // `undefined` leaves preview mode unfiltered; an empty set
                  // shows only the substrate plate for an empty draft.
                  draftCatalogEntryIds={draftCatalogEntryIdSet}
                  // Hover-preview highlight sets — undefined when the
                  // operator isn't hovering anything, so the scene
                  // relaxes to neutral.
                  previewConnectionNodes={preview?.connectionNodes}
                  previewReplacementNodes={preview?.replacementNodes}
                  previewPortIds={preview?.portIds}
                  onCatalogEntryDropped={handleCatalogEntryDrop}
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
            {showNoAssemblyData && (
              <div className="empty-assembly-state" role="status">
                <strong>No Assembly Data</strong>
                <span>Start a New Draft, or connect to a backend with a live DCP projection for this assembly.</span>
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
                      onClick={() => selectScenePart(draftComponentSelection(component.catalogEntryId, component.label, dynamicProjection))}
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
                    <th scope="col">Action</th>
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
                        <td>none</td>
                      </tr>
                      <tr>
                        <td>Substrate</td>
                        <td>No substrate ports used</td>
                        <td>validated connections will appear here</td>
                        <td>empty</td>
                        <td>none</td>
                      </tr>
                    </>
                  ) : (
                    draftComponents.map(component => (
                      <tr key={component.catalogEntryId}>
                        <td>Component</td>
                        <td>{component.label}</td>
                        <td>{component.catalogEntryId}</td>
                        <td>{component.status.toLowerCase()}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary"
                            disabled={!client.converseAuthoring}
                            onClick={() => askAuthoringForRemoval(component)}
                          >
                            Ask Agent
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy || state?.status !== "READY"}
                            onClick={() => void removeDraftComponent(component)}
                          >
                            Remove Component
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </section>
          ) : displayDynamicProjection && (
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
                  {displayDynamicProjection.nodes.map(node => (
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
            {showDraftInventory && liveSubstratePorts.length === 0 ? (
              <div className="substrate-empty-state">
                <strong>No substrate selected</strong>
                <span>Substrate ports appear after validated component connections.</span>
              </div>
            ) : (
              visibleSubstrateCapabilities.map(capability => (
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
            {selected ? (
              <>
                <span className={`module-icon ${selected.iconClass}`}>{selected.icon}</span>
                <div>
                  <strong>{selected.name}</strong>
                  <span className="valid-pill">{selected.status}</span>
                </div>
              </>
            ) : pendingDraftComponentLabel ? (
              <div>
                <strong>{pendingDraftComponentLabel}</strong>
                <span>Live DCP details appear once the projection includes this component.</span>
              </div>
            ) : (
              <div>
                <strong>No component selected</strong>
                <span>Select a component in the assembly to inspect it.</span>
              </div>
            )}
          </div>
          <div className="inspector-tabs">
            {["Properties", "Bindings", "Diagnostics", "Audit"].map(tab => (
              <button type="button" className={activeInspectorTab === tab ? "inspector-tab active" : "inspector-tab"} key={tab} onClick={() => setActiveInspectorTab(tab)}>
                {tab}
              </button>
            ))}
          </div>
          {hasInspectableSelection ? (
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
          ) : (
            <section className="inspector-card inspector-empty-card">
              <h2>Selection</h2>
              <p>Select a component, pipe, or substrate capability in the assembly to inspect governed details and available actions.</p>
            </section>
          )}
          {hasInspectableSelection && selectedPart.kind === "substrate" ? (
            <section className="inspector-card">
              <h2>Substrate</h2>
              <p className="live-data-notice">
                The substrate base plate is derived from the deployment profile, not from
                the catalog. It cannot be replaced from this panel — adjust the substrate
                profile to change which runtime hosts the assembly.
              </p>
              <button type="button" className="secondary" disabled={!client.converseAuthoring} onClick={askAuthoringForSubstrateConfiguration}>
                Ask Agent For Configuration
              </button>
            </section>
          ) : hasInspectableSelection && selectedPart.kind === "pipe" ? (
            <section className="inspector-card">
              <h2>Pipe</h2>
              <p className="live-data-notice">
                Pipes are derived from declared needs ↔ offers between draft components.
                Use Disconnect on the selected scene part to remove this wiring, or
                remove the consuming component to drop the pipe.
              </p>
              <button type="button" className="secondary" disabled={!client.converseAuthoring} onClick={askAuthoringForConnection}>
                Ask Agent
              </button>
            </section>
          ) : hasInspectableSelection ? (
            <section className="inspector-card">
              <h2>Replace Component</h2>
              <p className="live-data-notice">
                {fabricReplacementCandidates
                  ? "Replacement options are sourced from Fabric's dynamic DCP projection."
                  : demoFallbacks
                    ? "Replacement options are using local demo fallback data."
                    : "No replacement options available from Fabric for the selected component."}
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
              <div className="scene-action-row">
                <button type="button" className="secondary" disabled={!client.converseAuthoring || selectedPart.kind !== "component" || replacementEntryId === ""} onClick={askAuthoringForReplacement}>
                  Ask Agent
                </button>
                <button type="button" disabled={busy || state?.status !== "READY" || selectedPart.kind !== "component" || selectedReplacement?.status !== "ALLOWED" || !knownCatalogEntryIds.has(replacementEntryId)} onClick={replaceSelectedComponent}>
                  Validate & Replace
                </button>
              </div>
              {state?.status === "READY" && replacementEntryId !== "" && !knownCatalogEntryIds.has(replacementEntryId) && (
                <p className="studio-error">Replacement candidate '{replacementEntryId}' is not in the live catalog and cannot be applied.</p>
              )}
              {selectedReplacement?.status === "BLOCKED" && <p className="studio-error">{selectedReplacement.reason}</p>}
              {replacementCandidateError && <p className="studio-error">{replacementCandidateError}</p>}
              {state?.status !== "READY" && <p className="live-data-notice">Create a draft before governed replacements are allowed.</p>}
              {state?.status === "READY" && state.lastResponse?.status === "INVALID" && <p className="studio-error">{state.lastResponse.reason}: {state.lastResponse.details}</p>}
            </section>
          ) : null}
          <section className="inspector-card">
            <h2>{showDraftInventory ? "Draft Inventory" : "Dynamic DCP Projection"}</h2>
            {showDraftInventory ? (
              <>
                <dl>
                  <dt>Components</dt><dd>{draftComponents.length}</dd>
                  <dt>Substrate Ports</dt><dd>{liveSubstratePorts.length}</dd>
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
            ) : displayDynamicProjection ? (
              <>
                <dl>
                  <dt>Mode</dt><dd>{displayDynamicProjection.compositionMode}</dd>
                  <dt>Root</dt><dd>{nodeLabel(displayDynamicProjection, displayDynamicProjection.rootNodeId)}</dd>
                  <dt>Focus</dt><dd>{nodeLabel(displayDynamicProjection, displayDynamicProjection.focusNodeId)}</dd>
                  <dt>Substrate Ports</dt><dd>{liveSubstratePorts.length}</dd>
                  <dt>Connections</dt><dd>{liveConnectionCount}</dd>
                </dl>
                {liveSubstratePorts.length > 0 && (
                  <div>
                    <strong>SUBSTRATE</strong>
                    <ul>
                      {liveSubstratePorts.map(port => (
                        <li key={port.portId}>
                          <span>{port.label}</span>
                          <small>{port.provider} / {port.status}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="dynamic-dcp-levels">
                  {(["PARENT", "ASSEMBLY", "CHILD"] as const).map(level => (
                    <div key={level}>
                      <strong>{level}</strong>
                      <ul>
                        {displayDynamicProjection.nodes.filter(node => node.level === level).map(node => (
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
              <p className="live-data-notice">{dynamicProjectionError ? friendlyStudioError(dynamicProjectionError) : "Loading dynamic DCP projection..."}</p>
            )}
          </section>
          {displayDynamicProjection && displayDynamicProjection.nodes.length > 0 && (
            <section className="inspector-card">
              <div className="card-head-row">
                <h2>Component Hierarchy</h2>
                <small className="mono-muted">{displayDynamicProjection.nodes.length}</small>
              </div>
              <div className="hierarchy-tree">
                {displayDynamicProjection.nodes.map(node => {
                  // Indent by the projection's real recursive depth when present
                  // (arbitrary-depth composition); fall back to the legacy
                  // PARENT/ASSEMBLY/CHILD ranking for flat 3-level projections.
                  const legacyRank = node.level === "PARENT" ? 0 : node.level === "ASSEMBLY" ? 1 : 2;
                  const rank = Math.min(node.depth ?? legacyRank, 8);
                  return (
                    <button
                      type="button"
                      className="hierarchy-node"
                      key={node.nodeId}
                      style={{ paddingLeft: `${8 + rank * 14}px` }}
                      onClick={() => selectScenePart({ id: `component:${node.nodeId}`, kind: "component", surface: node.nodeId, label: node.label })}
                    >
                      <span className="hierarchy-dot" aria-hidden="true" />
                      <span className="hierarchy-label">{node.label}</span>
                      <span className="hierarchy-sub">{node.level}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          <section className="inspector-card">
            <h2>Component Details</h2>
            {selected ? (
              <>
                <dl>
                  <dt>Type</dt><dd>{selected.type}</dd>
                  <dt>Version</dt><dd>{selected.version}</dd>
                  <dt>Owner</dt><dd>{selected.owner}</dd>
                  <dt>Status</dt><dd><span className="included-dot" /> {selected.status}</dd>
                </dl>
                <p>{selected.description}</p>
                {selectedDraftComponent && (
                  <div className="scene-action-row">
                    <button type="button" className="secondary" disabled={!client.converseAuthoring} onClick={() => askAuthoringForRemoval(selectedDraftComponent)}>
                      Ask Agent
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || state?.status !== "READY"}
                      onClick={() => void removeDraftComponent(selectedDraftComponent)}
                    >
                      Remove Component
                    </button>
                  </div>
                )}
              </>
            ) : pendingDraftComponentLabel ? (
              <>
                <p className="live-data-notice">{pendingDraftComponentLabel} is in this draft; governed details appear once the projection includes it.</p>
                {selectedDraftComponent && (
                  <div className="scene-action-row">
                    <button type="button" className="secondary" disabled={!client.converseAuthoring} onClick={() => askAuthoringForRemoval(selectedDraftComponent)}>
                      Ask Agent
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || state?.status !== "READY"}
                      onClick={() => void removeDraftComponent(selectedDraftComponent)}
                    >
                      Remove Component
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="live-data-notice">Select a component in the assembly to inspect its governed details.</p>
            )}
          </section>
          {selected && (
            <section className="inspector-card">
              <h2>Deployment</h2>
              <dl>
                <dt>Binding Mode</dt><dd>{selected.bindingMode}</dd>
                <dt>Deployment Shape</dt><dd><span className="shape-pill">{selected.deploymentShape}</span></dd>
                <dt>Substrate Target</dt><dd>{selected.substrateTarget}</dd>
                <dt>Isolation Pattern</dt><dd><span className="strict-pill">{selected.isolationPattern}</span></dd>
              </dl>
            </section>
          )}
          <div className="inspector-stack">
            <label>
              Catalog entry intent
              <input value={catalogEntryId} onChange={event => setCatalogEntryId(event.target.value)} />
            </label>
            <button type="button" disabled={busy || state?.status !== "READY"} onClick={() => void addComponent()}>
              Add Component
            </button>
            <button type="button" className="secondary" disabled={!client.converseAuthoring || catalogEntryId === ""} onClick={() => askAuthoringForAdd()}>
              Ask Agent
            </button>
            <label>
              From port
              <input value={fromPort} onChange={event => setFromPort(event.target.value)} />
            </label>
            <label>
              To port
              <input value={toPort} onChange={event => setToPort(event.target.value)} />
            </label>
            <button type="button" disabled={busy || state?.status !== "READY"} onClick={connectPorts}>Validate Connection</button>
            <button type="button" className="secondary" disabled={!client.converseAuthoring || fromPort === "" || toPort === ""} onClick={askAuthoringForConnection}>
              Ask Agent
            </button>
            <label className="studio-checkbox">
              <input type="checkbox" checked={sign} onChange={event => setSign(event.target.checked)} />
              Request signed compile
            </label>
          </div>
          {selected && (
            <section className="inspector-card">
              <h2>Provided Ports ({selected.providedPorts.length})</h2>
              <PortList kind="provided" names={selected.providedPorts} />
            </section>
          )}
          {selected && (
            <section className="inspector-card">
              <h2>Required Ports ({selected.requiredPorts.length})</h2>
              <PortList kind="required" names={selected.requiredPorts} />
            </section>
          )}
          <section className="inspector-card">
            <h2>Validation Status</h2>
            <ul className="validation-list">
              <li>Deployment shape compatible</li>
              <li>All required ports satisfied</li>
              <li>Substrate target reachable</li>
              <li>Isolation policy satisfied</li>
            </ul>
            {state?.status === "READY" && state.lastError && <p className="studio-error">{friendlyStudioError(state.lastError)}</p>}
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
          <span>{showEmptyAssembly ? 0 : liveConnectionCount}</span>
        </div>
        <div>
          <strong>Substrate Ports Used</strong>
          <span>{showEmptyAssembly ? "0 / 12" : `${liveSubstratePorts.length} / 12`}</span>
        </div>
        <div>
          <strong>Validation</strong>
          <span>{state?.status === "READY" ? state.lastError ? "transient error" : state.lastResponse?.status ?? "all validations passed" : "waiting for draft"}</span>
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

/**
 * Presentational component: renders one catalog section with drag/select/hover hooks. Hover callbacks
 * are intentionally external so the parent can debounce Fabric compatibility lookups.
 */
function CatalogGroup({
  title,
  entries,
  ready,
  busy,
  canAssist,
  knownCatalogEntryIds,
  hoveredCatalogEntryId,
  onSelect,
  onAssist,
  onHover,
  onHoverEnd
}: {
  readonly title: string;
  readonly entries: readonly VisualCatalogEntry[];
  readonly ready: boolean;
  readonly busy: boolean;
  readonly canAssist: boolean;
  readonly knownCatalogEntryIds: ReadonlySet<string>;
  readonly hoveredCatalogEntryId?: string | undefined;
  readonly onSelect: (entryId: string) => void;
  readonly onAssist: (entryId: string) => void;
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
          <div
            className={isHovered ? `${baseClass} previewing` : baseClass}
            draggable={inCatalog}
            key={entry.catalogEntryId}
            onDragStart={event => {
              if (!inCatalog || !ready || busy) {
                return;
              }
              event.dataTransfer.setData("application/x-unfurl-catalog-entry", entry.catalogEntryId);
              event.dataTransfer.effectAllowed = "copy";
            }}
            // Hover drives the compatibility preview: the panel debounces
            // the lookup (150 ms) so quickly skimming buttons doesn't
            // fire a request per row. Mouseleave clears the preview so
            // the scene relaxes to neutral the moment focus drifts.
            onMouseEnter={onHover ? () => onHover(entry.catalogEntryId) : undefined}
            onMouseLeave={onHoverEnd}
            onFocus={onHover ? () => onHover(entry.catalogEntryId) : undefined}
            onBlur={onHoverEnd}
            aria-disabled={!ready || busy || !inCatalog}
            title={inCatalog ? undefined : "Not in the live catalog; admit it before assembly"}
          >
            <button
              type="button"
              className="catalog-row-main"
              aria-label={`Add ${paletteLabel(entry)}`}
              draggable={inCatalog}
              onClick={() => onSelect(entry.catalogEntryId)}
              disabled={!ready || busy || !inCatalog}
            >
              <span className="catalog-glyph purple">{entry.visualManifest?.fallbackShape.kind.slice(0, 1) ?? "C"}</span>
              <span>{paletteLabel(entry)}</span>
            </button>
            <button
              type="button"
              className="catalog-row-action"
              draggable={inCatalog}
              disabled={!canAssist || !ready || busy || !inCatalog}
              onClick={() => onAssist(entry.catalogEntryId)}
            >
              Ask
            </button>
            <button
              type="button"
              className="catalog-row-action"
              draggable={inCatalog}
              disabled={!ready || busy || !inCatalog}
              onClick={() => onSelect(entry.catalogEntryId)}
            >
              Add
            </button>
          </div>
        );
      })}
    </section>
  );
}

/**
 * Presentational component: renders non-interactive fallback catalog labels used for static guidance
 * and empty-state scaffolding when no live catalog entries are available.
 */
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

/**
 * Presentational component: renders provided/required port chips with stable styling so inspector
 * sections can compare component offers and needs without duplicating chip markup.
 */
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

/**
 * Browser-state helper: decides whether to open the workbench tutorial. Server-side rendering and
 * storage failures safely suppress the tutorial because it is purely local guidance.
 */
function shouldShowTutorial(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(tutorialStorageKey) === "open";
  } catch {
    return false;
  }
}

/**
 * Error-message adapter: turns low-level transport/server failures into operator-facing Studio copy
 * while preserving unknown messages for debugging.
 */
function friendlyStudioError(message: string): string {
  if (/HTTP\s+5\d\d|Internal Server Error/i.test(message)) {
    return "Fabric projection is temporarily unavailable. The workbench is showing the last available local state.";
  }
  if (/timed out|timeout|AbortError/i.test(message)) {
    return "Fabric Studio request timed out. The draft session is still active; retry the action.";
  }
  if (/socket hang up|ECONNRESET/i.test(message)) {
    return "Fabric Studio connection dropped. The draft session is still active; retry the action.";
  }
  if (/Failed to fetch|ECONNREFUSED|NetworkError/i.test(message)) {
    return "Fabric projection cannot be reached. Check that the local Fabric service is running.";
  }
  return message;
}

/**
 * Label helper: derives a compact catalog palette label from a Maven-like catalog id. Undefined
 * entries return an empty label so disabled UI rows do not fabricate component identity.
 */
function paletteLabel(entry: VisualCatalogEntry | undefined): string {
  if (!entry) {
    return "";
  }
  return entry.catalogEntryId.split(":").slice(1).join(":") || entry.catalogEntryId;
}

/**
 * Label helper: converts a catalog entry id into a human-readable component name for draft chips and
 * pending projection selections.
 */
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

/**
 * Catalog-file lookup helper: resolves the currently selected tenant catalog
 * file row for draft creation metadata.
 */
function selectedCatalogFile(
  files: readonly StudioFileRecord[],
  selectedFileId: string
): StudioFileRecord | undefined {
  return files.find(file => file.fileId === selectedFileId) ?? files[0];
}

/**
 * Label helper: formats tenant catalog file versions for the New Draft
 * dropdown without exposing internal ids as the primary text.
 */
function catalogFileOptionLabel(file: StudioFileRecord): string {
  const version = Number.isFinite(file.version) ? `v${file.version}` : "version";
  return `${file.fileTitle || file.fileName} (${version})`;
}

/**
 * Naming helper: creates a readable draft history title from the selected
 * assembly and catalog file metadata.
 */
function draftDisplayName(assemblyId: string, catalogFile: StudioFileRecord | undefined): string {
  const assembly = assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID;
  return `${assembly} - ${catalogFile?.fileTitle ?? "Current Catalog"}`;
}

/**
 * Projection helper: extracts the active visual port ids from a catalog entry. Missing manifests
 * produce an empty list because Fabric, not the UI, decides component validity.
 */
function activePorts(entry: VisualCatalogEntry | undefined): readonly string[] {
  return entry?.visualManifest?.ports.map(port => port.id) ?? [];
}

/**
 * Projection helper: extracts capability strings for one visual port kind from
 * the component's DCP-backed visual manifest.
 */
function entryCapabilities(
  entry: VisualCatalogEntry | undefined,
  kind: "OFFER" | "DEPENDENCY" | "SUBSTRATE_DEPENDENCY" | "REFUSAL"
): readonly string[] {
  return entry?.visualManifest?.ports
    .filter(port => port.kind === kind)
    .map(port => capabilityFromMapsTo(port.mapsTo) || port.id)
    .filter(Boolean) ?? [];
}

/**
 * DCP path formatter: trims common visual-manifest `mapsTo` prefixes into the
 * capability names that the authoring agent should reason about.
 */
function capabilityFromMapsTo(mapsTo: string): string {
  return mapsTo
    .replace(/^claim\.offers\./, "")
    .replace(/^claim\.dependencies\./, "")
    .replace(/^claim\.substrateDependencies\./, "")
    .replace(/^claim\.substrate_dependencies\./, "");
}

/**
 * Catalog lookup helper: finds the first offer port for a component so drag/drop connection flows can
 * seed a sensible default without inventing ports outside the visual manifest.
 */
function firstOfferPortId(catalogEntryId: string, catalogEntries: readonly VisualCatalogEntry[]): string | undefined {
  const entry = catalogEntries.find(entry => entry.catalogEntryId === catalogEntryId);
  const offer = entry?.visualManifest?.ports.find(port => port.kind === "OFFER");
  return offer?.id;
}

/**
 * Adapter helper: merges static demo replacement options and live catalog entries into one candidate
 * list while marking substrate replacement as blocked because the base plate is profile-derived.
 */
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

/**
 * Adapter helper: normalizes Fabric replacement-candidate responses into the panel's local view-model
 * shape without changing Fabric's allow/block decision.
 */
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

/**
 * Projector: narrows Fabric's dynamic projection to the operator's current draft inventory for
 * display-only surfaces. Fabric may return a broader catalog-derived projection, but the workbench
 * assembly, semantic zoom, hierarchy, and table must only show components that are actually in the
 * governed draft; parent/assembly context is retained so the DCP frame remains navigable.
 */
export function filterProjectionForDraftDisplay(
  projection: DynamicDcpProjectionResponse | undefined,
  draftComponents: readonly Pick<DraftComponentItem, "catalogEntryId">[] | undefined
): DynamicDcpProjectionResponse | undefined {
  if (!projection || draftComponents === undefined) {
    return projection;
  }
  const draftCatalogEntryIds = new Set(draftComponents.map(component => component.catalogEntryId));
  const keptNodeIds = new Set<string>();
  const nodes = projection.nodes.filter(node => {
    const keep = node.level !== "CHILD"
      || (node.catalogEntryId !== undefined && draftCatalogEntryIds.has(node.catalogEntryId));
    if (keep) {
      keptNodeIds.add(node.nodeId);
    }
    return keep;
  });
  const connections = (projection.connections ?? []).filter(edge =>
    endpointVisibleInDraft(edge.sourceNodeId, keptNodeIds)
    && endpointVisibleInDraft(edge.targetNodeId, keptNodeIds)
  );
  const usedSubstratePortIds = new Set(
    connections.flatMap(edge => [
      isSubstrateEndpoint(edge.sourceNodeId) ? edge.sourcePortId : undefined,
      isSubstrateEndpoint(edge.targetNodeId) ? edge.targetPortId : undefined
    ]).filter((portId): portId is string => typeof portId === "string" && portId.length > 0)
  );
  return {
    ...projection,
    nodes,
    edges: (projection.edges ?? []).filter(edge =>
      keptNodeIds.has(edge.fromNodeId) && keptNodeIds.has(edge.toNodeId)
    ),
    connections,
    substratePorts: (projection.substratePorts ?? []).filter(port => usedSubstratePortIds.has(port.portId)),
    warnings: projection.warnings
  };
}

/**
 * Guard helper: treats substrate pseudo-nodes as visible pipe endpoints while requiring real
 * component endpoints to survive the draft display filter.
 */
function endpointVisibleInDraft(nodeId: string, keptNodeIds: ReadonlySet<string>): boolean {
  return isSubstrateEndpoint(nodeId) || keptNodeIds.has(nodeId);
}

/**
 * Predicate helper: recognizes runtime substrate pseudo-node ids used by Fabric connection edges.
 */
function isSubstrateEndpoint(nodeId: string): boolean {
  return nodeId === "substrate" || nodeId === "substrate:runtime";
}

/**
 * Projection lookup helper: maps a scene selection back to a dynamic DCP projection node so hover,
 * replacement, and inspector behavior operate on Fabric-provided identities.
 */
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

/**
 * CSS helper: appends the selected class when a module surface matches the currently selected
 * inspector surface.
 */
function moduleClass(baseClass: string, selected: SelectedSurfaceId, surface: SelectedSurfaceId): string {
  return selected === surface ? `${baseClass} selected` : baseClass;
}

/**
 * Projection lookup helper: finds the CHILD-level projection node for a catalog entry id, returning
 * undefined when the draft has not yet been reflected in Fabric's dynamic projection.
 */
function projectionNodeIdForCatalogEntry(
  projection: DynamicDcpProjectionResponse | undefined,
  catalogEntryId: string
): string | undefined {
  return projection?.nodes.find(
    node => node.level === "CHILD" && node.catalogEntryId === catalogEntryId
  )?.nodeId;
}

/**
 * Predicate helper: confirms whether a scene component selection represents the given draft item.
 * Projection node ids and pending draft sentinel ids are both accepted so removal works before and
 * after Fabric's dynamic projection has reflected a newly added component.
 */
function selectedPartMatchesDraftItem(
  selection: ThreeAssemblySelection,
  component: DraftComponentItem,
  projection: DynamicDcpProjectionResponse | undefined
): boolean {
  if (selection.kind !== "component") {
    return false;
  }
  const projectionNodeId = projectionNodeIdForCatalogEntry(projection, component.catalogEntryId);
  return selection.surface === projectionNodeId
    || selection.surface === `draft:${component.catalogEntryId}`
    || selection.label === component.label;
}

/**
 * Projection lookup helper: resolves a projection node id back to the matching draft inventory item
 * so replacement intents can keep the local draft display synchronized with Fabric's accepted edit.
 */
function draftComponentForNodeId(
  nodeId: string,
  projection: DynamicDcpProjectionResponse | undefined,
  components: readonly DraftComponentItem[] | undefined
): DraftComponentItem | undefined {
  const catalogEntryId = projection?.nodes.find(node => node.nodeId === nodeId)?.catalogEntryId;
  return components?.find(component => component.catalogEntryId === catalogEntryId);
}

/**
 * Identity helper: chooses the best available component identity for REMOVE_COMPONENT intents. The
 * DCP projection node id wins; pending local draft items fall back to their draft sentinel/catalog id
 * so Fabric still receives a stable identifier instead of a display label.
 */
function selectedComponentIdForDraftItem(
  component: DraftComponentItem,
  selection: ThreeAssemblySelection
): string {
  if (selection.kind === "component" && selection.surface.startsWith("draft:")) {
    return selection.surface;
  }
  return `draft:${component.catalogEntryId}`;
}

/**
 * Collection helper: appends a validated draft component to the local inventory cache.
 */
function appendDraftComponentItem(
  components: readonly DraftComponentItem[],
  catalogEntryId: string
): readonly DraftComponentItem[] {
  return [
    ...components,
    {
      catalogEntryId,
      label: labelForCatalogEntry(catalogEntryId),
      status: "ADDED"
    }
  ];
}

/**
 * Collection helper: removes the first matching draft inventory item so duplicate catalog entries
 * can still be represented as separate operator additions.
 */
function removeDraftComponentItem(
  components: readonly DraftComponentItem[],
  catalogEntryId: string
): readonly DraftComponentItem[] {
  let removed = false;
  return components.filter(component => {
    if (!removed && component.catalogEntryId === catalogEntryId) {
      removed = true;
      return false;
    }
    return true;
  });
}

/**
 * Collection helper: replaces one draft inventory item after Fabric accepts a REPLACE_COMPONENT
 * intent, falling back to append semantics when the old item is not present in local cache.
 */
function replaceDraftComponentItem(
  components: readonly DraftComponentItem[],
  oldComponent: DraftComponentItem | undefined,
  newCatalogEntryId: string
): readonly DraftComponentItem[] {
  const replacement: DraftComponentItem = {
    catalogEntryId: newCatalogEntryId,
    label: labelForCatalogEntry(newCatalogEntryId),
    status: "ADDED"
  };
  if (!oldComponent) {
    return [...components, replacement];
  }
  let replaced = false;
  const next = components.map(component => {
    if (!replaced && component.catalogEntryId === oldComponent.catalogEntryId) {
      replaced = true;
      return replacement;
    }
    return component;
  });
  return replaced ? next : [...next, replacement];
}

/**
 * Projector: replays the subset of authoring proposal intents Fabric accepted into the local draft
 * inventory cache. This mirrors only validated intents; rejected proposal suffixes remain invisible.
 */
export function replayDraftInventoryIntents(
  components: readonly DraftComponentItem[],
  intents: readonly AuthoringProposedIntent[]
): readonly DraftComponentItem[] {
  let next = components;
  for (const intent of intents) {
    if (intent.type === "ADD_COMPONENT") {
      next = appendDraftComponentItem(next, intent.catalogEntryId);
    }
    if (intent.type === "REMOVE_COMPONENT") {
      next = removeDraftComponentItem(next, intent.catalogEntryId ?? catalogEntryIdFromComponentId(intent.componentId));
    }
    if (intent.type === "REPLACE_COMPONENT") {
      const oldCatalogEntryId = intent.oldCatalogEntryId ?? catalogEntryIdFromComponentId(intent.oldComponentId);
      const oldComponent = next.find(component => component.catalogEntryId === oldCatalogEntryId);
      next = replaceDraftComponentItem(next, oldComponent, intent.newCatalogEntryId);
    }
  }
  return next;
}

/**
 * Intent response guard: detects the ready state produced after Fabric accepted a semantic intent.
 */
function intentAccepted(state: DraftWorkspaceState): boolean {
  return state.status === "READY" && state.lastResponse?.status === "VALID";
}

// Build the scene selection for a draft component (palette add or Draft
// Assembly chip). When the live projection already has a CHILD node for this
// catalog entry, select that node id so the selection matches a 3D-module
// click exactly — same highlight, and inspectorDetailsFor resolves real
// projection-backed details. Otherwise fall back to a stable
// `draft:<catalogEntryId>` sentinel: the component is in the draft but the
// projection has no governed details for it yet, so the inspector reports a
// pending state instead of the misleading "No component selected" (or a
// fabricated identity). Replaces the old hardcoded `surface: "validation"`,
// which always resolved to the demo Flow Orchestrator.
/**
 * Selection builder: creates a scene selection for a draft component, preferring live projection node
 * ids and falling back to a draft sentinel when Fabric has not projected the component yet.
 */
function draftComponentSelection(
  catalogEntryId: string,
  label: string,
  projection: DynamicDcpProjectionResponse | undefined
): ThreeAssemblySelection {
  const nodeId = projectionNodeIdForCatalogEntry(projection, catalogEntryId);
  const surface = nodeId ?? `draft:${catalogEntryId}`;
  return {
    id: `component:${surface}`,
    kind: "component",
    surface,
    label
  };
}

/**
 * Demo-data factory: provides a minimal catalog only when demo fallbacks are explicitly enabled.
 * Governed runtime paths must prefer real Fabric catalog responses or honest empty states.
 */
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

/**
 * Adapter helper: resolves inspector data from the live DCP projection or, in demo mode only, from
 * static sample metadata. Undefined means the UI should render an honest empty inspector state.
 */
function inspectorDetailsFor(
  surface: SelectedSurfaceId,
  projection: DynamicDcpProjectionResponse | undefined,
  demoFallbacks: boolean
): InspectorDetails | undefined {
  // The substrate base plate is a real, profile-derived surface — its
  // details are not demo content, so they're always available.
  if (surface === "substrate") {
    return inspectorDetails.substrate;
  }
  // The rest of the static map is hardcoded sample-assembly metadata.
  // Only consult it in demo mode; otherwise the inspector must reflect the
  // live projection or report that it has nothing real to show.
  if (demoFallbacks) {
    const staticDetails = inspectorDetails[surface];
    if (staticDetails) {
      return staticDetails;
    }
  }
  const node = projection?.nodes.find(node => node.nodeId === surface);
  if (!node && !demoFallbacks) {
    // No projection-backed details for this surface and demo content is
    // off — signal the caller to render an honest empty state rather than
    // fabricate a component identity.
    return undefined;
  }
  return {
    name: node?.label ?? surface,
    icon: (node?.label ?? surface).slice(0, 1).toUpperCase() || "C",
    iconClass: "purple",
    type: node?.dcpType ?? "Component",
    version: node?.catalogEntryId?.split(":").at(-1) ?? "dynamic",
    owner: "catalog",
    status: node?.replacementAllowed ? "Replaceable" : "Included",
    description: node?.catalogEntryId
      ? `Projection node ${node.nodeId} from ${node.catalogEntryId}.`
      : `Projection node ${surface}.`,
    bindingMode: "DYNAMIC",
    deploymentShape: node?.dcpType ?? "COMPONENT",
    substrateTarget: "Customer Runtime Substrate",
    isolationPattern: "POLICY",
    providedPorts: node?.capabilities ?? [],
    requiredPorts: []
  };
}

/**
 * Label helper: maps workbench tool names to compact button glyphs while keeping unknown tools
 * visibly neutral.
 */
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

/**
 * CSS helper: derives the active-view class name used by the workbench chrome.
 */
function viewClassName(view: string): string {
  return `view-${view.toLowerCase()}`;
}

/**
 * Copy helper: provides a short operator-facing description for each supported visual view.
 */
function viewDescription(view: string): string {
  return {
    Assembly: "complete governed composition",
    Exploded: "selected component pulled forward",
    Ports: "offers, requirements, and handles emphasized",
    Substrate: "runtime layer and closed-world sockets emphasized",
    Validation: "policy and compatibility status emphasized"
  }[view] ?? "composition surface";
}

/**
 * Copy helper: maps semantic zoom ids to labels shown in the zoom navigator and layout status.
 */
function semanticZoomLabel(level: SemanticZoomLevel): string {
  return {
    PARENT_DCP: "Parent DCP",
    ASSEMBLY_DCP: "Assembly DCP",
    CHILD_DCP: "Child DCP"
  }[level];
}

/**
 * Copy helper: explains what level of the recursive DCP projection is visible at each zoom depth.
 */
function semanticZoomDescription(level: SemanticZoomLevel): string {
  return {
    PARENT_DCP: "zoomed out to tenant/application composition context",
    ASSEMBLY_DCP: "current validated assembly graph",
    CHILD_DCP: "zoomed in to descendant components and internal responsibilities"
  }[level];
}

/**
 * Persistence record: stores layout-only choices restored across route remounts. It deliberately
 * excludes contract or validation data because Fabric remains the source of semantic truth.
 */
type LayoutState = {
  readonly activeView: string;
  readonly semanticZoomLevel: SemanticZoomLevel;
  readonly selectedSurface: SelectedSurfaceId;
};

/**
 * Persistence record: stores the local draft chip inventory restored across route remounts. Fabric
 * remains authoritative for validation; this cache only preserves operator context between renders.
 */
type DraftInventoryState = {
  readonly components: readonly DraftComponentItem[];
};

/**
 * Browser persistence helper: restores locally cached draft inventory and validates each item shape
 * before exposing it to the UI.
 */
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

/**
 * Browser persistence helper: writes draft inventory as a convenience cache and silently ignores
 * storage failures because Fabric can always reload authoritative draft state.
 */
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

/**
 * Key helper: scopes draft inventory by tenant and assembly with safe defaults for local Studio use.
 */
function draftInventoryStateKey(tenantId: string, assemblyId: string): string {
  return `unfurl-studio-draft-inventory:${tenantId.trim() || DEFAULT_STUDIO_TENANT_ID}:${assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID}`;
}

/**
 * Type guard: validates browser-deserialized draft inventory items before they influence UI state.
 */
function isDraftComponentItem(value: unknown): value is DraftComponentItem {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DraftComponentItem>;
  return typeof candidate.catalogEntryId === "string"
    && typeof candidate.label === "string"
    && (candidate.status === "ADDED" || candidate.status === "VALIDATED");
}

/**
 * Browser persistence helper: restores layout-only state for a tenant assembly and rejects malformed
 * values rather than applying broken view/selection state.
 */
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

/**
 * Browser persistence helper: saves local view/zoom/selection state without treating that state as
 * contract input.
 */
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

/**
 * Key helper: scopes layout state by tenant and assembly with local defaults for empty route params.
 */
function layoutStateKey(tenantId: string, assemblyId: string): string {
  return `unfurl-studio-layout:${tenantId.trim() || DEFAULT_STUDIO_TENANT_ID}:${assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID}`;
}

/**
 * Adapter helper: converts Fabric layout state into the panel's local layout shape while normalizing
 * unsupported values to safe defaults.
 */
function toLayoutState(layout: StudioLayoutState): LayoutState {
  return {
    activeView: validView(layout.activeView),
    semanticZoomLevel: validSemanticZoomLevel(layout.semanticZoomLevel),
    selectedSurface: validSurface(layout.selectedSurface)
  };
}

/**
 * Validation helper: clamps persisted or server-provided view names to the supported workbench views.
 */
function validView(value: string): string {
  return ["Assembly", "Exploded", "Ports", "Substrate", "Validation"].includes(value) ? value : "Assembly";
}

/**
 * Validation helper: clamps persisted or server-provided semantic zoom levels to the supported DCP
 * projection depths.
 */
function validSemanticZoomLevel(value: string): SemanticZoomLevel {
  return value === "PARENT_DCP" || value === "CHILD_DCP" || value === "ASSEMBLY_DCP"
    ? value
    : "ASSEMBLY_DCP";
}

/**
 * Validation helper: clamps persisted selected surfaces to known static surfaces until a live
 * projection selection replaces them.
 */
function validSurface(value: string): SelectedSurfaceId {
  return Object.prototype.hasOwnProperty.call(inspectorDetails, value)
    ? value as SelectedSurfaceId
    : "validation";
}

/**
 * Projection helper: resolves a node label from the current dynamic projection and falls back to the
 * id so missing labels remain inspectable.
 */
function nodeLabel(projection: DynamicDcpProjectionResponse | undefined, nodeId: string): string {
  return projection?.nodes.find(node => node.nodeId === nodeId)?.label ?? nodeId;
}

/**
 * Copy helper: summarizes deployment runtime knobs for compact display in the planner panel.
 */
function deploymentRuntimeSummary(runtime: Record<string, unknown>): string {
  const entries = Object.entries(runtime)
    .filter(([, value]) => value !== undefined && value !== false && value !== "")
    .map(([key, value]) => `${key}=${value}`);
  return entries.length === 0 ? "default" : entries.join(", ");
}

/**
 * Projector: converts Fabric's recursive DCP projection into the small semantic scene projection
 * consumed by the ThreeAssemblyScene zoom controls.
 */
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

/**
 * Identity helper: derives a stable key for semantic scene projections so React/Three transitions
 * can detect meaningful projection changes.
 */
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

/**
 * Matching helper: normalizes labels for projection-selection fallback matching where exact ids are
 * unavailable.
 */
function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Copy helper: formats active collaborator counts for the workbench presence footer.
 */
function collaboratorLabel(count: number): string {
  if (count <= 0) {
    return "solo";
  }
  return count === 1 ? "1 active" : `${count} active`;
}

/**
 * Label helper: derives a compact two-letter substrate badge from a longer capability label.
 */
function shortSubstrateLabel(label: string): string {
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 2).map(word => word.charAt(0).toUpperCase()).join("");
  }
  return label.slice(0, 2).toUpperCase() || "S";
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
 * Filename normalizer: keeps tenant and assembly ids readable while avoiding
 * path characters in generated snapshot file names.
 */
function safeFilePart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "studio";
}

/**
 * Projector: rebuilds the local draft inventory chips from Fabric's restored
 * intent log after an assembly snapshot load. Supports add/remove/replace so
 * deleted components are not resurrected by replaying only ADD_COMPONENT records.
 */
function draftComponentsFromSession(session: StudioAssemblySnapshot["sessions"][number]): readonly DraftComponentItem[] {
  let components: readonly DraftComponentItem[] = [];
  for (const intent of session.intentLog ?? []) {
    if (intent.type === "ADD_COMPONENT") {
      const catalogEntryId = String(intent.payload.catalogEntryId ?? "");
      if (catalogEntryId) {
        components = [
          ...components,
          { catalogEntryId, label: labelForCatalogEntry(catalogEntryId), status: "VALIDATED" as const }
        ];
      }
    }
    if (intent.type === "REMOVE_COMPONENT") {
      const catalogEntryId = String(intent.payload.catalogEntryId ?? "");
      const componentId = String(intent.payload.componentId ?? "");
      components = removeDraftComponentItem(components, catalogEntryId || catalogEntryIdFromComponentId(componentId));
    }
    if (intent.type === "REPLACE_COMPONENT") {
      const oldCatalogEntryId = String(intent.payload.oldCatalogEntryId ?? "");
      const oldComponentId = String(intent.payload.oldComponentId ?? "");
      const newCatalogEntryId = String(intent.payload.newCatalogEntryId ?? "");
      components = removeDraftComponentItem(components, oldCatalogEntryId || catalogEntryIdFromComponentId(oldComponentId));
      if (newCatalogEntryId) {
        components = [
          ...components,
          { catalogEntryId: newCatalogEntryId, label: labelForCatalogEntry(newCatalogEntryId), status: "VALIDATED" as const }
        ];
      }
    }
  }
  return components;
}

/**
 * Identity parser: converts pending draft component ids back into catalog ids for local replay.
 */
function catalogEntryIdFromComponentId(componentId: string): string {
  return componentId.startsWith("draft:") ? componentId.slice("draft:".length) : componentId;
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

/** Scope boundary: changing the applied tenant/assembly destroys prior state and subscriptions. */
export function DraftWorkspacePanel(props: DraftWorkspacePanelProps) {
  const [scope, setScope] = useState({ tenant: props.initialTenantId ?? DEFAULT_STUDIO_TENANT_ID,
    assembly: props.initialAssemblyId ?? DEFAULT_STUDIO_ASSEMBLY_ID });
  return <ScopedDraftWorkspacePanel {...props} initialTenantId={scope.tenant} initialAssemblyId={scope.assembly}
    key={JSON.stringify([scope.tenant, scope.assembly])}
    onScopeChange={(tenant, assembly) => setScope({ tenant, assembly })} />;
}
