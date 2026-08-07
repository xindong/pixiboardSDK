import type { AssetRecord, BoardChangeSet, BoardCore, BoardNode, JsonValue } from "@pixi-board/core";
import { aborted, CapabilityError, CapabilityUnavailableError, mapCoreError } from "./errors.ts";
import type { BoardCapabilities, CaptureService, CreateNodeInput, PreviewService, ReadNodesInput, WriteOptions } from "./types.ts";

export * from "./types.ts";
export * from "./errors.ts";

export type BoardCapabilityServices = { preview?: PreviewService; capture?: CaptureService };

export function createBoardCapabilities(core: BoardCore, services: BoardCapabilityServices = {}): BoardCapabilities {
  const transact = <T>(label: string, options: WriteOptions, operation: () => T) => {
    aborted(options.signal);
    let changeSet: BoardChangeSet | undefined;
    const off = core.on("change", (event) => { changeSet = event.changeSet; });
    try {
      const result = core.transaction(label, operation, { origin: options.origin ?? "api" });
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
    availability: { preview: Boolean(services.preview), capture: Boolean(services.capture) },
    document: {
      snapshot: async (options = {}) => { aborted(options.signal); return core.document.snapshot(); },
      validate: async (input, options = {}) => { try { aborted(options.signal); return core.document.validate(input, { migrate: options.migrate }); } catch (error) { throw mapCoreError(error); } },
      load: async (input, options = {}) => { try { aborted(options.signal); const changeSet = core.document.load(input, options); aborted(options.signal); return { changed: true, revision: changeSet.revision, changeSet, requestId: options.requestId }; } catch (error) { throw mapCoreError(error); } },
    },
    nodes: {
      read: async (input: ReadNodesInput = {}, options = {}) => { try { aborted(options.signal); const result = page(core.nodes.list(input.filter ?? {}), input.limit, input.cursor); return { nodes: result.out, page: result.page, revision: core.document.snapshot().revision, requestId: options.requestId }; } catch (error) { throw mapCoreError(error); } },
      create: async (input, options = {}) => { try { if (!input.nodes.length) throw new CapabilityError("INVALID_INPUT", "nodes must not be empty"); const tx = transact(options.label ?? "Create nodes", options, () => { const nodes: BoardNode[] = []; for (const raw of input.nodes) { aborted(options.signal); const { asset, ...nodeInput } = raw; const refs = asset ? { ...(nodeInput.assetRefs ?? {}), primary: { assetId: asset.id, variant: "original" as const } } : nodeInput.assetRefs; if (asset) core.assets.upsert(asset); nodes.push(core.nodes.create({ x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0, ...nodeInput, ...(refs ? { assetRefs: refs } : {}) } as never) as BoardNode); } return nodes; }); return writeResult({ ...tx, nodes: tx.result, requestId: options.requestId }); } catch (error) { throw mapCoreError(error); } },
      update: async (input, options = {}) => { try { if (!input.nodes.length) throw new CapabilityError("INVALID_INPUT", "nodes must not be empty"); const tx = transact(options.label ?? "Update nodes", options, () => { const nodes: BoardNode[] = []; for (const item of input.nodes) { aborted(options.signal); if (item.asset) core.assets.upsert(item.asset); nodes.push(core.nodes.update(item.id, item.patch) as BoardNode); } return nodes; }); return writeResult({ ...tx, nodes: tx.result, requestId: options.requestId }); } catch (error) { throw mapCoreError(error); } },
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
