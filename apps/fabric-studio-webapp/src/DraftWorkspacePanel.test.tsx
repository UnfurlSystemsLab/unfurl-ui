import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import type { DynamicDcpProjectionResponse } from "@unfurl/fabric-validation-client";
import { DraftWorkspacePanel } from "./DraftWorkspacePanel.js";

describe("DraftWorkspacePanel", () => {
  it("renders the governed composition workbench", () => {
    const html = renderToString(<DraftWorkspacePanel client={client()} />);

    assert.match(html, /Unfurl Studio Workbench/);
    assert.match(html, /Guided Tour/);
    assert.match(html, /Tenant/);
    assert.match(html, /tenant-local/);
    assert.match(html, /Assembly/);
    assert.match(html, /assembly-demo/);
    assert.match(html, /Target application/);
    assert.match(html, /E-Commerce Platform/);
    assert.match(html, /Default deployment/);
    assert.match(html, /On-Prem Cluster/);
    assert.match(html, /Load target app/);
    assert.match(html, /Extract Needs/);
    assert.match(html, /load target app first/);
    assert.match(html, /Welcome to Unfurl Studio/);
    assert.match(html, /governed visual workbench/);
    assert.match(html, /href="\/components\/fabric-studio\/help#scanned-catalog"/);
    assert.match(html, /href="\/components\/fabric-studio\/help#component-claims"/);
    assert.match(html, /href="\/components\/fabric-studio\/help#needs"/);
    assert.match(html, /href="\/components\/fabric-studio\/help#trust-policy"/);
    assert.match(html, /href="\/components\/fabric-studio\/help#deployment-policy"/);
    assert.match(html, /Step.*1.*of.*8/s);
    assert.match(html, /Assembly/);
    assert.match(html, /Catalog/);
    assert.match(html, /API Gateway/);
    assert.match(html, /Validation Service/);
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
    assert.match(html, /Customer Policy Validator/);
    assert.match(html, /Fraud-only Validator/);
    assert.match(html, /Blocked/);
    assert.match(html, /Validate &amp; Replace/);
    assert.match(html, /Validate Connection/);
  });

  it("renders inspectable component-specific metadata", () => {
    const html = renderToString(<DraftWorkspacePanel client={client()} />);

    assert.match(html, /Payment Service/);
    assert.match(html, /Storage Adapter/);
    assert.match(html, /Provided Ports/);
    assert.match(html, /customer.query/);
    assert.match(html, /policy.evaluate/);
    assert.match(html, /rules.fetch/);
  });

  it("renders the requested tenant and assembly scope", () => {
    const html = renderToString(
      <DraftWorkspacePanel
        client={client()}
        initialTenantId="tenant-retail"
        initialAssemblyId="checkout-platform"
      />
    );

    assert.match(html, /tenant-retail/);
    assert.match(html, /checkout-platform/);
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
    assert.doesNotMatch(html, /Validation Service.*allowed by Fabric/s);
    assert.doesNotMatch(html, /Dynamic DCP Projection/);
    assert.doesNotMatch(html, /Checkout Assembly/);
    assert.match(html, /Components/);
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
    assert.doesNotMatch(html, /API Gateway/);
    assert.doesNotMatch(html, /Keyboard-accessible projection synchronized with the 3D assembly/);
    assert.doesNotMatch(html, /Checkout Assembly/);
    assert.doesNotMatch(html, /Dynamic DCP Projection/);
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
    assert.doesNotMatch(html, /API Gateway/);
    assert.doesNotMatch(html, /Checkout Assembly/);
    assert.doesNotMatch(html, /Dynamic DCP Projection/);
  });

  it("renders Fabric-backed dynamic DCP projection levels", () => {
    const html = renderToString(
      <DraftWorkspacePanel client={client()} initialDynamicProjection={projection()} />
    );

    assert.match(html, /Dynamic DCP Projection/);
    assert.match(html, /2D \/ Table View/);
    assert.match(html, /Keyboard-accessible projection synchronized with the 3D assembly/);
    assert.match(html, /DYNAMIC/);
    assert.match(html, /Commerce Platform/);
    assert.match(html, /Checkout Assembly/);
    assert.match(html, /Validation Service/);
    assert.match(html, /COMPONENT.*replaceable/s);
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
    rootNodeId: "company:commerce",
    focusNodeId: "assembly:checkout",
    nodes: [
      {
        nodeId: "company:commerce",
        label: "Commerce Platform",
        dcpType: "COMPANY",
        level: "PARENT",
        capabilities: ["commerce.checkout"],
        compatibleDescendants: ["assembly:checkout"],
        replacementAllowed: false
      },
      {
        nodeId: "assembly:checkout",
        label: "Checkout Assembly",
        dcpType: "MODULE",
        level: "ASSEMBLY",
        capabilities: ["order.create"],
        compatibleDescendants: ["component.validation"],
        replacementAllowed: false
      },
      {
        nodeId: "component.validation",
        label: "Validation Service",
        dcpType: "COMPONENT",
        level: "CHILD",
        catalogEntryId: "com.unfurl:validation-service:1.1.0",
        capabilities: ["validate.order"],
        compatibleDescendants: ["component.customer-policy-validator"],
        replacementAllowed: true
      }
    ],
    edges: [
      { fromNodeId: "company:commerce", toNodeId: "assembly:checkout", relationship: "CONTAINS" },
      { fromNodeId: "assembly:checkout", toNodeId: "component.validation", relationship: "CONTAINS" }
    ],
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
