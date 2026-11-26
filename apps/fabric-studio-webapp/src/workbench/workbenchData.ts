import type {
  CompileDraftCandidateResponse,
  ContractDiffResponse,
  DeploymentPolicyDraft,
  StudioViewId,
  StudioViewpoint,
  VerifyContractResponse,
  ViewProjectionResponse,
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
 * rule 6).
 *
 * Two places decide freshness, and they agree by construction:
 * - **Fabric** decides it for its read models. The contract diff and the verification are answered from Fabric's
 *   compile records with Fabric's hash of the policy Studio sent (LLD-fabric-studio-api, Compile records and
 *   freshness), so a stale comparison arrives as `COMPILE_STALE` and Studio shows it as Fabric names it.
 * - **Studio** decides whether a response it already holds still matches what it holds now: the session, the revision
 *   and its own policy draft. That compares two drafts Studio itself holds ({@link policyKey}); it never produces a
 *   hash for Fabric and is never compared with one. The deployment resolution has no Fabric record, so this is the only
 *   way to know it is out of date.
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
  /** The last contract diff Fabric answered, and the inputs it was asked with. */
  readonly contractDiff?: InputsPinned<ContractDiffResponse>;
  /** The last verification Fabric answered, and the inputs it was asked with. */
  readonly verification?: InputsPinned<VerifyContractResponse>;
  /**
   * Each view's typed data from Fabric (LLD-fabric-studio-api, StudioViewProjection), pinned to the session, revision,
   * policy and compile record it was loaded for (§4.3 rule 6). Read only through {@link currentView}.
   */
  readonly views?: Partial<Record<StudioViewpoint, InputsPinned<ViewProjectionResponse>>>;
  /** Why a view's data could not be loaded for the current inputs. */
  readonly viewErrors?: Partial<Record<StudioViewpoint, string>>;
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
 * A response and the inputs it was produced from: the session it belongs to, the session revision, the comparison key
 * of the deployment policy it was compiled or resolved with ({@link policyKey}), and, for a compile-derived answer, the
 * compile record it was answered for.
 *
 * `compileRecord` is the record's `contractHash`, `null` when the session had no record, and absent for a value that
 * does not come from a compile (the deployment resolution). Every compile has its own contract hash, because its audit
 * carries its own `compiledAt`, so a recompile at the same revision, signed or not, is a different record.
 */
export type InputsPinned<T> = {
  readonly sessionId: string;
  readonly revision: number;
  readonly policyKey: string;
  readonly compileRecord?: string | null;
  readonly response: T;
};

/** Whether a pinned value is current, or why not. */
export type Freshness =
  | { readonly current: true }
  | { readonly current: false; readonly reason: string };

/**
 * Comparison key of a policy draft Studio holds: the same draft always gives the same key, whatever its property order,
 * so a changed draft (shapes, isolation patterns or runtime options) is detected and an unchanged one is not. It is a
 * local equality of Studio's own drafts, never sent to Fabric and never compared with Fabric's policy hash.
 */
export function policyKey(policy: DeploymentPolicyDraft): string {
  return canonical(policy);
}

/**
 * Pins a response to the inputs it was produced from. Pass `compileRecord` for a compile-derived answer: the contract
 * hash of the record it is about, or `null` when there was none; leave it out for a value no compile produced.
 */
export function pin<T>(session: StudioDraftSession, policy: DeploymentPolicyDraft, response: T,
  compileRecord?: string | null): InputsPinned<T> {
  return {
    sessionId: session.sessionId, revision: session.sceneRevision, policyKey: policyKey(policy),
    ...(compileRecord === undefined ? {} : { compileRecord }), response
  };
}

/** Fabric's route id of each workbench view. */
export const VIEW_ROUTE_IDS: Readonly<Record<StudioViewpoint, StudioViewId>> = {
  FLOW: "flow", DATA: "data", TOPOLOGY: "topology", RUNTIME: "runtime"
};

/**
 * The outcome of pinning a view answer: pinned to what the answer describes (and whether it describes a later revision
 * than the session Studio holds, so the session should be refreshed), or refused with the reason.
 */
export type ViewPin =
  | { readonly status: "PINNED"; readonly pinned: InputsPinned<ViewProjectionResponse>; readonly newerRevision: boolean }
  | { readonly status: "REFUSED"; readonly reason: string };

/**
 * Pins a view answer to what the answer itself describes, never to what was asked (§4.3 rule 6): its scope and revision,
 * the policy Studio sent, and the compile record its compile-derived sections name. A collaborator can edit between the
 * request and Fabric's processing it, so the answer's revision can be later than the session held; the pinned answer is
 * then drawn only once the session reaches that revision. An answer for another tenant, assembly, session or view is
 * refused.
 */
export function pinView(requested: StudioDraftSession, policy: DeploymentPolicyDraft, view: StudioViewpoint,
  response: ViewProjectionResponse): ViewPin {
  if (response.tenantId !== requested.tenantId || response.assemblyId !== requested.assemblyId
    || response.sessionId !== requested.sessionId) {
    return { status: "REFUSED", reason: `Fabric answered for session ${response.sessionId} of ${response.tenantId}/${response.assemblyId};`
      + ` session ${requested.sessionId} of ${requested.tenantId}/${requested.assemblyId} was asked` };
  }
  if (response.view !== VIEW_ROUTE_IDS[view]) {
    return { status: "REFUSED", reason: `Fabric answered the ${response.view} view for the ${VIEW_ROUTE_IDS[view]} view` };
  }
  if (!Number.isSafeInteger(response.revision)) {
    return { status: "REFUSED", reason: "Fabric's answer names no revision" };
  }
  const compileRecord = answeredCompileRecord(view, response);
  return {
    status: "PINNED",
    pinned: {
      sessionId: response.sessionId, revision: response.revision, policyKey: policyKey(policy),
      ...(compileRecord === undefined ? {} : { compileRecord }), response
    },
    newerRevision: response.revision > requested.sceneRevision
  };
}

/**
 * The compile record a view answer's compile-derived sections were read from (their provenance), `null` when they name
 * none, and absent for the Flow view, which reads no compile.
 */
function answeredCompileRecord(view: StudioViewpoint, response: ViewProjectionResponse): string | null | undefined {
  switch (view) {
    case "DATA": return response.dataMappings?.provenance?.contractHash ?? null;
    case "TOPOLOGY": return response.transports?.provenance?.contractHash ?? null;
    case "RUNTIME": return response.verification?.provenance && !response.verification.historical
      ? response.verification.provenance.contractHash : null;
    default: return undefined;
  }
}

/** A view's Fabric data, only while it is current for the session, revision, policy and compile record (§4.3 rule 6). */
export function currentView(data: WorkbenchData, view: StudioViewpoint): ViewProjectionResponse | undefined {
  return currentResponse(data.views?.[view], data);
}

/** The contract hash of the session's current compile record (its latest), or `null` when nothing is recorded. */
export function currentCompileRecord(session: StudioDraftSession): string | null {
  return session.compileRecords?.at(-1)?.contractHash ?? null;
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
  // A compile-derived answer is about one compile record. A later compile, at the same revision too (signed or not,
  // by this operator or arriving through polling), is a new record, and the answer no longer describes the current one.
  if (pinned.compileRecord !== undefined) {
    const latest = session.compileRecords?.at(-1);
    if ((latest?.contractHash ?? null) !== pinned.compileRecord) {
      return {
        current: false,
        reason: latest
          ? `it was produced for ${pinned.compileRecord === null ? "no compile" : `contract ${pinned.compileRecord.slice(0, 12)}`}; the current compile is revision ${latest.revision}, contract ${latest.contractHash.slice(0, 12)}`
          : "the compile it was produced for is no longer the session's"
      };
    }
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
