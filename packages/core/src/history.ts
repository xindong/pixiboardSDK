import { cloneValue, jsonEqual } from "./json";
import type { DataPatch } from "./patches";
import type { AssetRef, BoardChangeSet, BoardNode, ChangeOrigin, JsonValue } from "./types";

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

/**
 * The media-only material changed by a `recordHistory:false` transaction.
 *
 * The update is deliberately narrow: it must not turn background writes into
 * a way to preserve unrelated user fields when an older history entry runs.
 */
export type HistoryMediaBackgroundUpdate = {
  nodeId: string;
  sourceType: string;
  sourceRefs: ReadonlySet<string>;
  /** Assets are document-global, so a parent media ref can outlive a node. */
  assetRefs: Record<string, AssetRef | undefined>;
  /** Only fields explicitly listed here are carried across history rebases. */
  props: Record<string, JsonValue | undefined>;
};

/**
 * Service-owned fields that can arrive after import/preview preparation.
 * `previewRequestId` and user-editable props are intentionally absent: the
 * former identifies the current editor request, not a preview result.
 */
const MEDIA_BACKGROUND_PROP_KEYS = [
  "previewStatus",
  "previewError",
  "previewSpec",
  "previewKey",
  "pageCount",
  "previewWarnings",
  "previewQuality",
  "fileExtension",
  "previewJobId",
  "intrinsicWidth",
  "intrinsicHeight",
  "duration",
  "mediaContentHash",
  "mediaPreparationStatus",
  "mediaPreparationError",
  "mediaAutoSize",
  "mediaAutoSizeBaseline",
] as const;

const MEDIA_BACKGROUND_ASSET_REF_ROLES = new Set([
  "preview",
  "poster",
  "waveform",
]);

const SOURCE_ASSET_REF_ROLES = [
  "primary",
  "original",
  "source",
  "image",
  "video",
  "audio",
  "model",
  "html",
  "markdown",
  "text-file",
  "file",
] as const;

function sourceRefs(node: BoardNode): ReadonlySet<string> {
  const refs = new Set<string>();
  for (const role of SOURCE_ASSET_REF_ROLES) {
    const ref = node.assetRefs?.[role];
    if (ref) refs.add(`${role}:${ref.assetId}:${ref.variant ?? ""}`);
  }
  return refs;
}

function isMediaBackgroundAssetRefRole(role: string): boolean {
  return MEDIA_BACKGROUND_ASSET_REF_ROLES.has(role) ||
    role.startsWith("_documentPreview") ||
    /^preview-[a-f0-9]{64}$/.test(role);
}

export function createHistoryMediaBackgroundUpdate(
  before: BoardNode,
  after: BoardNode,
): HistoryMediaBackgroundUpdate | undefined {
  const beforeSources = sourceRefs(before);
  const afterSources = sourceRefs(after);
  // A source/type transition is not a preview update. Never project a result
  // from one media identity onto snapshots for another. Comparing the complete
  // source-ref set also rejects alias changes; same-id delete/recreate is
  // handled independently by the history generation token.
  if (
    before.type !== after.type ||
    beforeSources.size !== afterSources.size ||
    [...beforeSources].some((id) => !afterSources.has(id))
  ) {
    return undefined;
  }

  const beforeProps = record(before.props);
  const afterProps = record(after.props);
  const props: Record<string, JsonValue | undefined> = {};
  for (const key of MEDIA_BACKGROUND_PROP_KEYS) {
    if (!jsonEqual(beforeProps[key], afterProps[key])) props[key] = afterProps[key];
  }

  const assetRefs: Record<string, AssetRef | undefined> = {};
  const beforeRefs = before.assetRefs ?? {};
  const afterRefs = after.assetRefs ?? {};
  for (const role of new Set([...Object.keys(beforeRefs), ...Object.keys(afterRefs)])) {
    if (!isMediaBackgroundAssetRefRole(role)) continue;
    if (!jsonEqual(beforeRefs[role], afterRefs[role])) {
      assetRefs[role] = afterRefs[role];
    }
  }

  if (Object.keys(assetRefs).length === 0 && Object.keys(props).length === 0) {
    return undefined;
  }
  return {
    nodeId: after.id,
    sourceType: before.type,
    sourceRefs: afterSources,
    assetRefs,
    props,
  };
}

const recordHistory = Symbol("recordHistory");
const rebaseMediaBackground = Symbol("rebaseMediaBackground");

type NodeGenerations = Map<string, number>;
type EntryGenerations = {
  before: NodeGenerations;
  after: NodeGenerations;
};

export class HistoryController {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<(event: HistoryChangeEvent) => void>();
  private readonly patchGenerations = new WeakMap<DataPatch, number>();
  private readonly entryGenerations = new WeakMap<HistoryEntry, EntryGenerations>();
  private nodeGenerations: NodeGenerations = new Map();
  private nextNodeGeneration = 1;

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
    this.restoreGenerations(entry, "before");
    this.emit();
    return changeSet;
  }

  redo(): BoardChangeSet | undefined {
    const entry = this.redoStack.at(-1);
    if (!entry) return undefined;
    const changeSet = this.host.applyHistoryEntry(entry, "redo");
    this.redoStack.pop();
    this.undoStack.push(entry);
    this.restoreGenerations(entry, "after");
    this.emit();
    return changeSet;
  }

  clear(): void {
    const hadHistory = this.canUndo() || this.canRedo();
    this.undoStack = [];
    this.redoStack = [];
    this.nodeGenerations = new Map();
    this.nextNodeGeneration = 1;
    if (hadHistory) this.emit();
  }

  onChange(listener: (event: HistoryChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  [recordHistory](entry: HistoryEntry): void {
    this.captureEntryGenerations(entry);
    const previous = this.undoStack.at(-1);
    // A pointer gesture commits one transaction per frame so the renderer and
    // any observer sees live geometry, but the user thinks of the whole drag
    // as one action — fold the frames into the entry the gesture opened.
    if (entry.coalesceKey !== undefined && previous?.coalesceKey === entry.coalesceKey) {
      previous.forward = this.compactPatches([...previous.forward, ...entry.forward]);
      // Inverse patches run newest-frame-first, so the gesture's original
      // state sits at the end and survives compaction.
      previous.inverse = this.compactPatches([...entry.inverse, ...previous.inverse]);
      const generationState = this.entryGenerations.get(previous);
      const nextGenerationState = this.entryGenerations.get(entry);
      if (generationState && nextGenerationState) {
        generationState.after = new Map(nextGenerationState.after);
      }
      this.redoStack = [];
      this.emit();
      return;
    }
    this.undoStack.push(entry);
    this.redoStack = [];
    this.emit();
  }

  [rebaseMediaBackground](updates: readonly HistoryMediaBackgroundUpdate[]): void {
    if (updates.length === 0) return;
    const updatesByNode = new Map(updates.map((update) => [update.nodeId, update]));
    const rebase = (stack: HistoryEntry[]) => {
      for (const entry of stack) {
        const forward = this.rebasePatches(entry.forward, updatesByNode);
        const inverse = this.rebasePatches(entry.inverse, updatesByNode);
        if (forward !== entry.forward) entry.forward = forward;
        if (inverse !== entry.inverse) entry.inverse = inverse;
      }
    };
    rebase(this.undoStack);
    rebase(this.redoStack);
  }

  private rebasePatches(
    patches: DataPatch[],
    updatesByNode: ReadonlyMap<string, HistoryMediaBackgroundUpdate>,
  ): DataPatch[] {
    let changed = false;
    const rebased = patches.map((patch): DataPatch => {
      if (!hasNodeSnapshot(patch)) return patch;
      const update = updatesByNode.get(patch.node.id);
      if (!update) return patch;
      const generation = this.nodeGenerations.get(patch.node.id);
      if (generation === undefined) return patch;
      if (this.patchGenerations.get(patch) !== generation) {
        return patch;
      }
      if (
        patch.node.type !== update.sourceType ||
        !sameSourceRefs(patch.node, update)
      ) {
        return patch;
      }
      const node = rebaseNodeMediaFields(patch.node, update);
      if (node === patch.node) return patch;
      changed = true;
      const rebasedPatch = { ...patch, node } as DataPatch;
      this.patchGenerations.set(rebasedPatch, generation);
      return rebasedPatch;
    });
    return changed ? rebased : patches;
  }

  private captureEntryGenerations(entry: HistoryEntry): void {
    const before = new Map(this.nodeGenerations);
    // `clear()` intentionally forgets which ids currently exist. Bootstrap a
    // lineage lazily for replace/remove patches, but never for a node inserted
    // by this entry: that is a new generation even when the id was reused.
    const present = new Set(this.nodeGenerations.keys());
    const insertedHere = new Set<string>();
    for (const patch of entry.forward) {
      if (patch.op === "node:insert") {
        present.add(patch.node.id);
        insertedHere.add(patch.node.id);
        continue;
      }
      if (patch.op !== "node:replace" && patch.op !== "node:remove") continue;
      const nodeId = patch.op === "node:replace" ? patch.node.id : patch.nodeId;
      if (!present.has(nodeId) && !insertedHere.has(nodeId)) {
        this.nodeGenerations.set(nodeId, 0);
        before.set(nodeId, 0);
        present.add(nodeId);
      }
      if (patch.op === "node:remove") present.delete(nodeId);
    }
    entry.forward.forEach((patch, forwardIndex) => {
      const inverse = entry.inverse[entry.forward.length - 1 - forwardIndex];
      if (patch.op === "node:insert") {
        const generation = this.nextNodeGeneration++;
        this.nodeGenerations.set(patch.node.id, generation);
        this.patchGenerations.set(patch, generation);
        if (inverse && hasNodeSnapshot(inverse)) this.patchGenerations.set(inverse, generation);
      } else if (patch.op === "node:replace") {
        const generation = this.nodeGenerations.get(patch.node.id) ?? 0;
        this.nodeGenerations.set(patch.node.id, generation);
        this.patchGenerations.set(patch, generation);
        if (inverse?.op === "node:replace") this.patchGenerations.set(inverse, generation);
      } else if (patch.op === "node:remove") {
        const generation = this.nodeGenerations.get(patch.nodeId) ?? 0;
        this.nodeGenerations.delete(patch.nodeId);
        if (inverse?.op === "node:insert") this.patchGenerations.set(inverse, generation);
      }
    });
    this.entryGenerations.set(entry, { before, after: new Map(this.nodeGenerations) });
  }

  private restoreGenerations(entry: HistoryEntry, side: "before" | "after"): void {
    const generations = this.entryGenerations.get(entry);
    if (generations) this.nodeGenerations = new Map(generations[side]);
  }

  private compactPatches(patches: DataPatch[]): DataPatch[] {
    const generationByNode = new Map<string, number>();
    for (const patch of patches) {
      if (!hasNodeSnapshot(patch)) continue;
      const generation = this.patchGenerations.get(patch);
      if (generation !== undefined) {
        generationByNode.set(patch.node.id, generation);
        continue;
      }
      const current = this.nodeGenerations.get(patch.node.id);
      if (current !== undefined) generationByNode.set(patch.node.id, current);
    }
    const compacted = compactReplaces(patches);
    // Compaction creates replacement patch objects. Carry lineage metadata to
    // them or later background writes cannot safely rebase coalesced gestures.
    for (const patch of compacted) {
      if (!hasNodeSnapshot(patch)) continue;
      const generation = generationByNode.get(patch.node.id);
      if (generation !== undefined) this.patchGenerations.set(patch, generation);
    }
    return compacted;
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

function sameSourceRefs(node: BoardNode, update: HistoryMediaBackgroundUpdate): boolean {
  const refs = sourceRefs(node);
  return refs.size === update.sourceRefs.size &&
    [...update.sourceRefs].every((ref) => refs.has(ref));
}

function hasNodeSnapshot(
  patch: DataPatch,
): patch is Extract<DataPatch, { op: "node:insert" | "node:replace" }> {
  return patch.op === "node:insert" || patch.op === "node:replace";
}

/**
 * Overlay service-owned media fields onto a history snapshot. The caller has
 * already matched node lineage, type and source asset, so unrelated persisted
 * fields remain exactly as the user's history recorded them.
 */
function rebaseNodeMediaFields(
  node: BoardNode,
  update: HistoryMediaBackgroundUpdate,
): BoardNode {
  let next = node;

  const roles = Object.keys(update.assetRefs);
  if (roles.length > 0) {
    const refs = { ...(next.assetRefs ?? {}) };
    let refsChanged = false;
    for (const role of roles) {
      if (jsonEqual(refs[role], update.assetRefs[role])) continue;
      refsChanged = true;
      if (update.assetRefs[role] === undefined) delete refs[role];
      else refs[role] = cloneValue(update.assetRefs[role]);
    }
    if (refsChanged) {
      next = Object.keys(refs).length === 0
        ? withoutAssetRefs(next)
        : { ...next, assetRefs: refs };
    }
  }

  const propKeys = Object.keys(update.props);
  if (propKeys.length > 0) {
    const props: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(record(next.props))) {
      if (value !== undefined) props[key] = value;
    }
    let propsChanged = false;
    for (const key of propKeys) {
      if (jsonEqual(props[key], update.props[key])) continue;
      propsChanged = true;
      if (update.props[key] === undefined) delete props[key];
      else props[key] = cloneValue(update.props[key]);
    }
    if (propsChanged) next = { ...next, props };
  }
  return next;
}

function withoutAssetRefs(node: BoardNode): BoardNode {
  const { assetRefs: _assetRefs, ...rest } = node;
  return rest;
}

function record(value: unknown): Record<string, JsonValue | undefined> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue | undefined>
    : {};
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
  rebaseMediaBackground(updates: readonly HistoryMediaBackgroundUpdate[]): void;
} {
  const controller = new HistoryController(host);
  return {
    controller,
    record: (entry) => controller[recordHistory](entry),
    rebaseMediaBackground: (updates) => controller[rebaseMediaBackground](updates),
  };
}
