import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateRouteAccess, requireAccessToken } from "./accessControl.js";
import { createHostRegistry } from "./registry.js";

describe("route access control", () => {
  it("allows matching routes when the user has at least one declared permission", () => {
    const decision = evaluateRouteAccess(registry(), "/components/rag/query", ["rag.view"]);

    assert.equal(decision.allowed, true);
    if (decision.allowed) {
      assert.equal(decision.webapp.componentId, "rag");
    }
  });

  it("denies direct route access when the user lacks component permissions", () => {
    const decision = evaluateRouteAccess(registry(), "/components/rag/query", ["audit.view"]);

    assert.equal(decision.allowed, false);
    if (!decision.allowed && decision.reason === "MISSING_PERMISSION") {
      assert.equal(decision.webapp.componentId, "rag");
      assert.deepEqual(decision.requiredPermissions, ["rag.view", "rag.admin"]);
      assert.deepEqual(decision.userPermissions, ["audit.view"]);
    } else {
      assert.fail("expected MISSING_PERMISSION");
    }
  });

  it("reports no matching webapp when the path is outside registered routes", () => {
    const decision = evaluateRouteAccess(registry(), "/settings", ["rag.view"]);

    assert.deepEqual(decision, {
      allowed: false,
      reason: "NO_MATCHING_WEBAPP",
      path: "/settings"
    });
  });

  it("requires non-empty access tokens from the token provider", async () => {
    await assert.rejects(
      () => requireAccessToken({ getAccessToken: async () => " " }),
      /empty access token/
    );

    await assert.doesNotReject(
      () => requireAccessToken({ getAccessToken: async () => "token-123" })
    );
  });
});

function registry() {
  return createHostRegistry({
    manifests: [
      {
        component: { id: "rag", name: "RAG", version: "1.0.0" },
        webapp: {
          type: "single-spa-application",
          name: "@unfurl/rag-webapp",
          routePrefix: "/components/rag",
          importMap: { key: "@unfurl/rag-webapp" },
          navigation: { section: "AI", title: "RAG", icon: "search", order: 20 },
          permissions: ["rag.view", "rag.admin"]
        },
        compatibility: {
          hostShell: ">=1.0.0 <2.0.0",
          hostShellApi: ">=1.0.0 <2.0.0",
          microAppProps: ">=1.0.0 <2.0.0",
          eventBus: ">=1.0.0 <2.0.0",
          themeSystem: ">=1.0.0 <2.0.0",
          componentContract: "rag@1.x"
        }
      }
    ],
    importMap: {
      imports: {
        "@unfurl/rag-webapp": "https://cdn.example.com/rag.js"
      }
    }
  });
}
