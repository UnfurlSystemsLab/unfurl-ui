import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_STUDIO_ASSEMBLY_ID,
  DEFAULT_STUDIO_TENANT_ID,
  createHttpStudioFabricClient,
  type StudioFabricClient
} from "@unfurl/fabric-validation-client";
import { createFixtureStudioFabricClient } from "./fixtures/deploymentResolutionFixtures.js";

const StudioClientContext = createContext<StudioFabricClient | null>(null);
const StudioModeContext = createContext<"live" | "fixture">("live");

// Origin-relative by default. The client appends `/studio/...` paths, so an
// empty base produces same-origin requests like `/studio/tenants/...`. In dev
// those hit the Vite `/studio` proxy (see vite.config.ts) which forwards to the
// backend on :7878 — no cross-origin hop, and a down backend surfaces as a
// readable proxy error instead of the browser's opaque "Failed to fetch". In a
// prod build the UI and API are served from the same origin (or a reverse
// proxy), so relative still works. Set VITE_STUDIO_API_BASE_URL to an absolute
// URL to target a backend on a different origin. "/" normalizes to "" in the
// client's normalizeBaseUrl (trailing slash stripped), satisfying its
// non-empty guard while staying origin-relative.
const DEFAULT_STUDIO_API_BASE_URL = "/";

export type StudioClientProviderProps = {
  readonly children: ReactNode;
  readonly getAccessToken?: (() => Promise<string>) | undefined;
  readonly mode?: "live" | "fixture";
  readonly apiBaseUrl?: string;
  readonly tenantId?: string;
  readonly assemblyId?: string;
};

/** Factory: bind a stable product client to explicit scope, mode and host authentication. */
export function StudioClientProvider({
  children,
  mode = studioMode(),
  apiBaseUrl = studioApiBaseUrl(),
  tenantId = studioTenantId(),
  assemblyId = studioAssemblyId(),
  getAccessToken
}: StudioClientProviderProps) {
  const client = useMemo(() => mode === "fixture"
    ? createFixtureStudioFabricClient()
    : createHttpStudioFabricClient({
        baseUrl: apiBaseUrl,
        defaultTenantId: tenantId,
        defaultAssemblyId: assemblyId,
        ...(getAccessToken ? { getAccessToken } : {})
      }), [mode, apiBaseUrl, tenantId, assemblyId, getAccessToken]);
  return (
    <StudioModeContext.Provider value={mode}><StudioClientContext.Provider value={client}>
      {children}
    </StudioClientContext.Provider></StudioModeContext.Provider>
  );
}

/** Context port: preview routes follow the explicit provider mode, never infer fixture data from errors. */
export function useStudioMode(): "live" | "fixture" { return useContext(StudioModeContext); }

/** Context port: require the product client selected by the current trusted bootstrap. */
export function useStudioClient(): StudioFabricClient {
  const client = useContext(StudioClientContext);
  if (!client) {
    throw new Error("StudioClientProvider is required");
  }
  return client;
}

/** Configuration Strategy: fixtures require an explicit environment selection. */
export function studioMode(): "live" | "fixture" {
  // Default is "live" — the React app talks to the real Studio backend
  // (StudioCatalogService via HTTP). Fixture mode is a deliberate opt-in
  // for offline development, demos, or screenshot generation; set
  // VITE_STUDIO_MODE=fixture to enable it. Silent default to fixture
  // previously hid the real backend behind a mock that only knew the
  // example tenant — multitenant, real catalogs, and backend changes
  // were all invisible from the UI.
  const env = (import.meta as ImportMeta & { readonly env?: { readonly VITE_STUDIO_MODE?: string } }).env;
  return env?.VITE_STUDIO_MODE === "fixture" ? "fixture" : "live";
}

/** Configuration Adapter: preserve the configured backend origin or same-origin default. */
export function studioApiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { readonly env?: { readonly VITE_STUDIO_API_BASE_URL?: string } }).env;
  const fromEnv = env?.VITE_STUDIO_API_BASE_URL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_STUDIO_API_BASE_URL;
}

/** Configuration Adapter: choose the initial local development tenant. */
export function studioTenantId(): string {
  const env = (import.meta as ImportMeta & { readonly env?: { readonly VITE_STUDIO_TENANT_ID?: string } }).env;
  const fromEnv = env?.VITE_STUDIO_TENANT_ID?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_STUDIO_TENANT_ID;
}

/** Configuration Adapter: choose the initial local development assembly. */
export function studioAssemblyId(): string {
  const env = (import.meta as ImportMeta & { readonly env?: { readonly VITE_STUDIO_ASSEMBLY_ID?: string } }).env;
  const fromEnv = env?.VITE_STUDIO_ASSEMBLY_ID?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_STUDIO_ASSEMBLY_ID;
}

export function studioDemoFallbacks(): boolean {
  // Default is OFF — the Studio shows real backend data (catalog, dynamic
  // DCP projection, replacement candidates) or an honest empty/error state
  // when an endpoint returns nothing. Set VITE_STUDIO_DEMO_FALLBACKS=true to
  // re-enable the generated demo catalog, the hardcoded sample assembly, and
  // local demo replacement options — useful for offline UI development,
  // demos, and screenshot generation without a live backend. Defaulting these
  // on previously mixed fictional, ungoverned content into a governed
  // workbench, hiding backend failures behind plausible-looking demo data.
  const env = (import.meta as ImportMeta & { readonly env?: { readonly VITE_STUDIO_DEMO_FALLBACKS?: string } }).env;
  return env?.VITE_STUDIO_DEMO_FALLBACKS === "true";
}
