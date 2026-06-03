import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { createHttpStudioFabricClient, type StudioFabricClient } from "@unfurl/fabric-validation-client";
import { createFixtureStudioFabricClient } from "./fixtures/deploymentResolutionFixtures.js";

const StudioClientContext = createContext<Pick<StudioFabricClient, "resolveDeployment"> | null>(null);

export type StudioClientProviderProps = {
  readonly children: ReactNode;
  readonly mode?: "live" | "fixture";
};

export function StudioClientProvider({ children, mode = studioMode() }: StudioClientProviderProps) {
  const client = mode === "fixture"
    ? createFixtureStudioFabricClient()
    : createHttpStudioFabricClient({ baseUrl: "" });
  return (
    <StudioClientContext.Provider value={client}>
      {children}
    </StudioClientContext.Provider>
  );
}

export function useStudioClient(): Pick<StudioFabricClient, "resolveDeployment"> {
  const client = useContext(StudioClientContext);
  if (!client) {
    throw new Error("StudioClientProvider is required");
  }
  return client;
}

export function studioMode(): "live" | "fixture" {
  const env = (import.meta as ImportMeta & { readonly env?: { readonly VITE_STUDIO_MODE?: string } }).env;
  return env?.VITE_STUDIO_MODE === "fixture" ? "fixture" : "live";
}
