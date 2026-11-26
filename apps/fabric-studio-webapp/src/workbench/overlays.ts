import type { StudioOverlay, StudioViewpoint } from "@unfurl/fabric-validation-client";
import { signingHandoffFromCompile } from "../signingHandoff.js";
import { overlayTitle } from "./viewState.js";
import type { Fact, ViewModel } from "./projectors.js";
import { NOT_YET_PROVIDED_BY_FABRIC, type Availability } from "./views.js";
import type { OverlayAnnotationsResponse } from "@unfurl/fabric-validation-client";
import { currentOverlay, isCurrent, staleMessage, type WorkbenchData } from "./workbenchData.js";

/** One annotation on an element the view already contains: a badge, styling hint and its source (LLD §4.3 rule 1). */
export type OverlayAnnotation = {
  readonly elementId: string;
  readonly label: string;
  readonly detail: string;
  readonly severity: "INFO" | "WARNING" | "ERROR";
  readonly source: string;
};

/** The inspector section an overlay contributes. */
export type OverlaySection = {
  readonly title: string;
  readonly facts: readonly Fact[];
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
      ...fabricSecurityFacts(data)
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
 * An overlay read entirely from Fabric's answer (P2c): its annotations and findings while the answer is current, and
 * otherwise unavailable with Fabric's reason, or loading, or the request's error (§4.3 rules 3 and 6).
 */
function fromFabricOverlay(id: "PERFORMANCE" | "COMPLIANCE"): OverlayDefinition {
  return {
    id,
    title: overlayTitle(id),
    appliesTo: ALL_VIEWS,
    evaluate(_model, data) {
      if (!data.session) {
        return { overlay: id, available: false, reasonCode: "NO_DRAFT", message: `${overlayTitle(id)} reads the open draft session; start or open a draft.` };
      }
      const fabric = currentOverlay(data, id);
      if (!fabric) {
        const error = data.overlayErrors?.[id];
        return error
          ? { overlay: id, available: false, reasonCode: "OVERLAY_DATA_UNAVAILABLE", message: `Fabric's ${overlayTitle(id)} answer could not be loaded: ${error}` }
          : { overlay: id, available: false, reasonCode: "OVERLAY_LOADING", message: `Loading Fabric's ${overlayTitle(id)} answer for revision ${data.session.sceneRevision}.` };
      }
      if (!fabric.available) {
        return { overlay: id, available: false, reasonCode: fabric.absentReason?.code ?? "UNAVAILABLE", message: fabric.absentReason?.message ?? "" };
      }
      return { overlay: id, available: true, annotations: fabric.annotations.map(fromFabric),
        section: { title: overlayTitle(id), facts: findingFacts(fabric) } };
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
  fromFabricOverlay("PERFORMANCE"),
  waitsForFabric("RESILIENCE", "declared faults and their propagation"),
  fromFabricOverlay("COMPLIANCE")
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
