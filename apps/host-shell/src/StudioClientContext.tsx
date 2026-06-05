import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_STUDIO_ASSEMBLY_ID,
  DEFAULT_STUDIO_TENANT_ID,
  createHttpStudioFabricClient,
  type StudioFabricClient
} from "@unfurl/fabric-validation-client";
import { createFixtureStudioFabricClient } from "./fixtures/deploymentResolutionFixtures.js";

const StudioClientContext = createContext<StudioFabricClient | null>(null);

const DEFAULT_STUDIO_API_BASE_URL = "http://127.0.0.1:7878";

export type StudioClientProviderProps = {
  readonly children: ReactNode;
  readonly mode?: "live" | "fixture";
  readonly apiBaseUrl?: string;
  readonly tenantId?: string;
  readonly assemblyId?: string;
};

export function StudioClientProvider({
  children,
  mode = studioMode(),
  apiBaseUrl = studioApiBaseUrl(),
  tenantId = studioTenantId(),
  assemblyId = studioAssemblyId()
}: StudioClientProviderProps) {
  const client = mode === "fixture"
    ? createFixtureStudioFabricClient()
    : createHttpStudioFabricClient({
        baseUrl: apiBaseUrl,
        defaultTenantId: tenantId,
        defaultAssemblyId: assemblyId
      });
  return (
    <StudioClientContext.Provider value={client}>
      {children}
    </StudioClientContext.Provider>
  );
}

export function useStudioClient(): StudioFabricClient {
  const client = useContext(StudioClientContext);
  if (!client) {
    throw new Error("StudioClientProvider is required");
  }
  return client;
}

export function studioMode(): "live" | "fixture" {
  const env = (import.meta as ImportMeta & { readonly env?: { readonly VITE_STUDIO_MODE?: string } }).env;
  return env?.VITE_STUDIO_MODE === "live" ? "live" : "fixture";
}

export function studioApiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { readonly env?: { readonly VITE_STUDIO_API_BASE_URL?: string } }).env;
  const fromEnv = env?.VITE_STUDIO_API_BASE_URL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_STUDIO_API_BASE_URL;
}

export function studioTenantId(): string {
  const env = (import.meta as ImportMeta & { readonly env?: { readonly VITE_STUDIO_TENANT_ID?: string } }).env;
  const fromEnv = env?.VITE_STUDIO_TENANT_ID?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_STUDIO_TENANT_ID;
}

export function studioAssemblyId(): string {
  const env = (import.meta as ImportMeta & { readonly env?: { readonly VITE_STUDIO_ASSEMBLY_ID?: string } }).env;
  const fromEnv = env?.VITE_STUDIO_ASSEMBLY_ID?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_STUDIO_ASSEMBLY_ID;
}
