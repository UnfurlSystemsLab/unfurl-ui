import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findSelectedWebapp, resolveActiveTheme } from "./activeTheme.js";
import { createHostRegistry } from "./registry.js";

describe("active component theme resolution", () => {
  it("selects the longest matching mounted route", () => {
    const registry = createHostRegistry({
      manifests: [
        manifest("workflow", "@unfurl/workflow-webapp", "/components/workflow", undefined),
        manifest("studio", "@unfurl/fabric-studio-webapp", "/components/workflow/studio", {
          "accent.intent": "composition"
        })
      ],
      importMap: {
        imports: {
          "@unfurl/workflow-webapp": "https://cdn.example.com/workflow.js",
          "@unfurl/fabric-studio-webapp": "https://cdn.example.com/studio.js"
        }
      }
    });

    const selected = findSelectedWebapp(registry, "/components/workflow/studio/inspect?tab=ports");

    assert.equal(selected?.componentId, "studio");
  });

  it("applies selected component theme contribution in component-adaptive mode", () => {
    const registry = createHostRegistry({
      manifests: [
        manifest("rag", "@unfurl/rag-webapp", "/components/rag", {
          "accent.intent": "ai",
          "color.accent": "#7c3aed"
        })
      ],
      importMap: {
        imports: {
          "@unfurl/rag-webapp": "https://cdn.example.com/rag.js"
        }
      }
    });

    const result = resolveActiveTheme({
      registry,
      currentPath: "/components/rag",
      baseTheme: {
        id: "default",
        name: "Default",
        tokens: {
          "color.accent": "#2563eb",
          "density": "comfortable"
        }
      },
      policy: {
        mode: "component-adaptive"
      }
    });

    assert.equal(result.selectedWebapp?.componentId, "rag");
    assert.equal(result.theme.mode, "component-adaptive");
    assert.equal(result.theme.tokens["color.accent"], "#7c3aed");
    assert.equal(result.theme.tokens["accent.intent"], "ai");
    assert.equal(result.theme.tokens["density"], "comfortable");
  });

  it("ignores selected contribution in host-only mode", () => {
    const registry = createHostRegistry({
      manifests: [
        manifest("rag", "@unfurl/rag-webapp", "/components/rag", {
          "color.accent": "#7c3aed"
        })
      ],
      importMap: {
        imports: {
          "@unfurl/rag-webapp": "https://cdn.example.com/rag.js"
        }
      }
    });

    const result = resolveActiveTheme({
      registry,
      currentPath: "/components/rag",
      baseTheme: {
        id: "default",
        name: "Default",
        tokens: {
          "color.accent": "#2563eb"
        }
      },
      policy: {
        mode: "host-only"
      }
    });

    assert.equal(result.theme.mode, "host");
    assert.equal(result.theme.tokens["color.accent"], "#2563eb");
  });
});

function manifest(
  id: string,
  name: string,
  routePrefix: string,
  themeTokens: Readonly<Record<string, string>> | undefined
) {
  return {
    component: { id, name: id, version: "1.0.0" },
    webapp: {
      type: "single-spa-application",
      name,
      routePrefix,
      importMap: { key: name },
      navigation: { section: "Test", title: id, icon: "box", order: 1 },
      permissions: [],
      ...(themeTokens ? { themeContribution: { mode: "suggestive", tokens: themeTokens } } : {})
    },
    compatibility: {
      hostShell: ">=1.0.0 <2.0.0",
      hostShellApi: ">=1.0.0 <2.0.0",
      microAppProps: ">=1.0.0 <2.0.0",
      eventBus: ">=1.0.0 <2.0.0",
      themeSystem: ">=1.0.0 <2.0.0",
      componentContract: `${id}@1.x`
    }
  };
}
