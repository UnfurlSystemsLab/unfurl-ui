import type { StudioDraftSession } from "@unfurl/fabric-validation-client";

/**
 * Strategy: accept only matching, monotone authoritative session snapshots. Both the revision and the compile records
 * only grow (records are append-only in Fabric), so a snapshot with an older revision or fewer records was read before
 * the one held and is ignored: a poll that started before a compile returned never takes its record away.
 */
export function reconcileSession(current: StudioDraftSession, next: StudioDraftSession): StudioDraftSession {
  return current.tenantId === next.tenantId && current.assemblyId === next.assemblyId
    && current.sessionId === next.sessionId && Number.isSafeInteger(next.sceneRevision)
    && next.sceneRevision >= current.sceneRevision
    && (next.compileRecords?.length ?? 0) >= (current.compileRecords?.length ?? 0) ? next : current;
}

/** Polling Strategy: serialize snapshots, retry transient failures and fence completions after stop. */
export function watchSession(read: () => Promise<StudioDraftSession>,
  receive: (next: StudioDraftSession) => void, connection: (connected: boolean) => void,
  schedule: (next: () => void) => () => void = next => {
    const timer = setTimeout(next, 3000); return () => clearTimeout(timer);
  }): () => void {
  let stopped = false;
  let cancelTimer: (() => void) | undefined;
  /** Reconciliation loop: schedule only after the current authenticated read settles. */
  async function refresh() {
    try {
      const next = await read();
      if (!stopped) { receive(next); connection(true); }
    } catch { if (!stopped) connection(false); }
    finally { if (!stopped) cancelTimer = schedule(() => { void refresh(); }); }
  }
  void refresh();
  return () => { stopped = true; cancelTimer?.(); };
}
