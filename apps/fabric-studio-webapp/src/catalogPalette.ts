import type { StudioFabricClient } from "@unfurl/fabric-validation-client";
import type { FallbackShape, VisualCatalogEntry, VisualWarning } from "@unfurl/visual-manifest";

export type CatalogPaletteItem = {
  readonly catalogEntryId: string;
  readonly category: FallbackShape["category"] | "UNCATEGORIZED";
  readonly shape: FallbackShape["kind"] | "UNKNOWN";
  readonly visualMode: "CUSTOM_MODEL" | "FALLBACK_SHAPE" | "NO_VISUAL_MANIFEST";
  readonly warningCount: number;
  readonly warnings: readonly VisualWarning[];
};

export type CatalogPaletteGroup = {
  readonly category: CatalogPaletteItem["category"];
  readonly items: readonly CatalogPaletteItem[];
};

export type CatalogPalette = {
  readonly catalogHash: string;
  readonly groups: readonly CatalogPaletteGroup[];
  readonly warningCount: number;
};

export type CatalogPaletteFilter = {
  readonly tenantId?: string;
  readonly query?: string;
  readonly category?: CatalogPaletteItem["category"];
  readonly includeWarningsOnly?: boolean;
};

export type CatalogPaletteState =
  | {
      readonly status: "READY";
      readonly palette: CatalogPalette;
    }
  | {
      readonly status: "FAILED";
      readonly message: string;
    };

export async function loadCatalogPalette(
  client: Pick<StudioFabricClient, "listCatalogVisuals">,
  filter: CatalogPaletteFilter = {}
): Promise<CatalogPaletteState> {
  try {
    const response = await client.listCatalogVisuals(
      filter.tenantId === undefined ? undefined : { tenantId: filter.tenantId }
    );
    return {
      status: "READY",
      palette: buildCatalogPalette(response.catalogHash, response.entries, filter)
    };
  } catch (error) {
    return {
      status: "FAILED",
      message: errorMessage(error)
    };
  }
}

export function buildCatalogPalette(
  catalogHash: string,
  entries: readonly VisualCatalogEntry[],
  filter: CatalogPaletteFilter = {}
): CatalogPalette {
  const items = entries
    .map(toItem)
    .filter(item => matchesFilter(item, filter))
    .sort(compareItems);

  const grouped = new Map<CatalogPaletteItem["category"], CatalogPaletteItem[]>();
  for (const item of items) {
    const group = grouped.get(item.category) ?? [];
    group.push(item);
    grouped.set(item.category, group);
  }

  return {
    catalogHash,
    groups: [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, groupItems]) => ({ category, items: groupItems })),
    warningCount: items.reduce((total, item) => total + item.warningCount, 0)
  };
}

export function renderCatalogPaletteText(palette: CatalogPalette): string {
  const lines = [`catalog: ${palette.catalogHash}`, `warnings: ${palette.warningCount}`];
  for (const group of palette.groups) {
    lines.push("", group.category);
    for (const item of group.items) {
      lines.push(`- ${item.catalogEntryId} [${item.visualMode}, warnings=${item.warningCount}]`);
    }
  }
  return lines.join("\n");
}

function toItem(entry: VisualCatalogEntry): CatalogPaletteItem {
  const fallback = entry.visualManifest?.fallbackShape;
  return {
    catalogEntryId: entry.catalogEntryId,
    category: fallback?.category ?? "UNCATEGORIZED",
    shape: fallback?.kind ?? "UNKNOWN",
    visualMode: visualMode(entry),
    warningCount: entry.warnings.length,
    warnings: entry.warnings
  };
}

function visualMode(entry: VisualCatalogEntry): CatalogPaletteItem["visualMode"] {
  if (!entry.visualManifest) {
    return "NO_VISUAL_MANIFEST";
  }
  return entry.visualManifest.model ? "CUSTOM_MODEL" : "FALLBACK_SHAPE";
}

function matchesFilter(item: CatalogPaletteItem, filter: CatalogPaletteFilter): boolean {
  if (filter.category && item.category !== filter.category) {
    return false;
  }
  if (filter.includeWarningsOnly && item.warningCount === 0) {
    return false;
  }
  if (filter.query && !item.catalogEntryId.toLowerCase().includes(filter.query.toLowerCase())) {
    return false;
  }
  return true;
}

function compareItems(left: CatalogPaletteItem, right: CatalogPaletteItem): number {
  return left.category.localeCompare(right.category)
    || left.catalogEntryId.localeCompare(right.catalogEntryId);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  return "unable to load catalog visuals";
}
