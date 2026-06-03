export type ThemeManifest = {
  readonly id: string;
  readonly name: string;
  readonly tokens: Readonly<Record<string, string>>;
};

export type ThemePolicy = {
  readonly mode: "host-only" | "component-adaptive" | "user-selectable" | "tenant-controlled";
};

export type FabricStudioTokenName =
  | "fabricStudio.port.offer.color"
  | "fabricStudio.port.dependency.color"
  | "fabricStudio.port.refusal.color"
  | "fabricStudio.pipe.valid.material"
  | "fabricStudio.pipe.invalid.material"
  | "fabricStudio.substrate.active.color"
  | "fabricStudio.substrate.inactive.opacity";

export type ThemeContribution = {
  readonly mode: "suggestive";
  readonly tokens: Readonly<Record<string, string>>;
};

export type ThemeResolutionInput = {
  readonly baseTheme: ThemeManifest;
  readonly tenantOverrides?: Readonly<Record<string, string>>;
  readonly userOverrides?: Readonly<Record<string, string>>;
  readonly componentContribution?: ThemeContribution;
  readonly policy: ThemePolicy;
};

export type ResolvedTheme = {
  readonly activeThemeId: string;
  readonly tokens: Readonly<Record<string, string>>;
  readonly mode: "host" | "component-adaptive";
};

export type ThemeValidationError = {
  readonly path: string;
  readonly message: string;
};

export type ThemeValidationResult =
  | {
      readonly valid: true;
      readonly theme: ThemeManifest;
    }
  | {
      readonly valid: false;
      readonly errors: readonly ThemeValidationError[];
    };

export function validateThemeManifest(value: unknown): ThemeValidationResult {
  const errors: ThemeValidationError[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: [{ path: "$", message: "theme manifest must be an object" }] };
  }

  requireString(value, "id", "id", errors);
  requireString(value, "name", "name", errors);
  const tokens = value.tokens;
  if (!isStringRecord(tokens)) {
    errors.push({ path: "tokens", message: "tokens must be an object of string values" });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, theme: value as ThemeManifest };
}

export function assertValidThemeManifest(value: unknown): ThemeManifest {
  const result = validateThemeManifest(value);
  if (!result.valid) {
    const summary = result.errors.map(error => `${error.path}: ${error.message}`).join("; ");
    throw new Error(`invalid theme manifest: ${summary}`);
  }
  return result.theme;
}

export function resolveTheme(input: ThemeResolutionInput): ResolvedTheme {
  const useComponentContribution = input.policy.mode === "component-adaptive"
    || input.policy.mode === "user-selectable"
    || input.policy.mode === "tenant-controlled";

  return {
    activeThemeId: input.baseTheme.id,
    mode: useComponentContribution ? "component-adaptive" : "host",
    tokens: {
      ...input.baseTheme.tokens,
      ...(input.tenantOverrides ?? {}),
      ...(input.userOverrides ?? {}),
      ...(useComponentContribution ? input.componentContribution?.tokens ?? {} : {})
    }
  };
}

export function toCssVariables(tokens: Readonly<Record<string, string>>, prefix = "--unfurl"): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [`${prefix}-${tokenNameToCssName(key)}`, value])
  );
}

function tokenNameToCssName(tokenName: string): string {
  return tokenName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: ThemeValidationError[]
): void {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.trim() === "") {
    errors.push({ path, message: "must be a non-empty string" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === "string");
}
