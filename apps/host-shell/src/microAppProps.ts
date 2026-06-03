import type { EventBus, UnfurlMicroAppProps } from "@unfurl/ui-contracts";
import type { ResolvedTheme } from "@unfurl/theme-engine";
import type { RegisteredWebapp } from "./registry.js";

export type HostUserContext = {
  readonly id: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
};

export type HostThemeContext = ResolvedTheme;

export type HostApiContext = {
  readonly platformBaseUrl: string;
  readonly componentBaseUrls?: Readonly<Record<string, string>>;
};

export type HostMicroAppContext = {
  readonly tenantId: string;
  readonly user: HostUserContext;
  readonly auth: {
    readonly getAccessToken: () => Promise<string>;
  };
  readonly api: HostApiContext;
  readonly theme: HostThemeContext;
  readonly eventBus: EventBus;
};

export function createMicroAppProps(
  webapp: RegisteredWebapp,
  context: HostMicroAppContext
): UnfurlMicroAppProps {
  return {
    mode: "hosted",
    componentId: webapp.componentId,
    tenantId: context.tenantId,
    user: context.user,
    auth: context.auth,
    api: {
      platformBaseUrl: context.api.platformBaseUrl,
      componentBaseUrl: componentBaseUrl(webapp, context.api)
    },
    theme: context.theme,
    eventBus: context.eventBus
  };
}

function componentBaseUrl(webapp: RegisteredWebapp, api: HostApiContext): string {
  const explicit = api.componentBaseUrls?.[webapp.componentId];
  if (explicit) {
    return explicit;
  }
  return joinUrl(api.platformBaseUrl, webapp.routePrefix);
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
