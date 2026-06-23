import type {
  AuthoringConverseRequest,
  AuthoringConverseResponse,
  AuthoringProposal,
  DeploymentPolicyDraft,
  ResolveDeploymentResponse,
  StudioFabricClient
} from "@unfurl/fabric-validation-client";
import {
  applyDraftIntent,
  compileDraftWorkspace,
  type DraftWorkspaceState
} from "./draftWorkspace.js";
import {
  buildDraftExportBundle,
  renderDraftExportText,
  type DraftExportBundle
} from "./draftExport.js";

export type AuthoringSessionState =
  | {
      readonly status: "IDLE";
      readonly conversation: readonly AuthoringConverseRequest["conversation"][number][];
    }
  | {
      readonly status: "WAITING";
      readonly conversation: readonly AuthoringConverseRequest["conversation"][number][];
    }
  | {
      readonly status: "READY";
      readonly conversation: readonly AuthoringConverseRequest["conversation"][number][];
      readonly response: AuthoringConverseResponse;
    }
  | {
      readonly status: "FAILED";
      readonly conversation: readonly AuthoringConverseRequest["conversation"][number][];
      readonly message: string;
    };

export type ApplyAuthoringProposalResult = {
  readonly state: DraftWorkspaceState;
  readonly deploymentPolicy?: DeploymentPolicyDraft | undefined;
  readonly appliedIntentCount: number;
};

export type FinalizeAuthoringProposalResult = {
  readonly state: DraftWorkspaceState;
  readonly deployment?: ResolveDeploymentResponse | undefined;
  readonly exportBundle: DraftExportBundle;
  readonly exportText: string;
};

export function initialAuthoringSession(): AuthoringSessionState {
  return { status: "IDLE", conversation: [] };
}

export async function converseAuthoring(
  client: Pick<StudioFabricClient, "converseAuthoring">,
  state: AuthoringSessionState,
  request: Omit<AuthoringConverseRequest, "conversation">
): Promise<AuthoringSessionState> {
  if (!client.converseAuthoring) {
    return {
      status: "FAILED",
      conversation: state.conversation,
      message: "Studio authoring endpoint is unavailable"
    };
  }
  const conversation = [
    ...state.conversation,
    ...(request.userMessage ? [{ role: "USER" as const, content: request.userMessage }] : [])
  ];
  try {
    const response = await client.converseAuthoring({
      ...request,
      conversation: state.conversation
    });
    return {
      status: "READY",
      conversation: [
        ...conversation,
        { role: "ASSISTANT", content: response.assistantMessage }
      ],
      response
    };
  } catch (error) {
    return {
      status: "FAILED",
      conversation,
      message: errorMessage(error)
    };
  }
}

export async function applyAuthoringProposal(
  client: Pick<StudioFabricClient, "applyIntent" | "getDraftSession">,
  state: DraftWorkspaceState,
  proposal: AuthoringProposal
): Promise<ApplyAuthoringProposalResult> {
  let next = state;
  let appliedIntentCount = 0;
  for (const intent of proposal.intents) {
    next = await applyDraftIntent(client, next, intent);
    if (next.status !== "READY") {
      return { state: next, deploymentPolicy: proposal.deploymentPolicy, appliedIntentCount };
    }
    if (next.lastResponse?.status !== "VALID") {
      return { state: next, deploymentPolicy: proposal.deploymentPolicy, appliedIntentCount };
    }
    appliedIntentCount += 1;
  }
  return { state: next, deploymentPolicy: proposal.deploymentPolicy, appliedIntentCount };
}

export async function finalizeAuthoringProposal(
  client: Pick<StudioFabricClient, "compileCandidate" | "getDraftSession" | "resolveDeployment">,
  state: DraftWorkspaceState,
  deploymentPolicy?: DeploymentPolicyDraft
): Promise<FinalizeAuthoringProposalResult> {
  let deployment: ResolveDeploymentResponse | undefined;
  if (state.status === "READY" && client.resolveDeployment) {
    deployment = await client.resolveDeployment({
      tenantId: state.session.tenantId,
      assemblyId: state.session.assemblyId,
      sessionId: state.session.sessionId,
      ...(state.session.currentCandidateId === undefined ? {} : { candidateId: state.session.currentCandidateId }),
      ...(deploymentPolicy === undefined ? {} : { deploymentPolicy })
    });
  }
  const compiled = await compileDraftWorkspace(client, state, {
    sign: true,
    ...(deploymentPolicy === undefined ? {} : { deploymentPolicy })
  });
  const exportBundle = buildDraftExportBundle(compiled);
  return {
    state: compiled,
    deployment,
    exportBundle,
    exportText: renderDraftExportText(exportBundle)
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  return "unable to continue authoring conversation";
}
