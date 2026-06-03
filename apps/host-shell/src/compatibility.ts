import type { WebappCompatibility } from "@unfurl/ui-contracts";

export type HostCompatibility = {
  readonly hostShell: string;
  readonly hostShellApi: string;
  readonly microAppProps: string;
  readonly eventBus: string;
  readonly themeSystem: string;
};

export type CompatibilityFailure = {
  readonly field: keyof HostCompatibility;
  readonly requiredRange: string;
  readonly actualVersion: string;
};

export type CompatibilityResult =
  | {
      readonly compatible: true;
    }
  | {
      readonly compatible: false;
      readonly failures: readonly CompatibilityFailure[];
    };

export function checkWebappCompatibility(
  required: WebappCompatibility,
  host: HostCompatibility
): CompatibilityResult {
  const failures: CompatibilityFailure[] = [];
  checkRange("hostShell", required.hostShell, host.hostShell, failures);
  checkRange("hostShellApi", required.hostShellApi, host.hostShellApi, failures);
  checkRange("microAppProps", required.microAppProps, host.microAppProps, failures);
  checkRange("eventBus", required.eventBus, host.eventBus, failures);
  checkRange("themeSystem", required.themeSystem, host.themeSystem, failures);

  return failures.length === 0
    ? { compatible: true }
    : { compatible: false, failures };
}

export function versionSatisfiesRange(version: string, range: string): boolean {
  return range.split(/\s+/)
    .filter(part => part.trim() !== "")
    .every(part => satisfiesComparator(version, part));
}

function checkRange(
  field: keyof HostCompatibility,
  requiredRange: string,
  actualVersion: string,
  failures: CompatibilityFailure[]
): void {
  if (!versionSatisfiesRange(actualVersion, requiredRange)) {
    failures.push({ field, requiredRange, actualVersion });
  }
}

function satisfiesComparator(version: string, comparator: string): boolean {
  const match = comparator.match(/^(>=|>|<=|<|=)?(.+)$/);
  if (!match) {
    return false;
  }
  const operator = match[1] ?? "=";
  const expected = match[2] ?? "";
  const compared = compareVersions(version, expected);

  return switchComparator(operator, compared);
}

function switchComparator(operator: string, compared: number): boolean {
  switch (operator) {
    case ">=":
      return compared >= 0;
    case ">":
      return compared > 0;
    case "<=":
      return compared <= 0;
    case "<":
      return compared < 0;
    case "=":
      return compared === 0;
    default:
      return false;
  }
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index++) {
    const delta = versionPart(leftParts, index) - versionPart(rightParts, index);
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }
  return 0;
}

function parseVersion(version: string): readonly [number, number, number] {
  const clean = version.replace(/^v/, "").split("-", 1)[0] ?? "";
  const parts = clean.split(".").map(part => Number.parseInt(part, 10));
  return [
    finitePart(parts[0]),
    finitePart(parts[1]),
    finitePart(parts[2])
  ];
}

function versionPart(parts: readonly [number, number, number], index: number): number {
  return parts[index] ?? 0;
}

function finitePart(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}
