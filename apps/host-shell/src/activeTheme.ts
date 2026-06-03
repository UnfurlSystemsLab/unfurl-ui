import { resolveTheme, type ResolvedTheme, type ThemeManifest, type ThemePolicy } from "@unfurl/theme-engine";
import type { HostRegistry, RegisteredWebapp } from "./registry.js";

export type ActiveThemeInput = {
  readonly registry: HostRegistry;
  readonly currentPath: string;
  readonly baseTheme: ThemeManifest;
  readonly policy: ThemePolicy;
  readonly tenantOverrides?: Readonly<Record<string, string>>;
  readonly userOverrides?: Readonly<Record<string, string>>;
};

export type ActiveThemeResult = {
  readonly selectedWebapp?: RegisteredWebapp;
  readonly theme: ResolvedTheme;
};

export function findSelectedWebapp(registry: HostRegistry, currentPath: string): RegisteredWebapp | undefined {
  const normalized = normalizePath(currentPath);
  return [...registry.apps]
    .filter(app => pathMatchesRoute(normalized, app.routePrefix))
    .sort((left, right) => right.routePrefix.length - left.routePrefix.length)[0];
}

export function resolveActiveTheme(input: ActiveThemeInput): ActiveThemeResult {
  const selectedWebapp = findSelectedWebapp(input.registry, input.currentPath);
  const themeInput = {
    baseTheme: input.baseTheme,
    policy: input.policy,
    ...(input.tenantOverrides ? { tenantOverrides: input.tenantOverrides } : {}),
    ...(input.userOverrides ? { userOverrides: input.userOverrides } : {}),
    ...(selectedWebapp?.manifest.webapp.themeContribution
      ? { componentContribution: selectedWebapp.manifest.webapp.themeContribution }
      : {})
  };
  return {
    ...(selectedWebapp ? { selectedWebapp } : {}),
    theme: resolveTheme(themeInput)
  };
}

function pathMatchesRoute(currentPath: string, routePrefix: string): boolean {
  const normalizedPrefix = normalizePath(routePrefix);
  return currentPath === normalizedPrefix || currentPath.startsWith(`${normalizedPrefix}/`);
}

function normalizePath(path: string): string {
  if (!path || path === "/") {
    return "/";
  }
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? "/";
  const normalized = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return normalized.replace(/\/+$/, "") || "/";
}
