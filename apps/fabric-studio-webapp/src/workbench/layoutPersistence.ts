import type { StudioLayoutState } from "@unfurl/fabric-validation-client";
import { viewStateFromLayout, type RestoredLayout, type StudioViewState } from "./viewState.js";

/**
 * Repository: the browser copy of the workbench view state (LLD-studio-viewpoints-and-perspectives §6), keyed by tenant,
 * user and assembly (VC §2A rule 4). Fabric's layout is the shared copy; this one keeps an operator's arrangement when
 * Fabric's layout endpoint is unavailable. It holds view state only, never composition state, and a malformed or older
 * entry is read through the same mapping as Fabric's layout ({@link viewStateFromLayout}), never applied as is.
 */
export function readLocalViewState(tenantId: string, userId: string, assemblyId: string): RestoredLayout | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key(tenantId, userId, assemblyId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StudioLayoutState>;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return viewStateFromLayout({
      tenantId, assemblyId,
      semanticZoomLevel: typeof parsed.semanticZoomLevel === "string" ? parsed.semanticZoomLevel : "ASSEMBLY_DCP",
      selectedSurface: typeof parsed.selectedSurface === "string" ? parsed.selectedSurface : "",
      camera: {}, annotations: [],
      ...(typeof parsed.activeView === "string" ? { activeView: parsed.activeView } : {}),
      ...(isOneOf(parsed.activeViewpoint, ["FLOW", "DATA", "TOPOLOGY", "RUNTIME"]) ? { activeViewpoint: parsed.activeViewpoint } : {}),
      ...(Array.isArray(parsed.activeOverlays)
        ? { activeOverlays: parsed.activeOverlays.filter(overlay => isOneOf(overlay, ["SECURITY", "PERFORMANCE", "RESILIENCE", "COMPLIANCE"])) }
        : {}),
      ...(isOneOf(parsed.colourOverlay, ["SECURITY", "PERFORMANCE", "RESILIENCE", "COMPLIANCE"]) ? { colourOverlay: parsed.colourOverlay } : {}),
      ...(isOneOf(parsed.renderer, ["THREE_D", "TWO_D", "TABLE"]) ? { renderer: parsed.renderer } : {}),
      ...(isOneOf(parsed.layout, ["ASSEMBLY", "EXPLODED"]) ? { layout: parsed.layout } : {})
    });
  } catch {
    return undefined;
  }
}

/** Writes the browser copy in the layout shape; a storage failure is ignored, Fabric's layout is the shared copy. */
export function writeLocalViewState(tenantId: string, userId: string, assemblyId: string, state: StudioViewState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(tenantId, userId, assemblyId), JSON.stringify({
      semanticZoomLevel: state.semanticZoomLevel,
      selectedSurface: state.selectedSurface,
      activeViewpoint: state.view,
      activeOverlays: state.overlays,
      ...(state.colourOverlay === undefined ? {} : { colourOverlay: state.colourOverlay }),
      renderer: state.renderer,
      ...(state.layout === undefined ? {} : { layout: state.layout })
    }));
  } catch {
    // A browser convenience only.
  }
}

function key(tenantId: string, userId: string, assemblyId: string): string {
  return `unfurl-studio-view-state:${tenantId}:${userId}:${assemblyId}`;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}
