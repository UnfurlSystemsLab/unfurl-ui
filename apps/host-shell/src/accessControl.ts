import { findSelectedWebapp } from "./activeTheme.js";
import type { HostRegistry, RegisteredWebapp } from "./registry.js";

export type RouteAccessDecision =
  | {
      readonly allowed: true;
      readonly webapp: RegisteredWebapp;
    }
  | {
      readonly allowed: false;
      readonly reason: "NO_MATCHING_WEBAPP";
      readonly path: string;
    }
  | {
      readonly allowed: false;
      readonly reason: "MISSING_PERMISSION";
      readonly webapp: RegisteredWebapp;
      readonly requiredPermissions: readonly string[];
      readonly userPermissions: readonly string[];
    };

export type TokenProvider = {
  readonly getAccessToken: () => Promise<string>;
};

export function evaluateRouteAccess(
  registry: HostRegistry,
  currentPath: string,
  userPermissions: readonly string[]
): RouteAccessDecision {
  const webapp = findSelectedWebapp(registry, currentPath);
  if (!webapp) {
    return {
      allowed: false,
      reason: "NO_MATCHING_WEBAPP",
      path: currentPath
    };
  }

  if (hasAnyRequiredPermission(webapp.manifest.webapp.permissions, userPermissions)) {
    return {
      allowed: true,
      webapp
    };
  }

  return {
    allowed: false,
    reason: "MISSING_PERMISSION",
    webapp,
    requiredPermissions: webapp.manifest.webapp.permissions,
    userPermissions
  };
}

export async function requireAccessToken(provider: TokenProvider): Promise<string> {
  const token = await provider.getAccessToken();
  if (!token || token.trim() === "") {
    throw new Error("token provider returned an empty access token");
  }
  return token;
}

function hasAnyRequiredPermission(
  requiredPermissions: readonly string[],
  userPermissions: readonly string[]
): boolean {
  if (requiredPermissions.length === 0) {
    return true;
  }
  const granted = new Set(userPermissions);
  return requiredPermissions.some(permission => granted.has(permission));
}
