import {
  assertValidComponentWebappManifest,
  type ComponentWebappManifest,
  type NavigationContribution
} from "@unfurl/component-manifest";
import { checkWebappCompatibility, type HostCompatibility } from "./compatibility.js";

export type ImportMap = {
  readonly imports: Readonly<Record<string, string>>;
};

export type HostRegistryInput = {
  readonly manifests: readonly unknown[];
  readonly importMap: ImportMap;
  readonly enabledComponentIds?: readonly string[];
  readonly userPermissions?: readonly string[];
  readonly hostCompatibility?: HostCompatibility;
};

export type RegisteredWebapp = {
  readonly componentId: string;
  readonly appName: string;
  readonly routePrefix: string;
  readonly bundleUrl: string;
  readonly manifest: ComponentWebappManifest;
};

export type NavigationItem = NavigationContribution & {
  readonly componentId: string;
  readonly routePrefix: string;
};

export type HostRegistry = {
  readonly apps: readonly RegisteredWebapp[];
  readonly navigation: readonly NavigationItem[];
  readonly rejected: readonly RejectedWebapp[];
};

export type RejectedWebapp = {
  readonly componentId: string;
  readonly reason: "INCOMPATIBLE";
  readonly details: readonly string[];
};

export function createHostRegistry(input: HostRegistryInput): HostRegistry {
  const enabled = input.enabledComponentIds ? new Set(input.enabledComponentIds) : undefined;
  const permissions = new Set(input.userPermissions ?? []);
  const manifests = input.manifests
    .map(assertValidComponentWebappManifest)
    .filter(manifest => enabled === undefined || enabled.has(manifest.component.id));

  const compatible = filterCompatible(manifests, input.hostCompatibility);
  const apps = compatible.manifests.map(manifest => registerWebapp(manifest, input.importMap));
  const navigation = compatible.manifests
    .filter(manifest => isNavigationVisible(manifest, permissions))
    .map(manifest => ({
      ...manifest.webapp.navigation,
      componentId: manifest.component.id,
      routePrefix: manifest.webapp.routePrefix
    }))
    .sort(compareNavigation);

  return { apps, navigation, rejected: compatible.rejected };
}

function registerWebapp(manifest: ComponentWebappManifest, importMap: ImportMap): RegisteredWebapp {
  const importKey = manifest.webapp.importMap.key;
  const bundleUrl = importMap.imports[importKey];
  if (!bundleUrl) {
    throw new Error(`no import-map entry for ${importKey}`);
  }
  return {
    componentId: manifest.component.id,
    appName: manifest.webapp.name,
    routePrefix: manifest.webapp.routePrefix,
    bundleUrl,
    manifest
  };
}

function isNavigationVisible(manifest: ComponentWebappManifest, permissions: ReadonlySet<string>): boolean {
  return manifest.webapp.permissions.length === 0
    || manifest.webapp.permissions.some(permission => permissions.has(permission));
}

function compareNavigation(left: NavigationItem, right: NavigationItem): number {
  return left.section.localeCompare(right.section)
    || left.order - right.order
    || left.title.localeCompare(right.title);
}

function filterCompatible(
  manifests: readonly ComponentWebappManifest[],
  hostCompatibility: HostCompatibility | undefined
): { readonly manifests: readonly ComponentWebappManifest[]; readonly rejected: readonly RejectedWebapp[] } {
  if (!hostCompatibility) {
    return { manifests, rejected: [] };
  }

  const accepted: ComponentWebappManifest[] = [];
  const rejected: RejectedWebapp[] = [];
  for (const manifest of manifests) {
    const result = checkWebappCompatibility(manifest.compatibility, hostCompatibility);
    if (result.compatible) {
      accepted.push(manifest);
    } else {
      rejected.push({
        componentId: manifest.component.id,
        reason: "INCOMPATIBLE",
        details: result.failures.map(failure =>
          `${failure.field}: requires ${failure.requiredRange}, host has ${failure.actualVersion}`)
      });
    }
  }

  return { manifests: accepted, rejected };
}
