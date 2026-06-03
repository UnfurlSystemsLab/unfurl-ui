import type { LoadCompositionViewRequest, StudioFabricClient } from "@unfurl/fabric-validation-client";
import type { GraphLayout, PositionedGraphLayout } from "@unfurl/graph-layout";
import type { RenderScene } from "@unfurl/three-renderer";
import { buildCatalogPalette, renderCatalogPaletteText, type CatalogPalette, type CatalogPaletteFilter } from "./catalogPalette.js";
import { buildPositionedStudioGraphView, buildStudioGraphView, renderStudioGraphText } from "./graphView.js";
import { loadReadOnlyStudio } from "./readOnlyStudio.js";
import type { StudioTableView } from "./tableView.js";

export type ReadOnlyWorkspaceRequest = {
  readonly composition: LoadCompositionViewRequest;
  readonly paletteFilter?: CatalogPaletteFilter;
};

export type ReadOnlyWorkspaceState =
  | {
      readonly status: "LOADING";
      readonly request: ReadOnlyWorkspaceRequest;
    }
  | {
      readonly status: "READY";
      readonly request: ReadOnlyWorkspaceRequest;
      readonly catalogHash: string;
      readonly palette: CatalogPalette;
      readonly paletteText: string;
      readonly table: StudioTableView;
      readonly tableText: string;
      readonly graph: GraphLayout;
      readonly positionedGraph: PositionedGraphLayout;
      readonly graphText: string;
      readonly renderScene: RenderScene;
      readonly warningCount: number;
    }
  | {
      readonly status: "FAILED";
      readonly request: ReadOnlyWorkspaceRequest;
      readonly message: string;
    };

export function loadingReadOnlyWorkspace(request: ReadOnlyWorkspaceRequest): ReadOnlyWorkspaceState {
  return { status: "LOADING", request };
}

export async function loadReadOnlyWorkspace(
  client: Pick<StudioFabricClient, "listCatalogVisuals" | "loadCompositionView">,
  request: ReadOnlyWorkspaceRequest
): Promise<ReadOnlyWorkspaceState> {
  try {
    const [catalog, studio] = await Promise.all([
      client.listCatalogVisuals(),
      loadReadOnlyStudio(client, request.composition)
    ]);

    if (studio.status !== "READY") {
      return {
        status: "FAILED",
        request,
        message: studio.status === "FAILED" ? studio.message : "composition view did not load"
      };
    }

    const palette = buildCatalogPalette(catalog.catalogHash, catalog.entries, request.paletteFilter);
    const graph = buildStudioGraphView(studio.composition);
    const positionedGraph = buildPositionedStudioGraphView(studio.composition);

    return {
      status: "READY",
      request,
      catalogHash: catalog.catalogHash,
      palette,
      paletteText: renderCatalogPaletteText(palette),
      table: studio.table,
      tableText: studio.text,
      graph,
      positionedGraph,
      graphText: renderStudioGraphText(graph),
      renderScene: studio.renderScene,
      warningCount: palette.warningCount + studio.composition.warnings.length
    };
  } catch (error) {
    return {
      status: "FAILED",
      request,
      message: errorMessage(error)
    };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  return "unable to load read-only workspace";
}
