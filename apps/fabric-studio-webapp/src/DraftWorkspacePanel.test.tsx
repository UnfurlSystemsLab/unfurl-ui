import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import type { DynamicDcpProjectionResponse } from "@unfurl/fabric-validation-client";
import { DraftWorkspacePanel } from "./DraftWorkspacePanel.js";

describe("DraftWorkspacePanel", () => {
  it("renders the governed composition workbench", () => {
    const html = renderToString(<DraftWorkspacePanel client={client()} demoFallbacks />);

    assert.match(html, /Unfurl Studio Workbench/);
    assert.match(html, /Guided Tour/);
    assert.match(html, /Tenant/);
    assert.match(html, /tenant-local/);
    assert.match(html, /Assembly/);
    assert.match(html, /assembly-demo/);
    assert.match(html, /Target runtime/);
    assert.match(html, /unfurl-flow/);
    assert.match(html, /Substrate target/);
    assert.match(html, /Customer Runtime Substrate/);
    assert.match(html, /profile mode: STRICT/);
    assert.match(html, /Welcome to Unfurl Studio/);
    assert.match(html, /governed visual workbench/);
    assert.match(html, /href="\/components\/fabric-studio\/help#scanned-catalog"/);
    assert.match(html, /href="\/components\/fabric-studio\/help#component-claims"/);
    assert.match(html, /href="\/components\/fabric-studio\/help#substrate-profile"/);
    assert.match(html, /href="\/components\/fabric-studio\/help#trust-policy"/);
    assert.match(html, /href="\/components\/fabric-studio\/help#deployment-policy"/);
    assert.match(html, /Step.*1.*of.*8/s);
    assert.match(html, /Assembly/);
    assert.match(html, /Catalog/);
    assert.match(html, /Flow API/);
    assert.match(html, /Flow Orchestrator/);
    assert.match(html, /Substrate Runtime Layer/);
    assert.match(html, /3D assembly scene/);
    assert.match(html, /Semantic Zoom/);
    assert.match(html, /Assembly DCP/);
    assert.match(html, /current validated assembly graph/);
    assert.match(html, /Parent/);
    assert.match(html, /Child/);
    assert.match(html, /Inspector/);
    assert.match(html, /Component Details/);
    assert.match(html, /Selected Scene Part/);
    assert.match(html, /Take Out/);
    assert.match(html, /Replace Component/);
    assert.match(html, /Replacement candidates/);
    assert.match(html, /Assembly Deployment Plan/);
    assert.match(html, /Compile and save use this policy/);
    assert.match(html, /In-process library/);
    assert.match(html, /Distributed Worker/);
    assert.match(html, /Trigger Ingress/);
    assert.match(html, /Blocked/);
    assert.match(html, /Validate &amp; Replace/);
    assert.match(html, /Validate Connection/);
  });

  it("renders inspectable component-specific metadata", () => {
    const html = renderToString(<DraftWorkspacePanel client={client()} demoFallbacks />);

    assert.match(html, /Distributed Worker/);
    assert.match(html, /State Store Adapter/);
    assert.match(html, /Provided Ports/);
    assert.match(html, /state-store/);
    assert.match(html, /event-sink/);
    assert.match(html, /capability-registry/);
  });

  it("renders the requested tenant and assembly scope", () => {
    const html = renderToString(
      <DraftWorkspacePanel
        client={client()}
        initialTenantId="tenant-retail"
        initialAssemblyId="flow-runtime"
      />
    );

    assert.match(html, /tenant-retail/);
    assert.match(html, /flow-runtime/);
  });

  it("renders a blank assembly for a new draft", () => {
    const html = renderToString(
      <DraftWorkspacePanel client={client()} initialDraftComponentCount={0} initialDynamicProjection={projection()} />
    );

    assert.match(html, /Empty Assembly/);
    assert.match(html, /Import or add verified catalog components/);
    assert.match(html, /empty governed draft/);
    assert.match(html, /Draft Inventory/);
    assert.match(html, /No components added/);
    assert.match(html, /No substrate ports used/);
    assert.doesNotMatch(html, /Keyboard-accessible projection synchronized with the 3D assembly/);
    assert.doesNotMatch(html, /Flow Orchestrator.*allowed by Fabric/s);
    assert.doesNotMatch(html, /Dynamic DCP Projection/);    assert.match(html, /Components/);
    assert.match(html, /Substrate Ports Used/);
    assert.match(html, /0 \/ 12/);
  });

  it("keeps added draft components isolated from the default assembly projection", () => {
    const html = renderToString(
      <DraftWorkspacePanel
        client={client()}
        initialDraftComponentCatalogEntryIds={["com.unfurl:storage-s3:1.2.0"]}
        initialDynamicProjection={projection()}
      />
    );

    assert.match(html, /Draft Assembly/);
    assert.match(html, /Storage S3/);
    assert.match(html, /com.unfurl:storage-s3:1.2.0/);
    assert.match(html, /Draft Inventory/);
    assert.match(html, /No substrate selected/);
    assert.doesNotMatch(html, /Empty Assembly/);
    assert.doesNotMatch(html, /Flow API/);
    assert.doesNotMatch(html, /Keyboard-accessible projection synchronized with the 3D assembly/);    assert.doesNotMatch(html, /Dynamic DCP Projection/);
    assert.doesNotMatch(html, /Java 21/);
  });

  it("restores draft inventory after the workspace route remounts", () => {
    const html = withBrowserStorage(
      {
        "unfurl-studio-draft-inventory:tenant-local:assembly-demo": JSON.stringify({
          components: [
            {
              catalogEntryId: "com.unfurl:storage-s3:1.2.0",
              label: "Storage S3",
              status: "ADDED"
            }
          ]
        })
      },
      () => renderToString(<DraftWorkspacePanel client={client()} initialDynamicProjection={projection()} />)
    );

    assert.match(html, /Draft Assembly/);
    assert.match(html, /Storage S3/);
    assert.match(html, /Draft Inventory/);
    assert.match(html, /No substrate selected/);
    assert.doesNotMatch(html, /Flow API/);    assert.doesNotMatch(html, /Dynamic DCP Projection/);
  });

  it("renders Fabric-backed dynamic DCP projection levels", () => {
    const html = renderToString(
      <DraftWorkspacePanel client={client()} initialDynamicProjection={projection()} />
    );

    assert.match(html, /Dynamic DCP Projection/);
    assert.match(html, /2D \/ Table View/);
    assert.match(html, /Keyboard-accessible projection synchronized with the 3D assembly/);
    assert.match(html, /DYNAMIC/);
    assert.match(html, /Unfurl Runtime/);
    assert.match(html, /Flow Runtime Assembly/);
    assert.match(html, /Flow Orchestrator/);
    assert.match(html, /COMPONENT.*replaceable/s);
    // New redesign surfaces driven by the same projection.
    assert.match(html, /Semantic zoom navigator/);
    assert.match(html, /Component Hierarchy/);
  });

  // Hover-preview contract: the panel accepts a client that exposes
  // loadConnectionCandidates and renders palette buttons that the
  // operator can hover. We can't assert event handlers in SSR (React 18
  // attaches synthetic events client-side), so this test verifies the
  // shape contract — the panel uses optional chaining on
  // loadConnectionCandidates, so a client with or without it must
  // render the workbench identically. Regression of either path would
  // surface as a type error or render crash.
  it("renders identically with or without a loadConnectionCandidates-capable client", () => {
    const withFn = renderToString(
      <DraftWorkspacePanel
        demoFallbacks
        client={{
          ...client(),
          loadConnectionCandidates: async () => ({
            tenantId: "tenant-local",
            assemblyId: "assembly-demo",
            catalogEntryId: "any",
            connections: [],
            replacements: [],
            warnings: []
          })
        }}
      />
    );
    const withoutFn = renderToString(<DraftWorkspacePanel client={client()} demoFallbacks />);

    assert.match(withFn, /catalog-row/);
    assert.match(withFn, /draggable="true"/);
    assert.match(withoutFn, /catalog-row/);
  });
});

describe("DraftWorkspacePanel without demo fallbacks (default)", () => {
  it("shows an honest no-data state instead of the sample assembly", () => {
    const html = renderToString(<DraftWorkspacePanel client={client()} />);

    assert.match(html, /No Assembly Data/);
    assert.match(html, /connect to a backend with a live DCP projection/);
    // None of the hardcoded sample-assembly modules should appear.
    assert.doesNotMatch(html, /Flow API/);
    assert.doesNotMatch(html, /Trigger Ingress/);
    assert.doesNotMatch(html, /Audit Sink/);
  });

  it("shows an empty inspector instead of hardcoded component details", () => {
    const html = renderToString(<DraftWorkspacePanel client={client()} />);

    assert.match(html, /No component selected/);
    assert.match(html, /Select a component in the assembly to inspect its governed details/);
    // The hardcoded sample "Flow Orchestrator" inspector identity must not leak.
    assert.doesNotMatch(html, /Orchestration Component/);
    assert.doesNotMatch(html, /Owns deterministic DAG scheduling/);
  });

  it("does not surface local demo replacement options", () => {
    const html = renderToString(<DraftWorkspacePanel client={client()} />);

    assert.match(html, /No replacement options available from Fabric/);
    assert.doesNotMatch(html, /using local demo fallback data/);
  });

  it("does not render a generated fallback catalog when the live catalog is empty", () => {
    const html = renderToString(
      <DraftWorkspacePanel
        client={{
          ...client(),
          listCatalogVisuals: async () => ({ catalogHash: "sha256:empty", entries: [] })
        }}
      />
    );

    // SSR render has no live catalog yet (effect not fired) and demo
    // fallbacks are off, so the Flow Components palette has no entries.
    // (The static Adapters/Substrate/Libraries groups still render rows.)
    assert.match(html, /No catalog entries available/);
    assert.match(html, /<h3>Flow Components<\/h3><\/section>/);
  });
});

function client() {
  return createHttpStudioFabricClient({
    baseUrl: "http://fixture.unfurl.local",
    fetch: createMockStudioApiFetch()
  });
}

function projection(): DynamicDcpProjectionResponse {
  return {
    tenantId: "tenant-local",
    assemblyId: "assembly-demo",
    compositionMode: "DYNAMIC",
    rootNodeId: "runtime:unfurl",
    focusNodeId: "assembly:unfurl-flow",
    nodes: [
      {
        nodeId: "runtime:unfurl",
        label: "Unfurl Runtime",
        dcpType: "COMPANY",
        level: "PARENT",
        capabilities: ["workflow.orchestration"],
        compatibleDescendants: ["assembly:unfurl-flow"],
        replacementAllowed: false
      },
      {
        nodeId: "assembly:unfurl-flow",
        label: "Flow Runtime Assembly",
        dcpType: "MODULE",
        level: "ASSEMBLY",
        capabilities: ["workflow.execute"],
        compatibleDescendants: ["component.flow-orchestrator"],
        replacementAllowed: false
      },
      {
        nodeId: "component.flow-orchestrator",
        label: "Flow Orchestrator",
        dcpType: "COMPONENT",
        level: "CHILD",
        catalogEntryId: "com.unfurl.flow:orchestrator:0.1.0",
        capabilities: ["node.dispatch"],
        compatibleDescendants: ["component.distributed-worker"],
        replacementAllowed: true
      }
    ],
    edges: [
      { fromNodeId: "runtime:unfurl", toNodeId: "assembly:unfurl-flow", relationship: "CONTAINS" },
      { fromNodeId: "assembly:unfurl-flow", toNodeId: "component.flow-orchestrator", relationship: "CONTAINS" }
    ],
    connections: [],
    warnings: []
  };
}

function withBrowserStorage<T>(items: Record<string, string>, render: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => items[key] ?? null,
        setItem: (key: string, value: string) => {
          items[key] = value;
        }
      }
    }
  });
  try {
    return render();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}
