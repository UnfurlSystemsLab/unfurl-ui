import type {
  CompileDraftCandidateRequest,
  CompileDraftCandidateResponse,
  CreateDraftCompositionRequest,
  CreateDraftCompositionResponse,
  AdmitCatalogArtifactsRequest,
  AdmitCatalogArtifactsResponse,
  ExtractNeedsRequest,
  ExtractNeedsResponse,
  CreateAssemblyRequest,
  ListAssembliesRequest,
  ListAssembliesResponse,
  SaveDraftRequest,
  SaveDraftResponse,
  SessionEventsRequest,
  LoadLayoutStateRequest,
  SaveLayoutStateRequest,
  StudioLayoutState,
  StudioAssemblySummary,
  DynamicDcpProjectionResponse,
  HeartbeatCollaboratorRequest,
  ReplacementCandidatesRequest,
  ReplacementCandidatesResponse,
  IntentResponse,
  ListCatalogVisualsResponse,
  LoadCompositionViewRequest,
  LoadCompositionViewResponse,
  ResolveDeploymentRequest,
  ResolveDeploymentResponse,
  StudioDraftSession,
  StudioFabricClient,
  StudioIntent,
  StudioVisualAsset
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
  }
) => Promise<FetchResponseLike>;

export type HttpStudioFabricClientOptions = {
  readonly baseUrl: string;
  readonly fetch?: FetchLike;
  readonly defaultTenantId?: string;
  readonly defaultAssemblyId?: string;
  readonly userId?: string;
  readonly tenantMemberships?: readonly string[];
};

type HttpStudioAuthContext = {
  readonly userId?: string;
  readonly tenantMemberships?: readonly string[];
};

export function createHttpStudioFabricClient(options: HttpStudioFabricClientOptions): StudioFabricClient {
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error("fetch implementation is required");
  }
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
      return request<ListCatalogVisualsResponse>(
        fetchImpl,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(tenantId)}/catalog`,
        undefined,
        tenantHeaders(tenantId, authContext)
      );
    },
    admitCatalogArtifacts: async body => {
      const scope = resolveScope(defaultScope, body);
      return request<AdmitCatalogArtifactsResponse>(
        fetchImpl,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/catalog/admissions`,
        { ...body, ...scope },
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    extractNeeds: async body => {
      const scope = resolveScope(defaultScope, body);
      return request<ExtractNeedsResponse>(
        fetchImpl,
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
        fetchImpl,
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
        fetchImpl,
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
        fetchImpl,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/drafts/save`,
        { ...body, ...scope },
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    loadLayoutState: async (body?: LoadLayoutStateRequest) => {
      const scope = resolveScope(defaultScope, body ?? {});
      return request<StudioLayoutState>(
        fetchImpl,
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
        fetchImpl,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/layout`,
        { ...body, ...scope },
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    loadDynamicDcpProjection: async body => {
      const scope = resolveScope(defaultScope, body ?? {});
      return request<DynamicDcpProjectionResponse>(
        fetchImpl,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/dynamic-dcp`,
        undefined,
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    loadReplacementCandidates: async (body: ReplacementCandidatesRequest) => {
      const scope = resolveScope(defaultScope, body);
      const componentNodeId = encodeURIComponent(body.componentNodeId);
      return request<ReplacementCandidatesResponse>(
        fetchImpl,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/dynamic-dcp/replacements?componentNodeId=${componentNodeId}`,
        undefined,
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    loadCompositionView: async (body: LoadCompositionViewRequest) =>
      request<LoadCompositionViewResponse>(fetchImpl, baseUrl, "POST", "/studio/composition-view", body),
    createDraftComposition: async (body: CreateDraftCompositionRequest) => {
      const scope = resolveScope(defaultScope, body);
      return request<CreateDraftCompositionResponse>(
        fetchImpl,
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
        fetchImpl,
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
        fetchImpl,
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
        fetchImpl,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(body.tenantId)}/assemblies/${encodeURIComponent(body.assemblyId)}/sessions/${encodeURIComponent(body.sessionId)}/intents`,
        body,
        tenantHeaders(body.tenantId, authContext)
      ),
    compileCandidate: async (body: CompileDraftCandidateRequest) => {
      const scope = resolveScope(defaultScope, body);
      return request<CompileDraftCandidateResponse>(
        fetchImpl,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/sessions/${encodeURIComponent(body.sessionId)}/compile`,
        { ...body, ...scope },
        tenantHeaders(scope.tenantId, authContext)
      );
    },
    resolveDeployment: async (body: ResolveDeploymentRequest) =>
      request<ResolveDeploymentResponse>(fetchImpl, baseUrl, "POST", "/studio/deployment/resolve", body),
    getVisualAsset: async (assetId: string) =>
      request<StudioVisualAsset>(
        fetchImpl,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(defaultScope.tenantId)}/assets/${encodeURIComponent(assetId)}`,
        undefined,
        tenantHeaders(defaultScope.tenantId, authContext)
      )
  };
}

async function request<T>(
  fetchImpl: FetchLike,
  baseUrl: string,
  method: "GET" | "POST",
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

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new Error("baseUrl is required");
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function resolveScope(
  defaults: { readonly tenantId: string; readonly assemblyId: string },
  body: { readonly tenantId?: string; readonly assemblyId?: string }
): { readonly tenantId: string; readonly assemblyId: string } {
  return {
    tenantId: body.tenantId ?? defaults.tenantId,
    assemblyId: body.assemblyId ?? defaults.assemblyId
  };
}
