import type {
  CompileDraftCandidateResponse,
  CreateDraftCompositionRequest,
  IntentResponse,
  StudioFabricClient,
  StudioIntent
} from "@unfurl/fabric-validation-client";
import type { StudioDraftSession } from "@unfurl/fabric-scene-model";
import {
  appendValidatedIntent,
  createIntentHistory,
  currentRevision,
  type GovernedIntentHistory
} from "./intentHistory.js";

export type DraftIntentCommand =
  | {
      readonly type: "ADD_COMPONENT";
      readonly catalogEntryId: string;
    }
  | {
      readonly type: "CONNECT";
      readonly fromPort: string;
      readonly toPort: string;
    }
  | {
      readonly type: "DISCONNECT";
      readonly pipeId: string;
    }
  | {
      readonly type: "REPLACE_COMPONENT";
      readonly oldComponentId: string;
      readonly newCatalogEntryId: string;
    };

export type DraftWorkspaceState =
  | {
      readonly status: "LOADING";
      readonly request: CreateDraftCompositionRequest;
    }
  | {
      readonly status: "READY";
      readonly session: StudioDraftSession;
      readonly history: GovernedIntentHistory;
      readonly lastResponse?: IntentResponse;
      readonly lastCompile?: CompileDraftCandidateResponse;
    }
  | {
      readonly status: "FAILED";
      readonly request?: CreateDraftCompositionRequest;
      readonly message: string;
    };

export function loadingDraftWorkspace(request: CreateDraftCompositionRequest): DraftWorkspaceState {
  return { status: "LOADING", request };
}

export async function createDraftWorkspace(
  client: Pick<StudioFabricClient, "createDraftComposition">,
  request: CreateDraftCompositionRequest
): Promise<DraftWorkspaceState> {
  try {
    const response = await client.createDraftComposition(request);
    return {
      status: "READY",
      session: response.session,
      history: createIntentHistory(response.session.sceneRevision)
    };
  } catch (error) {
    return {
      status: "FAILED",
      request,
      message: errorMessage(error)
    };
  }
}

export async function applyDraftIntent(
  client: Pick<StudioFabricClient, "applyIntent" | "getDraftSession">,
  state: DraftWorkspaceState,
  command: DraftIntentCommand
): Promise<DraftWorkspaceState> {
  if (state.status !== "READY") {
    return state;
  }

  try {
    const intent = toStudioIntent(state.session.sessionId, currentRevision(state.history), command);
    const response = await client.applyIntent(intent);

    if (response.status === "VALID") {
      const session = await client.getDraftSession(state.session.sessionId);
      return {
        status: "READY",
        session,
        history: appendValidatedIntent(state.history, intent, response),
        lastResponse: response
      };
    }

    if (response.status === "STALE_REVISION") {
      const session = await client.getDraftSession(state.session.sessionId);
      return {
        status: "READY",
        session,
        history: createIntentHistory(session.sceneRevision),
        lastResponse: response
      };
    }

    return {
      ...state,
      lastResponse: response
    };
  } catch (error) {
    return {
      status: "FAILED",
      message: errorMessage(error)
    };
  }
}

export async function compileDraftWorkspace(
  client: Pick<StudioFabricClient, "compileCandidate" | "getDraftSession">,
  state: DraftWorkspaceState,
  options?: { readonly sign?: boolean }
): Promise<DraftWorkspaceState> {
  if (state.status !== "READY") {
    return state;
  }

  try {
    const request = options?.sign === undefined ? {
      sessionId: state.session.sessionId,
      expectedRevision: currentRevision(state.history)
    } : {
      sessionId: state.session.sessionId,
      expectedRevision: currentRevision(state.history),
      sign: options?.sign
    };
    const response = await client.compileCandidate(request);

    if (response.status === "STALE_REVISION") {
      const session = await client.getDraftSession(state.session.sessionId);
      return {
        status: "READY",
        session,
        history: createIntentHistory(session.sceneRevision),
        lastCompile: response
      };
    }

    return {
      ...state,
      lastCompile: response
    };
  } catch (error) {
    return {
      status: "FAILED",
      message: errorMessage(error)
    };
  }
}

function toStudioIntent(sessionId: string, baseRevision: number, command: DraftIntentCommand): StudioIntent {
  switch (command.type) {
    case "ADD_COMPONENT":
      return { sessionId, baseRevision, type: "ADD_COMPONENT", catalogEntryId: command.catalogEntryId };
    case "CONNECT":
      return { sessionId, baseRevision, type: "CONNECT", fromPort: command.fromPort, toPort: command.toPort };
    case "DISCONNECT":
      return { sessionId, baseRevision, type: "DISCONNECT", pipeId: command.pipeId };
    case "REPLACE_COMPONENT":
      return {
        sessionId,
        baseRevision,
        type: "REPLACE_COMPONENT",
        oldComponentId: command.oldComponentId,
        newCatalogEntryId: command.newCatalogEntryId
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
  return "unable to update draft workspace";
}
