import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { DeploymentPlannerPanel } from "./DeploymentPlannerPanel.js";
import type { StudioFabricClient } from "@unfurl/fabric-validation-client";

describe("DeploymentPlannerPanel", () => {
  it("renders the policy form and all resolver output panels", () => {
    const html = renderToString(<DeploymentPlannerPanel client={fakeClient()} />);

    assert.match(html, /Deployment Planner/);
    assert.match(html, /Selected Shapes/);
    assert.match(html, /Rejected Shapes/);
    assert.match(html, /Isolation Policy/);
    assert.match(html, /Fallback Attempts/);
    assert.match(html, /Required Substrate Ports/);
    assert.match(html, /Containerized service/);
  });
});

function fakeClient(): Pick<StudioFabricClient, "resolveDeployment"> {
  return {
    resolveDeployment: async () => ({
      status: "RESOLVED",
      candidateId: "cand-abc123",
      selections: [],
      warnings: []
    })
  };
}
