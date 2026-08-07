import { describe, expect, it } from "vitest";
import { NodeTypeRegistry, type NodeTypeDefinition } from "@pixi-board/core";
import type { PluginDefinition, PluginEvent } from "@pixi-board/plugin-api-v3";
import { createDesktopBoard, MemoryTauriDocumentPort, type DesktopBoardHost } from "../src/index";

const text: NodeTypeDefinition = {
  type: "text",
  version: 1,
  defaults: {},
  validate: (value) => value ?? {},
  getBounds: (node) => ({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height }),
};

async function board(boardId: string, persistence = new MemoryTauriDocumentPort()): Promise<DesktopBoardHost> {
  const nodeTypes = new NodeTypeRegistry();
  nodeTypes.register(text);
  let nextId = 0;
  return createDesktopBoard({
    boardId,
    persistence: persistence.acquire(boardId),
    headless: true,
    core: { nodeTypes, idFactory: () => `${boardId}-id-${++nextId}`, now: () => 1 },
  });
}

const flushRuntime = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("desktop SDK integration fixture", () => {
  it("routes UI, Agent and Plugin v3 through one central ChangeSet dispatch", async () => {
    const host = await board("shared");
    const uiEvents: PluginEvent[] = [];
    const pluginEvents: PluginEvent[] = [];
    host.on("change", (event) => uiEvents.push(event));

    const plugin: PluginDefinition = {
      manifest: {
        apiVersion: "3",
        id: "fixture.plugin",
        name: "Fixture Plugin",
        version: "1.0.0",
        permissions: ["canvas.read", "canvas.write", "events.subscribe"],
      },
      start(context) { context.events.subscribe("change", (event) => pluginEvents.push(event)); },
    };
    const pluginContext = await host.installPlugin(plugin);

    const uiWrite = await host.capabilities.nodes.create({
      nodes: [{ id: "ui-node", type: "text", x: 0, y: 0, width: 10, height: 10 }],
    }, { origin: "ui" });
    const agentWrite = await host.agent.call("canvas.write", {
      type: "create", nodes: [{ id: "agent-node", type: "text" }],
    }, { requestId: "agent-1" });
    const pluginWrite = await pluginContext.canvas.create({
      nodes: [{ id: "plugin-node", type: "text", x: 20, y: 0, width: 10, height: 10 }],
    });
    await flushRuntime();

    expect(uiEvents).toHaveLength(3);
    expect(pluginEvents.map((event) => event.changeSet)).toEqual(uiEvents.map((event) => event.changeSet));
    expect(uiWrite.changeSet).toBe(uiEvents[0].changeSet);
    expect(agentWrite.ok && agentWrite.data).toMatchObject({ revision: 2, requestId: "agent-1" });
    if (agentWrite.ok) expect(agentWrite.data.changeSet).toBe(uiEvents[1].changeSet);
    expect(pluginWrite.changeSet).toBe(uiEvents[2].changeSet);
    await host.destroy();
  });

  it("rejects legacy Plugin API v2 manifests without a compatibility adapter", async () => {
    const host = await board("legacy");
    await expect(host.installPlugin({
      manifest: { apiVersion: "2", id: "old-plugin", name: "Old Plugin", version: "1.0.0", permissions: [] },
      start: () => undefined,
    } as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(host.plugins.getRegistrations()).toEqual({ panels: [], tools: [] });
    await host.destroy();
  });

  it("keeps shared leases isolated and aborts blocked persistence on destroy", async () => {
    const persistence = new MemoryTauriDocumentPort();
    const first = await board("first", persistence);
    const second = await board("second", persistence);
    expect(persistence.activeOwners).toEqual(["first", "second"]);

    await first.capabilities.nodes.create({ nodes: [{ id: "first-node", type: "text", x: 0, y: 0, width: 10, height: 10 }] });
    await second.capabilities.nodes.create({ nodes: [{ id: "second-node", type: "text", x: 0, y: 0, width: 10, height: 10 }] });
    await flushRuntime();
    await first.destroy();
    expect(persistence.activeOwners).toEqual(["second"]);
    expect(persistence.closed).toBe(false);

    await second.capabilities.nodes.create({ nodes: [{ id: "second-node-2", type: "text", x: 20, y: 0, width: 10, height: 10 }] });
    await flushRuntime();
    await second.destroy();
    const restored = await board("second", persistence);
    expect((await restored.board.document.snapshot()).nodes.map((node) => node.id)).toEqual(["second-node", "second-node-2"]);
    await restored.destroy();
    expect(persistence.closed).toBe(true);

    const blocking = new MemoryTauriDocumentPort();
    const lease = blocking.acquire("blocking");
    let saveStarted = false;
    let saveAborted = false;
    const nodeTypes = new NodeTypeRegistry();
    nodeTypes.register(text);
    const blocked = await createDesktopBoard({
      boardId: "blocking",
      persistence: {
        load: (options) => lease.load(options),
        save: (_document, options = {}) => {
          saveStarted = true;
          return new Promise<void>((resolve) => options.signal?.addEventListener("abort", () => { saveAborted = true; resolve(); }, { once: true }));
        },
        destroy: () => lease.destroy?.(),
      },
      headless: true,
      core: { nodeTypes, now: () => 1 },
    });
    await blocked.capabilities.nodes.create({ nodes: [{ id: "pending", type: "text", x: 0, y: 0, width: 10, height: 10 }] });
    await flushRuntime();
    expect(saveStarted).toBe(true);
    await blocked.destroy();
    expect(saveAborted).toBe(true);
  });
});
