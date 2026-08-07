import { describe, expect, expectTypeOf, it } from "vitest";
import { BoardCore, NodeTypeRegistry, type NodeTypeDefinition } from "@pixi-board/core";
import { createBoardCapabilities } from "@pixi-board/capabilities";
import { PluginHost, assertV3Manifest, definePlugin, serializeChangeSet, serializePluginError, type PluginEvent, type PluginEventSource } from "./index.ts";
import { taskCardPlugin } from "./fixture.ts";

const text: NodeTypeDefinition = { type: "text", version: 1, defaults: {}, validate: (value) => value ?? {}, getBounds: (node) => ({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height }) };
function fixture() {
  const registry = new NodeTypeRegistry(); registry.register(text);
  const core = new BoardCore({ nodeTypes: registry, idFactory: (() => { let n = 0; return () => `id-${++n}`; })(), now: () => 1 });
  const events: PluginEventSource = { on: (event, listener) => core.on(event as never, (value) => listener({ type: event, ...(value as object) } as PluginEvent)) };
  return { core, host: new PluginHost({ capabilities: createBoardCapabilities(core), events }) };
}

describe("Plugin API v3 contract", () => {
  it("defines a typed v3 developer contract without exposing host internals", () => {
    const plugin = definePlugin({
      manifest: {
        id: "example.typed",
        name: "Typed example",
        version: "1.0.0",
        apiVersion: "3",
        permissions: ["canvas.read"],
      } as const,
      start(context) {
        expectTypeOf(context.manifest.id).toEqualTypeOf<"example.typed">();
        expect("capabilities" in context).toBe(false);
        expect("renderer" in context).toBe(false);
      },
    });
    expectTypeOf(plugin.manifest.id).toEqualTypeOf<"example.typed">();
    expect(plugin.manifest).toMatchObject({ id: "example.typed", apiVersion: "3" });
    expect(Object.isFrozen(plugin.manifest)).toBe(true);
    expect(() => definePlugin({ ...plugin, manifest: { ...plugin.manifest, apiVersion: "2" as never } })).toThrow(/Only Plugin API v3/);
  });

  it("loads a new task-card plugin and cleans event subscriptions on destroy", async () => {
    const { core, host } = fixture(); const seen: PluginEvent[] = [];
    const definition = { ...taskCardPlugin, start: async (context: Parameters<NonNullable<typeof taskCardPlugin.start>>[0]) => { context.panels.register("task-card.panel"); context.tools.register("task-card.create"); context.events.subscribe("change", (event) => seen.push(event)); } };
    await host.load(definition); await createBoardCapabilities(core).nodes.create({ nodes: [{ id: "task-1", type: "text" }] }, { origin: "api" });
    expect(seen).toHaveLength(1); expect(host.getRegistrations().panels).toContain("example.task-card:task-card.panel"); await host.destroy(); expect(host.getRegistrations()).toEqual({ panels: [], tools: [], processes: [] }); await createBoardCapabilities(core).nodes.create({ nodes: [{ id: "task-2", type: "text" }] }, { origin: "api" }); expect(seen).toHaveLength(1);
  });

  it("negotiates permissions before writes and preserves atomicity", async () => {
    const { core } = fixture();
    const denied = { ...taskCardPlugin, manifest: { ...taskCardPlugin.manifest, permissions: ["canvas.read"] as const }, start: async (context: Parameters<NonNullable<typeof taskCardPlugin.start>>[0]) => { await context.canvas.create({ nodes: [{ id: "a", type: "text" }, { id: "b", type: "missing" }] }); } };
    const hostDenied = new PluginHost({ capabilities: createBoardCapabilities(core), events: { on: () => () => {} }, grantedPermissions: ["canvas.read"] });
    await expect(hostDenied.load(denied)).rejects.toMatchObject({ code: "PERMISSION_DENIED" }); expect(core.document.toJSON().nodes).toHaveLength(0);
    const { host } = fixture();
    await expect(host.load({ ...denied, manifest: { ...denied.manifest, apiVersion: "2" as never } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const { host: writableHost, core: writableCore } = fixture();
    const malformed = { ...taskCardPlugin, start: async (context: Parameters<NonNullable<typeof taskCardPlugin.start>>[0]) => { await context.canvas.create({ nodes: [{ id: "same", type: "text" }, { id: "same", type: "text" }] }); } };
    await expect(writableHost.load(malformed)).rejects.toMatchObject({ code: "DOCUMENT_VALIDATION" }); expect(writableCore.document.toJSON().nodes).toHaveLength(0);
  });

  it("serializes errors and ChangeSets without leaking mutable arrays", () => {
    const error = serializePluginError(new Error("boom")); expect(error).toMatchObject({ code: "INTERNAL_ERROR", message: "boom" });
    const changeSet = { transactionId: "t", revision: 1, origin: "plugin:x", addedNodeIds: ["a"], updatedNodeIds: [], removedNodeIds: [], assetChangedNodeIds: [], selectionChanged: false, viewportChanged: false, timestamp: 1 } as const;
    const serialized = serializeChangeSet(changeSet); serialized.addedNodeIds.push("b"); expect(changeSet.addedNodeIds).toEqual(["a"]);
  });

  it("rejects ambiguous plugin and contribution namespace separators", () => {
    expect(() => assertV3Manifest({ ...taskCardPlugin.manifest, id: "example:task-card" })).toThrow(/id cannot contain/);
    expect(() => assertV3Manifest({
      ...taskCardPlugin.manifest,
      contributions: { ...taskCardPlugin.manifest.contributions, tools: ["task-card:create"] },
    })).toThrow(/ids cannot contain/);
  });
});
