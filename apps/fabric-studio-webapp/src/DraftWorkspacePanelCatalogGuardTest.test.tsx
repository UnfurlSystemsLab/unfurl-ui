import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { DraftWorkspacePanel } from "./DraftWorkspacePanel.js";
import type { StudioFabricClient } from "@unfurl/fabric-validation-client";

describe("DraftWorkspacePanel catalog guard", () => {
  // The initial SSR render has an empty live catalog (useEffect hasn't
  // fired yet). knownCatalogEntryIds is therefore empty, so the palette
  // buttons rendered from fallbackCatalog() should all be disabled —
  // that's the guard's at-rest invariant: nothing is assemblable until
  // the live catalog confirms membership.
  it("renders Flow Components as disabled-but-draggable before a draft is ready", () => {
    const html = renderToString(<DraftWorkspacePanel client={fakeFabricClient()} demoFallbacks />);

    assert.match(html, /Flow Components/);

    // Extract the Flow Components <section> and assert every <button>
    // inside it carries the disabled attribute. The class name on the
    // section is `catalog-group`; the title text identifies which one.
    const flowSection = extractSectionByTitle(html, "Flow Components");
    const buttons = collectButtons(flowSection);
    assert.ok(buttons.length > 0, "expected fallback palette entries to render");
    for (const button of buttons) {
      assert.match(
        button,
        /disabled/,
        `expected catalog button to be disabled before a draft is ready: ${button.slice(0, 80)}`
      );
      assert.match(
        button,
        /draggable="true"/,
        "expected fallback Flow catalog affordance to be draggable-capable"
      );
    }
  });
});

function fakeFabricClient(): DraftWorkspacePanelClient {
  return {
    listCatalogVisuals: async () => ({ catalogHash: "sha256:empty", entries: [] }),
    createDraftComposition: async () => ({} as never),
    applyIntent: async () => ({} as never),
    getDraftSession: async () => ({} as never),
    compileCandidate: async () => ({} as never),
    saveDraft: async () => ({} as never),
    loadLayoutState: async () => ({} as never),
    saveLayoutState: async () => ({} as never),
    loadDynamicDcpProjection: async () => ({} as never),
    loadReplacementCandidates: async () => ({} as never),
    heartbeatCollaborator: async () => ({} as never),
    sessionEventsUrl: () => "http://fixture.unfurl.local/events"
  };
}

type DraftWorkspacePanelClient = Pick<
  StudioFabricClient,
  | "saveDraft"
  | "loadLayoutState"
  | "saveLayoutState"
  | "loadDynamicDcpProjection"
  | "loadReplacementCandidates"
  | "listCatalogVisuals"
  | "createDraftComposition"
  | "applyIntent"
  | "getDraftSession"
  | "compileCandidate"
  | "heartbeatCollaborator"
  | "sessionEventsUrl"
>;

/**
 * Pull the `<section class="catalog-group">...</section>` element whose
 * `<h3>` matches the given title. Returns just that section's substring.
 */
function extractSectionByTitle(html: string, title: string): string {
  const sectionRegex = /<section[^>]*class="[^"]*catalog-group[^"]*"[^>]*>[\s\S]*?<\/section>/g;
  for (const match of html.matchAll(sectionRegex)) {
    if (match[0].includes(`<h3>${title}</h3>`)) {
      return match[0];
    }
  }
  throw new Error(`section titled '${title}' not found in render`);
}

function collectButtons(fragment: string): readonly string[] {
  const buttonRegex = /<button[^>]*>[\s\S]*?<\/button>/g;
  return Array.from(fragment.matchAll(buttonRegex)).map(match => match[0]);
}
