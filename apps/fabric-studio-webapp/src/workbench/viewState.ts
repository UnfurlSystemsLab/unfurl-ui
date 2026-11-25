import type {
  SaveLayoutStateRequest,
  StudioLayoutMode,
  StudioLayoutState,
  StudioOverlay,
  StudioRenderer,
  StudioViewpoint
} from "@unfurl/fabric-validation-client";

/**
 * Workbench view state (LLD-studio-viewpoints-and-perspectives §6): which view, overlays, renderer and 3D layout the
 * operator is looking at. It is view state only (VC §24): it is never sent in an intent, never part of composition state,
 * and never changes a Fabric gate (LLD §1 rule 1).
 */

/** Semantic DCP zoom depth, shared by every view. */
export type SemanticZoomLevel = "PARENT_DCP" | "ASSEMBLY_DCP" | "CHILD_DCP";
/** A workbench panel a deep link can open. */
export type WorkbenchPanel = "compile" | "history";

export type StudioViewState = {
  readonly view: StudioViewpoint;
  readonly overlays: readonly StudioOverlay[];
  readonly colourOverlay?: StudioOverlay;
  readonly renderer: StudioRenderer;
  readonly layout?: StudioLayoutMode;
  readonly semanticZoomLevel: SemanticZoomLevel;
  readonly selectedSurface: string;
};

export const VIEWPOINTS: readonly StudioViewpoint[] = ["FLOW", "DATA", "TOPOLOGY", "RUNTIME"];
export const OVERLAYS: readonly StudioOverlay[] = ["SECURITY", "PERFORMANCE", "RESILIENCE", "COMPLIANCE"];
export const RENDERERS: readonly StudioRenderer[] = ["THREE_D", "TWO_D", "TABLE"];

/** The renderers each view supports, in preference order (LLD §5.2). */
export const SUPPORTED_RENDERERS: Readonly<Record<StudioViewpoint, readonly StudioRenderer[]>> = {
  FLOW: ["THREE_D", "TWO_D", "TABLE"],
  DATA: ["TWO_D", "TABLE"],
  TOPOLOGY: ["THREE_D", "TWO_D", "TABLE"],
  RUNTIME: ["TWO_D", "TABLE"]
};

/** The view state of a workbench nobody has arranged yet: Flow & Composition, 3D, assembly layout, no overlay. */
export const INITIAL_VIEW_STATE: StudioViewState = {
  view: "FLOW",
  overlays: [],
  renderer: "THREE_D",
  layout: "ASSEMBLY",
  semanticZoomLevel: "ASSEMBLY_DCP",
  selectedSurface: "substrate"
};

export type ViewStateAction =
  | { readonly type: "SELECT_VIEW"; readonly view: StudioViewpoint }
  | { readonly type: "TOGGLE_OVERLAY"; readonly overlay: StudioOverlay }
  | { readonly type: "SELECT_RENDERER"; readonly renderer: StudioRenderer }
  | { readonly type: "SELECT_LAYOUT"; readonly layout: StudioLayoutMode }
  | { readonly type: "ZOOM"; readonly level: SemanticZoomLevel }
  | { readonly type: "SELECT_SURFACE"; readonly surface: string }
  | { readonly type: "RESTORE"; readonly state: StudioViewState };

/** Whether a view has the renderer (LLD §5.2). */
export function supportsRenderer(view: StudioViewpoint, renderer: StudioRenderer): boolean {
  return SUPPORTED_RENDERERS[view].includes(renderer);
}

/**
 * Reducer (state machine): the only way view state changes. Every result keeps the invariants:
 * - the renderer exists for the view; a view switch keeps the renderer when it can, else takes the view's first
 *   supported renderer (the toggle itself never offers an unsupported one);
 * - the 3D layout exists only for 3D Flow;
 * - at most one overlay owns the colour channel; turning an overlay on gives it the colour and moves the previous owner
 *   to badges; turning the colour owner off leaves no colour owner (LLD §4.3 rule 2).
 */
export function viewStateReducer(state: StudioViewState, action: ViewStateAction): StudioViewState {
  switch (action.type) {
    case "SELECT_VIEW": {
      const renderer = supportsRenderer(action.view, state.renderer) ? state.renderer : SUPPORTED_RENDERERS[action.view][0]!;
      return normalize({ ...state, view: action.view, renderer });
    }
    case "TOGGLE_OVERLAY": {
      if (state.overlays.includes(action.overlay)) {
        const overlays = state.overlays.filter(overlay => overlay !== action.overlay);
        const { colourOverlay, ...rest } = state;
        return colourOverlay === action.overlay ? { ...rest, overlays } : { ...state, overlays };
      }
      return { ...state, overlays: [...state.overlays, action.overlay], colourOverlay: action.overlay };
    }
    case "SELECT_RENDERER":
      return supportsRenderer(state.view, action.renderer) ? normalize({ ...state, renderer: action.renderer }) : state;
    case "SELECT_LAYOUT":
      return state.view === "FLOW" && state.renderer === "THREE_D" ? { ...state, layout: action.layout } : state;
    case "ZOOM":
      return { ...state, semanticZoomLevel: action.level };
    case "SELECT_SURFACE":
      return { ...state, selectedSurface: action.surface };
    case "RESTORE":
      return normalize(action.state);
  }
}

/** Keeps the layout only for 3D Flow, defaulting it to the assembly layout there. */
function normalize(state: StudioViewState): StudioViewState {
  if (state.view === "FLOW" && state.renderer === "THREE_D") {
    return state.layout === undefined ? { ...state, layout: "ASSEMBLY" } : state;
  }
  const { layout: _layout, ...rest } = state;
  return rest;
}

/**
 * Migration of the retired five-tab value (LLD §5.4). `Validation` maps to 3D Flow with the guided-fix strip expanded.
 *
 * @returns the view state fields, or undefined for a value that was never a tab
 */
export function migrateActiveView(activeView: string):
  | { readonly view: StudioViewpoint; readonly renderer: StudioRenderer; readonly layout?: StudioLayoutMode; readonly guidedFixExpanded: boolean }
  | undefined {
  switch (activeView) {
    case "Assembly": return { view: "FLOW", renderer: "THREE_D", layout: "ASSEMBLY", guidedFixExpanded: false };
    case "Exploded": return { view: "FLOW", renderer: "THREE_D", layout: "EXPLODED", guidedFixExpanded: false };
    case "Ports": return { view: "FLOW", renderer: "TWO_D", guidedFixExpanded: false };
    case "Substrate": return { view: "TOPOLOGY", renderer: "THREE_D", guidedFixExpanded: false };
    case "Validation": return { view: "FLOW", renderer: "THREE_D", layout: "ASSEMBLY", guidedFixExpanded: true };
    default: return undefined;
  }
}

/** A restored layout: its view state, whether the guided-fix strip opens expanded, and what could not be restored. */
export type RestoredLayout = {
  readonly state: StudioViewState;
  readonly guidedFixExpanded: boolean;
  readonly notice?: string;
};

/**
 * Adapter: a stored Fabric layout as view state. A current layout carries the view state itself; an older one carries
 * only `activeView`, mapped with {@link migrateActiveView}. A value the workbench does not know keeps the default and is
 * named in the notice, never coerced silently.
 */
export function viewStateFromLayout(layout: StudioLayoutState): RestoredLayout {
  const base = {
    ...INITIAL_VIEW_STATE,
    semanticZoomLevel: validZoom(layout.semanticZoomLevel) ?? INITIAL_VIEW_STATE.semanticZoomLevel,
    selectedSurface: layout.selectedSurface || INITIAL_VIEW_STATE.selectedSurface
  };
  if (layout.activeViewpoint !== undefined && layout.renderer !== undefined) {
    const state: StudioViewState = {
      ...base,
      view: layout.activeViewpoint,
      overlays: [...(layout.activeOverlays ?? [])],
      renderer: layout.renderer,
      ...(layout.colourOverlay === undefined ? {} : { colourOverlay: layout.colourOverlay }),
      ...(layout.layout === undefined ? {} : { layout: layout.layout })
    };
    return { state: viewStateReducer(state, { type: "RESTORE", state }), guidedFixExpanded: false };
  }
  const migrated = layout.activeView === undefined ? undefined : migrateActiveView(layout.activeView);
  if (!migrated) {
    return {
      state: base,
      guidedFixExpanded: false,
      ...(layout.activeView === undefined ? {} : { notice: `Ignored the saved layout's unknown view "${layout.activeView}".` })
    };
  }
  const state: StudioViewState = {
    ...base,
    view: migrated.view,
    renderer: migrated.renderer,
    ...(migrated.layout === undefined ? {} : { layout: migrated.layout })
  };
  return { state: viewStateReducer(state, { type: "RESTORE", state }), guidedFixExpanded: migrated.guidedFixExpanded };
}

/** Adapter: the layout write for this view state; never the retired `activeView` (Fabric refuses it). */
export function layoutWriteFor(state: StudioViewState, scope: { readonly tenantId: string; readonly assemblyId: string }): SaveLayoutStateRequest {
  return {
    tenantId: scope.tenantId,
    assemblyId: scope.assemblyId,
    semanticZoomLevel: state.semanticZoomLevel,
    selectedSurface: state.selectedSurface,
    camera: {},
    annotations: [],
    activeViewpoint: state.view,
    activeOverlays: state.overlays,
    ...(state.colourOverlay === undefined ? {} : { colourOverlay: state.colourOverlay }),
    renderer: state.renderer,
    ...(state.layout === undefined ? {} : { layout: state.layout })
  };
}

const VIEW_PARAMS: Readonly<Record<string, StudioViewpoint>> = { flow: "FLOW", data: "DATA", topology: "TOPOLOGY", runtime: "RUNTIME" };
const OVERLAY_PARAMS: Readonly<Record<string, StudioOverlay>> = {
  security: "SECURITY", performance: "PERFORMANCE", resilience: "RESILIENCE", compliance: "COMPLIANCE"
};
const RENDERER_PARAMS: Readonly<Record<string, StudioRenderer>> = { "3d": "THREE_D", "2d": "TWO_D", table: "TABLE" };

/** A parsed deep link: the view state it selects, the panel it opens, and every ignored parameter or adjustment. */
export type DeepLink = {
  readonly state: StudioViewState;
  readonly panel?: WorkbenchPanel;
  readonly notices: readonly string[];
};

/**
 * Parser: `?view=&overlays=&renderer=&panel=` (LLD §5.3) over a base state. A value outside its set keeps the base value
 * and is named in a notice; an unsupported view and renderer pair keeps the view and takes its first supported renderer,
 * also with a notice. Nothing is coerced silently.
 */
export function parseDeepLink(params: URLSearchParams, base: StudioViewState = INITIAL_VIEW_STATE): DeepLink {
  const notices: string[] = [];
  let state = base;
  const view = params.get("view");
  if (view !== null) {
    const parsed = VIEW_PARAMS[view];
    if (parsed) state = viewStateReducer(state, { type: "SELECT_VIEW", view: parsed });
    else notices.push(`Ignored link parameter view=${view}.`);
  }
  const overlays = params.get("overlays");
  if (overlays !== null && overlays !== "") {
    const selected: StudioOverlay[] = [];
    for (const name of overlays.split(",")) {
      const parsed = OVERLAY_PARAMS[name.trim()];
      if (parsed && !selected.includes(parsed)) selected.push(parsed);
      else if (!parsed) notices.push(`Ignored link overlay ${name.trim()}.`);
    }
    state = { ...state, overlays: selected, ...(selected.length === 0 ? {} : { colourOverlay: selected[selected.length - 1]! }) };
    if (selected.length === 0) {
      const { colourOverlay: _colour, ...rest } = state;
      state = rest;
    }
  }
  const renderer = params.get("renderer");
  if (renderer !== null) {
    const parsed = RENDERER_PARAMS[renderer];
    if (!parsed) notices.push(`Ignored link parameter renderer=${renderer}.`);
    else if (!supportsRenderer(state.view, parsed)) {
      notices.push(`${viewTitle(state.view)} has no ${renderer} renderer; showing ${rendererTitle(state.renderer)}.`);
    } else state = viewStateReducer(state, { type: "SELECT_RENDERER", renderer: parsed });
  }
  const panel = params.get("panel");
  if (panel !== null && panel !== "compile" && panel !== "history") notices.push(`Ignored link parameter panel=${panel}.`);
  return {
    state,
    ...(panel === "compile" || panel === "history" ? { panel } : {}),
    notices
  };
}

/** Serializer: the deep-link parameters for a view state, the inverse of {@link parseDeepLink}. */
export function deepLinkParams(state: StudioViewState, panel?: WorkbenchPanel): URLSearchParams {
  const params = new URLSearchParams();
  params.set("view", keyOf(VIEW_PARAMS, state.view));
  if (state.overlays.length > 0) params.set("overlays", state.overlays.map(overlay => keyOf(OVERLAY_PARAMS, overlay)).join(","));
  params.set("renderer", keyOf(RENDERER_PARAMS, state.renderer));
  if (panel) params.set("panel", panel);
  return params;
}

/** The display title of a view. */
export function viewTitle(view: StudioViewpoint): string {
  return { FLOW: "Flow & Composition", DATA: "Data & State", TOPOLOGY: "Substrate & Topology", RUNTIME: "Runtime & Telemetry" }[view];
}

/** The display title of an overlay. */
export function overlayTitle(overlay: StudioOverlay): string {
  return {
    SECURITY: "Security & Trust", PERFORMANCE: "Performance & Load", RESILIENCE: "Resilience & Faults", COMPLIANCE: "Compliance & Governance"
  }[overlay];
}

/** The display title of a renderer. */
export function rendererTitle(renderer: StudioRenderer): string {
  return { THREE_D: "3D", TWO_D: "2D", TABLE: "Table" }[renderer];
}

function keyOf<T extends string>(map: Readonly<Record<string, T>>, value: T): string {
  return Object.entries(map).find(([, candidate]) => candidate === value)![0];
}

function validZoom(value: string): SemanticZoomLevel | undefined {
  return value === "PARENT_DCP" || value === "ASSEMBLY_DCP" || value === "CHILD_DCP" ? value : undefined;
}
