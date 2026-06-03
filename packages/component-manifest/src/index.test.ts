import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertValidComponentWebappManifest, validateComponentWebappManifest } from "./index.js";

describe("component manifest validation", () => {
  it("accepts a valid single-spa webapp manifest", () => {
    const manifest = assertValidComponentWebappManifest({
      component: { id: "rag-basic", name: "RAG", version: "1.0.0" },
      webapp: {
        type: "single-spa-application",
        name: "@unfurl/rag-webapp",
        routePrefix: "/components/rag",
        importMap: { key: "@unfurl/rag-webapp" },
        navigation: { section: "AI", title: "RAG", icon: "search", order: 20 },
        permissions: ["rag.view", "rag.admin"],
        themeContribution: {
          mode: "suggestive",
          tokens: {
            "accent.intent": "ai",
            "accent.color": "violet"
          }
        }
      },
      compatibility: {
        hostShell: ">=1.0.0 <2.0.0",
        hostShellApi: ">=1.0.0 <2.0.0",
        microAppProps: ">=1.0.0 <2.0.0",
        eventBus: ">=1.0.0 <2.0.0",
        themeSystem: ">=1.0.0 <2.0.0",
        componentContract: "rag-basic@1.x"
      }
    });

    assert.equal(manifest.webapp.routePrefix, "/components/rag");
  });

  it("rejects malformed route prefixes and missing compatibility fields", () => {
    const result = validateComponentWebappManifest({
      component: { id: "rag-basic", name: "RAG", version: "1.0.0" },
      webapp: {
        type: "single-spa-application",
        name: "@unfurl/rag-webapp",
        routePrefix: "components/rag",
        importMap: { key: "@unfurl/rag-webapp" },
        navigation: { section: "AI", title: "RAG", icon: "search", order: 20 },
        permissions: ["rag.view"]
      },
      compatibility: {
        hostShell: ">=1.0.0 <2.0.0"
      }
    });

    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.errors.some(error => error.path === "webapp.routePrefix"));
      assert.ok(result.errors.some(error => error.path === "compatibility.hostShellApi"));
    }
  });

  it("rejects malformed theme contributions", () => {
    const result = validateComponentWebappManifest({
      component: { id: "rag-basic", name: "RAG", version: "1.0.0" },
      webapp: {
        type: "single-spa-application",
        name: "@unfurl/rag-webapp",
        routePrefix: "/components/rag",
        importMap: { key: "@unfurl/rag-webapp" },
        navigation: { section: "AI", title: "RAG", icon: "search", order: 20 },
        permissions: ["rag.view"],
        themeContribution: {
          mode: "force",
          tokens: {
            "accent.color": 7
          }
        }
      },
      compatibility: {
        hostShell: ">=1.0.0 <2.0.0",
        hostShellApi: ">=1.0.0 <2.0.0",
        microAppProps: ">=1.0.0 <2.0.0",
        eventBus: ">=1.0.0 <2.0.0",
        themeSystem: ">=1.0.0 <2.0.0",
        componentContract: "rag-basic@1.x"
      }
    });

    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.errors.some(error => error.path === "webapp.themeContribution.mode"));
      assert.ok(result.errors.some(error => error.path === "webapp.themeContribution.tokens"));
    }
  });
});
