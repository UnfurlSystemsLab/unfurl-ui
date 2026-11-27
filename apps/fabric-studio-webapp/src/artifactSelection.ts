import type { StudioComponentArtifactDraft } from "@unfurl/fabric-validation-client";

/**
 * The jars selected for admission on the Catalog screen (LLD-studio-viewpoints-and-perspectives §3.5, "Selecting
 * artifacts to admit"): one selection built across browses, keyed by file name, because Fabric admits a jar as
 * `uploaded:<fileName>` and two drafts with one name would admit as one entry.
 *
 * Pure functions, so the selection rules are testable without a DOM.
 */

/**
 * Appends a browse's jars to the selection. A jar whose file name is already selected replaces that entry in place (the
 * newer bytes win); new names are added after the existing ones, in the order chosen.
 *
 * @param current the selection so far.
 * @param added   the jars from this browse.
 * @returns the new selection; `current` is not changed.
 */
export function appendArtifactDrafts(
  current: readonly StudioComponentArtifactDraft[],
  added: readonly StudioComponentArtifactDraft[]
): readonly StudioComponentArtifactDraft[] {
  const byName = new Map(added.map(draft => [draft.fileName, draft]));
  const replaced = current.map(draft => byName.get(draft.fileName) ?? draft);
  const existing = new Set(current.map(draft => draft.fileName));
  const appended: StudioComponentArtifactDraft[] = [];
  for (const draft of byName.values()) {
    if (!existing.has(draft.fileName)) appended.push(draft);
  }
  return [...replaced, ...appended];
}

/**
 * The selection's revision (§3.5): every browse (when it is made, before its files are read) and every removal advances
 * it. A verification records the revision it was asked for and is shown only while that is still the current one, so an
 * answer for an earlier selection never marks a changed selection verified.
 */
export class SelectionRevision {
  private value = 0;

  /** Records that the selection changed. */
  advance(): void {
    this.value += 1;
  }

  /** The current revision, to record when asking for a verification. */
  get current(): number {
    return this.value;
  }

  /** Whether an answer asked at `asked` still describes the selection. */
  isCurrent(asked: number): boolean {
    return asked === this.value;
  }
}

/**
 * Sequencer: applies each browse's read result in browse order, whatever order the reads finish in (§3.5). Reads run in
 * parallel; their results are applied one after another, so a later browse of the same file name always replaces an
 * earlier one.
 *
 * Each read's outcome is captured the moment it is enqueued, so a read that fails is handled at once: never an unhandled
 * rejection, even while an earlier browse is still being read. Its failure is reported as soon as it happens, and in
 * browse order it applies nothing; later browses still apply.
 *
 * @param apply     applies one browse's result, in browse order.
 * @param onSettled called once per browse after it applied or failed, in browse order.
 * @param onError   called with a browse's read failure, as soon as the read fails.
 * @returns the function that enqueues a browse's read, returning when that browse has applied or failed.
 */
export function createBrowseSequencer<T>(
  apply: (result: T) => void,
  onSettled: () => void,
  onError: (error: unknown) => void
): (read: Promise<T>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return read => {
    // Handled now, not when the earlier browses finish: the outcome is a value either way.
    const outcome = read.then(
      value => ({ ok: true as const, value }),
      error => {
        onError(error);
        return { ok: false as const };
      });
    tail = tail
      .then(() => outcome)
      .then(result => { if (result.ok) apply(result.value); })
      .catch(error => onError(error))
      .finally(onSettled);
    return tail;
  };
}

/**
 * Removes jars from the selection by file name.
 *
 * @param current   the selection.
 * @param fileNames the file names to remove; names not selected are ignored.
 * @returns the new selection; `current` is not changed.
 */
export function removeArtifactDrafts(
  current: readonly StudioComponentArtifactDraft[],
  fileNames: ReadonlySet<string>
): readonly StudioComponentArtifactDraft[] {
  return current.filter(draft => !fileNames.has(draft.fileName));
}
