import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_STUDIO_ASSEMBLY_ID,
  DEFAULT_STUDIO_TENANT_ID,
  type AuthoringProposal,
  type CompileDraftCandidateResponse,
  type DeploymentPolicyDraft,
  type DeploymentShape,
  type ResolveDeploymentResponse,
  type StudioAssemblySnapshot,
  type StudioAssemblySummary,
  type StudioFabricClient,
  type StudioFileRecord,
  type StudioReplacementCandidate
} from "@unfurl/fabric-validation-client";
import type { VisualCatalogEntry } from "@unfurl/visual-manifest";
import type { AuthoringPromptSeed } from "../AuthoringConversationPanel.js";
import {
  applyDraftIntent,
  compileDraftWorkspace,
  compileResponseProducedBy,
  createDraftWorkspace,
  type DraftWorkspaceState
} from "../draftWorkspace.js";
import {
  createAllShapesDeploymentPlannerState,
  createDefaultDeploymentPlannerState,
  deploymentPolicyFromPlannerState,
  type DeploymentPlannerState
} from "../deploymentPlanner.js";
import { resolveDeploymentForDraft } from "../deploymentPlannerView.js";
import { createIntentHistory } from "../intentHistory.js";
import { reconcileSession, watchSession } from "../sessionReconciliation.js";
import type { SceneDropTarget, ThreeAssemblySelection } from "../ThreeAssemblyScene.js";
import {
  appendDraftComponentItem,
  draftComponentForNodeId,
  draftComponentsFromSession,
  draftDisplayName,
  filterProjectionForDraftDisplay,
  firstOfferPortId,
  intentAccepted,
  labelForCatalogEntry,
  projectionNodeIdForCatalogEntry,
  readDraftInventory,
  removeDraftComponentItem,
  replaceDraftComponentItem,
  replayDraftInventoryIntents,
  selectedCatalogFile,
  toReplacementCandidates,
  writeDraftInventory,
  downloadJson,
  safeFilePart,
  type DraftComponentItem,
  type ReplacementCandidate
} from "./draftInventory.js";
import {
  failedProjectionLoad,
  pin,
  projectionFor,
  projectionInputsFor,
  type InputsPinned,
  type ProjectionLoad,
  type WorkbenchData
} from "./workbenchData.js";

/** The client operations the workbench uses; every composition fact comes through them. */
export type WorkbenchClient = Pick<
  StudioFabricClient,
  | "saveDraft" | "saveAssemblySnapshot" | "loadAssemblySnapshot" | "loadLayoutState" | "saveLayoutState"
  | "loadDynamicDcpProjection" | "loadReplacementCandidates" | "loadConnectionCandidates" | "listCatalogVisuals"
  | "listStudioFiles" | "listSessionHistory" | "createDraftComposition" | "applyIntent" | "getDraftSession"
  | "compileCandidate" | "resolveDeployment" | "converseAuthoring" | "heartbeatCollaborator" | "sessionEventsUrl"
  | "listAssemblies"
>;

/** The hover preview of a catalog entry: what it could connect to or replace, from Fabric. */
export type CompatibilityPreview = {
  readonly catalogEntryId: string;
  readonly connectionNodes: ReadonlySet<string>;
  readonly replacementNodes: ReadonlySet<string>;
  readonly portIds: ReadonlySet<string>;
};

export type WorkbenchCompositionOptions = {
  readonly client: WorkbenchClient;
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly initialBaseCatalogHash?: string;
  /** The host's verified operator id, used for presence; absent for no presence. */
  readonly operatorId?: string;
  /** The current scene selection, which replacement candidates are loaded for. */
  readonly selection: ThreeAssemblySelection;
  /** Called after an accepted intent with the selection the workbench should move to. */
  readonly onSelect: (selection: ThreeAssemblySelection) => void;
  /** Start the planner allowing every shape (`policy=all-shapes`, kept from the retired planner route). */
  readonly allShapesPolicy?: boolean;
};

/**
 * Controller (Facade over the Fabric client): all composition state of the workbench and every command that changes it,
 * moved out of the retired `DraftWorkspacePanel` (LLD-studio-viewpoints-and-perspectives §7, "Workbench store").
 *
 * Composition state comes only from Fabric: the draft session, its projection, catalog, replacement candidates, compile
 * and deployment resolution. View state (view, overlays, renderer) never enters here (LLD §1 rule 1), so no overlay or
 * renderer choice can produce an intent. Compile and resolution responses are pinned to the session revision they were
 * produced at (§4.3 rule 6). Nothing is defaulted or invented: a value Fabric has not supplied stays absent.
 */
export function useWorkbenchComposition(options: WorkbenchCompositionOptions) {
  const { client, selection, onSelect } = options;
  const tenantId = options.tenantId.trim() || DEFAULT_STUDIO_TENANT_ID;
  const assemblyId = options.assemblyId.trim() || DEFAULT_STUDIO_ASSEMBLY_ID;

  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<DraftWorkspaceState | undefined>();
  const [catalog, setCatalog] = useState<readonly VisualCatalogEntry[]>([]);
  const [catalogFiles, setCatalogFiles] = useState<readonly StudioFileRecord[]>([]);
  const [selectedCatalogFileId, setSelectedCatalogFileId] = useState("");
  const [baseCatalogHash, setBaseCatalogHash] = useState(options.initialBaseCatalogHash ?? "");
  const [catalogError, setCatalogError] = useState<string | undefined>();
  const [commandError, setCommandError] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [projectionLoad, setProjectionLoad] = useState<ProjectionLoad | undefined>();
  const [projectionRequest, setProjectionRequest] = useState(0);
  const [draftComponents, setDraftComponents] = useState<readonly DraftComponentItem[] | undefined>(() => readDraftInventory(tenantId, assemblyId));
  const [fabricReplacements, setFabricReplacements] = useState<readonly StudioReplacementCandidate[] | undefined>();
  const [replacementError, setReplacementError] = useState<string | undefined>();
  const [replacementEntryId, setReplacementEntryId] = useState("");
  const [preview, setPreview] = useState<CompatibilityPreview | undefined>();
  const [planner, setPlanner] = useState<DeploymentPlannerState>(() =>
    options.allShapesPolicy ? createAllShapesDeploymentPlannerState() : createDefaultDeploymentPlannerState());
  const [deployment, setDeployment] = useState<InputsPinned<ResolveDeploymentResponse> | undefined>();
  const [deploymentError, setDeploymentError] = useState<string | undefined>();
  const [compileResult, setCompileResult] = useState<InputsPinned<CompileDraftCandidateResponse> | undefined>();
  const [sign, setSign] = useState(false);
  const [assembly, setAssembly] = useState<StudioAssemblySummary | undefined>();
  const [syncError, setSyncError] = useState<string | undefined>();
  const [authoringSeed, setAuthoringSeed] = useState<AuthoringPromptSeed | undefined>();
  const seedCounter = useRef(0);
  const hoverDebounce = useRef<ReturnType<typeof setTimeout> | undefined>();
  const hoverGeneration = useRef(0);

  const readySession = state?.status === "READY" ? state.session : undefined;
  const deploymentPolicy: DeploymentPolicyDraft = useMemo(() => deploymentPolicyFromPlannerState(planner), [planner]);
  const knownCatalogEntryIds = useMemo(() => new Set(catalog.map(entry => entry.catalogEntryId)), [catalog]);
  // The projection is read only for the inputs it was loaded for (§4.3 rule 6): every reader below, the views, the
  // inspector and the intents that address a node, sees `projection`, which is absent while it is out of date.
  const currentProjectionInputs = projectionInputsFor(tenantId, assemblyId, readySession);
  const projectionView = projectionFor(projectionLoad, currentProjectionInputs);
  const projection = projectionView.projection;
  const displayProjection = useMemo(() => filterProjectionForDraftDisplay(projection, draftComponents), [projection, draftComponents]);

  // Catalog: the tenant's catalog files and the selected file's visual entries.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let fileId = selectedCatalogFileId;
      if (client.listStudioFiles) {
        const files = await client.listStudioFiles({ tenantId, fileType: "CATALOG" });
        if (cancelled) return;
        setCatalogFiles(files);
        if (fileId === "" || !files.some(file => file.fileId === fileId)) {
          fileId = files[0]?.fileId ?? "";
          setSelectedCatalogFileId(fileId);
        }
      }
      const response = await client.listCatalogVisuals({ tenantId, ...(fileId === "" ? {} : { catalogFileId: fileId }) });
      if (cancelled) return;
      setBaseCatalogHash(response.catalogHash);
      setCatalog(response.entries);
      setCatalogError(undefined);
    })().catch(error => { if (!cancelled) setCatalogError(message(error)); });
    return () => { cancelled = true; };
  }, [client, tenantId, selectedCatalogFileId]);

  // Fabric's summary of the assembly, for its default deployment target.
  useEffect(() => {
    if (!client.listAssemblies) return;
    let cancelled = false;
    void client.listAssemblies({ tenantId }).then(response => {
      if (!cancelled) setAssembly(response.assemblies.find(candidate => candidate.assemblyId === assemblyId));
    }).catch(() => { if (!cancelled) setAssembly(undefined); });
    return () => { cancelled = true; };
  }, [client, tenantId, assemblyId]);

  // The draft projection, reloaded on every change of scope, session or revision, and on Retry. Each outcome is pinned
  // to the inputs it was requested for; a late response for earlier inputs is discarded.
  useEffect(() => {
    const inputs = projectionInputsFor(tenantId, assemblyId, readySession);
    if (!client.loadDynamicDcpProjection) {
      setProjectionLoad(previous => failedProjectionLoad(previous, inputs, "This client does not provide Fabric's dynamic DCP projection"));
      return;
    }
    let cancelled = false;
    void client.loadDynamicDcpProjection({ tenantId, assemblyId, ...(inputs.sessionId === undefined ? {} : { sessionId: inputs.sessionId }) })
      .then(response => { if (!cancelled) setProjectionLoad({ status: "LOADED", inputs, response }); })
      .catch(error => { if (!cancelled) setProjectionLoad(previous => failedProjectionLoad(previous, inputs, message(error))); });
    return () => { cancelled = true; };
  }, [client, tenantId, assemblyId, readySession?.sessionId, readySession?.sceneRevision, projectionRequest]);

  // Authoritative session snapshots, retried after transient failures (sessionReconciliation).
  useEffect(() => {
    if (!readySession) return;
    return watchSession(
      () => client.getDraftSession({ tenantId: readySession.tenantId, assemblyId: readySession.assemblyId, sessionId: readySession.sessionId }),
      session => setState(current => current?.status === "READY" ? { ...current, session: reconcileSession(current.session, session) } : current),
      connected => setSyncError(connected ? undefined : "Session updates disconnected. Retrying authoritative snapshot reads."));
  }, [client, readySession?.tenantId, readySession?.assemblyId, readySession?.sessionId]);

  // Presence, with the host's verified operator identity only.
  useEffect(() => {
    if (!readySession || !client.heartbeatCollaborator || !options.operatorId) return;
    let cancelled = false;
    const operatorId = options.operatorId;
    const heartbeat = () => {
      void client.heartbeatCollaborator?.({
        tenantId: readySession.tenantId, assemblyId: readySession.assemblyId, sessionId: readySession.sessionId,
        collaboratorId: operatorId, displayName: operatorId, selectedSurface: selection.surface
      }).then(session => {
        if (!cancelled) setState(current => current?.status === "READY" ? { ...current, session: reconcileSession(current.session, session) } : current);
      }).catch(() => {
        // Presence is advisory; revisioned Fabric intents remain authoritative.
      });
    };
    heartbeat();
    const handle = setInterval(heartbeat, 30000);
    return () => { cancelled = true; clearInterval(handle); };
  }, [client, readySession?.tenantId, readySession?.assemblyId, readySession?.sessionId, selection.surface, options.operatorId]);

  // Fabric's replacement candidates for the selected projected component.
  const selectedNodeId = selection.kind === "component" && displayProjection?.nodes.some(node => node.nodeId === selection.surface)
    ? selection.surface : undefined;
  useEffect(() => {
    if (!client.loadReplacementCandidates || !selectedNodeId) {
      setFabricReplacements(undefined);
      setReplacementError(undefined);
      return;
    }
    let cancelled = false;
    void client.loadReplacementCandidates({ tenantId, assemblyId, componentNodeId: selectedNodeId })
      .then(response => { if (!cancelled) { setFabricReplacements(response.candidates); setReplacementError(undefined); } })
      .catch(error => { if (!cancelled) { setFabricReplacements(undefined); setReplacementError(message(error)); } });
    return () => { cancelled = true; };
  }, [client, tenantId, assemblyId, selectedNodeId]);

  const replacementCandidates: readonly ReplacementCandidate[] = useMemo(
    () => fabricReplacements ? toReplacementCandidates(fabricReplacements) : [], [fabricReplacements]);
  useEffect(() => {
    if (!replacementCandidates.some(candidate => candidate.catalogEntryId === replacementEntryId)) {
      setReplacementEntryId(replacementCandidates[0]?.catalogEntryId ?? "");
    }
  }, [replacementCandidates, replacementEntryId]);

  useEffect(() => {
    if (draftComponents !== undefined) writeDraftInventory(tenantId, assemblyId, draftComponents);
  }, [tenantId, assemblyId, draftComponents]);

  /** Runs a command with the busy flag held, recording a failure instead of throwing into React. */
  async function run(command: () => Promise<void>) {
    setBusy(true);
    setCommandError(undefined);
    try {
      await command();
    } catch (error) {
      setCommandError(message(error));
    } finally {
      setBusy(false);
    }
  }

  /** Applies one intent through Fabric and returns the next state, recording it. */
  async function intent(current: DraftWorkspaceState, body: Parameters<typeof applyDraftIntent>[2]): Promise<DraftWorkspaceState> {
    const next = await applyDraftIntent(client, current, body);
    setState(next);
    return next;
  }

  function componentSelection(catalogEntryId: string): ThreeAssemblySelection {
    const nodeId = projectionNodeIdForCatalogEntry(projection, catalogEntryId);
    const surface = nodeId ?? `draft:${catalogEntryId}`;
    return { id: `component:${surface}`, kind: "component", surface, label: labelForCatalogEntry(catalogEntryId) };
  }

  const substrateSelection: ThreeAssemblySelection = { id: "substrate:base", kind: "substrate", surface: "substrate", label: "Substrate base plate" };

  /** Forgets every compile and resolution result, when the open session is replaced (§4.3 rule 6). */
  function clearDerivedResults() {
    setCompileResult(undefined);
    setDeployment(undefined);
    setDeploymentError(undefined);
  }

  function clearPreview() {
    if (hoverDebounce.current !== undefined) {
      clearTimeout(hoverDebounce.current);
      hoverDebounce.current = undefined;
    }
    hoverGeneration.current += 1;
    setPreview(undefined);
  }

  const commands = {
    /** Creates a Fabric-backed draft and starts an empty inventory. */
    create: () => run(async () => {
      setState(await createDraftWorkspace(client, {
        tenantId, assemblyId, baseCatalogHash,
        ...(selectedCatalogFileId === "" ? {} : { catalogFileId: selectedCatalogFileId }),
        displayName: draftDisplayName(assemblyId, selectedCatalogFile(catalogFiles, selectedCatalogFileId))
      }));
      setDraftComponents([]);
      clearDerivedResults();
      onSelect(substrateSelection);
    }),

    /** ADD_COMPONENT through Fabric; only a live catalog entry can be added. */
    add: (catalogEntryId: string) => run(async () => {
      if (state?.status !== "READY") return;
      if (!knownCatalogEntryIds.has(catalogEntryId)) throw new Error(`Component '${catalogEntryId}' is not in the catalog`);
      const next = await intent(state, { type: "ADD_COMPONENT", catalogEntryId });
      if (intentAccepted(next)) {
        setDraftComponents(current => appendDraftComponentItem(current ?? [], catalogEntryId));
        onSelect(componentSelection(catalogEntryId));
        clearPreview();
      }
    }),

    /** ADD_COMPONENT, then CONNECT its first offer port to a target port, both through Fabric. */
    addAndConnect: (catalogEntryId: string, targetPortId: string) => run(async () => {
      if (state?.status !== "READY") return;
      const added = await intent(state, { type: "ADD_COMPONENT", catalogEntryId });
      if (!intentAccepted(added)) return;
      setDraftComponents(current => appendDraftComponentItem(current ?? [], catalogEntryId));
      onSelect(componentSelection(catalogEntryId));
      const sourcePortId = firstOfferPortId(catalogEntryId, catalog);
      if (!sourcePortId) {
        throw new Error(`Added ${labelForCatalogEntry(catalogEntryId)}, but its visual manifest declares no offer port to connect.`);
      }
      await intent(added, { type: "CONNECT", fromPort: sourcePortId, toPort: targetPortId });
      clearPreview();
    }),

    /** CONNECT two ports through Fabric. */
    connect: (fromPort: string, toPort: string) => run(async () => {
      if (state?.status !== "READY") return;
      const next = await intent(state, { type: "CONNECT", fromPort, toPort });
      if (intentAccepted(next)) { onSelect(substrateSelection); clearPreview(); }
    }),

    /** DISCONNECT the selected pipe through Fabric. */
    disconnect: (pipeId: string) => run(async () => {
      if (state?.status !== "READY") return;
      await intent(state, { type: "DISCONNECT", pipeId });
    }),

    /** REMOVE_COMPONENT through Fabric. */
    remove: (component: DraftComponentItem) => run(async () => {
      if (state?.status !== "READY") return;
      const componentId = projectionNodeIdForCatalogEntry(projection, component.catalogEntryId) ?? `draft:${component.catalogEntryId}`;
      const next = await intent(state, { type: "REMOVE_COMPONENT", componentId, catalogEntryId: component.catalogEntryId });
      if (intentAccepted(next)) {
        setDraftComponents(current => removeDraftComponentItem(current ?? [], component.catalogEntryId));
        onSelect(substrateSelection);
        clearPreview();
      }
    }),

    /** REPLACE_COMPONENT at a projected node through Fabric, only with an allowed, live candidate. */
    replace: (nodeId: string, newCatalogEntryId: string) => run(async () => {
      if (state?.status !== "READY") return;
      if (!knownCatalogEntryIds.has(newCatalogEntryId)) throw new Error(`Replacement '${newCatalogEntryId}' is not in the catalog`);
      const oldComponent = draftComponentForNodeId(nodeId, projection, draftComponents);
      const next = await intent(state, {
        type: "REPLACE_COMPONENT",
        oldComponentId: nodeId,
        ...(oldComponent === undefined ? {} : { oldCatalogEntryId: oldComponent.catalogEntryId }),
        newCatalogEntryId
      });
      if (intentAccepted(next)) {
        setDraftComponents(current => replaceDraftComponentItem(current ?? [], oldComponent, newCatalogEntryId));
        onSelect(componentSelection(newCatalogEntryId));
        clearPreview();
      }
    }),

    /** Routes a 3D-scene drop to add, replace or add-and-connect, using Fabric's latest compatibility preview only. */
    drop: (catalogEntryId: string, target: SceneDropTarget) => {
      if (busy) return;
      setCommandError(undefined);
      if (target.kind === "empty") { void commands.add(catalogEntryId); return; }
      if (target.kind === "component") {
        const replaceable = preview?.catalogEntryId === catalogEntryId && preview.replacementNodes.has(target.nodeId);
        if (replaceable) void commands.replace(target.nodeId, catalogEntryId);
        else setCommandError(`${labelForCatalogEntry(catalogEntryId)} is not a valid replacement there, according to Fabric.`);
        return;
      }
      const connectable = preview?.catalogEntryId === catalogEntryId && preview.portIds.has(target.portId);
      if (connectable) void commands.addAndConnect(catalogEntryId, target.portId);
      else setCommandError(`${labelForCatalogEntry(catalogEntryId)} cannot connect to ${target.portId}, according to Fabric.`);
    },

    /** Debounced hover preview from Fabric; a late response for an earlier hover is discarded. */
    hover: (catalogEntryId: string) => {
      if (!catalogEntryId || !knownCatalogEntryIds.has(catalogEntryId) || !client.loadConnectionCandidates) return;
      if (hoverDebounce.current !== undefined) clearTimeout(hoverDebounce.current);
      const generation = ++hoverGeneration.current;
      hoverDebounce.current = setTimeout(() => {
        hoverDebounce.current = undefined;
        void client.loadConnectionCandidates!({ tenantId, assemblyId, catalogEntryId }).then(response => {
          if (generation !== hoverGeneration.current) return;
          setPreview({
            catalogEntryId,
            connectionNodes: new Set(response.connections.map(edge => edge.targetNodeId)),
            replacementNodes: new Set(response.replacements.map(edge => edge.targetNodeId)),
            portIds: new Set(response.connections.map(edge => edge.targetPortId))
          });
        }).catch(() => {
          // A failed preview leaves the scene as it was; the preview is advisory.
        });
      }, 150);
    },
    clearPreview,

    /** Requests the projection for the current inputs again, after a failed load (§4.3 rule 6). */
    reloadProjection: () => setProjectionRequest(count => count + 1),

    /**
     * Compiles through Fabric with the planner's policy, pinning the response to the session, revision and policy sent.
     * Only a response this request produced is pinned (§4.3 rule 6): a failed compile leaves the earlier result with
     * its own inputs, so it stays out of date, and the failure shows as the state's `lastError`.
     */
    compile: () => run(async () => {
      if (state?.status !== "READY") return;
      const session = state.session;
      const policy = deploymentPolicy;
      const next = await compileDraftWorkspace(client, state, { sign, deploymentPolicy: policy });
      setState(next);
      const produced = compileResponseProducedBy(state, next);
      if (produced) setCompileResult(pin(session, policy, produced));
    }),

    /** Resolves deployment shapes through Fabric, pinning the response to the session, revision and policy sent. */
    resolveDeployment: () => run(async () => {
      if (state?.status !== "READY") return;
      const session = state.session;
      const policy = deploymentPolicy;
      try {
        setDeployment(pin(session, policy, await resolveDeploymentForDraft(client, state, planner)));
        setDeploymentError(undefined);
      } catch (error) {
        setDeploymentError(message(error));
      }
    }),

    /** Saves the draft with a deployment target and shape through Fabric. */
    saveDraft: (deploymentTarget: string, deploymentShape: DeploymentShape) => run(async () => {
      if (!client.saveDraft) throw new Error("This client cannot save drafts.");
      const response = await client.saveDraft({
        tenantId, assemblyId, targetApplicationName: assembly?.targetApplicationName ?? assemblyId, needsId: readySession?.needsId ?? "",
        deploymentTarget, deploymentShape,
        ...(readySession?.currentCandidateId === undefined ? {} : { currentCandidateId: readySession.currentCandidateId }),
        sceneRevision: readySession?.sceneRevision ?? 0
      });
      setAssembly(response.assembly);
      setStatus(`Draft ${response.status.toLowerCase()} for ${response.assembly.defaultDeploymentTarget} using ${response.assembly.deploymentShape}.`);
    }),

    /** Downloads Fabric's assembly snapshot. */
    saveSnapshot: () => run(async () => {
      if (!client.saveAssemblySnapshot) throw new Error("This client cannot save assembly snapshots.");
      const snapshot = await client.saveAssemblySnapshot({ tenantId, assemblyId });
      downloadJson(`assembly-${safeFilePart(snapshot.tenantId)}-${safeFilePart(snapshot.assemblyId)}.json`, snapshot);
      setStatus(`Assembly snapshot saved for ${snapshot.assemblyId}.`);
    }),

    /** Loads an assembly snapshot through Fabric; returns Fabric's layout for the workbench to restore. */
    loadSnapshot: (file: File, applyLayout: (layout: StudioAssemblySnapshot["layout"]) => void) => run(async () => {
      if (!client.loadAssemblySnapshot) throw new Error("This client cannot load assembly snapshots.");
      const input = JSON.parse(await file.text()) as StudioAssemblySnapshot;
      const snapshot = await client.loadAssemblySnapshot({ tenantId, assemblyId, snapshot: input });
      // The open session is replaced: no compile or resolution of the previous one may survive (§4.3 rule 6).
      clearDerivedResults();
      applyLayout(snapshot.layout);
      // Fabric removes the assembly's existing sessions on import, so a snapshot without one leaves no open session:
      // the removed session and its inventory are cleared, and no command can target it (§4.3 rule 6).
      const session = snapshot.sessions[0];
      if (session) {
        setState({ status: "READY", session, history: createIntentHistory(session.sceneRevision) });
        setDraftComponents(draftComponentsFromSession(session));
      } else {
        setState(undefined);
        setDraftComponents([]);
      }
      clearPreview();
      onSelect(substrateSelection);
      setStatus(`Assembly snapshot loaded for ${snapshot.assemblyId}.`);
    }),

    /** Folds an accepted authoring proposal's deployment policy into the planner; applies no intent. */
    applyAuthoringPolicy: (proposal: { readonly deploymentPolicy?: DeploymentPolicyDraft }) => {
      const policy = proposal.deploymentPolicy;
      if (!policy) return;
      setPlanner(current => ({
        ...current,
        preferredShapes: policy.preferredShapes,
        disallowedShapes: policy.disallowedShapes,
        requireIsolationForCapabilityPatterns: policy.requireIsolationForCapabilityPatterns,
        runtime: policy.runtime
      }));
    },

    /** Mirrors the authoring intents Fabric accepted into the inventory. */
    applyAuthoringInventory: (proposal: AuthoringProposal, appliedIntentCount: number) => {
      setDraftComponents(current => replayDraftInventoryIntents(current ?? [], proposal.intents.slice(0, appliedIntentCount)));
    },

    /** Seeds the authoring panel with one action context; the panel asks before proposing intents. */
    ask: (seed: Omit<AuthoringPromptSeed, "id">) => {
      seedCounter.current += 1;
      setAuthoringSeed({ ...seed, id: seedCounter.current });
    }
  };

  const data: WorkbenchData = {
    ...(readySession ? { session: readySession } : {}),
    ...(displayProjection ? { projection: displayProjection } : {}),
    ...(projectionView.error ? { projectionError: projectionView.error } : {}),
    ...(projectionView.outOfDate ? { projectionOutOfDate: projectionView.outOfDate } : {}),
    ...(compileResult ? { compile: compileResult } : {}),
    ...(deployment ? { deployment } : {}),
    ...(deploymentError ? { deploymentError } : {}),
    deploymentPolicy,
    ...(assembly ? { assembly } : {}),
    signingRequested: sign
  };

  return {
    tenantId, assemblyId, busy, state, readySession, data,
    catalog: { entries: catalog, files: catalogFiles, selectedFileId: selectedCatalogFileId, error: catalogError, knownIds: knownCatalogEntryIds, baseCatalogHash },
    selectCatalogFile: setSelectedCatalogFileId,
    draftComponents,
    replacement: { candidates: replacementCandidates, error: replacementError, selectedEntryId: replacementEntryId, select: setReplacementEntryId },
    preview, planner, setPlanner, sign, setSign, syncError, status, commandError, authoringSeed, commands,
    /** Adopts a state the authoring panel produced by applying Fabric-validated intents itself. */
    adoptState: setState
  };
}

/** The type the workbench regions read. */
export type WorkbenchComposition = ReturnType<typeof useWorkbenchComposition>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
