import { it } from "node:test";
import assert from "node:assert/strict";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AuthoringConversationPanel } from "./AuthoringConversationPanel.js";
import { CatalogPalettePanel } from "./CatalogPalettePanel.js";
import { IntentHistoryPanel } from "./IntentHistoryPanel.js";
import { VisualDiffPanel } from "./VisualDiffPanel.js";
import { createHttpStudioFabricClient, createMockStudioApiFetch, type AuthoringConverseResponse, type AuthoringConverseRequest } from "@unfurl/fabric-validation-client";

/** Fixture Factory: deterministic broker-neutral client with no real provider or credentials. */
function client() { return createHttpStudioFabricClient({ baseUrl: "http://fixture.test", fetch: createMockStudioApiFetch() }); }

it("drops delayed authoring responses and excludes old history after scope changes", async () => {
  const calls: AuthoringConverseRequest[] = [];
  let resolve: ((response: AuthoringConverseResponse) => void) | undefined;
  const api = { ...client(), converseAuthoring: async (request: AuthoringConverseRequest) => {
    calls.push(request);
    return new Promise<AuthoringConverseResponse>(done => { resolve = done; });
  } };
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<AuthoringConversationPanel client={api} tenantId="a" assemblyId="one" state={undefined} onStateChange={() => {}} />); });
  await act(async () => { void view.root.findAllByType("button")[0]!.props.onClick(); });
  const previous = resolve!;
  await act(async () => { view.update(<AuthoringConversationPanel client={api} tenantId="b" assemblyId="two" state={undefined} onStateChange={() => {}} />); });
  await act(async () => { previous({ kind: "clarify", assistantMessage: "Private old response", questions: [] }); });
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /Private old response/);
  await act(async () => { void view.root.findAllByType("button")[0]!.props.onClick(); });
  assert.equal(calls[1]!.tenantId, "b"); assert.deepEqual(calls[1]!.conversation, []);
  await act(async () => { view.unmount(); });
});

it("does not verify uploaded artifacts when no admission service is bound", async () => {
  const { admitCatalogArtifacts, ...api } = client();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<CatalogPalettePanel client={api} />); });
  const file = view.root.findAllByType("input").find(input => input.props.type === "file")!;
  await act(async () => { file.props.onChange({ currentTarget: { files: [new File(["identity: {}"], "claim.yaml")] } }); });
  const verify = view.root.findAllByType("button").find(button => JSON.stringify(button.props.children).includes("Verify Component Claims"))!;
  await act(async () => { await verify.props.onClick(); });
  assert.match(JSON.stringify(view.toJSON()), /verification is unavailable/);
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /ready for catalog/);
  await act(async () => { view.unmount(); });
});

it("live history and diff do not synthesize validated records or hashes", async () => {
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<><IntentHistoryPanel /><VisualDiffPanel /></>); });
  const output = JSON.stringify(view.toJSON());
  assert.match(output, /Authoritative intent history is unavailable/);
  assert.match(output, /Authoritative revision artifacts are unavailable/);
  assert.doesNotMatch(output, /sha256:contract-old|Add Sample Intent/);
  await act(async () => { view.unmount(); });
});
