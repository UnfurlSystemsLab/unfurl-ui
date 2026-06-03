import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertValidThemeManifest,
  resolveTheme,
  toCssVariables,
  validateThemeManifest
} from "./index.js";

describe("theme engine", () => {
  it("validates theme manifests", () => {
    const theme = assertValidThemeManifest({
      id: "enterprise-light",
      name: "Enterprise Light",
      tokens: {
        "color.accent": "#2563eb"
      }
    });

    assert.equal(theme.id, "enterprise-light");

    const invalid = validateThemeManifest({
      id: "broken",
      name: "Broken",
      tokens: {
        "color.accent": 7
      }
    });

    assert.equal(invalid.valid, false);
    if (!invalid.valid) {
      assert.ok(invalid.errors.some(error => error.path === "tokens"));
    }
  });

  it("resolves tokens with host-only policy ignoring component contribution", () => {
    const resolved = resolveTheme({
      baseTheme: {
        id: "default",
        name: "Default",
        tokens: {
          "color.accent": "#111111",
          "fabricStudio.port.offer.color": "#22c55e"
        }
      },
      tenantOverrides: {
        "color.accent": "#222222"
      },
      userOverrides: {
        "density": "compact"
      },
      componentContribution: {
        mode: "suggestive",
        tokens: {
          "color.accent": "#ff00ff"
        }
      },
      policy: {
        mode: "host-only"
      }
    });

    assert.equal(resolved.mode, "host");
    assert.equal(resolved.tokens["color.accent"], "#222222");
    assert.equal(resolved.tokens["density"], "compact");
    assert.equal(resolved.tokens["fabricStudio.port.offer.color"], "#22c55e");
  });

  it("resolves component-adaptive tokens after host/user layers", () => {
    const resolved = resolveTheme({
      baseTheme: {
        id: "default",
        name: "Default",
        tokens: {
          "color.accent": "#111111"
        }
      },
      tenantOverrides: {
        "color.accent": "#222222"
      },
      userOverrides: {
        "density": "compact"
      },
      componentContribution: {
        mode: "suggestive",
        tokens: {
          "color.accent": "#7c3aed",
          "icon": "search"
        }
      },
      policy: {
        mode: "component-adaptive"
      }
    });

    assert.equal(resolved.mode, "component-adaptive");
    assert.equal(resolved.tokens["color.accent"], "#7c3aed");
    assert.equal(resolved.tokens["density"], "compact");
    assert.equal(resolved.tokens["icon"], "search");
  });

  it("converts token names to CSS custom property names", () => {
    const css = toCssVariables({
      "fabricStudio.port.offer.color": "#22c55e",
      "color.accent": "#2563eb"
    });

    assert.equal(css["--unfurl-fabricstudio-port-offer-color"], "#22c55e");
    assert.equal(css["--unfurl-color-accent"], "#2563eb");
  });
});
