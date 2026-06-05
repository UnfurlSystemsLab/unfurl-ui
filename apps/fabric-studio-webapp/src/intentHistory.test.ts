import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appendValidatedIntent,
  canRedo,
  canUndo,
  createIntentHistory,
  currentIntentRecord,
  currentRevision,
  redoIntent,
  undoIntent
} from "./index.js";

describe("governed intent history", () => {
  it("records only validated Fabric intent responses and advances revision", () => {
    const history = appendValidatedIntent(
      createIntentHistory(7),
      connectIntent(7),
      {
        status: "VALID",
        newRevision: 8,
        updatedCandidateId: "cand-abc123",
        requiredSubstratePorts: ["secrets.provider"],
        warnings: []
      }
    );

    assert.equal(currentRevision(history), 8);
    assert.equal(currentIntentRecord(history)?.updatedCandidateId, "cand-abc123");
    assert.equal(canUndo(history), true);
    assert.equal(canRedo(history), false);
  });

  it("rejects invalid or stale responses instead of adding scene snapshots", () => {
    assert.throws(
      () =>
        appendValidatedIntent(createIntentHistory(7), connectIntent(7), {
          status: "INVALID",
          reason: "Capability version conflict",
          details: "storage.put@2.0 cannot satisfy storage.put@^1"
        }),
      /cannot add INVALID intent response/
    );

    assert.throws(
      () =>
        appendValidatedIntent(createIntentHistory(7), connectIntent(7), {
          status: "STALE_REVISION",
          expectedRevision: 9,
          receivedRevision: 7
        }),
      /cannot add STALE_REVISION intent response/
    );
  });

  it("guards against intents based on stale local revisions", () => {
    assert.throws(
      () =>
        appendValidatedIntent(createIntentHistory(8), connectIntent(7), {
          status: "VALID",
          newRevision: 9,
          requiredSubstratePorts: [],
          warnings: []
        }),
      /baseRevision 7 does not match current revision 8/
    );
  });

  it("undoes and redoes over validated records", () => {
    const first = appendValidatedIntent(createIntentHistory(0), connectIntent(0), valid(1));
    const second = appendValidatedIntent(first, disconnectIntent(1), valid(2));

    const undone = undoIntent(second);
    const redone = redoIntent(undone);

    assert.equal(currentRevision(undone), 1);
    assert.equal(canRedo(undone), true);
    assert.equal(currentRevision(redone), 2);
  });

  it("truncates redo history when a new validated intent is added after undo", () => {
    const first = appendValidatedIntent(createIntentHistory(0), connectIntent(0), valid(1));
    const second = appendValidatedIntent(first, disconnectIntent(1), valid(2));
    const undone = undoIntent(second);

    const replacement = appendValidatedIntent(undone, replaceIntent(1), valid(3));

    assert.equal(currentRevision(replacement), 3);
    assert.equal(canRedo(replacement), false);
    assert.deepEqual(replacement.records.map(record => record.intent.type), ["CONNECT", "REPLACE_COMPONENT"]);
  });
});

function connectIntent(baseRevision: number) {
  return {
    tenantId: "tenant-local",
    assemblyId: "assembly-demo",
    sessionId: "studio-session-123",
    baseRevision,
    type: "CONNECT" as const,
    fromPort: "storage-s3.storage.put",
    toPort: "workflow.storage.required"
  };
}

function disconnectIntent(baseRevision: number) {
  return {
    tenantId: "tenant-local",
    assemblyId: "assembly-demo",
    sessionId: "studio-session-123",
    baseRevision,
    type: "DISCONNECT" as const,
    pipeId: "pipe-123"
  };
}

function replaceIntent(baseRevision: number) {
  return {
    tenantId: "tenant-local",
    assemblyId: "assembly-demo",
    sessionId: "studio-session-123",
    baseRevision,
    type: "REPLACE_COMPONENT" as const,
    oldComponentId: "storage-s3",
    newCatalogEntryId: "com.unfurl:storage-blob:1.1.0"
  };
}

function valid(newRevision: number) {
  return {
    status: "VALID" as const,
    newRevision,
    requiredSubstratePorts: [],
    warnings: []
  };
}
