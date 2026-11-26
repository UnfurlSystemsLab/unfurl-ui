import {
  StudioApiError,
  type SaveDeploymentEnvironmentRequest,
  type StudioDeploymentEnvironment,
  type StudioEnvironmentProblem
} from "@unfurl/fabric-validation-client";

/** One row of a key-value table in the environment form. */
export type KeyValue = { readonly key: string; readonly value: string };

/**
 * The environment editor's form (LLD-studio-viewpoints-and-perspectives §5.5): every field as the operator typed it.
 * Studio checks nothing itself; {@link requestFromForm} carries the form to Fabric, which checks each save and names every
 * problem by field path. Lists are one entry per line, maps are key-value rows; blank rows and lines are not sent.
 */
export type EnvironmentForm = {
  readonly name: string;
  readonly kind: string;
  readonly environment: string;
  readonly region: string;
  readonly endpoint: string;
  readonly options: readonly KeyValue[];
  readonly credentialRefs: string;
  readonly serviceBaseUrls: readonly KeyValue[];
  readonly timeoutMs: string;
  readonly telemetryNamespace: string;
  readonly identityOn: boolean;
  readonly issuer: string;
  readonly audiences: readonly KeyValue[];
  readonly tenantClaim: string;
  readonly rolesClaim: string;
  readonly permissionsClaim: string;
  readonly tokenEndpointRef: string;
  readonly verificationKeysRef: string;
  readonly clientCredentialsRef: string;
  readonly serviceCredentials: readonly KeyValue[];
  readonly componentConfig: string;
  readonly visibilityDefault: string;
  readonly visibility: string;
  readonly observationIntervalMs: string;
  readonly observationMaxBackoffMs: string;
  readonly disabledBindings: string;
};

/** A new environment's form: nothing filled in, identity off. */
export function emptyEnvironmentForm(): EnvironmentForm {
  return {
    name: "", kind: "", environment: "", region: "", endpoint: "", options: [], credentialRefs: "", serviceBaseUrls: [],
    timeoutMs: "", telemetryNamespace: "", identityOn: false, issuer: "", audiences: [], tenantClaim: "", rolesClaim: "",
    permissionsClaim: "", tokenEndpointRef: "", verificationKeysRef: "", clientCredentialsRef: "", serviceCredentials: [],
    componentConfig: "", visibilityDefault: "", visibility: "", observationIntervalMs: "", observationMaxBackoffMs: "",
    disabledBindings: ""
  };
}

/** Adapter: a stored environment as the form shows it, field for field. */
export function formFromEnvironment(environment: StudioDeploymentEnvironment): EnvironmentForm {
  const { target, bindings } = environment;
  const identity = bindings.identity;
  const documentation = bindings.documentation;
  return {
    name: environment.name,
    kind: target.kind ?? "",
    environment: target.environment ?? "",
    region: target.region ?? "",
    endpoint: target.endpoint ?? "",
    options: rows(target.options),
    credentialRefs: target.credentialRefs.join("\n"),
    serviceBaseUrls: rows(bindings.serviceBaseUrls),
    timeoutMs: bindings.timeoutMs === undefined ? "" : String(bindings.timeoutMs),
    telemetryNamespace: bindings.telemetryNamespace ?? "",
    identityOn: identity !== undefined,
    issuer: identity?.issuer ?? "",
    audiences: rows(identity?.audiences ?? {}),
    tenantClaim: identity?.tenantClaim ?? "",
    rolesClaim: identity?.rolesClaim ?? "",
    permissionsClaim: identity?.permissionsClaim ?? "",
    tokenEndpointRef: identity?.tokenEndpointRef ?? "",
    verificationKeysRef: identity?.verificationKeysRef ?? "",
    clientCredentialsRef: identity?.clientCredentialsRef ?? "",
    serviceCredentials: rows(identity?.serviceCredentials ?? {}),
    componentConfig: bindings.componentConfig.join("\n"),
    visibilityDefault: documentation?.visibilityDefault ?? "",
    visibility: documentation?.visibility ?? "",
    observationIntervalMs: documentation?.observationIntervalMs === undefined ? "" : String(documentation.observationIntervalMs),
    observationMaxBackoffMs: documentation?.observationMaxBackoffMs === undefined ? "" : String(documentation.observationMaxBackoffMs),
    disabledBindings: bindings.disabledBindings.join("\n")
  };
}

/**
 * Adapter: the form as Fabric's save request. Text is sent trimmed and blank text is left out; numbers come from number
 * inputs. Identity is sent only when it is switched on, and documentation only when one of its settings is given, so an
 * environment without them has none (root CLAUDE.md rule 6: identity is never half-configured).
 */
export function requestFromForm(form: EnvironmentForm, expectedRevision: number): SaveDeploymentEnvironmentRequest {
  const documentation = {
    ...text("visibilityDefault", form.visibilityDefault),
    ...(form.visibility.trim() === "" ? {} : { visibility: form.visibility }),
    ...number("observationIntervalMs", form.observationIntervalMs),
    ...number("observationMaxBackoffMs", form.observationMaxBackoffMs)
  };
  return {
    name: form.name.trim(),
    expectedRevision,
    target: {
      ...text("kind", form.kind),
      ...text("environment", form.environment),
      ...text("region", form.region),
      ...text("endpoint", form.endpoint),
      options: record(form.options),
      credentialRefs: lines(form.credentialRefs)
    },
    bindings: {
      serviceBaseUrls: record(form.serviceBaseUrls),
      ...number("timeoutMs", form.timeoutMs),
      ...text("telemetryNamespace", form.telemetryNamespace),
      ...(form.identityOn ? {
        identity: {
          ...text("issuer", form.issuer),
          audiences: record(form.audiences),
          ...text("tenantClaim", form.tenantClaim),
          ...text("rolesClaim", form.rolesClaim),
          ...text("permissionsClaim", form.permissionsClaim),
          ...text("tokenEndpointRef", form.tokenEndpointRef),
          ...text("verificationKeysRef", form.verificationKeysRef),
          ...text("clientCredentialsRef", form.clientCredentialsRef),
          serviceCredentials: record(form.serviceCredentials)
        }
      } : {}),
      componentConfig: lines(form.componentConfig),
      ...(Object.keys(documentation).length === 0 ? {} : { documentation }),
      disabledBindings: lines(form.disabledBindings)
    }
  };
}

/** What a save or delete came to, as the editor shows it. */
export type EnvironmentOutcome =
  | { readonly status: "SAVED"; readonly environment?: StudioDeploymentEnvironment }
  | { readonly status: "INVALID"; readonly problems: readonly StudioEnvironmentProblem[] }
  | { readonly status: "CONFLICT"; readonly currentRevision: number; readonly message: string }
  | { readonly status: "FAILED"; readonly message: string };

/**
 * Classifier: a refused save or delete as Fabric answered it. A 400 `ENVIRONMENT_INVALID` carries every problem by
 * field path, a 409 `ENVIRONMENT_REVISION_CONFLICT` the stored revision; anything else is a failure with its message.
 */
export function environmentOutcome(error: unknown): EnvironmentOutcome {
  if (error instanceof StudioApiError && error.body && typeof error.body === "object") {
    const body = error.body as { readonly code?: string; readonly error?: string; readonly problems?: readonly StudioEnvironmentProblem[]; readonly currentRevision?: number };
    if (error.status === 400 && body.code === "ENVIRONMENT_INVALID" && Array.isArray(body.problems)) {
      return { status: "INVALID", problems: body.problems };
    }
    if (error.status === 409 && body.code === "ENVIRONMENT_REVISION_CONFLICT" && typeof body.currentRevision === "number") {
      return { status: "CONFLICT", currentRevision: body.currentRevision, message: body.error ?? error.message };
    }
    if (typeof body.error === "string") return { status: "FAILED", message: body.error };
  }
  return { status: "FAILED", message: error instanceof Error ? error.message : String(error) };
}

/** The problems that name a form field: its path, or a path inside it. */
export function problemsAt(problems: readonly StudioEnvironmentProblem[], path: string): readonly StudioEnvironmentProblem[] {
  return problems.filter(problem => problem.path === path || problem.path.startsWith(`${path}.`));
}

function rows(values: Readonly<Record<string, string>>): readonly KeyValue[] {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

function record(rowsToSend: readonly KeyValue[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const row of rowsToSend) {
    if (row.key.trim() !== "") values[row.key.trim()] = row.value.trim();
  }
  return values;
}

function lines(value: string): readonly string[] {
  return value.split("\n").map(line => line.trim()).filter(line => line !== "");
}

function text<K extends string>(key: K, value: string): Partial<Record<K, string>> {
  return value.trim() === "" ? {} : ({ [key]: value.trim() } as Record<K, string>);
}

function number<K extends string>(key: K, value: string): Partial<Record<K, number>> {
  return value.trim() === "" ? {} : ({ [key]: Number(value) } as Record<K, number>);
}
