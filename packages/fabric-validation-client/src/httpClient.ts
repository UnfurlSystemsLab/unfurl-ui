import type {
  CompileDraftCandidateRequest,
  CompileDraftCandidateResponse,
  AuthoringConverseRequest,
  AuthoringConverseResponse,
  CreateDraftCompositionRequest,
  CreateDraftCompositionResponse,
  AdmitCatalogArtifactsRequest,
  AdmitCatalogArtifactsResponse,
  RemoveCatalogEntryResponse,
  SaveCatalogSnapshotRequest,
  LoadCatalogSnapshotRequest,
  ExtractNeedsRequest,
  ExtractNeedsResponse,
  CreateAssemblyRequest,
  ListAssembliesRequest,
  ListAssembliesResponse,
  SaveDraftRequest,
  SaveDraftResponse,
  SaveAssemblySnapshotRequest,
  LoadAssemblySnapshotRequest,
  SessionEventsRequest,
  LoadLayoutStateRequest,
  SaveLayoutStateRequest,
  StudioLayoutState,
  StudioAssemblySummary,
  DynamicDcpProjectionResponse,
  HeartbeatCollaboratorRequest,
  ReplacementCandidatesRequest,
  ReplacementCandidatesResponse,
  ConnectionCandidatesRequest,
  ConnectionCandidatesResponse,
  IntentResponse,
  ListCatalogVisualsResponse,
  LoadCompositionViewRequest,
  LoadCompositionViewResponse,
  ResolveDeploymentRequest,
  ResolveDeploymentResponse,
  StudioDraftSession,
  StudioFabricClient,
  StudioIntent,
  StudioCatalogSnapshot,
  StudioAssemblySnapshot,
  StudioVisualAsset,
  StudioToolCallRequest,
  StudioToolCallResult,
  ListStudioFilesRequest,
  StudioFileRecord,
  ListStudioSessionHistoryRequest,
  StudioSessionHistoryItem
} from "./index.js";

export const DEFAULT_STUDIO_TENANT_ID = "tenant-local";
export const DEFAULT_STUDIO_ASSEMBLY_ID = "assembly-demo";

export type FetchResponseLike = {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly json: () => Promise<unknown>;
};

export type FetchLike = (
  input: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  }
) => Promise<FetchResponseLike>;

export const DEFAULT_STUDIO_REQUEST_TIMEOUT_MS = 120_000;

export type HttpStudioFabricClientOptions = {
  readonly baseUrl: string;
  readonly fetch?: FetchLike;
  readonly defaultTenantId?: string;
  readonly defaultAssemblyId?: string;
  readonly userId?: string;
  readonly tenantMemberships?: readonly string[];
  readonly requestTimeoutMs?: number;
};

type HttpStudioAuthContext = {
  readonly userId?: string;
  readonly tenantMemberships?: readonly string[];
};

/**
 * Factory: builds the HTTP Adapter for Fabric Studio routes, including tenant headers and a
 * request timeout guard so stalled backend/proxy calls become visible UI errors.
 */
export function createHttpStudioFabricClient(options: HttpStudioFabricClientOptions): StudioFabricClient {
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error("fetch implementation is required");
  }
  const guardedFetch = createTimeoutFetch(fetchImpl, normalizeRequestTimeoutMs(options.requestTimeoutMs));
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const defaultScope = {
    tenantId: options.defaultTenantId ?? DEFAULT_STUDIO_TENANT_ID,
    assemblyId: options.defaultAssemblyId ?? DEFAULT_STUDIO_ASSEMBLY_ID
  };
  const authContext: HttpStudioAuthContext = {
    ...(options.userId ? { userId: options.userId } : {}),
    ...(options.tenantMemberships?.length ? { tenantMemberships: options.tenantMemberships } : {})
  };

  return {
    listCatalogVisuals: async body => {
      const tenantId = body?.tenantId ?? defaultScope.tenantId;
      const query = body?.catalogFileId ? `?catalogFileId=${encodeURIComponent(body.catalogFileId)}` : "";
      return request<ListCatalogVisualsResponse>(
        guardedFetch,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(tenantId)}/catalog${query}`,
        undefined,
        tenantHeaders(tenantId, authContext)
      );
    },
    listStudioFiles: async (body?: ListStudioFilesRequest) => {
      const tenantId = body?.tenantId ?? defaultScope.tenantId;
      return request<readonly StudioFileRecord[]>(
        guardedFetch,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(tenantId)}/files${queryString({
          fileType: body?.fileType,
          sessionId: body?.sessionId,
          correlationId: body?.correlationId
        })}`,
        undefined,
        tenantHeaders(tenantId, authContext)
      );
    },
    listSessionHistory: async (body?: ListStudioSessionHistoryRequest) => {
      const tenantId = body?.tenantId ?? defaultScope.tenantId;
      return request<readonly StudioSessionHistoryItem[]>(
        guardedFetch,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(tenantId)}/sessions${queryString({ assemblyId: body?.assemblyId })}`,
        undefined,
        tenantHeaders(tenantId, authContext)
      );
    },
    admitCatalogArtifacts: async body => {
      const scope = resolveScope(defaultScope, body);
      return request<AdmitCatalogArtifactsResponse>(
        guardedFetch,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/catalog/admissions`,
        { ...body, ...scope },
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    removeCatalogEntry: async body => {
      const tenantId = body.tenantId ?? defaultScope.tenantId;
      return request<RemoveCatalogEntryResponse>(
        guardedFetch,
        baseUrl,
        "DELETE",
        `/studio/tenants/${encodeURIComponent(tenantId)}/catalog/${encodeURIComponent(body.catalogEntryId)}`,
        undefined,
        tenantHeaders(tenantId, authContext)
      );
    },
    saveCatalogSnapshot: async (body?: SaveCatalogSnapshotRequest) => {
      const tenantId = body?.tenantId ?? defaultScope.tenantId;
      return request<StudioCatalogSnapshot>(
        guardedFetch,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(tenantId)}/catalog/snapshot`,
        undefined,
        tenantHeaders(tenantId, authContext)
      );
    },
    loadCatalogSnapshot: async (body: LoadCatalogSnapshotRequest) => {
      const tenantId = body.tenantId ?? defaultScope.tenantId;
      return request<ListCatalogVisualsResponse>(
        guardedFetch,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(tenantId)}/catalog/snapshot`,
        body.snapshot,
        tenantHeaders(tenantId, authContext)
      );
    },
    extractNeeds: async body => {
      const scope = resolveScope(defaultScope, body);
      return request<ExtractNeedsResponse>(
        guardedFetch,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/needs/extract`,
        { ...body, ...scope },
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    listAssemblies: async body => {
      const tenantId = body?.tenantId ?? defaultScope.tenantId;
      return request<ListAssembliesResponse>(
        guardedFetch,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(tenantId)}/assemblies`,
        undefined,
        tenantHeaders(tenantId, authContext)
      );
    },
    createAssembly: async body => {
      const tenantId = body.tenantId ?? defaultScope.tenantId;
      return request<StudioAssemblySummary>(
        guardedFetch,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(tenantId)}/assemblies`,
        { ...body, tenantId },
        tenantHeaders(tenantId, authContext)
      );
    },
    saveDraft: async body => {
      const scope = resolveScope(defaultScope, body);
      return request<SaveDraftResponse>(
        guardedFetch,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/drafts/save`,
        { ...body, ...scope },
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    saveAssemblySnapshot: async (body?: SaveAssemblySnapshotRequest) => {
      const scope = resolveScope(defaultScope, body ?? {});
      return request<StudioAssemblySnapshot>(
        guardedFetch,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/snapshot`,
        undefined,
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    loadAssemblySnapshot: async (body: LoadAssemblySnapshotRequest) => {
      const scope = resolveScope(defaultScope, body);
      return request<StudioAssemblySnapshot>(
        guardedFetch,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/snapshot`,
        body.snapshot,
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    loadLayoutState: async (body?: LoadLayoutStateRequest) => {
      const scope = resolveScope(defaultScope, body ?? {});
      return request<StudioLayoutState>(
        guardedFetch,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/layout`,
        undefined,
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    saveLayoutState: async (body: SaveLayoutStateRequest) => {
      const scope = resolveScope(defaultScope, body);
      return request<StudioLayoutState>(
        guardedFetch,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/layout`,
        { ...body, ...scope },
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    loadDynamicDcpProjection: async body => {
      const scope = resolveScope(defaultScope, body ?? {});
      const sessionQuery = body?.sessionId ? `?sessionId=${encodeURIComponent(body.sessionId)}` : "";
      return request<DynamicDcpProjectionResponse>(
        guardedFetch,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/dynamic-dcp${sessionQuery}`,
        undefined,
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    loadReplacementCandidates: async (body: ReplacementCandidatesRequest) => {
      const scope = resolveScope(defaultScope, body);
      const componentNodeId = encodeURIComponent(body.componentNodeId);
      return request<ReplacementCandidatesResponse>(
        guardedFetch,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/dynamic-dcp/replacements?componentNodeId=${componentNodeId}`,
        undefined,
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    loadConnectionCandidates: async (body: ConnectionCandidatesRequest) => {
      const scope = resolveScope(defaultScope, body);
      const catalogEntryId = encodeURIComponent(body.catalogEntryId);
      return request<ConnectionCandidatesResponse>(
        guardedFetch,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/dynamic-dcp/connection-candidates?catalogEntryId=${catalogEntryId}`,
        undefined,
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    loadCompositionView: async (body: LoadCompositionViewRequest) =>
      request<LoadCompositionViewResponse>(guardedFetch, baseUrl, "POST", "/studio/composition-view", body),
    createDraftComposition: async (body: CreateDraftCompositionRequest) => {
      const scope = resolveScope(defaultScope, body);
      return request<CreateDraftCompositionResponse>(
        guardedFetch,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/sessions`,
        { ...body, ...scope },
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    getDraftSession: async body => {
      const sessionRef = typeof body === "string" ? { sessionId: body } : body;
      const scope = resolveScope(defaultScope, sessionRef);
      return request<StudioDraftSession>(
        guardedFetch,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/sessions/${encodeURIComponent(sessionRef.sessionId)}`,
        undefined,
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    heartbeatCollaborator: async (body: HeartbeatCollaboratorRequest) => {
      const scope = resolveScope(defaultScope, body);
      return request<StudioDraftSession>(
        guardedFetch,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/sessions/${encodeURIComponent(body.sessionId)}/collaborators/heartbeat`,
        {
          collaboratorId: body.collaboratorId,
          displayName: body.displayName ?? body.collaboratorId,
          selectedSurface: body.selectedSurface ?? ""
        },
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    sessionEventsUrl: (body: SessionEventsRequest) => {
      const scope = resolveScope(defaultScope, body);
      return `${baseUrl}/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/sessions/${encodeURIComponent(body.sessionId)}/events`;
    },
    applyIntent: async (body: StudioIntent) =>
      request<IntentResponse>(
        guardedFetch,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(body.tenantId)}/assemblies/${encodeURIComponent(body.assemblyId)}/sessions/${encodeURIComponent(body.sessionId)}/intents`,
        body,
        tenantHeaders(body.tenantId, authContext)
      ),
    compileCandidate: async (body: CompileDraftCandidateRequest) => {
      const scope = resolveScope(defaultScope, body);
      return request<CompileDraftCandidateResponse>(
        guardedFetch,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/sessions/${encodeURIComponent(body.sessionId)}/compile`,
        { ...body, ...scope },
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    callStudioTool: async (body: StudioToolCallRequest & { readonly toolName: string }) => {
      const tenantId = stringFromToolArguments(body.arguments, "tenantId") ?? defaultScope.tenantId;
      return request<StudioToolCallResult>(
        guardedFetch,
        baseUrl,
        "POST",
        `/studio/tools/${encodeURIComponent(body.toolName)}`,
        body,
        tenantHeaders(tenantId, authContext)
      );
    },
    converseAuthoring: async (body: AuthoringConverseRequest) => {
      const scope = resolveScope(defaultScope, body);
      return request<AuthoringConverseResponse>(
        guardedFetch,
        baseUrl,
        "POST",
        "/studio/authoring/converse",
        { ...body, ...scope },
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    resolveDeployment: async (body: ResolveDeploymentRequest) =>
      request<ResolveDeploymentResponse>(guardedFetch, baseUrl, "POST", "/studio/deployment/resolve", body),
    getVisualAsset: async (assetId: string) =>
      request<StudioVisualAsset>(
        guardedFetch,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(defaultScope.tenantId)}/assets/${encodeURIComponent(assetId)}`,
        undefined,
        tenantHeaders(defaultScope.tenantId, authContext)
      )
  };
}

/**
 * Adapter: wraps the provided fetch implementation with an AbortController and Promise race so
 * transports that honor abort and transports that merely stall both release the UI.
 */
function createTimeoutFetch(fetchImpl: FetchLike, timeoutMs: number | undefined): FetchLike {
  if (timeoutMs === undefined) {
    return fetchImpl;
  }
  return async (input, init) => {
    const controller = new AbortController();
    const fetchPromise = fetchImpl(input, { ...(init ?? {}), signal: controller.signal });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        const error = new Error(`Fabric Studio API timed out after ${timeoutMs} ms: ${init?.method ?? "GET"} ${input}`);
        reject(error);
        controller.abort(error);
      }, timeoutMs);
    });
    try {
      const response = await Promise.race([fetchPromise, timeoutPromise]);
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        json: () => withTimeout(
          response.json(),
          timeoutMs,
          `Fabric Studio API response body timed out after ${timeoutMs} ms: ${init?.method ?? "GET"} ${input}`,
          error => controller.abort(error)
        )
      };
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  };
}

/**
 * Timeout decorator: bounds deferred response-body parsing as well as the initial
 * header fetch so UI callers do not spin forever after a proxy or backend has
 * already opened a 2xx response.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: (error: Error) => void
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(message);
      onTimeout?.(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Transport helper: sends one JSON Studio API request and converts non-2xx responses into
 * route-scoped errors that panels can render without inspecting raw Response objects.
 */
async function request<T>(
  fetchImpl: FetchLike,
  baseUrl: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<T> {
  const requestHeaders = { "Content-Type": "application/json", ...(headers ?? {}) };
  const init: Parameters<FetchLike>[1] = body === undefined
    ? {
        method,
        headers: requestHeaders
      }
    : {
        method,
        headers: requestHeaders,
        body: JSON.stringify(body)
      };

  const response = await fetchImpl(`${baseUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`Fabric Studio API failed: ${method} ${path} HTTP ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Validation helper: normalizes the client request timeout. Zero disables the guard for callers
 * that own cancellation externally; negative or non-finite values are configuration errors.
 */
function normalizeRequestTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined) {
    return DEFAULT_STUDIO_REQUEST_TIMEOUT_MS;
  }
  if (!Number.isFinite(timeoutMs)) {
    throw new Error("requestTimeoutMs must be finite");
  }
  if (timeoutMs < 0) {
    throw new Error("requestTimeoutMs must be zero or positive");
  }
  if (timeoutMs === 0) {
    return undefined;
  }
  return Math.max(1, Math.trunc(timeoutMs));
}

/**
 * Header factory: projects host/user tenant context into the lightweight Studio API headers.
 */
function tenantHeaders(
  tenantId: string,
  authContext?: HttpStudioAuthContext
): Record<string, string> {
  return {
    "X-Unfurl-Tenant": tenantId,
    ...(authContext?.userId ? { "X-Unfurl-User": authContext.userId } : {}),
    ...(authContext?.tenantMemberships?.length
      ? { "X-Unfurl-Tenant-Memberships": authContext.tenantMemberships.join(",") }
      : {})
  };
}

/**
 * URL helper: normalizes the API base URL once so endpoint path builders can concatenate safely.
 */
function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new Error("baseUrl is required");
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

/**
 * URL helper: builds a query string from optional Studio filter values while
 * omitting blanks so route URLs remain deterministic for tests and logs.
 */
function queryString(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value.trim() !== "") {
      params.set(key, value);
    }
  });
  const encoded = params.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

/**
 * Scope resolver: applies client defaults to optional tenant/assembly request bodies.
 */
function resolveScope(
  defaults: { readonly tenantId: string; readonly assemblyId: string },
  body: { readonly tenantId?: string; readonly assemblyId?: string }
): { readonly tenantId: string; readonly assemblyId: string } {
  return {
    tenantId: body.tenantId ?? defaults.tenantId,
    assemblyId: body.assemblyId ?? defaults.assemblyId
  };
}

/**
 * Tool-call helper: reads tenant scope from top-level or nested request arguments
 * so HTTP tool calls use the same tenant headers as first-class Studio routes.
 */
function stringFromToolArguments(argumentsBody: Record<string, unknown> | undefined, key: string): string | undefined {
  const direct = argumentsBody?.[key];
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }
  const nested = argumentsBody?.request;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedValue = (nested as Record<string, unknown>)[key];
    if (typeof nestedValue === "string" && nestedValue.trim().length > 0) {
      return nestedValue.trim();
    }
  }
  return undefined;
}
