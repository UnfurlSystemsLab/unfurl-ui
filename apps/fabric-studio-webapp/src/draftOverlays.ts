import type { PlanningWarning } from "@unfurl/fabric-scene-model";
import type { DraftWorkspaceState } from "./draftWorkspace.js";
import { currentRevision } from "./intentHistory.js";

export type DraftOverlaySeverity = "INFO" | "WARNING" | "ERROR";

export type DraftOverlayItem = {
  readonly severity: DraftOverlaySeverity;
  readonly code: string;
  readonly message: string;
};

export type DraftWorkspaceOverlay = {
  readonly status: "LOADING" | "READY" | "FAILED";
  readonly sessionId?: string;
  readonly candidateId?: string;
  readonly revision?: number;
  readonly requiredSubstratePorts: readonly string[];
  readonly items: readonly DraftOverlayItem[];
};

export function buildDraftWorkspaceOverlay(state: DraftWorkspaceState): DraftWorkspaceOverlay {
  if (state.status === "LOADING") {
    return {
      status: "LOADING",
      requiredSubstratePorts: [],
      items: [{ severity: "INFO", code: "DRAFT_LOADING", message: "Draft workspace is loading." }]
    };
  }

  if (state.status === "FAILED") {
    return {
      status: "FAILED",
      requiredSubstratePorts: [],
      items: [{ severity: "ERROR", code: "DRAFT_FAILED", message: state.message }]
    };
  }

  const lastIntentPorts = state.lastResponse?.status === "VALID"
    ? state.lastResponse.requiredSubstratePorts
    : [];
  const lastRecord = state.history.records[state.history.cursor - 1];
  const requiredSubstratePorts = lastIntentPorts.length > 0
    ? lastIntentPorts
    : lastRecord?.requiredSubstratePorts ?? [];

  const overlay: DraftWorkspaceOverlay = {
    status: "READY",
    sessionId: state.session.sessionId,
    revision: currentRevision(state.history),
    requiredSubstratePorts,
    items: [
      ...planningWarnings(state.session.warnings),
      ...intentItems(state),
      ...compileItems(state)
    ]
  };
  return state.session.currentCandidateId === undefined
    ? overlay
    : { ...overlay, candidateId: state.session.currentCandidateId };
}

export function renderDraftWorkspaceOverlayText(overlay: DraftWorkspaceOverlay): string {
  const lines = [`draft: ${overlay.status}`];
  if (overlay.sessionId) {
    lines.push(`session: ${overlay.sessionId}`);
  }
  if (overlay.candidateId) {
    lines.push(`candidate: ${overlay.candidateId}`);
  }
  if (overlay.revision !== undefined) {
    lines.push(`revision: ${overlay.revision}`);
  }
  lines.push(`required substrate ports: ${overlay.requiredSubstratePorts.join(", ") || "none"}`);
  for (const item of overlay.items) {
    lines.push(`${item.severity} ${item.code}: ${item.message}`);
  }
  return lines.join("\n");
}

function planningWarnings(warnings: readonly PlanningWarning[]): readonly DraftOverlayItem[] {
  return warnings.map(warning => ({
    severity: "WARNING" as const,
    code: warning.code,
    message: warning.message
  }));
}

function intentItems(state: Extract<DraftWorkspaceState, { readonly status: "READY" }>): readonly DraftOverlayItem[] {
  const response = state.lastResponse;
  if (!response) {
    return [];
  }
  if (response.status === "VALID") {
    return [
      {
        severity: "INFO",
        code: "INTENT_VALID",
        message: `Intent accepted at revision ${response.newRevision}.`
      },
      ...response.warnings.map(message => ({
        severity: "WARNING" as const,
        code: "INTENT_WARNING",
        message
      }))
    ];
  }
  if (response.status === "STALE_REVISION") {
    return [{
      severity: "WARNING",
      code: "STALE_REVISION",
      message: `Draft refreshed from stale revision ${response.receivedRevision}; expected ${response.expectedRevision}.`
    }];
  }
  return [{
    severity: "ERROR",
    code: "INTENT_INVALID",
    message: `${response.reason}: ${response.details}`
  }];
}

function compileItems(state: Extract<DraftWorkspaceState, { readonly status: "READY" }>): readonly DraftOverlayItem[] {
  const response = state.lastCompile;
  if (!response) {
    return [];
  }
  if (response.status === "COMPILED") {
    return [
      {
        severity: "INFO",
        code: "COMPILE_READY",
        message: `Candidate ${response.candidateId} compiled.`
      },
      ...response.warnings.map(message => ({
        severity: "WARNING" as const,
        code: "COMPILE_WARNING",
        message
      }))
    ];
  }
  if (response.status === "STALE_REVISION") {
    return [{
      severity: "WARNING",
      code: "COMPILE_STALE_REVISION",
      message: `Compile used stale revision ${response.receivedRevision}; expected ${response.expectedRevision}.`
    }];
  }
  return [{
    severity: "ERROR",
    code: "COMPILE_INVALID",
    message: `${response.reason}: ${response.details}`
  }];
}
