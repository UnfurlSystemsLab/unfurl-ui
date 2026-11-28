import { studioApiExampleCompileRecord, studioErrorMessage, type ContractDiffResponse, type VerifyContractResponse, type ViewProjectionResponse, type OverlayAnnotationsResponse } from "@unfurl/fabric-validation-client";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import {
  createHttpStudioFabricClient,
  createMockStudioApiFetch,
  type CompileDraftCandidateResponse,
  type DynamicDcpProjectionResponse,
  type StudioLayoutState
} from "@unfurl/fabric-validation-client";
import type { StudioDraftSession } from "@unfurl/fabric-scene-model";
import {
  deepLinkParams,
  INITIAL_VIEW_STATE,
  layoutWriteFor,
  migrateActiveView,
  OVERLAYS,
  parseDeepLink,
  SUPPORTED_RENDERERS,
  VIEWPOINTS,
  viewStateFromLayout,
  viewStateReducer,
  type StudioViewState
} from "./viewState.js";
import { PROJECTION_LOADING, PROJECTION_UNAVAILABLE, VIEW_DATA_UNAVAILABLE, viewDefinition, viewMenu } from "./views.js";
import { badgesByElement, evaluateOverlays, NOTHING_IN_VIEW, overlayAvailability, OVERLAY_REGISTRY, TRUST_POLICY_PERMISSIVE, type OverlayResult } from "./overlays.js";
import { projectCompiledContract, projectData, projectFlow, projectRuntime, projectTopology } from "./projectors.js";
import { keyedDraftComponents } from "./draftInventory.js";
import { OwnershipMatrixRenderer, TableRenderer, TwoDRenderer, sceneModeFor, viewForSceneMode } from "./renderers.js";
import {
  currentCompileRecord,
  currentResponse,
  currentOverlay,
  currentView,
  failedProjectionLoad,
  pinOverlay,
  type InputsPinned,
  pinView,
  freshness,
  isCurrent,
  pin,
  policyKey,
  projectionFor,
  projectionInputsFor,
  type ProjectionLoad,
  type WorkbenchData
} from "./workbenchData.js";
import { Workbench } from "./Workbench.js";
import { ContractDiffResult, diffBaseRevisions, VerificationResult } from "./compileRecords.js";
import { RETIRED_ROUTES, retiredRouteTarget } from "../StudioRoutes.js";
import { StudioApiError, type EmitPlanResponse, type StudioDeploymentEnvironment } from "@unfurl/fabric-validation-client";
import { currentEmitPlan, environmentKey, pinEmitPlan } from "./workbenchData.js";
import { emitPlanStatus } from "./overlays.js";
import { EmitPlanSection, EnvironmentFormFields } from "./environmentEditor.js";
import { emptyEnvironmentForm, environmentOutcome, formFromEnvironment, problemsAt, requestFromForm } from "./environments.js";

/**
 * Tests the Studio workbench (LLD-studio-viewpoints-and-perspectives Â§9): the view-state reducer, deep links and the
 * Â§5.4 migration; views and overlays with and without their data (the unavailable state always has a reason); Security &
 * Trust in both identity paths; out-of-date compile and resolution values (Â§4.3 rule 6); renderer parity; overlays that
 * never add elements or change composition state; rule-2 regressions; and the retired-route redirects.
 */

const PROJECTION: DynamicDcpProjectionResponse = {
  tenantId: "tenant-a", assemblyId: "assembly-a", compositionMode: "DYNAMIC",
  rootNodeId: "root", focusNodeId: "assembly",
  nodes: [
    { nodeId: "root", label: "Acme", dcpType: "COMPANY", level: "PARENT", capabilities: [], compatibleDescendants: [], replacementAllowed: false },
    { nodeId: "assembly", label: "Checkout", dcpType: "MODULE", level: "ASSEMBLY", parentNodeId: "root", capabilities: [], compatibleDescendants: [], replacementAllowed: false },
    { nodeId: "flow", label: "Flow", dcpType: "COMPONENT", level: "CHILD", parentNodeId: "assembly", catalogEntryId: "com.unfurl:flow:0.1.0",
      capabilities: ["workflow.execute"], compatibleDescendants: [], replacementAllowed: true },
    { nodeId: "idp", label: "Keycloak", dcpType: "COMPONENT", level: "CHILD", parentNodeId: "assembly", catalogEntryId: "com.unfurl:keycloak:0.1.0",
      capabilities: ["identity-context"], compatibleDescendants: [], replacementAllowed: false }
  ],
  edges: [{ fromNodeId: "assembly", toNodeId: "flow", relationship: "CONTAINS" }, { fromNodeId: "assembly", toNodeId: "idp", relationship: "CONTAINS" }],
  substratePorts: [{ portId: "port.kafka", capability: "substrate.events", label: "Kafka", provider: "substrate", status: "AVAILABLE" }],
  connections: [
    { sourceNodeId: "flow", sourcePortId: "identity", targetNodeId: "idp", targetPortId: "identity-context", capability: "identity-context", status: "ALLOWED", reason: "offered" },
    { sourceNodeId: "flow", sourcePortId: "events", targetNodeId: "substrate", targetPortId: "port.kafka", capability: "substrate.events", status: "ALLOWED", reason: "substrate" }
  ],
  warnings: []
};

const section = <T,>(items: readonly T[]) => ({ available: true, items });
const absentSection = (code: string, message: string) => ({ available: false, items: [], absentReason: { code, message } });
const VIEW_BASE = { tenantId: "tenant-a", assemblyId: "assembly-a", sessionId: "s1", revision: 4, diagnostics: [], diagnosticArtifacts: [] };
const SCHEMA = (name: string) => ({ path: `dcp/schemas/${name}.schema.json`, mediaType: "application/schema+json", sha256: "a".repeat(64) });
const DATA_VIEW: ViewProjectionResponse = { ...VIEW_BASE, view: "data",
  ownedState: section([{ nodeId: "flow", concern: "workflow-execution", resource: "workflow-runs", description: "Run state", sensitivity: "CONFIDENTIAL", source: "claim.domain.concerns[0].owns_state[0]" }]),
  ownedDecisions: section([{ nodeId: "flow", concern: "workflow-execution", decision: "run-admission", description: "Admits runs", authority: "EXCLUSIVE", source: "claim.domain.concerns[0].owns_decisions[0]" }]),
  operations: section([{ nodeId: "flow", capability: "workflow.execute", operation: "start", requestSchema: SCHEMA("start.request"), responseSchema: SCHEMA("start.response"), source: "claim.offers[0].documentation.operations[0]" }]),
  dataMappings: absentSection("COMPILE_REQUIRED", "no compile is recorded for session s1; compile the draft first") };
const DATA_VIEW_EMPTY: ViewProjectionResponse = { ...VIEW_BASE, view: "data",
  ownedState: absentSection("NO_OWNED_STATE_DECLARED", "no selected component's concerns declare owned state (owns_state)"),
  ownedDecisions: absentSection("NO_OWNED_DECISIONS_DECLARED", "no selected component's concerns declare owned decisions (owns_decisions)"),
  operations: absentSection("NO_OPERATIONS_DOCUMENTED", "no selected component documents its offers' operations (documentation.operations)"),
  dataMappings: absentSection("COMPILE_REQUIRED", "no compile is recorded for session s1; compile the draft first") };
const NOT_SIGNED_RESULT = { available: false, historical: false, diagnosticArtifacts: [],
  absentReason: { code: "NOT_SIGNED", message: "the compile at revision 4 was not signed; compile with signing to verify it" } };
const RUNTIME_VIEW: ViewProjectionResponse = { ...VIEW_BASE, view: "runtime",
  monitoring: section([{ nodeId: "flow", required: true, healthEndpoints: ["/health/live", "/health/ready"], readinessRequired: true, livenessRequired: true, source: "claim.integration_ports.monitoring" }]),
  telemetry: section([{ nodeId: "flow", required: false, signals: ["LOGS", "AUDIT_EVENTS"], correlationIdRequired: false, source: "claim.integration_ports.telemetry" }]),
  verification: NOT_SIGNED_RESULT };
const RUNTIME_VIEW_EMPTY: ViewProjectionResponse = { ...VIEW_BASE, view: "runtime",
  monitoring: absentSection("NO_MONITORING_DECLARED", "no selected component declares monitoring (integration_ports.monitoring)"),
  telemetry: absentSection("NO_TELEMETRY_DECLARED", "no selected component declares telemetry (integration_ports.telemetry)"),
  verification: { ...NOT_SIGNED_RESULT, absentReason: { code: "COMPILE_REQUIRED", message: "no compile is recorded" } } };
const FLOW_VIEW: ViewProjectionResponse = { ...VIEW_BASE, view: "flow",
  externalOwners: section([{ boundaryNodeId: "owner:host", owner: "host", dependency: "host.config@v1?owner=host", neededByNodeId: "flow", source: "claim.dependencies.needs[0]" }]),
  externalProtocolOffers: section([{ nodeId: "idp", capability: "identity-context", protocol: "oauth2", source: "claim.offers[0].interface.details.protocol" }]) };
const TOPOLOGY_VIEW: ViewProjectionResponse = { ...VIEW_BASE, view: "topology",
  transports: { ...section([{ childContractId: "urn:contract:flow", providerNodeId: "flow", kind: "IN_PROCESS", details: {}, source: "contract.child_contracts[0].transport" }]),
    provenance: { sourceRevision: 4, contractHash: "b".repeat(64), compiledAt: "2026-01-01T00:00:00Z" } } };

const OVERLAY_BASE = { view: "flow" as const, tenantId: "tenant-a", assemblyId: "assembly-a", sessionId: "s1", revision: 4,
  staleSources: [], diagnostics: [], diagnosticArtifacts: [] };
const PERFORMANCE_OVERLAY: OverlayAnnotationsResponse = { ...OVERLAY_BASE, overlay: "performance", available: true, findings: [],
  annotations: [{ elementId: "flow", elementKind: "NODE", kind: "TIMEOUT", severity: "INFO", label: "timeout 30000 ms",
    detail: "workflow.execute is called with a 30000 ms timeout", source: "contract.child_contracts[0].expectations.timeout_ms",
    sourceRevision: 4, contractHash: "b".repeat(64) }] };
const COMPLIANCE_OVERLAY: OverlayAnnotationsResponse = { ...OVERLAY_BASE, overlay: "compliance", available: true, annotations: [],
  findings: [{ label: "Trust policy", value: "none set: planned under the permissive policy", source: "session.trustPolicyId" }],
  staleSources: [{ source: "contract.audit", reason: { code: "COMPILE_REQUIRED", message: "no compile is recorded" } }] };
const SECURITY_OVERLAY: OverlayAnnotationsResponse = { ...OVERLAY_BASE, overlay: "security", available: true,
  annotations: [{ elementId: "flow", elementKind: "NODE", kind: "AUTHENTICATION", severity: "INFO", label: "authentication enforced",
    detail: "callers must authenticate (JWT)", source: "claim.integration_ports.authentication" }],
  findings: [{ label: "Identity", value: "in the composition: a component provides identity-context", source: "claim.offers[].capability" }] };

/** The pinned overlay answer, failing the test when Fabric's answer was refused. */
function pinnedOverlay(result: ReturnType<typeof pinOverlay>): InputsPinned<OverlayAnnotationsResponse> {
  if (result.status !== "PINNED") assert.fail(`refused: ${result.reason}`);
  return result.pinned;
}

const POLICY = { preferredShapes: [], disallowedShapes: [], requireIsolationForCapabilityPatterns: [], runtime: {} };

const RESOLVED = { status: "RESOLVED" as const, candidateId: "c", selections: [{ componentId: "com.unfurl:flow-artifact:1.0.0",
  artifactCoordinates: "com.unfurl:flow-artifact:1.0.0", capability: "workflow.execute", deploymentShape: "CONTAINERIZED_SERVICE" as const,
  requiredPorts: [], catalogEntryId: "com.unfurl:flow:0.1.0" }], warnings: [] };

function session(overrides: Partial<StudioDraftSession> = {}): StudioDraftSession {
  return { tenantId: "tenant-a", assemblyId: "assembly-a", sessionId: "s1", baseCatalogHash: "h", sceneRevision: 4, warnings: [], ...overrides };
}

/** Workbench data with overrides; an override of `undefined` removes that field (Fabric did not supply it). */
function data(overrides: { readonly [K in keyof WorkbenchData]?: WorkbenchData[K] | undefined } = {}): WorkbenchData {
  const merged: Record<string, unknown> = {
    session: session(),
    projection: PROJECTION,
    deploymentPolicy: POLICY,
    signingRequested: false,
    ...overrides
  };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return merged as WorkbenchData;
}

const COMPILED: CompileDraftCandidateResponse = {
  status: "COMPILED",
  compileRecord: studioApiExampleCompileRecord, candidateId: "cand-1",
  contractArtifact: { artifactId: "c", label: "contract", fileName: "c.yaml", sha256: "1", downloadUrl: "/c" } as never,
  substrateProfileArtifact: { artifactId: "p", label: "profile", fileName: "p.yaml", sha256: "2", downloadUrl: "/p" } as never,
  warnings: []
};

describe("view state", () => {
  it("keeps the renderer supported by the view and the layout only for 3D Flow", () => {
    let state = viewStateReducer(INITIAL_VIEW_STATE, { type: "SELECT_VIEW", view: "DATA" });
    assert.equal(state.renderer, "TWO_D", "DATA has no 3D renderer, so its first supported one is used");
    assert.equal(state.layout, undefined);
    assert.equal(viewStateReducer(state, { type: "SELECT_RENDERER", renderer: "THREE_D" }), state, "an unsupported renderer is refused");
    state = viewStateReducer(state, { type: "SELECT_VIEW", view: "FLOW" });
    assert.equal(state.renderer, "TWO_D", "a supported renderer is kept across a view switch");
    state = viewStateReducer(state, { type: "SELECT_RENDERER", renderer: "THREE_D" });
    assert.equal(state.layout, "ASSEMBLY");
    for (const view of VIEWPOINTS) {
      for (const renderer of SUPPORTED_RENDERERS[view]) {
        const next = viewStateReducer(viewStateReducer(INITIAL_VIEW_STATE, { type: "SELECT_VIEW", view }), { type: "SELECT_RENDERER", renderer });
        assert.ok(SUPPORTED_RENDERERS[next.view].includes(next.renderer));
        assert.equal(next.layout !== undefined, next.view === "FLOW" && next.renderer === "THREE_D");
      }
    }
  });

  it("gives the colour channel to the newest overlay and moves the previous owner to badges", () => {
    let state = viewStateReducer(INITIAL_VIEW_STATE, { type: "TOGGLE_OVERLAY", overlay: "SECURITY" });
    assert.equal(state.colourOverlay, "SECURITY");
    state = viewStateReducer(state, { type: "TOGGLE_OVERLAY", overlay: "COMPLIANCE" });
    assert.deepEqual(state.overlays, ["SECURITY", "COMPLIANCE"]);
    assert.equal(state.colourOverlay, "COMPLIANCE");
    state = viewStateReducer(state, { type: "TOGGLE_OVERLAY", overlay: "COMPLIANCE" });
    assert.deepEqual(state.overlays, ["SECURITY"]);
    assert.equal(state.colourOverlay, undefined, "turning the colour owner off leaves no owner");
  });

  it("maps every retired tab value (Â§5.4) and refuses an unknown one with a notice", () => {
    assert.deepEqual(migrateActiveView("Assembly"), { view: "FLOW", renderer: "THREE_D", layout: "ASSEMBLY", guidedFixExpanded: false });
    assert.deepEqual(migrateActiveView("Exploded"), { view: "FLOW", renderer: "THREE_D", layout: "EXPLODED", guidedFixExpanded: false });
    assert.deepEqual(migrateActiveView("Ports"), { view: "FLOW", renderer: "TWO_D", guidedFixExpanded: false });
    assert.deepEqual(migrateActiveView("Substrate"), { view: "TOPOLOGY", renderer: "THREE_D", guidedFixExpanded: false });
    assert.deepEqual(migrateActiveView("Validation"), { view: "FLOW", renderer: "THREE_D", layout: "ASSEMBLY", guidedFixExpanded: true });
    assert.equal(migrateActiveView("Cockpit"), undefined);

    const legacy = (activeView: string): StudioLayoutState => ({ tenantId: "t", assemblyId: "a", activeView, semanticZoomLevel: "CHILD_DCP",
      selectedSurface: "flow", camera: {}, annotations: [] });
    assert.equal(viewStateFromLayout(legacy("Substrate")).state.view, "TOPOLOGY");
    assert.equal(viewStateFromLayout(legacy("Validation")).guidedFixExpanded, true);
    assert.match(viewStateFromLayout(legacy("Cockpit")).notice ?? "", /unknown view "Cockpit"/);
    assert.equal(viewStateFromLayout(legacy("Exploded")).state.semanticZoomLevel, "CHILD_DCP");
  });

  it("writes the view state and never the retired activeView, and reads a current layout back", () => {
    const state: StudioViewState = { ...INITIAL_VIEW_STATE, view: "TOPOLOGY", renderer: "TABLE", overlays: ["SECURITY"], colourOverlay: "SECURITY", selectedSurface: "flow" };
    const { layout: _layout, ...withoutLayout } = state;
    const write = layoutWriteFor(withoutLayout, { tenantId: "t", assemblyId: "a" });
    assert.equal("activeView" in write, false);
    assert.equal(write.activeViewpoint, "TOPOLOGY");
    assert.equal(write.renderer, "TABLE");
    const read = viewStateFromLayout({ tenantId: "t", assemblyId: "a", semanticZoomLevel: "ASSEMBLY_DCP", selectedSurface: "flow", camera: {},
      annotations: [], activeViewpoint: "TOPOLOGY", activeOverlays: ["SECURITY"], colourOverlay: "SECURITY", renderer: "TABLE" });
    assert.deepEqual(read.state, withoutLayout);
  });

  it("round-trips deep links and names every ignored value", () => {
    const state: StudioViewState = { ...INITIAL_VIEW_STATE, view: "TOPOLOGY", renderer: "TWO_D", overlays: ["SECURITY", "RESILIENCE"], colourOverlay: "RESILIENCE" };
    const { layout: _layout, ...expected } = state;
    const parsed = parseDeepLink(deepLinkParams(expected, "compile"));
    assert.deepEqual(parsed.state, expected);
    assert.equal(parsed.panel, "compile");
    assert.deepEqual(parsed.notices, []);

    const odd = parseDeepLink(new URLSearchParams("view=cockpit&overlays=security,cost&renderer=4d&panel=audit"));
    assert.equal(odd.state.view, "FLOW");
    assert.deepEqual(odd.state.overlays, ["SECURITY"]);
    assert.equal(odd.notices.length, 4, odd.notices.join(" | "));
    const unsupported = parseDeepLink(new URLSearchParams("view=data&renderer=3d"));
    assert.equal(unsupported.state.view, "DATA");
    assert.equal(unsupported.state.renderer, "TWO_D");
    assert.match(unsupported.notices[0] ?? "", /no 3d renderer/);
  });
});

describe("views and overlays", () => {
  it("lists Data & State and Runtime & Telemetry under More views with their reason, never empty", () => {
    const menu = viewMenu(data());
    assert.deepEqual(menu.switcher.map(view => view.id), ["FLOW", "TOPOLOGY"]);
    assert.deepEqual(menu.more.map(entry => [entry.view.id, entry.reason.reasonCode]), [["DATA", PROJECTION_LOADING], ["RUNTIME", PROJECTION_LOADING]],
      "before Fabric answers, the views are loading, never shown empty");
    const absent = viewMenu(data({ views: { DATA: pin(session(), POLICY, DATA_VIEW_EMPTY, null), RUNTIME: pin(session(), POLICY, RUNTIME_VIEW_EMPTY, null) } }));
    assert.deepEqual(absent.more.map(entry => entry.reason.reasonCode), ["NO_OWNED_STATE_DECLARED", "NO_MONITORING_DECLARED"]);
    assert.match(absent.more[0]!.reason.message, /NO_OPERATIONS_DOCUMENTED: no selected component documents/);
    const offered = viewMenu(data({ views: { DATA: pin(session(), POLICY, DATA_VIEW, null), RUNTIME: pin(session(), POLICY, RUNTIME_VIEW, null) } }));
    assert.deepEqual(offered.switcher.map(view => view.id), ["FLOW", "DATA", "TOPOLOGY", "RUNTIME"]);
    const failed = viewMenu(data({ viewErrors: { DATA: "HTTP 503" } }));
    assert.equal(failed.more[0]!.reason.reasonCode, VIEW_DATA_UNAVAILABLE);
    const stale = viewMenu(data({ views: { DATA: pin(session({ sceneRevision: 3 }), POLICY, DATA_VIEW, null) } }));
    assert.equal(stale.more[0]!.reason.reasonCode, PROJECTION_LOADING, "another revision's data never offers the view");
    const without = viewMenu(data({ projection: undefined, projectionError: "HTTP 503" }));
    assert.deepEqual(without.switcher.map(view => view.id), ["FLOW", "TOPOLOGY"], "always-offered views stay, and explain themselves");
    const flow = without.switcher[0]!.availability(data({ projection: undefined, projectionError: "HTTP 503" }));
    assert.equal(flow.available, false);
  });

  it("regression: a projection is read only for the scope, session and revision it was loaded for (Â§4.3 rule 6)", () => {
    const at4 = projectionInputsFor("tenant-a", "assembly-a", session());
    const at5 = projectionInputsFor("tenant-a", "assembly-a", session({ sceneRevision: 5 }));
    const loaded: ProjectionLoad = { status: "LOADED", inputs: at4, response: PROJECTION };
    assert.equal(projectionFor(loaded, at4).projection, PROJECTION, "current inputs: drawn");
    for (const other of [at5, projectionInputsFor("tenant-a", "assembly-a", session({ sessionId: "s2" })),
      projectionInputsFor("tenant-a", "assembly-b", undefined), projectionInputsFor("tenant-a", "assembly-a", undefined)]) {
      const view = projectionFor(loaded, other);
      assert.equal(view.projection, undefined, "any other input: never drawn");
      assert.deepEqual(view.outOfDate, at4, "and named as out of date");
    }

    const failed = failedProjectionLoad(loaded, at5, "HTTP 503");
    assert.deepEqual(projectionFor(failed, at5), { error: "HTTP 503", outOfDate: at4 }, "a failed refresh keeps the error and names the old one");
    assert.deepEqual(projectionFor(failedProjectionLoad(failed, at5, "HTTP 504"), at5), { error: "HTTP 504", outOfDate: at4 },
      "a repeated failure still names the last projection that loaded");
    assert.deepEqual(projectionFor(failed, projectionInputsFor("tenant-a", "assembly-a", session({ sceneRevision: 6 }))), { outOfDate: at4 },
      "another request's error is not this one's");

    const flow = viewDefinition("FLOW");
    const refreshing = flow.availability(data({ projection: undefined, session: session({ sceneRevision: 5 }), projectionOutOfDate: at4 }));
    assert.ok(!refreshing.available && refreshing.reasonCode === PROJECTION_LOADING
      && /revision 5 of session s1.*session s1 at revision 4, is out of date and is not shown/.test(refreshing.message));
    const broken = flow.availability(data({ projection: undefined, projectionError: "HTTP 503", projectionOutOfDate: at4 }));
    assert.ok(!broken.available && broken.reasonCode === PROJECTION_UNAVAILABLE && /could not be loaded: HTTP 503\. The last projection/.test(broken.message));
  });

  it("shows identity when a provider of identity-context is in the composition, and the trusted-network state when not", () => {
    const withIdentity = evaluateOverlays(["SECURITY"], projectFlow(PROJECTION), data())[0]!;
    assert.ok(withIdentity.available);
    if (!withIdentity.available) return;
    assert.deepEqual(withIdentity.annotations.map(annotation => annotation.elementId), ["idp"]);
    assert.match(withIdentity.section.facts.find(fact => fact.label === "Identity")!.value, /provided by Keycloak/);

    const noIdp: DynamicDcpProjectionResponse = { ...PROJECTION, nodes: PROJECTION.nodes.filter(node => node.nodeId !== "idp") };
    const withoutIdentity = evaluateOverlays(["SECURITY"], projectFlow(noIdp), data({ projection: noIdp }))[0]!;
    assert.ok(withoutIdentity.available);
    if (!withoutIdentity.available) return;
    assert.deepEqual(withoutIdentity.annotations, []);
    assert.match(withoutIdentity.section.facts.find(fact => fact.label === "Identity")!.value, /trusted network/);
  });

  it("displays Fabric's permissive-policy warning only when the session carries it", () => {
    const permissive = data({ session: session({ warnings: [{ code: TRUST_POLICY_PERMISSIVE, message: "No trust policy is set." }] }) });
    const shown = evaluateOverlays(["SECURITY"], projectFlow(PROJECTION), permissive)[0]!;
    assert.ok(shown.available && shown.section.facts.some(fact => fact.value.startsWith(TRUST_POLICY_PERMISSIVE)));
    const governed = evaluateOverlays(["SECURITY"], projectFlow(PROJECTION), data({ session: session({ trustPolicyId: "trust-acme" }) }))[0]!;
    assert.ok(governed.available && !governed.section.facts.some(fact => fact.label === "Warning"));
    // A named policy is shown with the fact that Fabric does not apply it yet, never as enforced.
    assert.ok(governed.available && governed.section.facts.some(fact => fact.label === "Trust policy"
      && fact.value.startsWith("trust-acme") && fact.value.includes("does not apply named trust policies")));
  });

  it("reports an out-of-date compile and resolution instead of showing them as current (Â§4.3 rule 6)", () => {
    const stale = data({ compile: pin(session({ sceneRevision: 2 }), POLICY, COMPILED) });
    const security = evaluateOverlays(["SECURITY"], projectFlow(PROJECTION), stale)[0]!;
    assert.ok(security.available);
    if (!security.available) return;
    assert.match(security.section.facts.find(fact => fact.label === "Signing")!.value, /Out of date.*revision 2.*revision 4.*Compile again/);
    const current = evaluateOverlays(["SECURITY"], projectFlow(PROJECTION), data({ compile: pin(session(), POLICY, COMPILED) }))[0]!;
    assert.ok(current.available && /UNSIGNED_READY/.test(current.section.facts.find(fact => fact.label === "Signing")!.value));

    const topology = projectTopology(PROJECTION, data({ deployment: pin(session({ sceneRevision: 1 }), POLICY, RESOLVED) }));
    assert.match(topology.notes[0] ?? "", /Out of date.*Resolve again/);
    // The row keeps its Deployment shape fact, reading why it has no value; the out-of-date shape is never shown.
    assert.ok(!topology.nodes.some(node => node.facts.some(fact => fact.value === "CONTAINERIZED_SERVICE")));
    assert.equal(topology.nodes.find(node => node.id === "flow")!.facts.find(fact => fact.label === "Deployment shape")!.value,
      "not resolved: the resolution is out of date");
    const resolved = projectTopology(PROJECTION, data({ deployment: pin(session(), POLICY, RESOLVED) }));
    assert.ok(resolved.nodes.some(node => node.facts.some(fact => fact.label === "Deployment shape" && fact.value === "CONTAINERIZED_SERVICE")));
  });

  it("regression: a result from another session with the same revision is never current", () => {
    const other = pin(session({ sessionId: "s-imported" }), POLICY, COMPILED);
    assert.equal(other.revision, session().sceneRevision, "same revision, different session");
    const result = freshness(other, data());
    assert.ok(!result.current && /session s-imported; session s1 is open/.test(result.reason));
    const security = evaluateOverlays(["SECURITY"], projectFlow(PROJECTION), data({ compile: other }))[0]!;
    assert.ok(security.available && /Out of date/.test(security.section.facts.find(fact => fact.label === "Signing")!.value));
    const topology = projectTopology(PROJECTION, data({ deployment: pin(session({ sessionId: "s-imported" }), POLICY, RESOLVED) }));
    assert.ok(!topology.nodes.some(node => node.facts.some(fact => fact.value === "CONTAINERIZED_SERVICE")));
  });

  it("regression: changing the deployment policy makes earlier compile and resolution results out of date", () => {
    const resolvedWith = pin(session(), POLICY, RESOLVED);
    const changedShapes = { ...POLICY, preferredShapes: ["SPRING_BOOT_SERVICE" as const] };
    const changedRuntime = { ...POLICY, runtime: { kubernetes: true } };
    for (const policy of [changedShapes, changedRuntime]) {
      const result = freshness(resolvedWith, data({ deploymentPolicy: policy }));
      assert.ok(!result.current && /different deployment policy/.test(result.reason));
      assert.equal(isCurrent(pin(session(), POLICY, COMPILED), data({ deploymentPolicy: policy })), false);
    }
    const reordered = { runtime: {}, requireIsolationForCapabilityPatterns: [], disallowedShapes: [], preferredShapes: [] };
    assert.equal(policyKey(reordered), policyKey(POLICY), "property order is not a change");
    assert.ok(freshness(resolvedWith, data({ deploymentPolicy: reordered })).current);
    assert.notEqual(policyKey({ ...POLICY, preferredShapes: ["A" as never, "B" as never] }),
      policyKey({ ...POLICY, preferredShapes: ["B" as never, "A" as never] }), "preference order is a change");
  });

  it("reads a pinned response only while it is current", () => {
    const pinned = pin(session(), POLICY, COMPILED);
    assert.equal(currentResponse(pinned, data()), COMPILED);
    assert.equal(currentResponse(pinned, data({ deploymentPolicy: { ...POLICY, runtime: { kubernetes: true } } })), undefined);
    assert.equal(currentResponse(pinned, data({ session: undefined })), undefined);
    assert.equal(currentResponse(undefined, data()), undefined);
  });

  it("lists Performance, Resilience and Compliance as loading until Fabric answers", () => {
    const model = projectFlow(PROJECTION);
    for (const overlay of ["PERFORMANCE", "RESILIENCE", "COMPLIANCE"] as const) {
      const availability = overlayAvailability(overlay, model, data());
      assert.equal(!availability.available && availability.reasonCode, "OVERLAY_LOADING", overlay);
    }
    assert.equal(overlayAvailability("SECURITY", model, data({ session: undefined })).available, false);
  });

  it("draws Fabric's Performance annotations and Compliance findings while current, and Fabric's reasons otherwise", () => {
    const model = projectFlow(PROJECTION);
    const compiled = session({ compileRecords: [{ ...studioApiExampleCompileRecord, revision: 4, contractHash: "b".repeat(64) }] });
    const performance = evaluateOverlays(["PERFORMANCE"], model,
      data({ session: compiled, overlays: { PERFORMANCE: pin(compiled, POLICY, PERFORMANCE_OVERLAY, "b".repeat(64)) } }))[0] as OverlayResult;
    assert.ok(performance.available && performance.annotations.some(annotation => annotation.elementId === "flow" && annotation.label === "timeout 30000 ms"));
    // Before any compile, Compliance still answers: the trust-policy finding, with the decision audit left out.
    const compliance = evaluateOverlays(["COMPLIANCE"], model,
      data({ overlays: { COMPLIANCE: pin(session(), POLICY, COMPLIANCE_OVERLAY, null) } }))[0] as OverlayResult;
    assert.ok(compliance.available && compliance.section.facts.some(fact => fact.label === "Trust policy" && fact.value.startsWith("none set")));
    assert.ok(compliance.available && compliance.section.facts.some(fact => fact.label === "Left out" && fact.value.includes("COMPILE_REQUIRED")));
    // The same compile-less answer is not drawn once a compile is recorded: it no longer describes the current record.
    const outdated = overlayAvailability("COMPLIANCE", model,
      data({ session: compiled, overlays: { COMPLIANCE: pin(compiled, POLICY, COMPLIANCE_OVERLAY, null) } }));
    assert.equal(!outdated.available && outdated.reasonCode, "OVERLAY_LOADING");
    const absent = overlayAvailability("PERFORMANCE", model, data({ overlays: { PERFORMANCE: pin(session(), POLICY,
      { ...PERFORMANCE_OVERLAY, available: false, annotations: [], absentReason: { code: "COMPILE_REQUIRED", message: "no compile is recorded" } }, null) } }));
    assert.equal(!absent.available && absent.reasonCode, "COMPILE_REQUIRED");
  });

  it("adds Fabric's authentication annotations to Security & Trust in both identity paths (rule 6)", () => {
    const model = projectFlow(PROJECTION);
    for (const mode of ["enforced", "trusted network"]) {
      const answer = { ...SECURITY_OVERLAY, annotations: SECURITY_OVERLAY.annotations.map(annotation => ({ ...annotation, label: `authentication ${mode}` })) };
      const result = evaluateOverlays(["SECURITY"], model, data({ overlays: { SECURITY: pin(session(), POLICY, answer, null) } }))[0]!;
      assert.ok(result.available && result.annotations.some(annotation => annotation.label === `authentication ${mode}`), mode);
    }
    const loading = evaluateOverlays(["SECURITY"], model, data())[0]!;
    assert.ok(loading.available && loading.section.facts.some(fact => fact.label === "Authentication & authorization" && fact.value === "loading from Fabric"),
      "P1's facts stand while Fabric's answer loads");
  });

  it("keeps Security & Trust's claim-only annotations current after a compile (they read no compile record)", () => {
    const pinned = pinOverlay(session(), POLICY, "SECURITY", SECURITY_OVERLAY);
    assert.ok(pinned.status === "PINNED" && !("compileRecord" in pinned.pinned), "security is never pinned to a compile");
    const compiled = session({ compileRecords: [{ ...studioApiExampleCompileRecord, revision: 4, contractHash: "b".repeat(64) }] });
    const result = evaluateOverlays(["SECURITY"], projectFlow(PROJECTION),
      data({ session: compiled, overlays: { SECURITY: pinnedOverlay(pinned) } }))[0]!;
    assert.ok(result.available && result.annotations.some(annotation => annotation.label === "authentication enforced"));
    assert.ok(result.available && !result.section.facts.some(fact => fact.value === "loading from Fabric"));
  });

  it("pins a compile-reading overlay to the record Fabric names, even when nothing came of it", () => {
    const model = projectFlow(PROJECTION);
    const compiled = session({ compileRecords: [{ ...studioApiExampleCompileRecord, revision: 4, contractHash: "b".repeat(64) }] });
    const noTimeouts: OverlayAnnotationsResponse = { ...PERFORMANCE_OVERLAY, available: false, annotations: [],
      provenance: { sourceRevision: 4, contractHash: "b".repeat(64), compiledAt: "2026-11-26T00:00:00Z" },
      absentReason: { code: "NO_TIMEOUTS_DECLARED", message: "no child contract of the current compile sets a timeout" } };
    const pinned = pinOverlay(compiled, POLICY, "PERFORMANCE", noTimeouts);
    assert.ok(pinned.status === "PINNED" && pinned.pinned.compileRecord === "b".repeat(64));
    const shown = overlayAvailability("PERFORMANCE", model, data({ session: compiled,
      overlays: { PERFORMANCE: pinnedOverlay(pinned) } }));
    assert.equal(!shown.available && shown.reasonCode, "NO_TIMEOUTS_DECLARED", "Fabric's reason, not loading");
    const recompiled = session({ compileRecords: [...compiled.compileRecords!, { ...studioApiExampleCompileRecord, revision: 4, contractHash: "c".repeat(64) }] });
    const outdated = overlayAvailability("PERFORMANCE", model, data({ session: recompiled,
      overlays: { PERFORMANCE: pinnedOverlay(pinned) } }));
    assert.equal(!outdated.available && outdated.reasonCode, "OVERLAY_LOADING", "a later compile makes it out of date");
    const beforeCompile = pinOverlay(session(), POLICY, "COMPLIANCE", COMPLIANCE_OVERLAY);
    assert.ok(beforeCompile.status === "PINNED" && beforeCompile.pinned.compileRecord === null, "no record named: pinned to no compile");
  });

  it("offers no overlay whose annotations all fall outside the active view, and says why (rules 1 and 3)", () => {
    const model = projectFlow(PROJECTION);
    const elsewhere: OverlayAnnotationsResponse = { ...PERFORMANCE_OVERLAY,
      annotations: PERFORMANCE_OVERLAY.annotations.map(annotation => ({ ...annotation, elementId: "not-in-this-view" })) };
    const compiled = session({ compileRecords: [{ ...studioApiExampleCompileRecord, revision: 4, contractHash: "b".repeat(64) }] });
    const current = data({ session: compiled, overlays: { PERFORMANCE: pin(compiled, POLICY, elsewhere, "b".repeat(64)) } });
    const [result] = evaluateOverlays(["PERFORMANCE"], model, current);
    assert.equal(!result!.available && result!.reasonCode, NOTHING_IN_VIEW);
    const availability = overlayAvailability("PERFORMANCE", model, current);
    assert.equal(!availability.available && availability.reasonCode, NOTHING_IN_VIEW);
    assert.match(!availability.available ? availability.message : "", /its 1 annotation is on elements this view does not draw/);
  });

  it("refuses an overlay answer for another session and holds back one for a later revision", () => {
    const other = pinOverlay(session(), POLICY, "COMPLIANCE", { ...COMPLIANCE_OVERLAY, sessionId: "s-other" });
    assert.equal(other.status, "REFUSED");
    const later = pinOverlay(session({ sceneRevision: 4 }), POLICY, "COMPLIANCE", { ...COMPLIANCE_OVERLAY, revision: 5 });
    assert.ok(later.status === "PINNED" && later.newerRevision);
    assert.equal(later.status === "PINNED" && currentOverlay(data({ overlays: { COMPLIANCE: later.pinned } }), "COMPLIANCE"), undefined);
  });

  it("never adds an element and never changes composition state", () => {
    const frozen = deepFreeze(data({ compile: pin(session(), POLICY, COMPILED) }));
    for (const view of ["FLOW", "TOPOLOGY"] as const) {
      const model = view === "FLOW" ? projectFlow(PROJECTION) : projectTopology(PROJECTION, frozen);
      const ids = new Set([...model.nodes.map(node => node.id), ...model.edges.map(edge => edge.id)]);
      const results = evaluateOverlays(OVERLAYS, model, frozen);
      for (const [elementId] of badgesByElement(results)) assert.ok(ids.has(elementId), elementId);
      let state = viewStateReducer(INITIAL_VIEW_STATE, { type: "SELECT_VIEW", view });
      for (const overlay of OVERLAYS) state = viewStateReducer(state, { type: "TOGGLE_OVERLAY", overlay });
      assert.deepEqual(Object.keys(state).sort(), ["colourOverlay", "layout", "overlays", "renderer", "selectedSurface", "semanticZoomLevel", "view"]
        .filter(key => key !== "layout" || state.layout !== undefined));
    }
  });
});

describe("compile records, contract diff and verification (P2a)", () => {
  const record = (revision: number, hash: string) => ({ ...studioApiExampleCompileRecord, revision, contractHash: hash.repeat(64) });
  const provenance = (revision: number, hash: string) => ({ sourceRevision: revision, contractHash: hash.repeat(64), compiledAt: "2026-01-01T00:00:00Z" });
  const DIFF = {
    available: true, historical: false, base: provenance(2, "a"), target: provenance(4, "b"), diagnosticArtifacts: [],
    diff: { leftCanonicalHash: "a", rightCanonicalHash: "b", canonicalHashChanged: true, contractIdChanged: false,
      addedSelections: [], removedSelections: [], changedSelections: [], addedDeploymentEntries: [], removedDeploymentEntries: [],
      changedDeploymentShapes: [{ key: "flow/workflow.execute", fromShape: "CONTAINERIZED_SERVICE", toShape: "IN_PROCESS_LIBRARY", fromPorts: [], toPorts: [] }],
      substrateProfileHashChanged: false, ports: { added: [], removed: [], changed: [] } }
  } satisfies ContractDiffResponse;
  const VERIFIED = {
    available: true, historical: false, provenance: provenance(4, "b"), overallOk: true, diagnosticArtifacts: [],
    signature: { ok: true, result: "Ok", detail: "signed by key k1 with SHA256withECDSA" },
    catalogDrift: { clean: true, hashDrifts: [], missingFromCatalog: [] }
  } satisfies VerifyContractResponse;

  it("offers as a base every revision whose latest record is not the current one", () => {
    assert.deepEqual(diffBaseRevisions([]), []);
    assert.deepEqual(diffBaseRevisions([record(2, "a")]), [], "the current compile is not compared with itself");
    assert.deepEqual(diffBaseRevisions([record(2, "a"), record(4, "b"), record(4, "c")]), [2]);
    assert.deepEqual(diffBaseRevisions([record(2, "a"), record(4, "b"), record(6, "c")]), [2, 4]);
  });

  it("shows Fabric's comparison while current, labelled current or historical", () => {
    const html = renderToString(<ContractDiffResult data={data({ contractDiff: pin(session(), POLICY, DIFF) })} />);
    assert.match(html, /revision 2, contract aaaaaaaaaaaa/);
    assert.match(html, /revision 4, contract bbbbbbbbbbbb \(current\)/);
    assert.match(html, /CONTAINERIZED_SERVICE -&gt; IN_PROCESS_LIBRARY/);
    const historical = renderToString(<ContractDiffResult data={data({ contractDiff: pin(session(), POLICY, { ...DIFF, historical: true }) })} />);
    assert.match(historical, /\(historical\)/);
  });

  it("shows Fabric's absent reason as Fabric names it, and no comparison", () => {
    const stale = { available: false, historical: false, diagnosticArtifacts: [],
      absentReason: { code: "COMPILE_STALE", message: "compiled at revision 4 with a different deployment policy than the one this request names" } } satisfies ContractDiffResponse;
    const html = renderToString(<ContractDiffResult data={data({ contractDiff: pin(session(), POLICY, stale) })} />);
    assert.match(html, /COMPILE_STALE: compiled at revision 4 with a different deployment policy/);
    assert.doesNotMatch(html, /Contract hash changed/);
  });

  it("never shows an answer asked for another revision or policy as current (Â§4.3 rule 6)", () => {
    const moved = renderToString(<ContractDiffResult data={data({ contractDiff: pin(session({ sceneRevision: 3 }), POLICY, DIFF) })} />);
    assert.match(moved, /Out of date: the contract diff; it was produced at revision 3; the draft is at revision 4/);
    assert.doesNotMatch(moved, /IN_PROCESS_LIBRARY/);
    const otherPolicy = renderToString(<VerificationResult data={data({ verification: pin(session(), { ...POLICY, preferredShapes: ["CONTAINERIZED_SERVICE"] }, VERIFIED) })} />);
    assert.match(otherPolicy, /Out of date: the verification; it was produced with a different deployment policy/);
  });

  it("shows a verification with its signature and catalog, and an unsigned compile as NOT_SIGNED", () => {
    const html = renderToString(<VerificationResult data={data({ verification: pin(session(), POLICY, VERIFIED) })} />);
    assert.match(html, /Ok: signed by key k1/);
    assert.match(html, /clean/);
    assert.match(html, />verified</);
    const unsigned = { available: false, historical: false, diagnosticArtifacts: [],
      absentReason: { code: "NOT_SIGNED", message: "the compile at revision 4 was not signed; compile with signing to verify it" } } satisfies VerifyContractResponse;
    assert.match(renderToString(<VerificationResult data={data({ verification: pin(session(), POLICY, unsigned) })} />), /NOT_SIGNED: the compile at revision 4 was not signed/);
  });

  it("regression: a recompile, even at the same revision and unsigned, makes earlier answers out of date", () => {
    const signed = { ...record(4, "b"), signedEnvelopeSha256: "d".repeat(64) };
    const unsigned = record(4, "c");
    const before = session({ compileRecords: [signed] });
    const after = session({ compileRecords: [signed, unsigned] });
    const verification = pin(before, POLICY, VERIFIED, signed.contractHash);
    const diff = pin(before, POLICY, DIFF, signed.contractHash);

    assert.ok(freshness(verification, data({ session: before })).current);
    const result = freshness(verification, data({ session: after }));
    assert.equal(result.current, false);
    assert.match(result.current ? "" : result.reason, /the current compile is revision 4, contract cccccccccccc/);
    assert.match(renderToString(<VerificationResult data={data({ session: after, verification })} />), /Out of date: the verification/);
    assert.match(renderToString(<ContractDiffResult data={data({ session: after, contractDiff: diff })} />), /Out of date: the contract diff/);
    const facts = evaluateOverlays(["SECURITY"], projectFlow(PROJECTION), data({ session: after, verification }))[0]!;
    assert.ok(facts.available && !facts.section.facts.some(fact => fact.label === "Verification"));
  });

  it("an answer given before any compile is out of date once a compile is recorded", () => {
    const required = { available: false, historical: false, diagnosticArtifacts: [],
      absentReason: { code: "COMPILE_REQUIRED", message: "no compile is recorded for session s1; compile the draft first" } } satisfies VerifyContractResponse;
    const pinned = pin(session(), POLICY, required, currentCompileRecord(session()));
    assert.equal(pinned.compileRecord, null);
    assert.ok(freshness(pinned, data()).current);
    assert.equal(freshness(pinned, data({ session: session({ compileRecords: [record(4, "b")] }) })).current, false);
  });

  it("a value no compile produced is not bound to a record", () => {
    const resolved = pin(session(), POLICY, RESOLVED);
    assert.equal("compileRecord" in resolved, false);
    assert.ok(freshness(resolved, data({ session: session({ compileRecords: [record(4, "b")] }) })).current);
  });

  it("adds the verification to Security & Trust only while it is current", () => {
    const facts = (verification: WorkbenchData["verification"]) => {
      const result = evaluateOverlays(["SECURITY"], projectFlow(PROJECTION), data({ verification }))[0]!;
      return result.available ? result.section.facts.filter(fact => fact.label === "Verification") : [];
    };
    assert.deepEqual(facts(undefined), []);
    assert.equal(facts(pin(session(), POLICY, VERIFIED))[0]?.value, "verified: signature Ok; catalog clean");
    assert.deepEqual(facts(pin(session({ sceneRevision: 1 }), POLICY, VERIFIED)), [], "an out-of-date verification is left out");
  });
});

describe("typed views (P2b)", () => {
  it("projects Data & State: owners, owned resources and decisions joined by labelled edges, operations as facts", () => {
    const model = projectData(PROJECTION, DATA_VIEW);
    assert.deepEqual(model.nodes.map(node => [node.id, node.kind]), [
      ["flow", "COMPONENT"], ["state:flow:workflow-runs", "OWNED_STATE"], ["decision:flow:run-admission", "OWNED_DECISION"]]);
    assert.deepEqual(model.edges.map(edge => [edge.kind, edge.label]), [["OWNS_STATE", "CONFIDENTIAL"], ["OWNS_DECISION", "EXCLUSIVE"]]);
    assert.ok(model.nodes[0]!.facts.some(fact => fact.label === "Operation workflow.execute/start" && fact.source.includes("documentation.operations[0]")));
    assert.match(model.notes.join(" "), /Data mappings: COMPILE_REQUIRED/);
  });

  it("draws the ownership matrix with exactly the Table's elements (renderer parity)", () => {
    const model = projectData(PROJECTION, DATA_VIEW);
    const props = { model, badges: new Map(), selectedId: "", onSelect: () => undefined };
    const matrix = renderToString(<OwnershipMatrixRenderer {...props} />);
    const table = renderToString(<TableRenderer {...props} />);
    const ids = (html: string) => new Set([...html.matchAll(/data-element-id="([^"]+)"/g)].map(match => match[1]));
    assert.deepEqual(ids(matrix), ids(table));
    assert.match(matrix, />CONFIDENTIAL</);
    assert.match(table, /owned decision/);
  });

  it("projects Runtime & Telemetry: declared ports as facts, the verification as a note", () => {
    const model = projectRuntime(PROJECTION, RUNTIME_VIEW);
    assert.deepEqual(model.nodes.map(node => node.id), ["flow"]);
    assert.ok(model.nodes[0]!.facts.some(fact => fact.label === "Health endpoints" && fact.value === "/health/live, /health/ready"));
    assert.ok(model.nodes[0]!.facts.some(fact => fact.label === "Telemetry signals" && fact.value === "LOGS, AUDIT_EVENTS"));
    assert.match(model.notes.join(" "), /Verification: NOT_SIGNED/);
  });

  it("adds external owners as boundary nodes and external-protocol offers as facts to Flow & Composition", () => {
    const model = projectFlow(PROJECTION, FLOW_VIEW);
    const owner = model.nodes.find(node => node.id === "owner:host");
    assert.equal(owner?.kind, "EXTERNAL_OWNER");
    assert.ok(model.edges.some(edge => edge.kind === "NEEDS_OWNER" && edge.from === "flow" && edge.to === "owner:host"));
    assert.ok(model.nodes.find(node => node.id === "idp")!.facts.some(fact => fact.value === "identity-context over oauth2"));
    assert.equal(projectFlow(PROJECTION).nodes.some(node => node.kind === "EXTERNAL_OWNER"), false, "without Fabric's data, nothing is added");
  });

  it("adds transports to Substrate & Topology, or notes why there are none", () => {
    const withTransports = projectTopology(PROJECTION, data(), TOPOLOGY_VIEW);
    assert.ok(withTransports.nodes.find(node => node.id === "flow")!.facts.some(fact => fact.label === "Transport" && fact.value.startsWith("IN_PROCESS")));
    const stale = projectTopology(PROJECTION, data(), { ...TOPOLOGY_VIEW, transports: { available: false, items: [],
      absentReason: { code: "COMPILE_STALE", message: "compiled at revision 3; the draft is at revision 4" } } });
    assert.match(stale.notes.join(" "), /Transports: COMPILE_STALE/);
    // Each row reads Fabric's reason in its Transport column, never a transport from the stale compile.
    assert.ok(!stale.nodes.some(node => node.facts.some(fact => fact.label === "Transport" && fact.value.startsWith("IN_PROCESS"))));
    assert.equal(stale.nodes.find(node => node.id === "flow")!.facts.find(fact => fact.label === "Transport")!.value, "COMPILE_STALE");
  });

  it("regression: an answer for a later revision than held is not drawn until the session reaches it", () => {
    const answered = { ...DATA_VIEW, revision: 5 };
    const result = pinView(session({ sceneRevision: 4 }), POLICY, "DATA", answered);
    assert.equal(result.status, "PINNED");
    if (result.status !== "PINNED") return;
    assert.equal(result.newerRevision, true, "the session is refreshed to reach the answer");
    assert.equal(result.pinned.revision, 5, "pinned to the revision Fabric answered for, not the one asked");
    assert.equal(currentView(data({ session: session({ sceneRevision: 4 }), views: { DATA: result.pinned } }), "DATA"), undefined);
    assert.ok(currentView(data({ session: session({ sceneRevision: 5 }), views: { DATA: result.pinned } }), "DATA"));
  });

  it("refuses an answer for another session or view, and pins compile sections to the record Fabric names", () => {
    const other = pinView(session(), POLICY, "DATA", { ...DATA_VIEW, sessionId: "s-other" });
    assert.equal(other.status, "REFUSED");
    assert.match(other.status === "REFUSED" ? other.reason : "", /Fabric answered for session s-other/);
    assert.equal(pinView(session(), POLICY, "DATA", { ...DATA_VIEW, view: "runtime" }).status, "REFUSED");

    const record = { ...studioApiExampleCompileRecord, revision: 4, contractHash: "b".repeat(64) };
    const answered = pinView(session({ compileRecords: [record] }), POLICY, "TOPOLOGY", TOPOLOGY_VIEW);
    assert.equal(answered.status === "PINNED" ? answered.pinned.compileRecord : "", "b".repeat(64));
    const otherRecord = session({ compileRecords: [{ ...record, contractHash: "c".repeat(64) }] });
    assert.equal(answered.status === "PINNED" && currentView(data({ session: otherRecord, views: { TOPOLOGY: answered.pinned } }), "TOPOLOGY"),
      undefined, "an answer about another compile record is not drawn");
    const flow = pinView(session(), POLICY, "FLOW", FLOW_VIEW);
    assert.equal(flow.status === "PINNED" && "compileRecord" in flow.pinned, false, "the Flow view reads no compile");
  });

  it("shows a port member the claim did not write as not declared, never as a default", () => {
    const model = projectRuntime(PROJECTION, { ...RUNTIME_VIEW,
      monitoring: section([{ nodeId: "flow", source: "claim.integration_ports.monitoring" }]),
      telemetry: section([{ nodeId: "flow", source: "claim.integration_ports.telemetry" }]) });
    const facts = model.nodes[0]!.facts;
    for (const label of ["Health endpoints", "Readiness check", "Liveness check", "Telemetry signals", "Correlation id"]) {
      assert.equal(facts.find(fact => fact.label === label)?.value, "not declared", label);
    }
  });

  it("regression: view data from before a recompile is not drawn (pinned to the compile record)", () => {
    const record = { ...studioApiExampleCompileRecord, revision: 4, contractHash: "b".repeat(64) };
    const pinned = pin(session({ compileRecords: [record] }), POLICY, DATA_VIEW, record.contractHash);
    const recompiled = session({ compileRecords: [record, { ...record, contractHash: "c".repeat(64) }] });
    assert.ok(currentView(data({ session: session({ compileRecords: [record] }), views: { DATA: pinned } }), "DATA"));
    assert.equal(currentView(data({ session: recompiled, views: { DATA: pinned } }), "DATA"), undefined);
  });
});

describe("projectors and renderers", () => {
  it("projects Flow and Topology from the draft with only Fabric's facts", () => {
    const flow = projectFlow(PROJECTION);
    assert.deepEqual(flow.nodes.map(node => node.id), ["root", "assembly", "flow", "idp"]);
    assert.ok(flow.edges.some(edge => edge.kind === "CONNECTION" && edge.status === "ALLOWED" && edge.reason === "offered"));
    assert.ok(!flow.edges.some(edge => edge.to === "substrate"), "a substrate connection belongs to Topology");
    const topology = projectTopology(PROJECTION, data());
    assert.ok(topology.nodes.some(node => node.id === "port.kafka" && node.kind === "SUBSTRATE_PORT"));
    assert.ok(topology.edges.some(edge => edge.kind === "REQUIRES_SUBSTRATE" && edge.from === "flow" && edge.to === "port.kafka"));
    assert.match(topology.notes[0] ?? "", /after Fabric resolves/);
    for (const node of [...flow.nodes, ...topology.nodes]) {
      for (const fact of node.facts) assert.ok(fact.source.length > 0, `${node.id} ${fact.label} has a source`);
    }
  });

  it("gives Topology rows this view's facts, each with its reason, and keeps identity for the Selection card (§3.3)", () => {
    const unresolved = projectTopology(PROJECTION, data());
    const flow = unresolved.nodes.find(node => node.id === "flow")!;
    assert.deepEqual(flow.facts.map(fact => [fact.label, fact.value]), [
      ["Deployment shape", "not resolved: resolve the deployment"],
      ["Required ports", "not resolved: resolve the deployment"],
      ["Transport", "loading"],
      ["Runtime binding", "no environment chosen"]
    ]);
    assert.ok(!flow.facts.some(fact => ["DCP type", "Catalog entry", "Capabilities", "Replacement", "Level"].includes(fact.label)),
      "identity is not this view's subject");
    assert.ok(flow.details!.some(fact => fact.label === "Catalog entry" && fact.value === "com.unfurl:flow:0.1.0"));
    assert.deepEqual(unresolved.nodes.find(node => node.id === "assembly")!.facts, [], "no catalog entry, no deployment facts");

    // Fabric's INVALID reason is each row's reason.
    const invalid = projectTopology(PROJECTION, data({ deployment: pin(session(), POLICY, { status: "INVALID" as const, reason: "CATALOG_ENTRY_NOT_ADMITTED",
      details: "com.unfurl:storage-s3:1.2.0 is display-only", rejectedShapes: [], reasons: [], trustRejections: [] }) }));
    assert.equal(invalid.nodes.find(node => node.id === "flow")!.facts[0]!.value, "not resolved: CATALOG_ENTRY_NOT_ADMITTED");

    // A shape is placed by the catalog entry Fabric attributes it to, never by the resolver's coordinates.
    const resolved = projectTopology(PROJECTION, data({ deployment: pin(session(), POLICY, RESOLVED) }));
    assert.equal(resolved.nodes.find(node => node.id === "flow")!.facts[0]!.value, "CONTAINERIZED_SERVICE");
    assert.equal(resolved.nodes.find(node => node.id === "idp")!.facts[0]!.value, "not resolved: Fabric selected no shape for this component");
    const unattributed = { ...RESOLVED, selections: RESOLVED.selections.map(({ catalogEntryId: _ignored, ...selection }) => selection) };
    const regression = projectTopology(PROJECTION, data({ deployment: pin(session(), POLICY, unattributed) }));
    assert.ok(!regression.nodes.some(node => node.facts.some(fact => fact.value === "CONTAINERIZED_SERVICE")),
      "a selection without a catalog entry is not guessed onto a node");
  });

  it("labels a CONTAINS edge Fabric derived from bindings, and leaves declared ones unlabelled", () => {
    const derived = { ...PROJECTION, edges: [{ fromNodeId: "assembly", toNodeId: "flow", relationship: "CONTAINS" },
      { fromNodeId: "flow", toNodeId: "idp", relationship: "CONTAINS", derivation: "DERIVED_FROM_BINDINGS" as const }] };
    const model = projectFlow(derived);
    assert.equal(model.edges.find(edge => edge.id === "CONTAINS:flow->idp")?.label, "derived from bindings");
    assert.equal(model.edges.find(edge => edge.id === "CONTAINS:assembly->flow")?.label, undefined);
    assert.match(renderToString(<TableRenderer model={model} badges={new Map()} onSelect={() => undefined} />), /CONTAINS \(derived from bindings\)/);
  });

  it("draws a resolved deployment shape in the 2D box as in the Table row", () => {
    const model = projectTopology(PROJECTION, data({ deployment: pin(session(), POLICY, RESOLVED) }));
    const props = { model, badges: new Map(), onSelect: () => undefined };
    assert.match(renderToString(<TwoDRenderer {...props} />), /Deployment shape<\/span> CONTAINERIZED_SERVICE/);
    assert.match(renderToString(<TableRenderer {...props} />), /Deployment shape(<!-- -->)?: (<!-- -->)?CONTAINERIZED_SERVICE/);
  });

  it("keys inventory rows by entry and occurrence, so a twice-added jar renders twice without a key clash (§5.7 rule 3)", () => {
    const keyed = keyedDraftComponents([{ catalogEntryId: "uploaded:events.jar" }, { catalogEntryId: "uploaded:flow.jar" }, { catalogEntryId: "uploaded:events.jar" }]);
    assert.deepEqual(keyed.map(row => row.key), ["uploaded:events.jar", "uploaded:flow.jar", "uploaded:events.jar#2"]);
  });

  it("shows Fabric's reason after the request line when a call fails", () => {
    const refused = new StudioApiError("Fabric Studio API failed: POST /studio/deployment/resolve HTTP 400 Bad Request", 400,
      { error: "DEPLOYMENT_RESOLVE_INPUTS_INVALID: deployment resolve requires ...; missing: tenantId, assemblyId" });
    assert.match(studioErrorMessage(refused), /HTTP 400 Bad Request: DEPLOYMENT_RESOLVE_INPUTS_INVALID.*missing: tenantId, assemblyId/);
    assert.equal(studioErrorMessage(new StudioApiError("HTTP 500", 500, undefined)), "HTTP 500");
    assert.equal(studioErrorMessage(new Error("offline")), "offline");
  });

  it("draws the same elements in 2D and Table (renderer parity)", () => {
    for (const model of [projectFlow(PROJECTION), projectTopology(PROJECTION, data())]) {
      const props = { model, badges: new Map(), onSelect: () => undefined };
      const twoD = elementIds(renderToString(<TwoDRenderer {...props} />));
      const table = elementIds(renderToString(<TableRenderer {...props} />));
      assert.deepEqual(twoD.nodes, table.nodes);
      assert.deepEqual(twoD.all, table.all);
    }
  });

  it("projects a supplied compiled contract into the same model", () => {
    const model = projectCompiledContract({ contractId: "urn:c", candidateId: "cand", components: [{ componentId: "flow", catalogEntryId: "e", name: "Flow",
      coordinates: "c", claimHash: "h", artifactSha256: "a", visualStatus: "NO_VISUAL_MANIFEST" }], ports: [], substrate: [{ port: "java", status: "REQUIRED", profileHash: "p" }],
      warnings: [{ code: "W", message: "m" }] });
    assert.deepEqual(model.nodes.map(node => node.id), ["flow", "substrate:java"]);
    assert.deepEqual(model.notes, ["W: m"]);
  });

  it("maps the 3D scene's modes in one adapter", () => {
    assert.equal(sceneModeFor("FLOW", "EXPLODED"), "Exploded");
    assert.equal(sceneModeFor("TOPOLOGY", undefined), "Substrate");
    assert.deepEqual(viewForSceneMode("Substrate"), { view: "TOPOLOGY" });
    assert.equal(viewForSceneMode("Unknown"), undefined);
  });
});

describe("workbench", () => {
  it("renders the regions, More views with reasons, overlay pills and the renderer toggle", () => {
    const html = renderToString(<Workbench client={client()} />);
    for (const region of ["Unfurl Studio Workbench", "Views", "Perspective overlays", "Renderer", "Catalog palette", "Inspector", "Guided fixes"]) {
      assert.match(html, new RegExp(region), region);
    }
    assert.match(html, /More views/);
    assert.match(html, /Data &amp; State/);
    assert.match(html, /Runtime &amp; Telemetry/);
    for (const overlay of ["Security &amp; Trust", "Performance &amp; Load", "Resilience &amp; Faults", "Compliance &amp; Governance"]) {
      assert.match(html, new RegExp(overlay));
    }
    assert.match(html, /Loading Fabric&#x27;s projection for the assembly/);
  });

  it("shows only values Fabric supplies (rule-2 regressions)", () => {
    const html = renderToString(<Workbench client={client()} />);
    for (const fabricated of ["Customer Runtime Substrate", "isolationPattern", "Binding Mode", "Fabric synced", "profile mode: STRICT", "Flow Orchestrator",
      "Postgres State Store", "Java 21", "All required ports satisfied", "/ 12", "Local Operator", ">DR<"]) {
      assert.doesNotMatch(html, new RegExp(fabricated.replace(/[/]/g, "\\/")), fabricated);
    }
    assert.match(html, /no draft session/);
  });

  it("opens a deep link's view state and names its ignored parameters", () => {
    const html = renderToString(<Workbench client={client()} deepLink="view=topology&renderer=table&overlays=cost" />);
    assert.match(html, /aria-selected="true"[^>]*>Substrate &amp; Topology/);
    assert.match(html, /Ignored link overlay cost/);
  });
});

describe("resilience and faults (P2e)", () => {
  const RESILIENCE_OVERLAY: OverlayAnnotationsResponse = { ...OVERLAY_BASE, overlay: "resilience", available: true,
    annotations: [
      { elementId: "flow", elementKind: "NODE", kind: "FAULT", severity: "ERROR", label: "fault workflow.execute.failed",
        detail: "RUNTIME, BLOCKING: Workflow execution failed", source: "claim.faults.emitted[workflow.execute.failed]" },
      { elementId: "CONTAINS:assembly->flow", elementKind: "EDGE", kind: "FAULT_PROPAGATION", severity: "ERROR",
        label: "blocked by workflow.execute.failed", detail: "Flow's fault leaves Checkout blocked when the parent depends on it",
        source: "claim.faults.emitted[workflow.execute.failed].propagation" },
      { elementId: "assembly", elementKind: "NODE", kind: "FAULT_PROPAGATION", severity: "ERROR",
        label: "blocked by workflow.execute.failed", detail: "Flow's fault leaves Checkout blocked when the parent depends on it",
        source: "claim.faults.emitted[workflow.execute.failed].propagation" }
    ],
    findings: [{ label: "Declared faults", value: "1 declared, 1 propagating to a parent", source: "claim.faults.emitted" }] };
  const pinned = () => pinnedOverlay(pinOverlay(session(), POLICY, "RESILIENCE", RESILIENCE_OVERLAY));

  it("draws each fault on its component and its propagation on the CONTAINS edge and the parent", () => {
    const result = evaluateOverlays(["RESILIENCE"], projectFlow(PROJECTION), data({ overlays: { RESILIENCE: pinned() } }))[0]!;
    assert.ok(result.available);
    assert.deepEqual(result.annotations.map(annotation => annotation.elementId), ["flow", "CONTAINS:assembly->flow", "assembly"]);
    assert.ok(result.section.facts.some(fact => fact.label === "Declared faults" && fact.value.startsWith("1 declared")));
  });

  it("drops the edge where the view does not draw it, and stays current after a compile (claims only)", () => {
    const topology = evaluateOverlays(["RESILIENCE"], projectTopology(PROJECTION, data()), data({ overlays: { RESILIENCE: pinned() } }))[0]!;
    assert.ok(topology.available && !topology.annotations.some(annotation => annotation.elementId.startsWith("CONTAINS:")));
    const held = pinned();
    assert.equal(held.compileRecord, undefined, "never pinned to a compile");
    const compiled = session({ compileRecords: [{ ...studioApiExampleCompileRecord, revision: 4, contractHash: "b".repeat(64) }] });
    assert.equal(currentOverlay(data({ session: compiled, overlays: { RESILIENCE: held } }), "RESILIENCE"), RESILIENCE_OVERLAY);
    const none = overlayAvailability("RESILIENCE", projectFlow(PROJECTION), data({ overlays: { RESILIENCE: pinnedOverlay(pinOverlay(session(), POLICY,
      "RESILIENCE", { ...RESILIENCE_OVERLAY, available: false, annotations: [], findings: [],
        absentReason: { code: "NO_FAULTS_DECLARED", message: "no selected component declares a fault" } })) } }));
    assert.equal(!none.available && none.reasonCode, "NO_FAULTS_DECLARED");
  });

  it("draws the annotated CONTAINS edge in 2D as a path styled by its most severe annotation", () => {
    const model = projectFlow(PROJECTION);
    const results = evaluateOverlays(["RESILIENCE"], model, data({ overlays: { RESILIENCE: pinned() } }));
    const html = renderToString(<TwoDRenderer model={model} badges={badgesByElement(results)} onSelect={() => undefined} />);
    assert.match(html, /data-element-id="CONTAINS:assembly-&gt;flow"[^>]*class="workbench-edge  annotated error"/);
    assert.match(html, /<title>blocked by workflow.execute.failed: Flow&#x27;s fault leaves Checkout blocked/);
    assert.match(html, /data-element-id="CONTAINS:assembly-&gt;idp"[^>]*class="workbench-edge  "/, "an unannotated edge is not styled");
  });
});

describe("emit plan and environments (P2d)", () => {
  const RECORD = { ...studioApiExampleCompileRecord, revision: 4, contractHash: "b".repeat(64) };
  const LOCAL: StudioDeploymentEnvironment = { name: "local", revision: 2, updatedAt: "2026-11-26T00:00:00Z", contentSha256: "a".repeat(64),
    target: { kind: "local-compose", environment: "local", options: { "image.flow": "unfurl-flow:e2e" }, credentialRefs: [] },
    bindings: { serviceBaseUrls: { "urn:unfurl:flow:runtime": "http://flow:8080" }, timeoutMs: 45000, componentConfig: [], disabledBindings: [] } };
  const PLAN: EmitPlanResponse = { tenantId: "tenant-a", assemblyId: "assembly-a", sessionId: "s1", revision: 4,
    environment: "local", environmentRevision: 2, environmentSha256: "a".repeat(64), provenance: { sourceRevision: 4, contractHash: "b".repeat(64), compiledAt: "2026-11-26T00:00:00Z" },
    available: true, targetKind: "local-compose",
    artifacts: [{ path: "compose.yaml", kind: "COMPOSE", sha256: "c".repeat(64) }],
    requiredSecrets: [{ name: "UNFURL_FOUNDRY_CREDENTIAL_KEY", boundComponentId: "foundry", targetStoreHint: "local-compose-env" }],
    runtimeBindings: [
      { bindingId: "urn:b:root", contractId: "urn:c:root", enabled: true, auditEnabled: true, secretRefNames: [], configRefNames: [] },
      { bindingId: "urn:b:flow", contractId: "urn:c:flow", capability: "workflow.execute", providerComponent: "urn:unfurl:flow:runtime",
        providerNodeId: "flow", deploymentKind: "CONTAINER", baseUrl: "http://flow:8080", enabled: true, timeoutMs: 45000,
        auditEnabled: false, telemetryNamespace: "acme", secretRefNames: ["credentials"], configRefNames: [] }
    ],
    bindingsSha256: "d".repeat(64), emitManifestSha256: "e".repeat(64), diagnosticArtifacts: [] };
  const compiled = () => session({ compileRecords: [RECORD] });
  const withPlan = (overrides: Parameters<typeof data>[0] = {}) => {
    const pinned = pinEmitPlan(compiled(), POLICY, "local", PLAN);
    assert.equal(pinned.status, "PINNED");
    return data({ session: compiled(), environments: [LOCAL], environment: "local",
      emitPlan: pinned.status === "PINNED" ? pinned.pinned : undefined, ...overrides });
  };

  it("refuses an answer for another environment or session, and pins it to the environment's name and settings", () => {
    assert.equal(pinEmitPlan(compiled(), POLICY, "staging", PLAN).status, "REFUSED");
    assert.equal(pinEmitPlan(compiled(), POLICY, "local", { ...PLAN, sessionId: "s-other" }).status, "REFUSED");
    const pinned = pinEmitPlan(compiled(), POLICY, "local", PLAN);
    assert.ok(pinned.status === "PINNED" && pinned.pinned.environment === environmentKey("local", "a".repeat(64)) && pinned.pinned.compileRecord === "b".repeat(64));
    assert.equal(currentEmitPlan(withPlan()), PLAN);
  });

  it("is out of date after choosing another environment, after a settings change, and after a new compile record (rule 6)", () => {
    assert.equal(currentEmitPlan(withPlan({ environment: "staging", environments: [LOCAL, { ...LOCAL, name: "staging" }] })), undefined);
    assert.equal(currentEmitPlan(withPlan({ environments: [{ ...LOCAL, revision: 3, contentSha256: "9".repeat(64) }] })), undefined, "changed settings");
    assert.equal(currentEmitPlan(withPlan({ environments: [{ ...LOCAL, revision: 2, contentSha256: "9".repeat(64) }] })), undefined,
      "deleted and re-created at the same revision with other settings");
    assert.equal(currentEmitPlan(withPlan({ environments: [{ ...LOCAL, revision: 3 }] })), PLAN, "a save that kept the settings keeps it current");
    assert.equal(currentEmitPlan(withPlan({ session: session({ compileRecords: [RECORD, { ...RECORD, contractHash: "f".repeat(64) }] }) })), undefined);
    const stale = withPlan({ environments: [{ ...LOCAL, contentSha256: "9".repeat(64) }] });
    assert.match(freshness(stale.emitPlan!, stale).current ? "" : (freshness(stale.emitPlan!, stale) as { reason: string }).reason, /has changed since/);
  });

  it("puts each binding on its provider node in Substrate & Topology only while the plan is current", () => {
    const facts = projectTopology(PROJECTION, withPlan()).nodes.find(node => node.id === "flow")!.facts;
    assert.ok(facts.some(fact => fact.label === "Runtime binding (workflow.execute)" && fact.value === "CONTAINER at http://flow:8080"));
    const stale = projectTopology(PROJECTION, withPlan({ environments: [{ ...LOCAL, contentSha256: "9".repeat(64) }] })).nodes.find(node => node.id === "flow")!.facts;
    assert.ok(!stale.some(fact => fact.label.startsWith("Runtime binding (")), "no binding from an out-of-date plan");
    assert.equal(stale.find(fact => fact.label === "Runtime binding")!.value, "the emit plan is out of date");
  });

  it("adds runtime timeouts, audit flags and secret-request names to the overlays while the plan is current", () => {
    const model = projectTopology(PROJECTION, withPlan());
    const current = withPlan();
    const [performance, compliance, security] = evaluateOverlays(["PERFORMANCE", "COMPLIANCE", "SECURITY"], model, current) as [OverlayResult, OverlayResult, OverlayResult];
    assert.ok(performance.available && performance.annotations.some(a => a.elementId === "flow" && a.label === "runtime timeout 45000 ms"),
      "runtime timeouts alone make Performance available, with Fabric's answer still loading as a note");
    assert.ok(compliance.available && compliance.annotations.some(a => a.elementId === "flow" && a.label === "audit disabled" && a.severity === "WARNING"));
    assert.ok(security.available && security.section.facts.some(f => f.label === "Secret UNFURL_FOUNDRY_CREDENTIAL_KEY"
      && f.value === "bound to foundry, store hint local-compose-env"));
    const none = evaluateOverlays(["PERFORMANCE"], model, data({ session: compiled() }))[0]!;
    assert.equal(!none.available && none.reasonCode, "OVERLAY_LOADING", "with no environment chosen, nothing is added");
    const status = emitPlanStatus(data());
    assert.equal("why" in status ? status.why : "", "choose a deployment environment in Substrate & Topology");
  });

  it("shows the plan with preview hashes and secret names only, Fabric's reason, or that no environment is chosen", () => {
    const html = renderToString(<EmitPlanSection data={withPlan()} />);
    assert.match(html, /compose.yaml/);
    assert.match(html, /preview hash cccccccccccc/);
    assert.match(html, /UNFURL_FOUNDRY_CREDENTIAL_KEY/);
    assert.match(html, /bound to foundry, store hint local-compose-env/);
    const refused = pinEmitPlan(compiled(), POLICY, "local", { ...PLAN, available: false, artifacts: [], requiredSecrets: [], runtimeBindings: [],
      absentReason: { code: "SERVICE_BASE_URL_MISSING", message: "urn:unfurl:foundry is served over HTTP but has no base URL" } });
    const unavailable = renderToString(<EmitPlanSection data={withPlan({ emitPlan: refused.status === "PINNED" ? refused.pinned : undefined })} />);
    assert.match(unavailable, /SERVICE_BASE_URL_MISSING: urn:unfurl:foundry is served over HTTP/);
    assert.match(renderToString(<EmitPlanSection data={data()} />), /choose a deployment environment/);
  });

  it("converts between the form and Fabric's environment, sending identity only when it is on (rule 6)", () => {
    const form = formFromEnvironment(LOCAL);
    const request = requestFromForm(form, LOCAL.revision);
    assert.deepEqual(request.target, LOCAL.target);
    assert.deepEqual(request.bindings, LOCAL.bindings);
    assert.equal(request.expectedRevision, 2);
    const withIdentity = requestFromForm({ ...form, identityOn: true, issuer: " https://idp.example ", clientCredentialsRef: "secret://idp/client",
      audiences: [{ key: "urn:unfurl:foundry", value: "foundry" }, { key: " ", value: "ignored" }] }, 2);
    assert.equal(withIdentity.bindings.identity?.issuer, "https://idp.example");
    assert.deepEqual(withIdentity.bindings.identity?.audiences, { "urn:unfurl:foundry": "foundry" });
    assert.equal(requestFromForm({ ...form, issuer: "https://idp.example" }, 2).bindings.identity, undefined, "identity off sends none");
    assert.equal(requestFromForm(emptyEnvironmentForm(), 0).target.kind, undefined, "Studio sends what was typed and checks nothing");
  });

  it("reads Fabric's refusals: problems by field path, a revision conflict, or a failure", () => {
    const problems = [{ path: "target.kind", message: "'nomad' is not an installed emitter" },
      { path: "target.options.runtimeBindingPath", message: "is generated by the emit-plan preview" },
      { path: "bindings.identity.clientCredentialsRef", message: "must be a secret:// or config:// reference" }];
    const invalid = environmentOutcome(new StudioApiError("Fabric Studio API failed: PUT x HTTP 400", 400, { code: "ENVIRONMENT_INVALID", problems }));
    assert.ok(invalid.status === "INVALID" && invalid.problems.length === 3);
    assert.deepEqual(problemsAt(problems, "bindings.identity").map(problem => problem.path), ["bindings.identity.clientCredentialsRef"]);
    const conflict = environmentOutcome(new StudioApiError("x", 409, { code: "ENVIRONMENT_REVISION_CONFLICT", error: "at revision 3", currentRevision: 3 }));
    assert.ok(conflict.status === "CONFLICT" && conflict.currentRevision === 3);
    assert.equal(environmentOutcome(new Error("network down")).status, "FAILED");
    const html = renderToString(<EnvironmentFormFields form={{ ...formFromEnvironment(LOCAL), identityOn: true }} creating={false}
      problems={[...problems, { path: "bindings.catalog", message: "unplaced" }]} onChange={() => undefined} onSave={() => undefined}
      onCancel={() => undefined} saving={false} />);
    assert.match(html, /target.kind: &#x27;nomad&#x27; is not an installed emitter/);
    assert.match(html, /bindings.identity.clientCredentialsRef: must be a secret/);
    assert.match(html, /target.options.runtimeBindingPath: is generated by the emit-plan preview/, "shown at the Options table");
    assert.match(html, /bindings.catalog: unplaced/, "a problem no field names is listed under the form");
  });
});

describe("retired routes", () => {
  it("redirect into the workbench with their view state and keep the old parameters", () => {
    assert.deepEqual(Object.keys(RETIRED_ROUTES).sort(), ["audit", "deployment-planner", "diff", "graph", "intents", "read-only", "signing"]);
    assert.equal(retiredRouteTarget("graph", "?tenantId=t1"), "/components/fabric-studio/workspace?tenantId=t1&view=flow&renderer=2d");
    assert.equal(retiredRouteTarget("graph", "?renderer=3d"), "/components/fabric-studio/workspace?renderer=3d&view=flow", "an explicit renderer is kept");
    assert.equal(retiredRouteTarget("deployment-planner", "?policy=all-shapes"), "/components/fabric-studio/workspace?policy=all-shapes&view=topology");
    assert.match(retiredRouteTarget("signing", ""), /view=flow&overlays=security&panel=compile/);
    assert.match(retiredRouteTarget("audit", ""), /overlays=compliance&panel=compile/);
    assert.match(retiredRouteTarget("intents", ""), /panel=history/);
    assert.match(retiredRouteTarget("read-only", "?contractPath=c.yaml"), /contractPath=c.yaml&view=flow&renderer=table/);
  });
});

/** The element ids a renderer drew, nodes alone and all elements. */
function elementIds(html: string): { readonly nodes: readonly string[]; readonly all: readonly string[] } {
  const all = [...html.matchAll(/data-element-id="([^"]+)"/g)].map(match => match[1]!).sort();
  return { nodes: all.filter(id => !id.includes("->") && !id.startsWith("connection:")), all };
}

function client() {
  return createHttpStudioFabricClient({ baseUrl: "http://fabric.local", fetch: createMockStudioApiFetch() });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
