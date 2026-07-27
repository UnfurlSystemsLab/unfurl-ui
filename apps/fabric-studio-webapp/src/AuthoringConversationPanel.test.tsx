import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import {
  AuthoringConversationPanel,
  questionAnswerSummary,
  structuredQuestionAnswers
} from "./AuthoringConversationPanel.js";
import type { DraftWorkspaceState } from "./draftWorkspace.js";

describe("AuthoringConversationPanel", () => {
  it("renders the server-side authoring entry point", () => {
    const html = renderToString(
      <AuthoringConversationPanel
        client={client()}
        tenantId="tenant-local"
        assemblyId="assembly-demo"
        state={readyDraft()}
        onStateChange={() => undefined}
      />
    );

    assert.match(html, /AI Contract Authoring/);
    assert.match(html, /server-side foundry agent/);
    assert.match(html, /Help me create a governed Fabric assembly from the selected tenant catalog/);
    assert.match(html, /Describe the governed component contract you need/);
    assert.match(html, /Ask Agent/);
    assert.match(html, /Accept Proposal/);
  });

  it("renders unavailable state without a converse endpoint", () => {
    const { converseAuthoring, ...withoutAuthoring } = client();
    const html = renderToString(
      <AuthoringConversationPanel
        client={withoutAuthoring}
        tenantId="tenant-local"
        assemblyId="assembly-demo"
        state={readyDraft()}
        onStateChange={() => undefined}
      />
    );

    assert.match(html, /Studio authoring endpoint unavailable/);
  });

  it("summarizes structured answers with question labels for generic ids", () => {
    const questions = [{
      id: "q1",
      label: "Which model provider should the Foundry runtime utilize?",
      type: "SINGLE_SELECT" as const,
      options: [
        { label: "Gemini", value: "uploaded:unfurl-fabric-advisor-gemini-0.1.0-SNAPSHOT.jar" }
      ]
    }];
    const answers = structuredQuestionAnswers(questions, {
      q1: "uploaded:unfurl-fabric-advisor-gemini-0.1.0-SNAPSHOT.jar"
    });

    assert.deepEqual(answers, {
      q1: "uploaded:unfurl-fabric-advisor-gemini-0.1.0-SNAPSHOT.jar"
    });
    assert.match(
      questionAnswerSummary(questions, answers),
      /Which model provider should the Foundry runtime utilize\? \(q1\): Gemini/
    );
    assert.match(
      questionAnswerSummary(questions, answers),
      /uploaded:unfurl-fabric-advisor-gemini-0\.1\.0-SNAPSHOT\.jar/
    );
  });
});

function client() {
  return createHttpStudioFabricClient({
    baseUrl: "http://fabric.local",
    fetch: createMockStudioApiFetch()
  });
}

function readyDraft(): DraftWorkspaceState {
  return {
    status: "READY",
    session: {
      tenantId: "tenant-local",
      assemblyId: "assembly-demo",
      sessionId: "studio-session-123",
      baseCatalogHash: "sha256:catalog",
      sceneRevision: 7,
      currentCandidateId: "cand-abc123",
      warnings: []
    },
    history: {
      initialRevision: 7,
      cursor: 0,
      records: []
    }
  };
}
