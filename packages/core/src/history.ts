import type { DataPatch } from "./patches";
import type { BoardChangeSet, ChangeOrigin } from "./types";

export type HistoryEntry = {
  label?: string;
  origin: ChangeOrigin;
  forward: DataPatch[];
  inverse: DataPatch[];
  /** Set by `TransactionOptions.coalesceKey`; see mergeHistoryEntries. */
  coalesceKey?: string;
};

export type HistoryChangeEvent = {
  canUndo: boolean;
  canRedo: boolean;
};

export interface HistoryHost {
  applyHistoryEntry(entry: HistoryEntry, direction: "undo" | "redo"): BoardChangeSet;
}

const recordHistory = Symbol("recordHistory");

export class HistoryController {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<(event: HistoryChangeEvent) => void>();

  constructor(private readonly host: HistoryHost) {}

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): BoardChangeSet | undefined {
    const entry = this.undoStack.at(-1);
    if (!entry) return undefined;
    const changeSet = this.host.applyHistoryEntry(entry, "undo");
    this.undoStack.pop();
    this.redoStack.push(entry);
    this.emit();
    return changeSet;
  }

  redo(): BoardChangeSet | undefined {
    const entry = this.redoStack.at(-1);
    if (!entry) return undefined;
    const changeSet = this.host.applyHistoryEntry(entry, "redo");
    this.redoStack.pop();
    this.undoStack.push(entry);
    this.emit();
    return changeSet;
  }

  clear(): void {
    if (!this.canUndo() && !this.canRedo()) return;
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  onChange(listener: (event: HistoryChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  [recordHistory](entry: HistoryEntry): void {
    const previous = this.undoStack.at(-1);
    // A pointer gesture commits one transaction per frame so the renderer and
    // any observer sees live geometry, but the user thinks of the whole drag
    // as one action — fold the frames into the entry the gesture opened.
    if (entry.coalesceKey !== undefined && previous?.coalesceKey === entry.coalesceKey) {
      previous.forward = compactReplaces([...previous.forward, ...entry.forward]);
      // Inverse patches run newest-frame-first, so the gesture's original
      // state sits at the end and survives compaction.
      previous.inverse = compactReplaces([...entry.inverse, ...previous.inverse]);
      this.redoStack = [];
      this.emit();
      return;
    }
    this.undoStack.push(entry);
    this.redoStack = [];
    this.emit();
  }

  private emit(): void {
    const event = { canUndo: this.canUndo(), canRedo: this.canRedo() };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener failures must not corrupt already-committed history state.
      }
    }
  }
}

/**
 * Collapses the repeated per-frame replaces a coalesced gesture produces down
 * to one patch per touched id. Without it a 300-frame drag over 50 nodes would
 * leave 15000 patches on a single undo step.
 *
 * Both stacks keep the *last* patch per id, because both are already ordered
 * so that the last one is the state the entry must reach: `forward` runs
 * oldest-first and must end at the newest geometry, while `inverse` runs
 * newest-first (it is built by unshifting) and must end at the geometry the
 * gesture started from.
 *
 * Only replace-only runs can be compacted — an insert or remove makes the
 * sequence order-dependent, and a gesture that structurally edits the document
 * is not the hot path this exists for.
 */
function compactReplaces(patches: DataPatch[]): DataPatch[] {
  if (patches.some((patch) => patch.op !== "node:replace" && patch.op !== "asset:replace")) {
    return patches;
  }
  const byKey = new Map<string, DataPatch>();
  for (const patch of patches) {
    const key = patch.op === "node:replace"
      ? `node:${patch.node.id}`
      : `asset:${(patch as Extract<DataPatch, { op: "asset:replace" }>).asset.id}`;
    // Map.set on an existing key overwrites the value but keeps the original
    // insertion position, so the relative order of distinct ids is preserved.
    byKey.set(key, patch);
  }
  return [...byKey.values()];
}

export function createHistoryController(host: HistoryHost): {
  controller: HistoryController;
  record(entry: HistoryEntry): void;
} {
  const controller = new HistoryController(host);
  return {
    controller,
    record: (entry) => controller[recordHistory](entry),
  };
}
