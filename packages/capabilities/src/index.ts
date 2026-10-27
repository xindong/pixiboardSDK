import {
  createMediaAssetRefs,
  preferredMediaNodeSize,
  type AssetRecord,
  type BoardChangeSet,
  type BoardCore,
  type BoardNode,
  type BoardNodeCreateInput,
  type JsonValue,
} from "@pixi-board/core";
import { aborted, CapabilityError, CapabilityUnavailableError, mapCoreError } from "./errors.ts";
import type { AssetImportRequest, AssetImportService, BoardCapabilities, CaptureService, CreateNodeInput, ImportedAsset, PreviewService, ReadNodesInput, UpdateNodeInput, WriteOptions } from "./types.ts";

export * from "./types.ts";
export * from "./errors.ts";

export type BoardCapabilityServices = { preview?: PreviewService; capture?: CaptureService; import?: AssetImportService };

export function createBoardCapabilities(core: BoardCore, services: BoardCapabilityServices = {}): BoardCapabilities {
  const transact = <T>(label: string, options: WriteOptions, operation: () => T) => {
    aborted(options.signal);
    let changeSet: BoardChangeSet | undefined;
    const off = core.on("change", (event) => { changeSet = event.changeSet; });
    try {
      const result = core.transaction(label, operation, {
        origin: options.origin ?? "api",
        recordHistory: options.recordHistory,
      });
      return { result, changed: changeSet !== undefined, changeSet };
    } catch (error) {
      throw mapCoreError(error);
    } finally { off(); }
  };
  const page = <T>(items: readonly T[], requested = 50, cursor?: string) => {
    const limit = Math.min(Math.max(requested, 1), 200);
    const start = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
    const out = items.slice(start, start + limit);
    const hasMore = start + out.length < items.length;
    return { out, page: { hasMore, ...(hasMore ? { nextCursor: String(start + out.length) } : {}) } };
  };
  const writeResult = (value: { changed: boolean; changeSet?: BoardChangeSet; requestId?: string; nodes?: readonly BoardNode[]; assets?: readonly AssetRecord[]; deletedNodeIds?: readonly string[]; deletedAssetIds?: readonly string[] }) => ({
    changed: value.changed,
    nodes: value.nodes ?? [],
    ...(value.assets ? { assets: value.assets } : {}),
    ...(value.deletedNodeIds ? { deletedNodeIds: value.deletedNodeIds } : {}),
    ...(value.deletedAssetIds ? { deletedAssetIds: value.deletedAssetIds } : {}),
    revision: core.document.snapshot().revision,
    ...(value.changeSet ? { changeSet: value.changeSet } : {}),
    requestId: value.requestId,
  });

  const capabilities: BoardCapabilities = {
    availability: { preview: Boolean(services.preview), capture: Boolean(services.capture), import: Boolean(services.import) },
    document: {
      snapshot: async (options = {}) => { aborted(options.signal); return core.document.snapshot(); },
      validate: async (input, options = {}) => { try { aborted(options.signal); return core.document.validate(input); } catch (error) { throw mapCoreError(error); } },
      load: async (input, options = {}) => { try { aborted(options.signal); const changeSet = core.document.load(input, options); aborted(options.signal); return { changed: true, revision: changeSet.revision, changeSet, requestId: options.requestId }; } catch (error) { throw mapCoreError(error); } },
    },
    nodes: {
      read: async (input: ReadNodesInput = {}, options = {}) => { try { aborted(options.signal); const result = page(core.nodes.list(input.filter ?? {}), input.limit, input.cursor); return { nodes: result.out, page: result.page, revision: core.document.snapshot().revision, requestId: options.requestId }; } catch (error) { throw mapCoreError(error); } },
      create: async (input, options = {}) => {
        try {
          if (!input.nodes.length) throw new CapabilityError("INVALID_INPUT", "nodes must not be empty");
          const prepared = input.nodes.some((item) => item.source)
            ? await Promise.all(input.nodes.map((item) => prepareWrite(core, services, item, options)))
            : input.nodes.map(prepareDirectCreate);
          aborted(options.signal);
          const tx = transact(options.label ?? "Create nodes", options, () => {
            const nodes: BoardNode[] = [];
            for (const item of prepared) {
              aborted(options.signal);
              if (item.sourceToken !== undefined) assertLatestSourceRequest(core, item.sourceNodeId!, item.sourceToken);
              if (item.asset) core.assets.upsert(item.asset);
              const { asset: _asset, sourceToken: _token, sourceNodeId: _nodeId, ...nodeInput } = item;
              nodes.push(core.nodes.create(nodeInput) as BoardNode);
            }
            return nodes;
          });
          return writeResult({ ...tx, nodes: tx.result, requestId: options.requestId });
        } catch (error) { throw mapCoreError(error); }
      },
      update: async (input, options = {}) => {
        let stopWatching: (() => void) | undefined;
        try {
          if (!input.nodes.length) throw new CapabilityError("INVALID_INPUT", "nodes must not be empty");
          aborted(options.signal);
          const sourceIds = new Set(input.nodes.filter((item) => item.source).map((item) => item.id));
          const sourceIdentity = new Map<string, SourceIdentity | undefined>();
          const invalidated = new Set<string>();
          for (const id of sourceIds) sourceIdentity.set(id, readSourceIdentity(core, id));
          if (sourceIds.size) {
            stopWatching = core.on("change", ({ changeSet }) => {
              // Structural changes are reported from before/after snapshots, so a
              // same-transaction remove/recreate of an id is not observable here.
              for (const id of sourceIds) {
                if (changeSet.origin === "load" || changeSet.removedNodeIds.includes(id) || changeSet.addedNodeIds.includes(id)) {
                  invalidated.add(id);
                } else if ((changeSet.updatedNodeIds.includes(id) || changeSet.assetChangedNodeIds.includes(id)) &&
                  !jsonEqual(sourceIdentity.get(id), readSourceIdentity(core, id))) {
                  invalidated.add(id);
                }
              }
            });
          }
          const commit = (prepared: PreparedNodeUpdate[]) => {
            const tx = transact(options.label ?? "Update nodes", options, () => {
              const nodes: BoardNode[] = [];
              for (const item of prepared) {
                aborted(options.signal);
                if (item.kind === "source") {
                  assertLatestSourceRequest(core, item.id, item.token);
                  const latest = core.nodes.get(item.id);
                  if (!latest || invalidated.has(item.id) || !jsonEqual(sourceIdentity.get(item.id), readSourceIdentity(core, item.id))) {
                    throw new CapabilityError("TRANSACTION_CONFLICT", "Node or source changed while source import was pending", { nodeId: item.id });
                  }
                  core.assets.upsert(item.imported.asset);
                  nodes.push(core.nodes.update(item.id, importedUpdatePatch(item.raw, item.initial, latest, item.imported)) as BoardNode);
                } else {
                  const patch = { ...item.patch };
                  if (item.asset) {
                    const latest = core.nodes.get(item.id);
                    if (!latest) throw new CapabilityError("NODE_NOT_FOUND", `Node not found: ${item.id}`, { nodeId: item.id });
                    patch.assetRefs ??= { ...(latest.assetRefs ?? {}), primary: { assetId: item.asset.id, variant: "original" } };
                    core.assets.upsert(item.asset);
                  }
                  nodes.push(core.nodes.update(item.id, patch) as BoardNode);
                }
              }
              return nodes;
            });
            return writeResult({ ...tx, nodes: tx.result, requestId: options.requestId });
          };
          if (!sourceIds.size) return commit(input.nodes.map(prepareDirectUpdate));
          const prepared = await Promise.all(input.nodes.map((item) => prepareWrite(core, services, item, options)));
          aborted(options.signal);
          return commit(prepared);
        } catch (error) { throw mapCoreError(error); }
        finally { stopWatching?.(); }
      },
      delete: async (input, options = {}) => { try { if (!input.nodeIds.length) throw new CapabilityError("INVALID_INPUT", "nodeIds must not be empty"); const tx = transact(options.label ?? "Delete nodes", options, () => { const ids: string[] = []; for (const id of [...new Set(input.nodeIds)]) { aborted(options.signal); core.nodes.remove(id); ids.push(id); } return ids; }); return writeResult({ ...tx, deletedNodeIds: tx.result, requestId: options.requestId }); } catch (error) { throw mapCoreError(error); } },
    },
    assets: {
      read: async (input = {}, options = {}) => { try { aborted(options.signal); const assets = core.assets.list().filter((asset) => (!input.ids || input.ids.includes(asset.id)) && (!input.kinds || input.kinds.includes(asset.kind))); const result = page(assets, input.limit, input.cursor); return { assets: result.out, page: result.page, revision: core.document.snapshot().revision, requestId: options.requestId }; } catch (error) { throw mapCoreError(error); } },
      upsert: async (input, options = {}) => { try { if (!input.assets.length) throw new CapabilityError("INVALID_INPUT", "assets must not be empty"); const tx = transact(options.label ?? "Upsert assets", options, () => input.assets.map((asset) => { aborted(options.signal); return core.assets.upsert(asset) as AssetRecord; })); return writeResult({ ...tx, assets: tx.result, requestId: options.requestId }); } catch (error) { throw mapCoreError(error); } },
      remove: async (input, options = {}) => { try { if (!input.assetIds.length) throw new CapabilityError("INVALID_INPUT", "assetIds must not be empty"); const tx = transact(options.label ?? "Remove assets", options, () => [...new Set(input.assetIds)].map((id) => { aborted(options.signal); core.assets.remove(id); return id; })); return writeResult({ ...tx, deletedAssetIds: tx.result, requestId: options.requestId }); } catch (error) { throw mapCoreError(error); } },
    },
    selection: {
      get: async (options = {}) => { aborted(options.signal); return core.selection.get(); },
      set: async (nodeIds, options = {}) => { try { aborted(options.signal); core.selection.set(nodeIds); return { nodeIds: core.selection.get(), requestId: options.requestId }; } catch (error) { throw mapCoreError(error); } },
    },
    viewport: {
      get: async (options = {}) => { aborted(options.signal); return core.viewport.get(); },
      set: async (viewport, options = {}) => { try { aborted(options.signal); core.viewport.set(viewport); return { viewport: core.viewport.get(), requestId: options.requestId }; } catch (error) { throw mapCoreError(error); } },
    },
    history: {
      canUndo: () => core.history.canUndo(), canRedo: () => core.history.canRedo(), clear: () => core.history.clear(),
      undo: (options = {}) => { try { aborted(options.signal); return core.history.undo(); } catch (error) { throw mapCoreError(error); } },
      redo: (options = {}) => { try { aborted(options.signal); return core.history.redo(); } catch (error) { throw mapCoreError(error); } },
    },
    preview: { get: async (input, options = {}) => { try { aborted(options.signal); if (!core.nodes.get(input.nodeId)) throw new CapabilityError("NODE_NOT_FOUND", `Node not found: ${input.nodeId}`, { nodeId: input.nodeId }); if (!services.preview) throw new CapabilityUnavailableError("preview"); const value = await services.preview(input, options); aborted(options.signal); return { ...value, revision: core.document.snapshot().revision, requestId: options.requestId }; } catch (error) { throw mapCoreError(error); } } },
    capture: { available: Boolean(services.capture), capture: async (input: JsonValue, options = {}) => { try { aborted(options.signal); if (!services.capture) throw new CapabilityUnavailableError("capture"); const value = await services.capture(input, options); aborted(options.signal); return { ...value, revision: core.document.snapshot().revision, requestId: options.requestId }; } catch (error) { throw mapCoreError(error); } } },
  };
  return capabilities;
}

type PreparedNodeInput = BoardNodeCreateInput & { asset?: AssetRecord; sourceToken?: number; sourceNodeId?: string };
type PreparedNodeUpdate =
  | { kind: "update"; id: string; patch: NonNullable<UpdateNodeInput["patch"]>; asset?: AssetRecord }
  | { kind: "source"; id: string; initial: Readonly<BoardNode>; raw: UpdateNodeInput; imported: ImportedAsset; token: number };

// Include source records: a host can replace the source under the same asset
// id without changing the node's refs. Preview-only roles are not identity.
type SourceIdentity = {
  type: string;
  typeVersion: number;
  assetRefs: BoardNode["assetRefs"];
  assets: Array<Readonly<AssetRecord> | undefined>;
};
function readSourceIdentity(core: BoardCore, nodeId: string): SourceIdentity | undefined {
  const node = core.nodes.get(nodeId);
  if (!node) return undefined;
  const refs = Object.fromEntries(Object.entries(node.assetRefs ?? {})
    .filter(([role]) => !isPreviewRefRole(role))
    .sort(([left], [right]) => left.localeCompare(right)));
  const ids = [...new Set(Object.values(refs).map((ref) => ref.assetId))].sort();
  return { type: node.type, typeVersion: node.typeVersion, assetRefs: refs, assets: ids.map((id) => sourceAssetIdentity(core.assets.get(id))) };
}

function isPreviewRefRole(role: string): boolean {
  return role === "preview" || role === "poster" || role === "waveform" ||
    role.startsWith("_documentPreview") || /^preview-[a-f0-9]{64}$/.test(role);
}

function sourceAssetIdentity(asset: Readonly<AssetRecord> | undefined): AssetRecord | undefined {
  if (!asset) return undefined;
  const identity = { ...asset };
  for (const key of Object.keys(identity)) {
    if (isPreviewAssetField(key)) delete identity[key];
  }
  for (const key of ["metadata", "variants", "binaries"] as const) {
    const value = jsonObject(identity[key]);
    if (!value) continue;
    const filtered = { ...value };
    for (const entry of Object.keys(filtered)) {
      if (isPreviewAssetField(entry)) delete filtered[entry];
    }
    if (key === "metadata") {
      for (const nestedKey of ["variants", "binaries"]) {
        const nested = jsonObject(filtered[nestedKey]);
        if (!nested) continue;
        const remaining = { ...nested };
        for (const entry of Object.keys(remaining)) {
          if (isPreviewAssetField(entry)) delete remaining[entry];
        }
        if (Object.keys(remaining).length) filtered[nestedKey] = remaining;
        else delete filtered[nestedKey];
      }
    }
    if (Object.keys(filtered).length) identity[key] = filtered;
    else delete identity[key];
  }
  return identity;
}

function isPreviewAssetField(key: string): boolean {
  return /^(?:preview|poster|waveform)(?:$|[A-Z_-])/.test(key) || key.startsWith("_documentPreview");
}

type SourceRequestState = {
  nextToken: number;
  latestByNode: Map<string, number>;
};
const sourceRequestStates = new WeakMap<BoardCore, SourceRequestState>();

function sourceRequests(core: BoardCore): SourceRequestState {
  let state = sourceRequestStates.get(core);
  if (!state) {
    state = { nextToken: 0, latestByNode: new Map() };
    sourceRequestStates.set(core, state);
  }
  return state;
}

function beginSourceRequest(core: BoardCore, nodeId: string): number {
  const state = sourceRequests(core);
  const token = ++state.nextToken;
  state.latestByNode.set(nodeId, token);
  return token;
}

function assertLatestSourceRequest(core: BoardCore, nodeId: string, token: number): void {
  const state = sourceRequests(core);
  if (state.latestByNode.get(nodeId) !== token) {
    throw new CapabilityError("TRANSACTION_CONFLICT", "Source import was superseded by a newer request", { nodeId });
  }
}

async function prepareWrite(
  core: BoardCore,
  services: BoardCapabilityServices,
  raw: CreateNodeInput,
  options: WriteOptions,
): Promise<PreparedNodeInput>;
async function prepareWrite(
  core: BoardCore,
  services: BoardCapabilityServices,
  raw: UpdateNodeInput,
  options: WriteOptions,
): Promise<PreparedNodeUpdate>;
async function prepareWrite(
  core: BoardCore,
  services: BoardCapabilityServices,
  raw: CreateNodeInput | UpdateNodeInput,
  options: WriteOptions,
): Promise<PreparedNodeInput | PreparedNodeUpdate> {
  const nodeId = "id" in raw ? raw.id : undefined;
  const current = nodeId ? core.nodes.get(nodeId) : undefined;
  const nodeType = "type" in raw ? raw.type : current?.type;
  if (!nodeType && raw.source) throw new CapabilityError("INVALID_INPUT", "source update requires an existing node type");

  if (raw.source) {
    if (!services.import) throw new CapabilityUnavailableError("import");
    if (raw.asset) throw new CapabilityError("INVALID_INPUT", "source and asset are mutually exclusive");
    aborted(options.signal);
    const request: AssetImportRequest = {
      source: raw.source,
      nodeType: nodeType!,
      ...("name" in raw && raw.name ? { name: raw.name } : {}),
      ...(raw.source.mimeType ? { mimeType: raw.source.mimeType } : {}),
    };
    const sourceId = "id" in raw ? raw.id : undefined;
    const token = sourceId === undefined ? undefined : beginSourceRequest(core, sourceId);
    const imported = await services.import(request, options);
    aborted(options.signal);
    if ("type" in raw) {
      const prepared = importedCreateInput(raw, imported);
      return token === undefined ? prepared : { ...prepared, sourceToken: token, sourceNodeId: sourceId };
    }
    if (!current || token === undefined) throw new CapabilityError("INVALID_INPUT", "source update requires an existing node type");
    return { kind: "source", id: raw.id, initial: current, raw, imported, token };
  }

  if ("type" in raw) {
    return prepareDirectCreate(raw);
  }

  return prepareDirectUpdate(raw);
}

function prepareDirectCreate(raw: CreateNodeInput): PreparedNodeInput {
  const asset = raw.asset;
  return {
    ...raw,
    x: raw.x ?? 0,
    y: raw.y ?? 0,
    width: raw.width ?? 100,
    height: raw.height ?? 100,
    ...(asset ? {
      asset,
      assetRefs: raw.assetRefs ?? createMediaAssetRefs(raw.type, asset.id),
      fit: raw.fit ?? "contain",
    } : {}),
  } as PreparedNodeInput;
}

function prepareDirectUpdate(raw: UpdateNodeInput): PreparedNodeUpdate {
  return { kind: "update", id: raw.id, patch: raw.patch, ...(raw.asset ? { asset: raw.asset } : {}) };
}

function importedMetadata(imported: ImportedAsset): Record<string, JsonValue> {
  return {
    ...imported.props,
    ...(imported.width ? { intrinsicWidth: imported.width } : {}),
    ...(imported.height ? { intrinsicHeight: imported.height } : {}),
    ...(imported.duration ? { duration: imported.duration } : {}),
    ...(imported.previewStatus ? { previewStatus: imported.previewStatus } : {}),
  } as Record<string, JsonValue>;
}

function importedCreateInput(raw: CreateNodeInput, imported: ImportedAsset): PreparedNodeInput {
  const nodeType = "type" in raw ? raw.type : undefined;
  if (!nodeType) throw new CapabilityError("INVALID_INPUT", "Imported source has no target node type");
  const assetRefs = imported.assetRefs ?? createMediaAssetRefs(nodeType, imported.asset.id);
  const size = preferredMediaNodeSize(
    imported.width && imported.height ? { width: imported.width, height: imported.height } : undefined,
  );
  return {
    ...raw,
    asset: imported.asset,
    assetRefs,
    fit: raw.fit ?? imported.fit ?? "contain",
    x: raw.x ?? 0,
    y: raw.y ?? 0,
    width: raw.width ?? size.width,
    height: raw.height ?? size.height,
    props: { ...importedMetadata(imported), ...(raw.props && typeof raw.props === "object" && !Array.isArray(raw.props) ? raw.props : {}) } as never,
  } as PreparedNodeInput;
}

// These fields describe the source or its background preparation, not the
// user's node edits. Keep this aligned with core's media background fields.
const SOURCE_OWNED_PROP_KEYS = new Set([
  "previewRequestId", "previewStatus", "previewError", "previewSpec", "previewKey",
  "pageCount", "previewWarnings", "previewQuality", "fileExtension", "previewJobId",
  "intrinsicWidth", "intrinsicHeight", "duration", "mediaContentHash",
  "mediaPreparationStatus", "mediaPreparationError", "mediaAutoSize", "mediaAutoSizeBaseline",
]);

function importedUpdatePatch(
  raw: UpdateNodeInput,
  initial: Readonly<BoardNode>,
  latest: Readonly<BoardNode>,
  imported: ImportedAsset,
): NonNullable<UpdateNodeInput["patch"]> {
  const nodeType = latest.type;
  const assetRefs = imported.assetRefs ?? createMediaAssetRefs(nodeType, imported.asset.id);
  const initialProps = jsonObject(initial.props);
  const latestProps = jsonObject(latest.props);
  const requestedProps = jsonObject(raw.patch.props);
  const patch = { ...raw.patch } as NonNullable<UpdateNodeInput["patch"]> & Record<string, unknown>;
  const importedProps = importedMetadata(imported);
  const userChangedProps = latestProps ? changedKeys(initialProps, latestProps).filter((key) => !SOURCE_OWNED_PROP_KEYS.has(key)) : [];
  const sourceOwnedKeys = [...SOURCE_OWNED_PROP_KEYS];

  for (const key of Object.keys(patch)) {
    if (key === "props" || key === "assetRefs" || key === "fit") continue;
    if (nodeFieldChanged(initial, latest, key)) delete patch[key];
  }

  if (latestProps) {
    const props: Record<string, JsonValue> = {
      ...withoutKeys(latestProps, sourceOwnedKeys),
      ...withoutKeys(importedProps, userChangedProps),
      ...withoutKeys(requestedProps ?? {}, sourceOwnedKeys),
    };
    for (const key of userChangedProps) {
      if (Object.hasOwn(latestProps, key)) props[key] = latestProps[key];
      else delete props[key];
    }
    patch.props = props;
  } else if (nodeFieldChanged(initial, latest, "props")) {
    delete patch.props;
  } else {
    patch.props = { ...importedProps, ...withoutKeys(requestedProps ?? {}, sourceOwnedKeys) };
  }

  if (nodeFieldChanged(initial, latest, "fit")) delete patch.fit;
  else patch.fit = raw.patch.fit ?? imported.fit ?? "contain";
  // Preview refs produced for the previous source must not follow the new one.
  patch.assetRefs = assetRefs;
  return patch;
}

function withoutKeys(
  value: Record<string, JsonValue>,
  keys: readonly string[],
): Record<string, JsonValue> {
  const result = { ...value };
  for (const key of keys) delete result[key];
  return result;
}

function jsonObject(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : undefined;
}

function changedKeys(
  before: Record<string, JsonValue> | undefined,
  after: Record<string, JsonValue>,
): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  return [...keys].filter((key) => {
    const hadBefore = before !== undefined && Object.hasOwn(before, key);
    const hasAfter = Object.hasOwn(after, key);
    return hadBefore !== hasAfter || !jsonEqual(before?.[key], after[key]);
  });
}

function nodeFieldChanged(before: Readonly<BoardNode>, after: Readonly<BoardNode>, key: string): boolean {
  const previous = before as unknown as Record<string, unknown>;
  const current = after as unknown as Record<string, unknown>;
  if (Object.hasOwn(previous, key) !== Object.hasOwn(current, key)) return true;
  return !jsonEqual(previous[key], current[key]);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
