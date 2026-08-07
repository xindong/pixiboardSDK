import { describe, expect, it } from "vitest";
import { BoardCore, NodeTypeRegistry, type NodeTypeDefinition } from "@pixi-board/core";
import { createBoardCapabilities } from "@pixi-board/capabilities";
import { createPixiBoardAgentTools } from "./index.ts";

const text: NodeTypeDefinition = { type: "text", version: 1, defaults: {}, validate: (value) => value ?? {}, getBounds: (node) => ({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height }) };
function tools() { const registry = new NodeTypeRegistry(); registry.register(text); const core = new BoardCore({ nodeTypes: registry, idFactory: (() => { let n = 0; return () => `id-${++n}`; })(), now: () => 1 }); return { core, tools: createPixiBoardAgentTools(createBoardCapabilities(core)) }; }
describe("agent canvas contract", () => {
  it("preserves requestId and uses discriminated writes", async () => { const fixture = tools(); const response = await fixture.tools.call("canvas.write", { type: "create", nodes: [{ id: "a", type: "text" }] }, { requestId: "req-1" }); expect(response.ok).toBe(true); if (response.ok) expect(response.data).toMatchObject({ revision: 1, requestId: "req-1" }); expect(fixture.core.history.canUndo()).toBe(true); });
  it("serializes invalid input and rejects unsupported fields", async () => { const fixture = tools(); const response = await fixture.tools.call("canvas.write", { type: "delete", nodeIds: ["a"], nodes: [] }, { requestId: "req-2" }); expect(response.ok).toBe(false); if (!response.ok) expect(response.error).toMatchObject({ code: "INVALID_INPUT", requestId: "req-2" }); });
  it("projects requested fields and translates source content to one asset/node commit", async () => {
    const fixture = tools();
    const response = await fixture.tools.call("canvas.write", { type: "create", nodes: [{ id: "source-node", type: "text", content: "hello" }] }, { requestId: "req-3" });
    expect(response.ok).toBe(true); expect(fixture.core.document.toJSON().assets).toHaveLength(1); expect(fixture.core.document.toJSON().revision).toBe(1);
    const read = await fixture.tools.call("canvas.read", { type: "nodes", fields: ["position"] }, { requestId: "req-4" });
    expect(read.ok).toBe(true); if (read.ok) { const node = (read.data as { nodes: Array<Record<string, unknown>> }).nodes[0]; expect(node.position).toEqual({ x: 0, y: 0 }); expect(node.size).toBeUndefined(); }
  });
  it("keeps Agent document and history undo/redo aligned with Core", async () => {
    const fixture = tools();
    const response = await fixture.tools.call("canvas.write", { type: "create", nodes: [{ id: "history-node", type: "text" }] }, { requestId: "req-history" });
    expect(response.ok).toBe(true); expect(fixture.core.document.toJSON().revision).toBe(1); expect(fixture.core.history.canUndo()).toBe(true);
    const undo = fixture.core.history.undo(); expect(undo?.origin).toBe("history"); expect(fixture.core.document.toJSON().nodes).toHaveLength(0); expect(fixture.core.history.canRedo()).toBe(true);
    const redo = fixture.core.history.redo(); expect(redo?.origin).toBe("history"); expect(fixture.core.document.toJSON().nodes).toHaveLength(1); expect(fixture.core.document.toJSON().revision).toBe(3);
  });
  it("matches direct Core and capability document/revision/change semantics", async () => {
    const direct = tools(); const viaCapability = tools(); const viaAgent = tools();
    const directEvents: unknown[] = []; direct.core.on("change", (event) => directEvents.push(event.changeSet));
    direct.core.transaction("Create nodes", () => { direct.core.nodes.create({ id: "same", type: "text", x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0 }); direct.core.nodes.create({ id: "same-2", type: "text", x: 4, y: 5, width: 50, height: 60, rotation: 0, zIndex: 1 }); }, { origin: "api" });
    const capabilityResult = await viaCapability.tools.call("canvas.write", { type: "create", nodes: [{ id: "same", type: "text" }, { id: "same-2", type: "text", x: 4, y: 5, width: 50, height: 60, zIndex: 1 }] });
    const agentResult = await viaAgent.tools.call("canvas.write", { type: "create", nodes: [{ id: "same", type: "text" }, { id: "same-2", type: "text", x: 4, y: 5, width: 50, height: 60, zIndex: 1 }] });
    expect(viaCapability.core.document.toJSON()).toEqual(direct.core.document.toJSON()); expect(viaAgent.core.document.toJSON()).toEqual(direct.core.document.toJSON());
    expect(direct.core.document.toJSON().revision).toBe(1); expect(directEvents).toHaveLength(1); expect(viaCapability.core.history.canUndo()).toBe(true); expect(viaAgent.core.history.canUndo()).toBe(true);
    expect(capabilityResult.ok && capabilityResult.data).toMatchObject({ revision: 1, changed: true }); expect(agentResult.ok && agentResult.data).toMatchObject({ revision: 1, changed: true });
    if (capabilityResult.ok && agentResult.ok) expect(capabilityResult.data.changeSet).toMatchObject({ revision: 1, addedNodeIds: ["same", "same-2"] });
  });
});
