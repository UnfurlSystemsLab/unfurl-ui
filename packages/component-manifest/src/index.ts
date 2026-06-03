import type { WebappCompatibility } from "@unfurl/ui-contracts";

export type ComponentWebappManifest = {
  readonly component: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
  readonly webapp: {
    readonly type: "single-spa-application";
    readonly name: string;
    readonly routePrefix: string;
    readonly standaloneUrl?: string;
    readonly importMap: {
      readonly key: string;
    };
    readonly navigation: NavigationContribution;
    readonly permissions: readonly string[];
    readonly themeContribution?: ThemeContribution;
  };
  readonly compatibility: WebappCompatibility;
};

export type NavigationContribution = {
  readonly section: string;
  readonly title: string;
  readonly icon: string;
  readonly order: number;
};

export type ThemeContribution = {
  readonly mode: "suggestive";
  readonly tokens: Readonly<Record<string, string>>;
};

export type ManifestValidationError = {
  readonly path: string;
  readonly message: string;
};

export type ManifestValidationResult =
  | {
      readonly valid: true;
      readonly manifest: ComponentWebappManifest;
    }
  | {
      readonly valid: false;
      readonly errors: readonly ManifestValidationError[];
    };

export function validateComponentWebappManifest(value: unknown): ManifestValidationResult {
  const errors: ManifestValidationError[] = [];

  if (!isRecord(value)) {
    return { valid: false, errors: [{ path: "$", message: "manifest must be an object" }] };
  }

  const component = readRecord(value, "component", errors);
  const webapp = readRecord(value, "webapp", errors);
  const compatibility = readRecord(value, "compatibility", errors);

  if (component) {
    requireString(component, "id", "component.id", errors);
    requireString(component, "name", "component.name", errors);
    requireString(component, "version", "component.version", errors);
  }

  if (webapp) {
    requireLiteral(webapp, "type", "single-spa-application", "webapp.type", errors);
    requireString(webapp, "name", "webapp.name", errors);
    const routePrefix = requireString(webapp, "routePrefix", "webapp.routePrefix", errors);
    if (routePrefix && !routePrefix.startsWith("/")) {
      errors.push({ path: "webapp.routePrefix", message: "routePrefix must start with /" });
    }
    readRecord(webapp, "importMap", errors);
    const importMap = isRecord(webapp.importMap) ? webapp.importMap : undefined;
    if (importMap) {
      requireString(importMap, "key", "webapp.importMap.key", errors);
    }
    readRecord(webapp, "navigation", errors);
    const navigation = isRecord(webapp.navigation) ? webapp.navigation : undefined;
    if (navigation) {
      requireString(navigation, "section", "webapp.navigation.section", errors);
      requireString(navigation, "title", "webapp.navigation.title", errors);
      requireString(navigation, "icon", "webapp.navigation.icon", errors);
      requireNumber(navigation, "order", "webapp.navigation.order", errors);
    }
    if (!Array.isArray(webapp.permissions) || !webapp.permissions.every(item => typeof item === "string")) {
      errors.push({ path: "webapp.permissions", message: "permissions must be an array of strings" });
    }
    if (webapp.themeContribution !== undefined) {
      const themeContribution = isRecord(webapp.themeContribution) ? webapp.themeContribution : undefined;
      if (!themeContribution) {
        errors.push({ path: "webapp.themeContribution", message: "themeContribution must be an object" });
      } else {
        requireLiteral(themeContribution, "mode", "suggestive", "webapp.themeContribution.mode", errors);
        if (!isStringRecord(themeContribution.tokens)) {
          errors.push({
            path: "webapp.themeContribution.tokens",
            message: "tokens must be an object of string values"
          });
        }
      }
    }
  }

  if (compatibility) {
    requireString(compatibility, "hostShell", "compatibility.hostShell", errors);
    requireString(compatibility, "hostShellApi", "compatibility.hostShellApi", errors);
    requireString(compatibility, "microAppProps", "compatibility.microAppProps", errors);
    requireString(compatibility, "eventBus", "compatibility.eventBus", errors);
    requireString(compatibility, "themeSystem", "compatibility.themeSystem", errors);
    requireString(compatibility, "componentContract", "compatibility.componentContract", errors);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, manifest: value as ComponentWebappManifest };
}

export function assertValidComponentWebappManifest(value: unknown): ComponentWebappManifest {
  const result = validateComponentWebappManifest(value);
  if (!result.valid) {
    const summary = result.errors.map(error => `${error.path}: ${error.message}`).join("; ");
    throw new Error(`invalid component webapp manifest: ${summary}`);
  }
  return result.manifest;
}

function readRecord(
  value: Record<string, unknown>,
  key: string,
  errors: ManifestValidationError[]
): Record<string, unknown> | undefined {
  const nested = value[key];
  if (!isRecord(nested)) {
    errors.push({ path: key, message: `${key} must be an object` });
    return undefined;
  }
  return nested;
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: ManifestValidationError[]
): string | undefined {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.trim() === "") {
    errors.push({ path, message: "must be a non-empty string" });
    return undefined;
  }
  return candidate;
}

function requireNumber(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: ManifestValidationError[]
): number | undefined {
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    errors.push({ path, message: "must be a finite number" });
    return undefined;
  }
  return candidate;
}

function requireLiteral(
  value: Record<string, unknown>,
  key: string,
  expected: string,
  path: string,
  errors: ManifestValidationError[]
): void {
  if (value[key] !== expected) {
    errors.push({ path, message: `must be ${expected}` });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === "string");
}
