import { createInMemoryEventBus } from "@unfurl/event-bus";
import type { HostMicroAppContext } from "./microAppProps.js";
import type { HostCompatibility } from "./compatibility.js";
import type { HostRegistryInput } from "./registry.js";
import type { ThemeManifest, ThemePolicy } from "@unfurl/theme-engine";

/** Host port: deployment supplies trusted modules and identity, never a route or model payload. */
export type HostRuntime = {
  readonly registry: HostRegistryInput;
  readonly context: HostMicroAppContext;
  readonly baseTheme: ThemeManifest;
  readonly themePolicy: ThemePolicy;
  readonly authentication: "authenticated" | "local-development";
  readonly approvedBundleUrls: readonly string[];
};

export const hostCompatibility: HostCompatibility = {
  hostShell: "1.0.0", hostShellApi: "1.0.0", microAppProps: "1.0.0", eventBus: "1.0.0", themeSystem: "1.0.0"
};
export const studioManifest = {
  component: { id: "fabric-studio", name: "Fabric Studio", version: "0.1.0-SNAPSHOT" },
  webapp: { type: "single-spa-application", name: "@unfurl/fabric-studio-webapp",
    routePrefix: "/components/fabric-studio", importMap: { key: "@unfurl/fabric-studio-webapp" },
    navigation: { section: "Design", title: "Studio", icon: "box", order: 0 }, permissions: ["studio.view"] },
  compatibility: { hostShell: ">=1.0.0 <2.0.0", hostShellApi: ">=1.0.0 <2.0.0",
    microAppProps: ">=1.0.0 <2.0.0", eventBus: ">=1.0.0 <2.0.0", themeSystem: ">=1.0.0 <2.0.0", componentContract: "studio@0.1" }
};

/** Factory: explicit local development is not authenticated production identity. */
export function localHostRuntime(tenantId: string, apiBaseUrl = "/"): HostRuntime {
  return {
    registry: { manifests: [studioManifest], importMap: { imports: { "@unfurl/fabric-studio-webapp": "bundled:studio" } }, hostCompatibility },
    authentication: "local-development", approvedBundleUrls: [],
    baseTheme: { id: "default", name: "Default", tokens: { background: "#f6f7f9", foreground: "#171717", primary: "#2563eb" } },
    themePolicy: { mode: "host-only" },
    context: { tenantId, user: { id: "local-development", roles: [], permissions: ["studio.view"] },
      auth: { getAccessToken: async () => { throw new Error("No authenticated host profile configured"); } },
      api: { platformBaseUrl: apiBaseUrl, componentBaseUrls: { "fabric-studio": apiBaseUrl } },
      theme: { activeThemeId: "default", mode: "host", tokens: {} },
      eventBus: createInMemoryEventBus()
    }
  };
}
