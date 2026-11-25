import type {
  CompileDraftCandidateResponse,
  DeploymentPolicyDraft,
  DynamicDcpProjectionResponse,
  ResolveDeploymentResponse,
  StudioAssemblySummary
} from "@unfurl/fabric-validation-client";
import type { StudioDraftSession } from "@unfurl/fabric-scene-model";

/**
 * Value Object: everything the workbench's views and overlays read, all of it typed data Fabric returned
 * (LLD-studio-viewpoints-and-perspectives §1 rule 2). Nothing here is parsed from claim text, defaulted, or invented;
 * an absent field means Fabric has not supplied it.
 *
 * Compile- and resolution-derived values are pinned to the inputs they were produced from, the session, its revision
 * and the deployment policy, so a view never shows them for a draft, session or policy that has changed since (§4.3
 * rule 6). Until Fabric's compile records exist (P2), Studio pins the responses itself to what it sent.
 */
export type WorkbenchData = {
  /** The ready draft session, when one is open. */
  readonly session?: StudioDraftSession;
  /**
   * The draft's `/dynamic-dcp` projection, already narrowed to the draft inventory, present only when it was loaded for
   * the current tenant, assembly, session and revision (§4.3 rule 6). A projection for other inputs is never here.
   */
  readonly projection?: DynamicDcpProjectionResponse;
  /** Why the projection for the current inputs could not be loaded. */
  readonly projectionError?: string;
  /** The inputs of the last projection loaded, when that projection is out of date and therefore not drawn. */
  readonly projectionOutOfDate?: ProjectionInputs;
  /** The last compile response and the inputs it compiled. */
  readonly compile?: InputsPinned<CompileDraftCandidateResponse>;
  /** The last deployment resolution and the inputs it resolved. */
  readonly deployment?: InputsPinned<ResolveDeploymentResponse>;
  /** Why the deployment could not be resolved. */
  readonly deploymentError?: string;
  /** The deployment policy the operator is planning with now. */
  readonly deploymentPolicy: DeploymentPolicyDraft;
  /** Fabric's summary of the assembly (its default deployment target), when Fabric returned one. */
  readonly assembly?: StudioAssemblySummary;
  /** Whether the operator asked for a signed compile. */
  readonly signingRequested: boolean;
};

/**
 * A response and the inputs it was produced from: the session it belongs to, the session revision, and the canonical
 * key of the deployment policy it was compiled or resolved with ({@link policyKey}).
 */
export type InputsPinned<T> = {
  readonly sessionId: string;
  readonly revision: number;
  readonly policyKey: string;
  readonly response: T;
};

/** Whether a pinned value is current, or why not. */
export type Freshness =
  | { readonly current: true }
  | { readonly current: false; readonly reason: string };

/**
 * Canonical key of a deployment policy: the same policy always gives the same key, whatever its property order, so a
 * changed policy (shapes, isolation patterns or runtime options) is detected and an unchanged one is not.
 */
export function policyKey(policy: DeploymentPolicyDraft): string {
  return canonical(policy);
}

/** Pins a response to the inputs it was produced from. */
export function pin<T>(session: StudioDraftSession, policy: DeploymentPolicyDraft, response: T): InputsPinned<T> {
  return { sessionId: session.sessionId, revision: session.sceneRevision, policyKey: policyKey(policy), response };
}

/**
 * Rule (§4.3 rule 6): a pinned value is current only for the same session, the same revision and an equal deployment
 * policy. The first difference found is the reason, so the operator learns what changed.
 */
export function freshness(pinned: InputsPinned<unknown>, data: WorkbenchData): Freshness {
  const session = data.session;
  if (!session) return { current: false, reason: "no draft session is open" };
  if (pinned.sessionId !== session.sessionId) {
    return { current: false, reason: `it was produced for session ${pinned.sessionId}; session ${session.sessionId} is open` };
  }
  if (pinned.revision !== session.sceneRevision) {
    return { current: false, reason: `it was produced at revision ${pinned.revision}; the draft is at revision ${session.sceneRevision}` };
  }
  if (pinned.policyKey !== policyKey(data.deploymentPolicy)) {
    return { current: false, reason: "it was produced with a different deployment policy" };
  }
  return { current: true };
}

/** Whether a pinned value describes the current session, revision and deployment policy. */
export function isCurrent(pinned: InputsPinned<unknown> | undefined, data: WorkbenchData): boolean {
  return pinned !== undefined && freshness(pinned, data).current;
}

/** The pinned response when it is current (§4.3 rule 6), otherwise `undefined`: the only way a view reads one. */
export function currentResponse<T>(pinned: InputsPinned<T> | undefined, data: WorkbenchData): T | undefined {
  return pinned !== undefined && isCurrent(pinned, data) ? pinned.response : undefined;
}

/** The "out of date" message for a pinned value, naming what changed and what to do. */
export function staleMessage(what: string, pinned: InputsPinned<unknown>, data: WorkbenchData, redo: string): string {
  const result = freshness(pinned, data);
  return result.current ? "" : `Out of date: ${what}; ${result.reason}. ${redo}`;
}

/**
 * What a `/dynamic-dcp` projection was requested for: the tenant and assembly, and the open draft session and its
 * revision (both absent when no draft is open, which asks Fabric for the assembly's projection).
 */
export type ProjectionInputs = {
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly sessionId?: string;
  readonly revision?: number;
};

/**
 * The outcome of the latest projection request (§4.3 rule 6): the response with the inputs it was loaded for, or the
 * failure for its inputs together with the inputs of the last projection that did load, so the failure can name it.
 */
export type ProjectionLoad =
  | { readonly status: "LOADED"; readonly inputs: ProjectionInputs; readonly response: DynamicDcpProjectionResponse }
  | { readonly status: "FAILED"; readonly inputs: ProjectionInputs; readonly error: string; readonly lastLoaded?: ProjectionInputs };

/** The projection inputs for a scope and its open session, if any. */
export function projectionInputsFor(tenantId: string, assemblyId: string, session: StudioDraftSession | undefined): ProjectionInputs {
  return session ? { tenantId, assemblyId, sessionId: session.sessionId, revision: session.sceneRevision } : { tenantId, assemblyId };
}

/** Whether two sets of projection inputs are the same request. */
export function sameProjectionInputs(left: ProjectionInputs, right: ProjectionInputs): boolean {
  return left.tenantId === right.tenantId && left.assemblyId === right.assemblyId
    && left.sessionId === right.sessionId && left.revision === right.revision;
}

/**
 * Reducer step: records a failed projection request, carrying forward the inputs of the last projection that loaded
 * (from a previous success, or from a previous failure's own record), so the out-of-date projection stays named.
 */
export function failedProjectionLoad(previous: ProjectionLoad | undefined, inputs: ProjectionInputs, error: string): ProjectionLoad {
  const lastLoaded = previous?.status === "LOADED" ? previous.inputs : previous?.lastLoaded;
  return { status: "FAILED", inputs, error, ...(lastLoaded ? { lastLoaded } : {}) };
}

/**
 * Projector of a load onto what the workbench may read for the current inputs: the projection only when it was loaded
 * for exactly these inputs; the error only when it is this request's; and the inputs of any other projection that
 * loaded, which is out of date and is never drawn.
 */
export function projectionFor(load: ProjectionLoad | undefined, current: ProjectionInputs): {
  readonly projection?: DynamicDcpProjectionResponse;
  readonly error?: string;
  readonly outOfDate?: ProjectionInputs;
} {
  if (!load) return {};
  if (load.status === "LOADED") {
    return sameProjectionInputs(load.inputs, current) ? { projection: load.response } : { outOfDate: load.inputs };
  }
  const lastLoaded = load.lastLoaded && !sameProjectionInputs(load.lastLoaded, current) ? { outOfDate: load.lastLoaded } : {};
  return sameProjectionInputs(load.inputs, current) ? { error: load.error, ...lastLoaded } : lastLoaded;
}

/** Plain-language name of projection inputs, for out-of-date and loading messages. */
export function describeProjectionInputs(inputs: ProjectionInputs): string {
  return inputs.sessionId === undefined
    ? `assembly ${inputs.assemblyId}`
    : `session ${inputs.sessionId} at revision ${inputs.revision}`;
}

/** JSON with object keys sorted at every depth; arrays keep their order, which is meaningful (preference order). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .filter(key => (value as Record<string, unknown>)[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
