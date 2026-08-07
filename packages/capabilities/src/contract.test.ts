import { describe, expect, it } from "vitest";
import { BoardCore, NodeTypeRegistry, type NodeTypeDefinition } from "@pixi-board/core";
import { createBoardCapabilities } from "./index.ts";

const text: NodeTypeDefinition = { type: "text", version: 1, defaults: {}, validate: (value) => value ?? {}, getBounds: (node) => ({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height }) };
function core() { const registry = new NodeTypeRegistry(); registry.register(text); return new BoardCore({ nodeTypes: registry, idFactory: (() => { let n = 0; return () => `id-${++n}`; })(), now: () => 1 }); }

describe("core-backed capabilities", () => {
  it("batches nodes into one revision/change/history entry and undoes", () => {
    const board = core(); const caps = createBoardCapabilities(board); let events = 0; board.on("change", () => events++);
    const result = caps.nodes.create({ nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 10, height: 10 }, { id: "b", type: "text", x: 1, y: 1, width: 10, height: 10 }] }, { origin: "agent" });
    return result.then((write) => { expect(write.revision).toBe(1); expect(events).toBe(1); expect(board.history.canUndo()).toBe(true); const undo = caps.history.undo(); expect(undo?.origin).toBe("history"); expect(board.document.toJSON().nodes).toHaveLength(0); });
  });
  it("rolls back a failed batch and handles abort/headless availability", async () => {
    const board = core(); const caps = createBoardCapabilities(board); const before = board.document.toJSON();
    await expect(caps.nodes.create({ nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 1, height: 1 }, { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1 }] }, { origin: "agent" })).rejects.toMatchObject({ code: "DOCUMENT_VALIDATION" });
    expect(board.document.toJSON()).toEqual(before);
    const controller = new AbortController(); controller.abort(); await expect(caps.nodes.create({ nodes: [{ type: "text", x: 0, y: 0, width: 1, height: 1 }] }, { origin: "agent", signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" });
    expect(caps.availability.preview).toBe(false); await expect(caps.preview.get({ nodeId: "missing" })).rejects.toMatchObject({ code: "NODE_NOT_FOUND" }); await expect(caps.capture.capture({ target: "viewport" })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });
  it("returns changed false for no-op and exposes session/document/history contracts", async () => {
    const board = core(); const caps = createBoardCapabilities(board);
    await caps.nodes.create({ nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 1, height: 1 }] }, { origin: "api" });
    caps.history.clear(); const before = board.document.toJSON();
    const result = await caps.nodes.update({ nodes: [{ id: "a", patch: { x: 0 } }] }, { origin: "api" });
    expect(result.changed).toBe(false); expect(result.changeSet).toBeUndefined(); expect(result.revision).toBe(before.revision); expect(caps.history.canUndo()).toBe(false);
    expect((await caps.document.snapshot()).revision).toBe(before.revision);
    await caps.selection.set(["a"], { origin: "ui" }); expect(await caps.selection.get()).toEqual(["a"]);
    await caps.viewport.set({ scale: 2, offset: { x: 3, y: 4 } }, { origin: "ui" }); expect(await caps.viewport.get()).toEqual({ scale: 2, offset: { x: 3, y: 4 } });
  });
  it("returns deletedAssetIds for asset removal", async () => {
    const board = core(); const caps = createBoardCapabilities(board);
    const created = await caps.assets.upsert({ assets: [{ id: "asset-1", kind: "text", source: { content: "hello" } }] }, { origin: "api" });
    expect(created.changed).toBe(true); caps.history.clear();
    const removed = await caps.assets.remove({ assetIds: ["asset-1"] }, { origin: "api" });
    expect(removed.deletedAssetIds).toEqual(["asset-1"]); expect(removed.deletedNodeIds).toBeUndefined(); expect(removed.changeSet).toMatchObject({ revision: 2 });
  });
});
