import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertValidVisualManifest, validateVisualManifest } from "./index.js";

describe("visual manifest validation", () => {
  it("accepts a visual manifest that maps ports to DCP claim facts", () => {
    const manifest = assertValidVisualManifest({
      model: { type: "GLB", path: "META-INF/visual/storage.glb" },
      fallbackShape: { kind: "CUBE", category: "STORAGE" },
      ports: [
        {
          id: "storage-put",
          mapsTo: "claim.offers[storage.put]",
          kind: "OFFER",
          anchor: "right-upper",
          connectorShape: "SQUARE_SOCKET"
        }
      ],
      interactions: {
        draggable: true,
        connectable: true,
        inspectable: true
      }
    });

    assert.equal(manifest.fallbackShape.category, "STORAGE");
  });

  it("rejects semantic ports that do not map to DCP claim facts", () => {
    const result = validateVisualManifest({
      fallbackShape: { kind: "CUBE", category: "STORAGE" },
      ports: [
        {
          id: "made-up",
          mapsTo: "visual.synthetic.port",
          kind: "OFFER",
          anchor: "right",
          connectorShape: "ROUND"
        }
      ],
      interactions: {
        draggable: true,
        connectable: true,
        inspectable: true
      }
    });

    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.errors.some(error => error.path === "ports[0].mapsTo"));
    }
  });
});
