import { it } from "node:test";
import assert from "node:assert/strict";
import { reconcileSession, watchSession } from "./sessionReconciliation.js";
const session = { tenantId: "a", assemblyId: "assembly", sessionId: "session", baseCatalogHash: "hash", sceneRevision: 4, warnings: [] };

it("rejects foreign identities and regressing snapshots while accepting newer revisions", () => {
  for (const changes of [{ tenantId: "b" }, { assemblyId: "b" }, { sessionId: "b" }, { sceneRevision: 3 }]) {
    assert.equal(reconcileSession(session, { ...session, ...changes }), session);
  }
  assert.equal(reconcileSession(session, { ...session, sceneRevision: 5 }).sceneRevision, 5);
});

it("never takes a compile record away: a same-revision snapshot with fewer records is older and ignored", () => {
  const record = (hash: string) => ({ revision: 4, deploymentPolicyHash: "p", contractHash: hash, compiledEnvelopeSha256: "e",
    substrateProfileSha256: "s", compiledAt: "2026-01-01T00:00:00Z" });
  const compiled = { ...session, compileRecords: [record("a")] };
  assert.equal(reconcileSession(compiled, session), compiled, "a poll read before the compile returned");
  const recompiled = { ...session, compileRecords: [record("a"), record("b")] };
  assert.equal(reconcileSession(compiled, recompiled), recompiled, "a recompile at the same revision arrives");
});

it("retries a transient read failure and fences a pending completion after unsubscribe", async () => {
  let retry: (() => void) | undefined;
  let resolve: ((value: typeof session) => void) | undefined;
  let calls = 0;
  const states: boolean[] = [];
  const received: unknown[] = [];
  const stop = watchSession(async () => {
    if (++calls === 1) throw new Error("offline");
    return new Promise<typeof session>(done => { resolve = done; });
  }, value => received.push(value), value => states.push(value), next => { retry = next; return () => { retry = undefined; }; });
  await new Promise(done => setImmediate(done));
  assert.deepEqual(states, [false]);
  retry!();
  assert.equal(calls, 2);
  stop(); resolve!(session);
  await new Promise(done => setImmediate(done));
  assert.deepEqual(received, []);
  assert.deepEqual(states, [false]);
});

it("reports restored connectivity after the next successful snapshot", async () => {
  let retry: (() => void) | undefined;
  let calls = 0;
  const states: boolean[] = [];
  const stop = watchSession(async () => { if (++calls === 1) throw Error(); return session; }, () => {},
    value => states.push(value), next => { retry = next; return () => {}; });
  await new Promise(done => setImmediate(done)); retry!();
  await new Promise(done => setImmediate(done)); stop();
  assert.deepEqual(states, [false, true]);
});
