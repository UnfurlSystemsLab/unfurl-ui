import type { StudioOverlay, StudioViewpoint } from "@unfurl/fabric-validation-client";
import { signingHandoffFromCompile } from "../signingHandoff.js";
import { overlayTitle } from "./viewState.js";
import type { Fact, ViewModel } from "./projectors.js";
import { NOT_YET_PROVIDED_BY_FABRIC, type Availability } from "./views.js";
import { isCurrent, staleMessage, type WorkbenchData } from "./workbenchData.js";

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
      ...verificationFacts(data)
    ];
    return { overlay: "SECURITY", available: true, annotations, section: { title: overlayTitle("SECURITY"), facts } };
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
  waitsForFabric("PERFORMANCE", "contract and runtime timeouts"),
  waitsForFabric("RESILIENCE", "declared faults and their propagation"),
  waitsForFabric("COMPLIANCE", "the decision audit, audit flags or trust policy provenance")
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
  const result = definition.evaluate(model, data);
  return result.available ? { available: true } : { available: false, reasonCode: result.reasonCode, message: result.message };
}

/**
 * Guard (§4.3 rule 1): evaluates the active overlays on a model and keeps only annotations on elements the model already
 * contains, so an overlay can never introduce an element.
 */
export function evaluateOverlays(overlays: readonly StudioOverlay[], model: ViewModel, data: WorkbenchData): readonly OverlayResult[] {
  const ids = new Set([...model.nodes.map(node => node.id), ...model.edges.map(edge => edge.id)]);
  return overlays.map(overlay => {
    const result = overlayDefinition(overlay).evaluate(model, data);
    return result.available ? { ...result, annotations: result.annotations.filter(annotation => ids.has(annotation.elementId)) } : result;
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
