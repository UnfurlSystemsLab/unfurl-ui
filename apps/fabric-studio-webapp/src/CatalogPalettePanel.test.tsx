import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createHttpStudioFabricClient, createMockStudioApiFetch } from "@unfurl/fabric-validation-client";
import { AdmissionResults, CatalogPalettePanel, SelectedArtifacts, toAdmissionDraft } from "./CatalogPalettePanel.js";
import { appendArtifactDrafts, createBrowseSequencer, removeArtifactDrafts, SelectionRevision } from "./artifactSelection.js";

describe("CatalogPalettePanel", () => {
  it("renders catalog controls and loading-safe structure", () => {
    const html = renderToString(<CatalogPalettePanel client={client()} />);

    assert.match(html, /Catalog Palette/);
    assert.match(html, /Search catalog/);
    assert.match(html, /Warnings only/);
    assert.match(html, /Add Components/);
    assert.match(html, /Add component artifacts/);
    assert.match(html, /Verify Component Claims/);
    assert.match(html, /blocked until verified/);
  });

  it("appends each browse to the selection, replacing a jar with the same file name in place", () => {
    const flow = { fileName: "flow.jar", artifactBase64: "Zmxvdw==" };
    const foundry = { fileName: "foundry.jar", artifactBase64: "Zm91bmRyeQ==" };
    const first = appendArtifactDrafts([], [flow]);
    const second = appendArtifactDrafts(first, [foundry]);
    assert.deepEqual(second.map(draft => draft.fileName), ["flow.jar", "foundry.jar"], "a second browse adds, never overrides");
    const rebuilt = { fileName: "flow.jar", artifactBase64: "bmV3" };
    const third = appendArtifactDrafts(second, [rebuilt, { fileName: "catalog.jar" }]);
    assert.deepEqual(third.map(draft => draft.fileName), ["flow.jar", "foundry.jar", "catalog.jar"]);
    assert.equal(third[0]!.artifactBase64, "bmV3", "the newer bytes replace the earlier jar of that name");
    assert.deepEqual(first.map(draft => draft.fileName), ["flow.jar"], "the earlier selection is not changed");
  });

  it("applies browses in browse order even when an older read finishes last, so the newer jar wins", async () => {
    type Draft = { readonly fileName: string; readonly artifactBase64?: string };
    let selection = [] as readonly Draft[];
    const settled: string[] = [];
    const errors: unknown[] = [];
    const enqueue = createBrowseSequencer<readonly { readonly fileName: string; readonly artifactBase64?: string }[]>(
      drafts => { selection = appendArtifactDrafts(selection, drafts); },
      () => settled.push("settled"),
      error => errors.push(error));
    let finishOlder!: (drafts: readonly { readonly fileName: string; readonly artifactBase64?: string }[]) => void;
    const older = new Promise<readonly { readonly fileName: string; readonly artifactBase64?: string }[]>(resolve => { finishOlder = resolve; });
    const first = enqueue(older);
    const second = enqueue(Promise.resolve([{ fileName: "flow.jar", artifactBase64: "bmV3" }]));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(selection.length, 0, "the newer browse waits for the older one");
    finishOlder([{ fileName: "flow.jar", artifactBase64: "b2xk" }]);
    await Promise.all([first, second]);
    assert.deepEqual(selection, [{ fileName: "flow.jar", artifactBase64: "bmV3" }], "the later browse's bytes win");
    assert.equal(settled.length, 2);
    const failed = enqueue(Promise.reject(new Error("unreadable")));
    const after = enqueue(Promise.resolve([{ fileName: "foundry.jar" }]));
    await Promise.all([failed, after]);
    assert.equal(errors.length, 1, "a failed read is reported");
    assert.deepEqual(selection.map(draft => draft.fileName), ["flow.jar", "foundry.jar"], "and later browses still apply");
  });

  it("handles a later browse's failed read at once, while an earlier browse is still being read", async () => {
    type Draft = { readonly fileName: string };
    let selection = [] as readonly Draft[];
    const errors: unknown[] = [];
    let settled = 0;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const enqueue = createBrowseSequencer<readonly Draft[]>(
        drafts => { selection = appendArtifactDrafts(selection, drafts); },
        () => { settled += 1; },
        error => errors.push(error));
      let finishFirst!: (drafts: readonly Draft[]) => void;
      const first = enqueue(new Promise<readonly Draft[]>(resolve => { finishFirst = resolve; }));
      const second = enqueue(Promise.reject(new Error("unreadable.jar")));
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(errors.length, 1, "the failure is reported while the first browse is still pending");
      assert.match(String(errors[0]), /unreadable\.jar/);
      assert.equal(settled, 0, "nothing settles before the first browse, which comes first");
      finishFirst([{ fileName: "flow.jar" }]);
      await Promise.all([first, second]);
      assert.deepEqual(selection.map(draft => draft.fileName), ["flow.jar"], "the first browse still applies");
      assert.equal(settled, 2);
      assert.equal(errors.length, 1, "reported once");
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.deepEqual(unhandled, [], "no unhandled rejection");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("shows a verification only for the selection revision it was asked for", () => {
    const revision = new SelectionRevision();
    revision.advance();
    const askedForA = revision.current;
    revision.advance();
    assert.equal(revision.isCurrent(askedForA), false, "B browsed while A was verifying: A's answer is not B's");
    const askedAgain = revision.current;
    assert.equal(revision.isCurrent(askedAgain), true);
  });

  it("removes jars from the selection by file name", () => {
    const selection = [{ fileName: "flow.jar" }, { fileName: "foundry.jar" }, { fileName: "catalog.jar" }];
    assert.deepEqual(removeArtifactDrafts(selection, new Set(["foundry.jar"])).map(draft => draft.fileName), ["flow.jar", "catalog.jar"]);
    assert.deepEqual(removeArtifactDrafts(selection, new Set(["flow.jar", "catalog.jar", "unknown.jar"])).map(draft => draft.fileName), ["foundry.jar"]);
  });

  it("shows every selected jar with a remove action, under Select all and Remove selected", () => {
    const artifacts = [{ fileName: "flow.jar" }, { fileName: "foundry.jar" }];
    const none = renderToString(<SelectedArtifacts artifacts={artifacts} checked={new Set()} onCheckedChange={() => undefined} onRemove={() => undefined} />);
    assert.match(none, /Select all/);
    assert.match(none, /aria-label="Remove flow.jar"/);
    assert.match(none, /aria-label="Remove foundry.jar"/);
    assert.match(none, /Remove selected \(<!-- -->0<!-- -->\)/);
    assert.match(none, /<button[^>]*disabled=""[^>]*>Remove selected/, "nothing checked, nothing to remove");
    const one = renderToString(<SelectedArtifacts artifacts={artifacts} checked={new Set(["foundry.jar"])} onCheckedChange={() => undefined} onRemove={() => undefined} />);
    assert.match(one, /Remove selected \(<!-- -->1<!-- -->\)/);
    assert.equal(renderToString(<SelectedArtifacts artifacts={[]} checked={new Set()} onCheckedChange={() => undefined} onRemove={() => undefined} />), "");
  });

  it("renders DCP admission diagnostics with code path and message", () => {
    const html = renderToString(<AdmissionResults results={[{
      fileName: "broken.yaml",
      status: "REJECTED",
      catalogEntryId: "",
      claimHash: "",
      warnings: ["metadata.dcp_version: metadata.dcp_version must be >= 0.2.0"],
      diagnostics: [{
        severity: "ERROR",
        code: "DCP_VERSION_UNSUPPORTED",
        path: "metadata.dcp_version",
        message: "metadata.dcp_version must be >= 0.2.0"
      }]
    }]} />);

    assert.match(html, /broken\.yaml/);
    assert.match(html, /DCP_VERSION_UNSUPPORTED/);
    assert.match(html, /metadata\.dcp_version/);
    assert.match(html, /must be &gt;= 0\.2\.0/);
  });

  it("renders the downloadable resolved claim bundle when admission returns one", () => {
    const html = renderToString(<AdmissionResults
      results={[]}
      claimBundleArtifact={{
        artifactId: "adm-123",
        mediaType: "application/zip",
        sha256: "sha256:bundle",
        url: "/studio/tenants/tenant-a/catalog/admissions/adm-123/claims.zip?sha256=sha256:bundle"
      }}
    />);

    assert.match(html, /Download Claims Bundle/);
    assert.match(html, /claims\.zip\?sha256=sha256:bundle/);
  });

  it("sends a YAML file by name only, because a claim is admitted only from its jar", async () => {
    const draft = await toAdmissionDraft(new File(["identity:\n  name: payment\n"], "payment.yaml"));

    assert.deepEqual(draft, { fileName: "payment.yaml" });
  });

  it("converts JAR uploads into base64 artifact admission drafts", async () => {
    const draft = await toAdmissionDraft(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "payment.jar"));

    assert.deepEqual(draft, {
      fileName: "payment.jar",
      artifactBase64: "UEsDBA=="
    });
  });
});

function client() {
  return createHttpStudioFabricClient({
    baseUrl: "http://fixture.unfurl.local",
    fetch: createMockStudioApiFetch()
  });
}
