import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMicroAppProps } from "./microAppProps.js";
import type { RegisteredWebapp } from "./registry.js";

describe("micro app props", () => {
  it("creates hosted props with tenant user auth theme api and event bus", async () => {
    const published: unknown[] = [];
    const props = createMicroAppProps(webapp("rag"), {
      tenantId: "tenant-a",
      user: {
        id: "user-1",
        roles: ["operator"],
        permissions: ["rag.view"]
      },
      auth: {
        getAccessToken: async () => "token-123"
      },
      api: {
        platformBaseUrl: "https://platform.example.com/",
        componentBaseUrls: {
          rag: "https://rag.example.com"
        }
      },
      theme: {
        activeThemeId: "enterprise-light",
        tokens: { "color.accent": "#2563eb" },
        mode: "component-adaptive"
      },
      eventBus: {
        publish: (_eventName, payload) => published.push(payload),
        subscribe: () => () => undefined
      }
    });

    assert.equal(props.mode, "hosted");
    assert.equal(props.componentId, "rag");
    assert.equal(props.tenantId, "tenant-a");
    assert.equal(props.api.componentBaseUrl, "https://rag.example.com");
    assert.equal(await props.auth.getAccessToken(), "token-123");
    props.eventBus.publish("component:selected", { id: "rag" });
    assert.deepEqual(published, [{ id: "rag" }]);
  });

  it("derives component base url from platform base url when no explicit url exists", () => {
    const props = createMicroAppProps(webapp("audit"), {
      tenantId: "tenant-a",
      user: { id: "user-1", roles: [], permissions: [] },
      auth: { getAccessToken: async () => "token" },
      api: { platformBaseUrl: "https://platform.example.com/root" },
      theme: { activeThemeId: "default", tokens: {}, mode: "host" },
      eventBus: { publish: () => undefined, subscribe: () => () => undefined }
    });

    assert.equal(props.api.componentBaseUrl, "https://platform.example.com/root/components/audit");
  });
});

function webapp(componentId: string): RegisteredWebapp {
  return {
    componentId,
    appName: `@unfurl/${componentId}-webapp`,
    routePrefix: `/components/${componentId}`,
    bundleUrl: `https://cdn.example.com/${componentId}.js`,
    manifest: {
      component: { id: componentId, name: componentId, version: "1.0.0" },
      webapp: {
        type: "single-spa-application",
        name: `@unfurl/${componentId}-webapp`,
        routePrefix: `/components/${componentId}`,
        importMap: { key: `@unfurl/${componentId}-webapp` },
        navigation: { section: "Test", title: componentId, icon: "box", order: 1 },
        permissions: []
      },
      compatibility: {
        hostShell: ">=1.0.0 <2.0.0",
        hostShellApi: ">=1.0.0 <2.0.0",
        microAppProps: ">=1.0.0 <2.0.0",
        eventBus: ">=1.0.0 <2.0.0",
        themeSystem: ">=1.0.0 <2.0.0",
        componentContract: `${componentId}@1.x`
      }
    }
  };
}
