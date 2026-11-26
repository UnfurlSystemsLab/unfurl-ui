import type { StudioOverlay, StudioViewpoint } from "@unfurl/fabric-validation-client";
import { signingHandoffFromCompile } from "../signingHandoff.js";
import { overlayTitle } from "./viewState.js";
import type { Fact, ViewModel } from "./projectors.js";
import { NOT_YET_PROVIDED_BY_FABRIC, type Availability } from "./views.js";
import type { EmitPlanResponse, OverlayAnnotationsResponse } from "@unfurl/fabric-validation-client";
import { runtimeBindingsByNode } from "./projectors.js";
import { currentEmitPlan, currentOverlay, isCurrent, staleMessage, type WorkbenchData } from "./workbenchData.js";

/** One annotation on an element the view already contains: a badge, styling hint and its source (LLD §4.3 rule 1). */
export type OverlayAnnotation = {
  readonly elementId: string;
  readonly label: string;
  readonly detail: string;
  readonly severity: "INFO" | "WARNING" | "ERROR";
  readonly source: string;
};

/** The inspector section an overlay contributes. */
/**
 * The inspector section an overlay contributes. `facts` are what the overlay found; `notes` say why a source has nothing
 * to add (for example "choose a deployment environment"). Notes are shown but never make an overlay available, so an
 * overlay with notes alone is never drawn as a layer (§4.3 rule 3).
 */
export type OverlaySection = {
  readonly title: string;
  readonly facts: readonly Fact[];
  readonly notes?: readonly Fact[];
};

export type OverlayResult =
  | { readonly overlay: StudioOverlay; readonly available: true; readonly annotations: readonly OverlayAnnotation[]; readonly section: OverlaySection }
  | { readonly overlay: StudioOverlay; readonly available: false; readonly reasonCode: string; readonly message: string };

/**
 * Decorator: one perspective overlay (LLD-studio-viewpoints-and-perspectives §4). It annotates the elements of the active
 * view's model and contributes an inspector section; it can never add or remove an element (§4.3 rule 1), and it never
 * gates (§4.3 rule 4): evaluating it changes no intent, no composition state and no revision.
 */
export type OverlayDefinition = {
  readonly id: StudioOverlay;
  readonly title: string;
  readonly appliesTo: readonly StudioViewpoint[];
  readonly evaluate: (model: ViewModel, data: WorkbenchData) => OverlayResult;
};

/** The identity capability whose provider makes identity part of the composition (Fabric HLD-needs-driven-identity). */
export const IDENTITY_CAPABILITY = "identity-context";
/** Fabric's planning warning for a session planned without a trust policy. */
export const TRUST_POLICY_PERMISSIVE = "TRUST_POLICY_PERMISSIVE";

const ALL_VIEWS: readonly StudioViewpoint[] = ["FLOW", "DATA", "TOPOLOGY", "RUNTIME"];

/**
 * Security & Trust, P1 (§4, §10): identity in the composition, the trust policy, Fabric's permissive-policy warning and
 * the signing state. Both paths of the optional identity component are explicit (root CLAUDE.md rule 6): with a provider
 * of `identity-context` its node is badged and the section says so; without one the section states trusted-network
 * operation and badges nothing. The signing state follows §4.3 rule 6: a compile the draft has moved past is out of date.
 */
const SECURITY: OverlayDefinition = {
  id: "SECURITY",
  title: overlayTitle("SECURITY"),
  appliesTo: ALL_VIEWS,
  evaluate(model, data) {
    if (!data.session) {
      return { overlay: "SECURITY", available: false, reasonCode: "NO_DRAFT", message: "Security & Trust reads the open draft session; start or open a draft." };
    }
    const providers = model.nodes.filter(node => node.kind === "COMPONENT"
      && node.facts.some(fact => fact.label === "Capabilities" && fact.value.split(", ").includes(IDENTITY_CAPABILITY)));
    const annotations: OverlayAnnotation[] = providers.map(node => ({
      elementId: node.id,
      label: "Identity provider",
      detail: `${node.label} provides ${IDENTITY_CAPABILITY}: callers present tokens and providers verify them.`,
      severity: "INFO",
      source: "dynamic-dcp nodes[].capabilities"
    }));
    const permissive = data.session.warnings.find(warning => warning.code === TRUST_POLICY_PERMISSIVE);
    const facts: Fact[] = [
      providers.length > 0
        ? { label: "Identity", value: `in the composition, provided by ${providers.map(node => node.label).join(", ")}`, source: "dynamic-dcp nodes[].capabilities" }
        : { label: "Identity", value: "not in the composition: components run unauthenticated on a trusted network", source: "dynamic-dcp nodes[].capabilities" },
      // A named policy is stored on the session but Fabric does not yet apply it (LLD-fabric-studio-api, "Gap: a
      // session's trust policy is not applied"), so it is never shown as enforced.
      data.session.trustPolicyId
        ? { label: "Trust policy", value: `${data.session.trustPolicyId} (named on the session; Fabric does not apply named trust policies yet)`, source: "session.trustPolicyId" }
        : { label: "Trust policy", value: "none set", source: "session.trustPolicyId" },
      ...(permissive ? [{ label: "Warning", value: `${permissive.code}: ${permissive.message}`, source: "session.warnings[]" }] : []),
      signingFact(data),
      ...verificationFacts(data),
      ...fabricSecurityFacts(data),
      ...secretRequestFacts(data)
    ];
    // Fabric's authentication and authorization annotations (P2c), only while its answer is current.
    const fabric = currentOverlay(data, "SECURITY");
    const fabricAnnotations = fabric?.available ? fabric.annotations.map(fromFabric) : [];
    return { overlay: "SECURITY", available: true, annotations: [...annotations, ...fabricAnnotations],
      section: { title: overlayTitle("SECURITY"), facts } };
  }
};

/** The signing state, from the current compile only. */
function signingFact(data: WorkbenchData): Fact {
  if (!data.compile) {
    return { label: "Signing", value: data.signingRequested ? "requested; compile to sign" : "not compiled", source: "compile response" };
  }
  if (!isCurrent(data.compile, data)) {
    return { label: "Signing", value: staleMessage("the compiled contract", data.compile, data, "Compile again."), source: "compile response" };
  }
  const handoff = signingHandoffFromCompile(data.compile.response, { signingRequested: data.signingRequested });
  const value = handoff.status === "SIGNED"
    ? `SIGNED (sha256 ${handoff.sha256})`
    : handoff.status === "UNSIGNED_READY"
      ? `UNSIGNED_READY: ${handoff.message}`
      : handoff.status === "REQUEST_SIGNED_COMPILE" ? handoff.message : `unavailable: ${handoff.reason}`;
  return { label: "Signing", value, source: "compile response signedContractArtifact" };
}

/**
 * The verification Fabric answered, only while it is current (§4.3 rule 6): a result for an earlier revision, session or
 * policy is left out, and the compile panel names it as out of date. An unavailable result shows Fabric's reason.
 */
function verificationFacts(data: WorkbenchData): readonly Fact[] {
  if (!data.verification || !isCurrent(data.verification, data)) return [];
  const result = data.verification.response;
  if (!result.available) {
    return [{ label: "Verification", value: `${result.absentReason?.code ?? "UNAVAILABLE"}: ${result.absentReason?.message ?? ""}`, source: "verify absentReason" }];
  }
  const signature = result.signature;
  const drift = result.catalogDrift;
  return [{
    label: "Verification",
    value: `${result.overallOk ? "verified" : "not verified"}: signature ${signature?.result ?? "unknown"}; catalog ${drift?.clean ? "clean" : "drifted"}`,
    source: "verify signature, catalogDrift"
  }];
}

/**
 * The emit plan the overlays' runtime facts read (P2d), or why there is none: no environment chosen, loading, failed,
 * out of date, or Fabric's absent reason. Only a current, available plan is returned (§4.3 rule 6).
 */
export function emitPlanStatus(data: WorkbenchData): { readonly plan: EmitPlanResponse } | { readonly why: string } {
  if (data.environment === undefined) return { why: "choose a deployment environment in Substrate & Topology" };
  const plan = currentEmitPlan(data);
  if (plan) {
    return plan.available ? { plan } : { why: `${plan.absentReason?.code ?? "UNAVAILABLE"}: ${plan.absentReason?.message ?? ""}` };
  }
  if (data.emitPlanError) return { why: `the emit plan could not be loaded: ${data.emitPlanError}` };
  if (data.emitPlan) return { why: staleMessage("the emit plan", data.emitPlan, data, "It is being asked for again.") };
  return { why: `loading the emit plan for ${data.environment}` };
}

/**
 * Security & Trust's secret requests from the current emit plan (P2d): each by name, bound component and store hint,
 * never a value; or why they are not known.
 */
function secretRequestFacts(data: WorkbenchData): readonly Fact[] {
  const status = emitPlanStatus(data);
  if (!("plan" in status)) return [{ label: "Secret requests", value: status.why, source: "emit-plan requiredSecrets" }];
  if (status.plan.requiredSecrets.length === 0) {
    return [{ label: "Secret requests", value: `none: ${status.plan.environment} needs no secret`, source: "emit-plan requiredSecrets" }];
  }
  return status.plan.requiredSecrets.map(secret => ({
    label: `Secret ${secret.name}`,
    value: `bound to ${secret.boundComponentId}, store hint ${secret.targetStoreHint}`,
    source: "emit-plan requiredSecrets[]"
  }));
}

/**
 * The runtime facts an overlay adds from the current emit plan's bindings (P2d), one annotation per binding on its
 * provider node, with a status line saying why there are none when no current plan exists.
 */
type RuntimeFacts = { readonly annotations: readonly OverlayAnnotation[]; readonly status?: Fact };

/** Performance & Load's runtime facts: the `runtime_policy.timeout_ms` each binding sets. */
function runtimeTimeouts(data: WorkbenchData): RuntimeFacts {
  const status = emitPlanStatus(data);
  if (!("plan" in status)) return { annotations: [], status: { label: "Runtime timeouts", value: status.why, source: "emit-plan runtimeBindings" } };
  const annotations: OverlayAnnotation[] = [];
  runtimeBindingsByNode(data).forEach((bindings, nodeId) => bindings.forEach(binding => {
    if (binding.timeoutMs === undefined) return;
    annotations.push({ elementId: nodeId, label: `runtime timeout ${binding.timeoutMs} ms`, severity: "INFO",
      detail: `${binding.capability} is bound with runtime_policy.timeout_ms ${binding.timeoutMs} in environment ${status.plan.environment}`,
      source: "emit-plan runtimeBindings[].timeoutMs" });
  }));
  return { annotations };
}

/** Compliance & Governance's runtime facts: whether each binding enables audit (`runtime_policy.audit_enabled`). */
function runtimeAudit(data: WorkbenchData): RuntimeFacts {
  const status = emitPlanStatus(data);
  if (!("plan" in status)) return { annotations: [], status: { label: "Runtime audit", value: status.why, source: "emit-plan runtimeBindings" } };
  const annotations: OverlayAnnotation[] = [];
  runtimeBindingsByNode(data).forEach((bindings, nodeId) => bindings.forEach(binding => annotations.push({
    elementId: nodeId, label: binding.auditEnabled ? "audit enabled" : "audit disabled",
    severity: binding.auditEnabled ? "INFO" : "WARNING",
    detail: `${binding.capability} is bound with runtime_policy.audit_enabled ${binding.auditEnabled} in environment ${status.plan.environment}`,
    source: "emit-plan runtimeBindings[].auditEnabled"
  })));
  return { annotations };
}

/**
 * The facts Security & Trust adds from Fabric's answer (P2c): its findings while current, Fabric's reason when it found
 * nothing, or that the answer is loading or failed. P1's facts stand either way.
 */
function fabricSecurityFacts(data: WorkbenchData): readonly Fact[] {
  const fabric = currentOverlay(data, "SECURITY");
  if (!fabric) {
    const error = data.overlayErrors?.SECURITY;
    return [{ label: "Authentication & authorization", value: error ? `could not be loaded: ${error}` : "loading from Fabric",
      source: "overlays/security" }];
  }
  if (!fabric.available) {
    return [{ label: "Authentication & authorization", value: `${fabric.absentReason?.code ?? "UNAVAILABLE"}: ${fabric.absentReason?.message ?? ""}`,
      source: "overlays/security absentReason" }];
  }
  return findingFacts(fabric);
}

/** A Fabric annotation as a workbench annotation: the same element, label, detail, severity and source. */
function fromFabric(annotation: OverlayAnnotationsResponse["annotations"][number]): OverlayAnnotation {
  return { elementId: annotation.elementId, label: annotation.label, detail: annotation.detail,
    severity: annotation.severity, source: `overlays ${annotation.source}` };
}

/** Fabric's findings and left-out sources as inspector facts, each with its source and, if compile-derived, its record. */
function findingFacts(fabric: OverlayAnnotationsResponse): readonly Fact[] {
  return [
    ...fabric.findings.map(finding => ({
      label: finding.label,
      value: finding.sourceRevision === undefined ? finding.value : `${finding.value} (compile at revision ${finding.sourceRevision})`,
      source: `overlays/${fabric.overlay} ${finding.source}`
    })),
    ...fabric.staleSources.map(stale => ({
      label: "Left out", value: `${stale.source}: ${stale.reason.code}: ${stale.reason.message}`, source: `overlays/${fabric.overlay} staleSources`
    }))
  ];
}

/**
 * An overlay read from Fabric (P2c, P2d): Fabric's overlay answer while it is current, plus the runtime facts the current
 * emit plan's bindings give it. With neither, it is unavailable with Fabric's reason, or loading, or the request's error
 * (§4.3 rules 3 and 6); runtime facts alone make it available, with a line saying what Fabric's answer is.
 */
function fromFabricOverlay(id: "PERFORMANCE" | "COMPLIANCE", runtimeFacts: (data: WorkbenchData) => RuntimeFacts): OverlayDefinition {
  return {
    id,
    title: overlayTitle(id),
    appliesTo: ALL_VIEWS,
    evaluate(_model, data) {
      if (!data.session) {
        return { overlay: id, available: false, reasonCode: "NO_DRAFT", message: `${overlayTitle(id)} reads the open draft session; start or open a draft.` };
      }
      const runtime = runtimeFacts(data);
      const fabric = currentOverlay(data, id);
      const section = (facts: readonly Fact[], notes: readonly Fact[]) => ({ title: overlayTitle(id), facts, notes });
      if (!fabric) {
        const error = data.overlayErrors?.[id];
        const message = error
          ? `Fabric's ${overlayTitle(id)} answer could not be loaded: ${error}`
          : `Loading Fabric's ${overlayTitle(id)} answer for revision ${data.session.sceneRevision}.`;
        if (runtime.annotations.length > 0) {
          return { overlay: id, available: true, annotations: runtime.annotations,
            section: section([], [{ label: overlayTitle(id), value: message, source: `overlays/${id.toLowerCase()}` }]) };
        }
        return { overlay: id, available: false, reasonCode: error ? "OVERLAY_DATA_UNAVAILABLE" : "OVERLAY_LOADING", message };
      }
      if (!fabric.available) {
        if (runtime.annotations.length > 0) {
          return { overlay: id, available: true, annotations: runtime.annotations, section: section([], [{
            label: overlayTitle(id), value: `${fabric.absentReason?.code ?? "UNAVAILABLE"}: ${fabric.absentReason?.message ?? ""}`,
            source: `overlays/${fabric.overlay} absentReason`
          }]) };
        }
        return { overlay: id, available: false, reasonCode: fabric.absentReason?.code ?? "UNAVAILABLE", message: fabric.absentReason?.message ?? "" };
      }
      return { overlay: id, available: true, annotations: [...fabric.annotations.map(fromFabric), ...runtime.annotations],
        section: section(findingFacts(fabric), runtime.status ? [runtime.status] : []) };
    }
  };
}

/** An overlay whose data needs Fabric's P2 overlay endpoint: listed with its reason, never shown as an empty layer. */
function waitsForFabric(id: StudioOverlay, what: string): OverlayDefinition {
  return {
    id,
    title: overlayTitle(id),
    appliesTo: ALL_VIEWS,
    evaluate: () => ({
      overlay: id,
      available: false,
      reasonCode: NOT_YET_PROVIDED_BY_FABRIC,
      message: `Fabric does not provide ${what} yet; it arrives with Fabric's overlay endpoint (LLD-fabric-studio-api, Views and Overlays).`
    })
  };
}

/** Registry: the four overlays (§4), in pill order. */
export const OVERLAY_REGISTRY: readonly OverlayDefinition[] = [
  SECURITY,
  fromFabricOverlay("PERFORMANCE", runtimeTimeouts),
  waitsForFabric("RESILIENCE", "declared faults and their propagation"),
  fromFabricOverlay("COMPLIANCE", runtimeAudit)
];

/** The definition of an overlay. */
export function overlayDefinition(overlay: StudioOverlay): OverlayDefinition {
  return OVERLAY_REGISTRY.find(definition => definition.id === overlay)!;
}

/** Whether an overlay can be turned on for a view, with its reason when not (§4.1, §4.3 rule 3). */
export function overlayAvailability(overlay: StudioOverlay, model: ViewModel | undefined, data: WorkbenchData): Availability {
  const definition = overlayDefinition(overlay);
  if (!model) return { available: false, reasonCode: "VIEW_UNAVAILABLE", message: "The active view has no data to annotate." };
  if (!definition.appliesTo.includes(model.view)) {
    return { available: false, reasonCode: "NOT_APPLICABLE", message: `${definition.title} does not apply to this view.` };
  }
  // Availability is decided on the guarded result, so an overlay is never offered with nothing to show (§4.3 rule 3).
  const result = evaluateOverlays([overlay], model, data)[0]!;
  return result.available ? { available: true } : { available: false, reasonCode: result.reasonCode, message: result.message };
}

/** An overlay whose annotations all fall outside the active view and which has no inspector fact: nothing applies. */
export const NOTHING_IN_VIEW = "NOTHING_IN_VIEW";

/**
 * Guard (§4.3 rules 1 and 3): evaluates the active overlays on a model and keeps only annotations on elements the model
 * already contains, so an overlay can never introduce an element. Availability is decided after that filter: an overlay
 * left with no annotation and no inspector fact is unavailable with {@link NOTHING_IN_VIEW}, never an empty layer.
 */
export function evaluateOverlays(overlays: readonly StudioOverlay[], model: ViewModel, data: WorkbenchData): readonly OverlayResult[] {
  const ids = new Set([...model.nodes.map(node => node.id), ...model.edges.map(edge => edge.id)]);
  return overlays.map(overlay => {
    const result = overlayDefinition(overlay).evaluate(model, data);
    if (!result.available) return result;
    const annotations = result.annotations.filter(annotation => ids.has(annotation.elementId));
    if (annotations.length === 0 && result.section.facts.length === 0) {
      const dropped = result.annotations.length;
      return { overlay, available: false, reasonCode: NOTHING_IN_VIEW,
        message: `${overlayTitle(overlay)} has nothing for this view: its ${dropped} annotation${dropped === 1 ? " is" : "s are"} on elements this view does not draw.` };
    }
    return { ...result, annotations };
  });
}

/** The badges per element from the available overlay results. */
export function badgesByElement(results: readonly OverlayResult[]): ReadonlyMap<string, readonly OverlayAnnotation[]> {
  const badges = new Map<string, OverlayAnnotation[]>();
  for (const result of results) {
    if (!result.available) continue;
    for (const annotation of result.annotations) {
      badges.set(annotation.elementId, [...(badges.get(annotation.elementId) ?? []), annotation]);
    }
  }
  return badges;
}
