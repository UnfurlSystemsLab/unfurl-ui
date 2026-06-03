import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { failedWebapp, readyWebapp } from "./loadState.js";
import type { RegisteredWebapp } from "./registry.js";

describe("webapp load state", () => {
  it("represents ready and failed component webapp states without throwing through the shell", () => {
    const webapp = registeredWebapp();

    assert.deepEqual(readyWebapp(webapp), {
      status: "READY",
      webapp
    });

    assert.deepEqual(failedWebapp(webapp, new Error("bundle failed"), { retryable: false }), {
      status: "FAILED",
      webapp,
      message: "bundle failed",
      retryable: false,
      disabled: false
    });
  });
});

function registeredWebapp(): RegisteredWebapp {
  return {
    componentId: "rag",
    appName: "@unfurl/rag-webapp",
    routePrefix: "/components/rag",
    bundleUrl: "https://cdn.example.com/rag.js",
    manifest: {
      component: { id: "rag", name: "RAG", version: "1.0.0" },
      webapp: {
        type: "single-spa-application",
        name: "@unfurl/rag-webapp",
        routePrefix: "/components/rag",
        importMap: { key: "@unfurl/rag-webapp" },
        navigation: { section: "AI", title: "RAG", icon: "search", order: 20 },
        permissions: ["rag.view"]
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
  };
}
