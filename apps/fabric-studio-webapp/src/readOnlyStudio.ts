import type { LoadCompositionViewRequest, StudioFabricClient } from "@unfurl/fabric-validation-client";
import type { ReadOnlyCompositionView } from "@unfurl/fabric-scene-model";
import { buildReadOnlyRenderScene, type RenderScene } from "@unfurl/three-renderer";
import { buildStudioTableView, renderStudioTableText, type StudioTableView } from "./tableView.js";

export type ReadOnlyStudioState =
  | {
      readonly status: "LOADING";
      readonly request: LoadCompositionViewRequest;
    }
  | {
      readonly status: "READY";
      readonly composition: ReadOnlyCompositionView;
      readonly table: StudioTableView;
      readonly renderScene: RenderScene;
      readonly text: string;
    }
  | {
      readonly status: "FAILED";
      readonly request: LoadCompositionViewRequest;
      readonly message: string;
    };

export function loadingReadOnlyStudio(request: LoadCompositionViewRequest): ReadOnlyStudioState {
  return { status: "LOADING", request };
}

export async function loadReadOnlyStudio(
  client: Pick<StudioFabricClient, "loadCompositionView">,
  request: LoadCompositionViewRequest
): Promise<ReadOnlyStudioState> {
  try {
    const response = await client.loadCompositionView(request);
    return readyReadOnlyStudio(response.view);
  } catch (error) {
    return {
      status: "FAILED",
      request,
      message: errorMessage(error)
    };
  }
}

export function readyReadOnlyStudio(composition: ReadOnlyCompositionView): ReadOnlyStudioState {
  const table = buildStudioTableView(composition);
  return {
    status: "READY",
    composition,
    table,
    renderScene: buildReadOnlyRenderScene(composition),
    text: renderStudioTableText(table)
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  return "unable to load composition view";
}
