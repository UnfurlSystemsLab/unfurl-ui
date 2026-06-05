import type {
  CompileDraftCandidateRequest,
  CompileDraftCandidateResponse,
  CreateDraftCompositionRequest,
  CreateDraftCompositionResponse,
  AdmitCatalogArtifactsRequest,
  AdmitCatalogArtifactsResponse,
  ExtractNeedsRequest,
  ExtractNeedsResponse,
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

  return {
    listCatalogVisuals: async body => {
      const tenantId = encodeURIComponent(body?.tenantId ?? defaultScope.tenantId);
      return request<ListCatalogVisualsResponse>(fetchImpl, baseUrl, "GET", `/studio/tenants/${tenantId}/catalog`);
    },
    admitCatalogArtifacts: async body => {
      const scope = resolveScope(defaultScope, body);
      return request<AdmitCatalogArtifactsResponse>(
        fetchImpl,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/catalog/admissions`,
        { ...body, ...scope }
      );
    },
    extractNeeds: async body => {
      const scope = resolveScope(defaultScope, body);
      return request<ExtractNeedsResponse>(
        fetchImpl,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/needs/extract`,
        { ...body, ...scope }
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
        { ...body, ...scope }
      );
    },
    getDraftSession: async body => {
      const sessionRef = typeof body === "string" ? { sessionId: body } : body;
      const scope = resolveScope(defaultScope, sessionRef);
      return request<StudioDraftSession>(
        fetchImpl,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/sessions/${encodeURIComponent(sessionRef.sessionId)}`
      );
    },
    applyIntent: async (body: StudioIntent) =>
      request<IntentResponse>(
        fetchImpl,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(body.tenantId)}/assemblies/${encodeURIComponent(body.assemblyId)}/sessions/${encodeURIComponent(body.sessionId)}/intents`,
        body
      ),
    compileCandidate: async (body: CompileDraftCandidateRequest) => {
      const scope = resolveScope(defaultScope, body);
      return request<CompileDraftCandidateResponse>(
        fetchImpl,
        baseUrl,
        "POST",
        `/studio/tenants/${encodeURIComponent(scope.tenantId)}/assemblies/${encodeURIComponent(scope.assemblyId)}/sessions/${encodeURIComponent(body.sessionId)}/compile`,
        { ...body, ...scope }
      );
    },
    resolveDeployment: async (body: ResolveDeploymentRequest) =>
      request<ResolveDeploymentResponse>(fetchImpl, baseUrl, "POST", "/studio/deployment/resolve", body),
    getVisualAsset: async (assetId: string) =>
      request<StudioVisualAsset>(
        fetchImpl,
        baseUrl,
        "GET",
        `/studio/tenants/${encodeURIComponent(defaultScope.tenantId)}/assets/${encodeURIComponent(assetId)}`
      )
  };
}

async function request<T>(
  fetchImpl: FetchLike,
  baseUrl: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  const init: Parameters<FetchLike>[1] = body === undefined
    ? {
        method,
        headers: { "Content-Type": "application/json" }
      }
    : {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      };

  const response = await fetchImpl(`${baseUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`Fabric Studio API failed: ${method} ${path} HTTP ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
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
