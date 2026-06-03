import type {
  CompileDraftCandidateRequest,
  CompileDraftCandidateResponse,
  CreateDraftCompositionRequest,
  CreateDraftCompositionResponse,
  IntentResponse,
  ListCatalogVisualsResponse,
  LoadCompositionViewRequest,
  LoadCompositionViewResponse,
  StudioDraftSession,
  StudioFabricClient,
  StudioIntent,
  StudioVisualAsset
} from "./index.js";

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
};

export function createHttpStudioFabricClient(options: HttpStudioFabricClientOptions): StudioFabricClient {
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error("fetch implementation is required");
  }
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  return {
    listCatalogVisuals: async () =>
      request<ListCatalogVisualsResponse>(fetchImpl, baseUrl, "GET", "/studio/catalog"),
    loadCompositionView: async (body: LoadCompositionViewRequest) =>
      request<LoadCompositionViewResponse>(fetchImpl, baseUrl, "POST", "/studio/composition-view", body),
    createDraftComposition: async (body: CreateDraftCompositionRequest) =>
      request<CreateDraftCompositionResponse>(fetchImpl, baseUrl, "POST", "/studio/sessions", body),
    getDraftSession: async (sessionId: string) =>
      request<StudioDraftSession>(fetchImpl, baseUrl, "GET", `/studio/sessions/${encodeURIComponent(sessionId)}`),
    applyIntent: async (body: StudioIntent) =>
      request<IntentResponse>(
        fetchImpl,
        baseUrl,
        "POST",
        `/studio/sessions/${encodeURIComponent(body.sessionId)}/intents`,
        body
      ),
    compileCandidate: async (body: CompileDraftCandidateRequest) =>
      request<CompileDraftCandidateResponse>(
        fetchImpl,
        baseUrl,
        "POST",
        `/studio/sessions/${encodeURIComponent(body.sessionId)}/compile`,
        body
      ),
    getVisualAsset: async (assetId: string) =>
      request<StudioVisualAsset>(fetchImpl, baseUrl, "GET", `/studio/assets/${encodeURIComponent(assetId)}`)
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
