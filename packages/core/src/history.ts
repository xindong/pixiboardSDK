import { cloneValue } from "./json";
import type { DataPatch } from "./patches";
import type { BoardChangeSet, ChangeOrigin } from "./types";

export type HistoryEntry = {
  label?: string;
  origin: ChangeOrigin;
  forward: DataPatch[];
  inverse: DataPatch[];
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
    this.undoStack.push(cloneValue(entry));
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
