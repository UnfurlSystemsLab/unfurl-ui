export type VisualManifest = {
  readonly model?: VisualModel;
  readonly fallbackShape: FallbackShape;
  readonly ports: readonly VisualManifestPort[];
  readonly interactions: VisualInteractions;
};

export type VisualModel = {
  readonly type: "GLB";
  readonly path: string;
};

export type FallbackShape = {
  readonly kind: "CUBE" | "SPHERE" | "CYLINDER" | "SHIELD" | "GEAR";
  readonly category: "STORAGE" | "AUTH" | "AI" | "AUDIT" | "WORKFLOW" | "SUBSTRATE";
};

export type VisualManifestPort = {
  readonly id: string;
  readonly mapsTo: string;
  readonly kind: "OFFER" | "DEPENDENCY" | "SUBSTRATE_DEPENDENCY" | "REFUSAL";
  readonly anchor: string;
  readonly connectorShape: "ROUND" | "SQUARE" | "HEX" | "PIPE" | "LOCK" | "SQUARE_SOCKET" | "HEX_SOCKET";
};

export type VisualInteractions = {
  readonly draggable: boolean;
  readonly connectable: boolean;
  readonly inspectable: boolean;
  readonly removable?: boolean;
};

export type VisualIntegrity = {
  readonly visualManifestHash?: string;
  readonly assets: readonly VisualAssetIntegrity[];
};

export type VisualAssetIntegrity = {
  readonly path: string;
  readonly sha256: string;
};

export type VisualCatalogEntry = {
  readonly catalogEntryId: string;
  readonly claimHash: string;
  readonly artifactSha256: string;
  readonly visualManifest?: VisualManifest;
  readonly visualIntegrity: VisualIntegrity;
  readonly warnings: readonly VisualWarning[];
};

export type VisualWarning = {
  readonly code: "MISSING_VISUAL_MANIFEST" | "INVALID_VISUAL_MANIFEST" | "ASSET_HASH_MISMATCH" | "ASSET_BLOCKED";
  readonly message: string;
};

export type VisualManifestValidationError = {
  readonly path: string;
  readonly message: string;
};

export type VisualManifestValidationResult =
  | {
      readonly valid: true;
      readonly manifest: VisualManifest;
    }
  | {
      readonly valid: false;
      readonly errors: readonly VisualManifestValidationError[];
    };

export function validateVisualManifest(value: unknown): VisualManifestValidationResult {
  const errors: VisualManifestValidationError[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: [{ path: "$", message: "visual manifest must be an object" }] };
  }

  if (value.model !== undefined) {
    const model = isRecord(value.model) ? value.model : undefined;
    if (!model) {
      errors.push({ path: "model", message: "model must be an object" });
    } else {
      requireLiteral(model, "type", "GLB", "model.type", errors);
      requireString(model, "path", "model.path", errors);
    }
  }

  const fallbackShape = readRecord(value, "fallbackShape", errors);
  if (fallbackShape) {
    requireOneOf(fallbackShape, "kind", ["CUBE", "SPHERE", "CYLINDER", "SHIELD", "GEAR"], "fallbackShape.kind", errors);
    requireOneOf(fallbackShape, "category", ["STORAGE", "AUTH", "AI", "AUDIT", "WORKFLOW", "SUBSTRATE"], "fallbackShape.category", errors);
  }

  if (!Array.isArray(value.ports)) {
    errors.push({ path: "ports", message: "ports must be an array" });
  } else {
    value.ports.forEach((port, index) => validatePort(port, `ports[${index}]`, errors));
  }

  const interactions = readRecord(value, "interactions", errors);
  if (interactions) {
    requireBoolean(interactions, "draggable", "interactions.draggable", errors);
    requireBoolean(interactions, "connectable", "interactions.connectable", errors);
    requireBoolean(interactions, "inspectable", "interactions.inspectable", errors);
    if (interactions.removable !== undefined) {
      requireBoolean(interactions, "removable", "interactions.removable", errors);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, manifest: value as VisualManifest };
}

export function assertValidVisualManifest(value: unknown): VisualManifest {
  const result = validateVisualManifest(value);
  if (!result.valid) {
    const summary = result.errors.map(error => `${error.path}: ${error.message}`).join("; ");
    throw new Error(`invalid visual manifest: ${summary}`);
  }
  return result.manifest;
}

function validatePort(value: unknown, path: string, errors: VisualManifestValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({ path, message: "port must be an object" });
    return;
  }
  requireString(value, "id", `${path}.id`, errors);
  const mapsTo = requireString(value, "mapsTo", `${path}.mapsTo`, errors);
  if (mapsTo && !mapsTo.startsWith("claim.")) {
    errors.push({ path: `${path}.mapsTo`, message: "mapsTo must reference a DCP claim fact" });
  }
  requireOneOf(value, "kind", ["OFFER", "DEPENDENCY", "SUBSTRATE_DEPENDENCY", "REFUSAL"], `${path}.kind`, errors);
  requireString(value, "anchor", `${path}.anchor`, errors);
  requireOneOf(value, "connectorShape", ["ROUND", "SQUARE", "HEX", "PIPE", "LOCK", "SQUARE_SOCKET", "HEX_SOCKET"], `${path}.connectorShape`, errors);
}

function readRecord(
  value: Record<string, unknown>,
  key: string,
  errors: VisualManifestValidationError[]
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
  errors: VisualManifestValidationError[]
): string | undefined {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.trim() === "") {
    errors.push({ path, message: "must be a non-empty string" });
    return undefined;
  }
  return candidate;
}

function requireBoolean(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: VisualManifestValidationError[]
): void {
  if (typeof value[key] !== "boolean") {
    errors.push({ path, message: "must be a boolean" });
  }
}

function requireLiteral(
  value: Record<string, unknown>,
  key: string,
  expected: string,
  path: string,
  errors: VisualManifestValidationError[]
): void {
  if (value[key] !== expected) {
    errors.push({ path, message: `must be ${expected}` });
  }
}

function requireOneOf(
  value: Record<string, unknown>,
  key: string,
  expected: readonly string[],
  path: string,
  errors: VisualManifestValidationError[]
): void {
  if (typeof value[key] !== "string" || !expected.includes(value[key])) {
    errors.push({ path, message: `must be one of ${expected.join(", ")}` });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
