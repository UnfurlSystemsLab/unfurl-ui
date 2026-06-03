import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHostRegistry } from "./registry.js";

describe("host registry", () => {
  it("registers enabled manifests from the import map and filters navigation by permission", () => {
    const registry = createHostRegistry({
      manifests: [
        manifest("rag", "@unfurl/rag-webapp", "/components/rag", "AI", 20, ["rag.view"]),
        manifest("audit", "@unfurl/audit-webapp", "/components/audit", "Ops", 10, ["audit.view"])
      ],
      importMap: {
        imports: {
          "@unfurl/rag-webapp": "https://cdn.example.com/rag.js",
          "@unfurl/audit-webapp": "https://cdn.example.com/audit.js"
        }
      },
      enabledComponentIds: ["rag", "audit"],
      userPermissions: ["rag.view"]
    });

    assert.deepEqual(registry.apps.map(app => app.componentId), ["rag", "audit"]);
    assert.deepEqual(registry.navigation.map(item => item.componentId), ["rag"]);
    assert.equal(registry.apps[0]?.bundleUrl, "https://cdn.example.com/rag.js");
    assert.deepEqual(registry.rejected, []);
  });

  it("throws when an enabled webapp has no import-map entry", () => {
    assert.throws(
      () => createHostRegistry({
        manifests: [manifest("rag", "@unfurl/rag-webapp", "/components/rag", "AI", 20, ["rag.view"])],
        importMap: { imports: {} }
      }),
      /no import-map entry/
    );
  });

  it("rejects incompatible webapps before registration", () => {
    const registry = createHostRegistry({
      manifests: [manifest("rag", "@unfurl/rag-webapp", "/components/rag", "AI", 20, ["rag.view"], {
        hostShellApi: ">=2.0.0 <3.0.0"
      })],
      importMap: {
        imports: {
          "@unfurl/rag-webapp": "https://cdn.example.com/rag.js"
        }
      },
      hostCompatibility: {
        hostShell: "1.0.0",
        hostShellApi: "1.0.0",
        microAppProps: "1.0.0",
        eventBus: "1.0.0",
        themeSystem: "1.0.0"
      }
    });

    assert.deepEqual(registry.apps, []);
    assert.equal(registry.rejected[0]?.componentId, "rag");
    assert.equal(registry.rejected[0]?.reason, "INCOMPATIBLE");
    assert.match(registry.rejected[0]?.details[0] ?? "", /hostShellApi/);
  });
});

function manifest(
  id: string,
  name: string,
  routePrefix: string,
  section: string,
  order: number,
  permissions: readonly string[],
  compatibilityOverrides: Partial<Record<"hostShell" | "hostShellApi" | "microAppProps" | "eventBus" | "themeSystem", string>> = {}
) {
  return {
    component: { id, name: id, version: "1.0.0" },
    webapp: {
      type: "single-spa-application",
      name,
      routePrefix,
      importMap: { key: name },
      navigation: { section, title: id, icon: "box", order },
      permissions
    },
    compatibility: {
      hostShell: compatibilityOverrides.hostShell ?? ">=1.0.0 <2.0.0",
      hostShellApi: compatibilityOverrides.hostShellApi ?? ">=1.0.0 <2.0.0",
      microAppProps: compatibilityOverrides.microAppProps ?? ">=1.0.0 <2.0.0",
      eventBus: compatibilityOverrides.eventBus ?? ">=1.0.0 <2.0.0",
      themeSystem: compatibilityOverrides.themeSystem ?? ">=1.0.0 <2.0.0",
      componentContract: `${id}@1.x`
    }
  };
}
