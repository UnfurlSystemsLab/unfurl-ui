import type { StudioRenderer, StudioViewpoint } from "@unfurl/fabric-validation-client";
import { SUPPORTED_RENDERERS, viewTitle } from "./viewState.js";
import { describeProjectionInputs, type WorkbenchData } from "./workbenchData.js";

/** Whether a view or overlay can be shown, and if not, the stable reason code and message (LLD §1 rule 2). */
export type Availability =
  | { readonly available: true }
  | { readonly available: false; readonly reasonCode: string; readonly message: string };

/**
 * Strategy: one workbench view (LLD-studio-viewpoints-and-perspectives §3). `alwaysOffered` views sit in the switcher
 * even without data and explain their state on the stage; the others appear in "More views" with their reason until
 * their data arrives.
 */
export type ViewDefinition = {
  readonly id: StudioViewpoint;
  readonly title: string;
  readonly alwaysOffered: boolean;
  readonly renderers: readonly StudioRenderer[];
  readonly availability: (data: WorkbenchData) => Availability;
};

/** The reason a view or overlay waits for Fabric's typed view and overlay endpoints (LLD §10, P2). */
export const NOT_YET_PROVIDED_BY_FABRIC = "NOT_YET_PROVIDED_BY_FABRIC";

/** Reason code of a projection request that failed for the current inputs; the stage offers Retry for it. */
export const PROJECTION_UNAVAILABLE = "PROJECTION_UNAVAILABLE";
/** Reason code while the projection for the current inputs is being loaded. */
export const PROJECTION_LOADING = "PROJECTION_LOADING";

/**
 * A draft view's data (§4.3 rule 6): the projection for the current inputs, or why it is missing. An out-of-date
 * projection (another session, revision or scope) is never drawn; the message names it, so a refresh that is slow or
 * failed never passes the previous composition off as the current one.
 */
function projectionAvailability(data: WorkbenchData): Availability {
  if (data.projection) return { available: true };
  const wanted = data.session ? `revision ${data.session.sceneRevision} of session ${data.session.sessionId}` : "the assembly";
  const outOfDate = data.projectionOutOfDate
    ? ` The last projection loaded, for ${describeProjectionInputs(data.projectionOutOfDate)}, is out of date and is not shown.` : "";
  if (data.projectionError) {
    return { available: false, reasonCode: PROJECTION_UNAVAILABLE,
      message: `Fabric's projection for ${wanted} could not be loaded: ${data.projectionError.replace(/\.$/, "")}.${outOfDate}` };
  }
  return { available: false, reasonCode: PROJECTION_LOADING, message: `Loading Fabric's projection for ${wanted}.${outOfDate}` };
}

/** A view whose data needs Fabric's P2 endpoints: listed with its reason, never shown empty. */
function waitsForFabric(what: string): (data: WorkbenchData) => Availability {
  return () => ({
    available: false,
    reasonCode: NOT_YET_PROVIDED_BY_FABRIC,
    message: `Fabric does not provide ${what} yet; it arrives with Fabric's view endpoint (LLD-fabric-studio-api, Views and Overlays).`
  });
}

/**
 * Registry: the four views, in switcher order. Flow & Composition and Substrate & Topology are always offered (§3.1,
 * §3.3); Data & State and Runtime & Telemetry are offered only when Fabric supplies their data (§3.2, §3.4), which in P1
 * it does not, so they are listed under "More views" with that reason.
 */
export const VIEW_REGISTRY: readonly ViewDefinition[] = [
  { id: "FLOW", title: viewTitle("FLOW"), alwaysOffered: true, renderers: SUPPORTED_RENDERERS.FLOW, availability: projectionAvailability },
  {
    id: "DATA", title: viewTitle("DATA"), alwaysOffered: false, renderers: SUPPORTED_RENDERERS.DATA,
    availability: waitsForFabric("owned state, owned decisions, data mappings or operation schemas")
  },
  { id: "TOPOLOGY", title: viewTitle("TOPOLOGY"), alwaysOffered: true, renderers: SUPPORTED_RENDERERS.TOPOLOGY, availability: projectionAvailability },
  {
    id: "RUNTIME", title: viewTitle("RUNTIME"), alwaysOffered: false, renderers: SUPPORTED_RENDERERS.RUNTIME,
    availability: waitsForFabric("declared monitoring, telemetry or a verification result")
  }
];

/** The definition of a view. */
export function viewDefinition(view: StudioViewpoint): ViewDefinition {
  return VIEW_REGISTRY.find(definition => definition.id === view)!;
}

/** The switcher's views and "More views"' unavailable views with their reasons (LLD §5.1). */
export function viewMenu(data: WorkbenchData): {
  readonly switcher: readonly ViewDefinition[];
  readonly more: readonly { readonly view: ViewDefinition; readonly reason: Extract<Availability, { available: false }> }[];
} {
  const switcher: ViewDefinition[] = [];
  const more: { view: ViewDefinition; reason: Extract<Availability, { available: false }> }[] = [];
  for (const view of VIEW_REGISTRY) {
    const availability = view.availability(data);
    if (view.alwaysOffered || availability.available) switcher.push(view);
    else more.push({ view, reason: availability });
  }
  return { switcher, more };
}
