import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogPalette,
  loadCatalogPalette,
  renderCatalogPaletteText
} from "./catalogPalette.js";
import type { VisualCatalogEntry } from "@unfurl/visual-manifest";

describe("catalog palette", () => {
  it("groups catalog visuals by category and summarizes warnings", () => {
    const palette = buildCatalogPalette("sha256:catalog", [
      entry("com.unfurl:storage-s3:1.2.0", "STORAGE", "CUBE", []),
      entry("com.unfurl:gemini:1.0.0", "AI", "SPHERE", [
        { code: "ASSET_HASH_MISMATCH", message: "bad glb hash" }
      ])
    ]);

    assert.deepEqual(palette.groups.map(group => group.category), ["AI", "STORAGE"]);
    assert.equal(palette.warningCount, 1);
    assert.equal(palette.groups[0]?.items[0]?.visualMode, "FALLBACK_SHAPE");

    const text = renderCatalogPaletteText(palette);
    assert.match(text, /com.unfurl:gemini:1.0.0/);
    assert.match(text, /warnings=1/);
  });

  it("filters by query category and warnings", () => {
    const palette = buildCatalogPalette("sha256:catalog", [
      entry("com.unfurl:storage-s3:1.2.0", "STORAGE", "CUBE", []),
      entry("com.unfurl:storage-blob:1.1.0", "STORAGE", "CUBE", [
        { code: "MISSING_VISUAL_MANIFEST", message: "using fallback" }
      ]),
      entry("com.unfurl:gemini:1.0.0", "AI", "SPHERE", [])
    ], {
      query: "storage",
      category: "STORAGE",
      includeWarningsOnly: true
    });

    assert.deepEqual(palette.groups.map(group => group.items.map(item => item.catalogEntryId)), [
      ["com.unfurl:storage-blob:1.1.0"]
    ]);
  });

  it("loads palette state from the Fabric client and maps failures to state", async () => {
    const ready = await loadCatalogPalette({
      listCatalogVisuals: async () => ({
        catalogHash: "sha256:catalog",
        entries: [entry("com.unfurl:storage-s3:1.2.0", "STORAGE", "CUBE", [])]
      })
    });

    assert.equal(ready.status, "READY");

    const failed = await loadCatalogPalette({
      listCatalogVisuals: async () => {
        throw new Error("catalog unavailable");
      }
    });

    assert.deepEqual(failed, {
      status: "FAILED",
      message: "catalog unavailable"
    });
  });
});

function entry(
  catalogEntryId: string,
  category: "STORAGE" | "AUTH" | "AI" | "AUDIT" | "WORKFLOW" | "SUBSTRATE" | "COMPONENT",
  kind: "CUBE" | "SPHERE" | "CYLINDER" | "SHIELD" | "GEAR",
  warnings: VisualCatalogEntry["warnings"]
): VisualCatalogEntry {
  return {
    catalogEntryId,
    claimHash: "sha256:claim",
    artifactSha256: "sha256:artifact",
    visualManifest: {
      fallbackShape: { category, kind },
      ports: [],
      interactions: { draggable: true, connectable: true, inspectable: true }
    },
    visualIntegrity: { assets: [] },
    warnings
  };
}
