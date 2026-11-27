import type { StudioRenderer, StudioViewpoint } from "@unfurl/fabric-validation-client";
import { SUPPORTED_RENDERERS, viewTitle } from "./viewState.js";
import type { StudioViewSection, ViewProjectionResponse } from "@unfurl/fabric-validation-client";
import { currentView, describeProjectionInputs, type WorkbenchData } from "./workbenchData.js";

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

/** Reason code of a view whose data request failed for the current inputs. */
export const VIEW_DATA_UNAVAILABLE = "VIEW_DATA_UNAVAILABLE";

/**
 * A view offered only when Fabric supplies its data (LLD §3.2, §3.4): available while Fabric's current view projection
 * has at least one available section; otherwise unavailable with Fabric's own reasons, while loading, or with the
 * request's error. An out-of-date projection counts as not loaded, so a previous draft's data never offers the view.
 */
function viewDataAvailability(view: "DATA" | "RUNTIME",
  sections: (response: ViewProjectionResponse) => readonly ({ readonly available: boolean; readonly absentReason?: { readonly code: string; readonly message: string } } | undefined)[]):
  (data: WorkbenchData) => Availability {
  return data => {
    if (!data.session) {
      return { available: false, reasonCode: "NO_DRAFT", message: `${viewTitle(view)} reads the open draft session; start or open a draft.` };
    }
    const response = currentView(data, view);
    if (!response) {
      const error = data.viewErrors?.[view];
      return error
        ? { available: false, reasonCode: VIEW_DATA_UNAVAILABLE, message: `Fabric's ${viewTitle(view)} data could not be loaded: ${error.replace(/\.$/, "")}.` }
        : { available: false, reasonCode: PROJECTION_LOADING, message: `Loading Fabric's ${viewTitle(view)} data for revision ${data.session.sceneRevision} of session ${data.session.sessionId}.` };
    }
    const present = sections(response).filter((section): section is NonNullable<typeof section> => section !== undefined);
    if (present.some(section => section.available)) return { available: true };
    const reasons = present.map(section => section.absentReason).filter(reason => reason !== undefined);
    return {
      available: false,
      reasonCode: reasons[0]?.code ?? "NO_VIEW_DATA",
      message: reasons.length > 0 ? reasons.map(reason => `${reason.code}: ${reason.message}`).join("; ") : `Fabric supplied no ${viewTitle(view)} data.`
    };
  };
}

/** The sections a view projection carries, in display order. */
export function dataSections(response: ViewProjectionResponse): readonly (StudioViewSection<unknown> | undefined)[] {
  return [response.ownedState, response.ownedDecisions, response.operations, response.dataMappings];
}

/**
 * Registry: the four views, in switcher order. Flow & Composition and Substrate & Topology are always offered (§3.1,
 * §3.3); Data & State and Runtime & Telemetry are offered only when Fabric's view projection has data for them (§3.2,
 * §3.4), and are otherwise listed under "More views" with Fabric's reasons.
 */
export const VIEW_REGISTRY: readonly ViewDefinition[] = [
  { id: "FLOW", title: viewTitle("FLOW"), alwaysOffered: true, renderers: SUPPORTED_RENDERERS.FLOW, availability: projectionAvailability },
  {
    id: "DATA", title: viewTitle("DATA"), alwaysOffered: false, renderers: SUPPORTED_RENDERERS.DATA,
    availability: viewDataAvailability("DATA", dataSections)
  },
  { id: "TOPOLOGY", title: viewTitle("TOPOLOGY"), alwaysOffered: true, renderers: SUPPORTED_RENDERERS.TOPOLOGY, availability: projectionAvailability },
  {
    id: "RUNTIME", title: viewTitle("RUNTIME"), alwaysOffered: false, renderers: SUPPORTED_RENDERERS.RUNTIME,
    availability: viewDataAvailability("RUNTIME", response => [response.monitoring, response.telemetry, response.verification])
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
