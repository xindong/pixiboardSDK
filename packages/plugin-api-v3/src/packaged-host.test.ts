import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPixiBoardAgentTools } from "@pixi-board/agent-tools";
import { createBoardCapabilities, type BoardCapabilities, type BoardChangeSet, type WriteResult } from "@pixi-board/capabilities";
import { BoardCore, NodeTypeRegistry, type NodeTypeDefinition } from "@pixi-board/core";
import type { PluginEvent, PluginEventSource, PluginPermission, PluginProcessHost, PluginProcessRequest } from "./index.ts";
import { PackagedPluginHost } from "./package-loader.ts";

const text: NodeTypeDefinition = {
  type: "text",
  version: 1,
  defaults: {},
  validate: (value) => value ?? {},
  getBounds: (node) => ({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height }),
};

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../test/fixtures");
const fixturePath = (name: string) => resolve(fixtureRoot, name);
const taskCardPermissions: readonly PluginPermission[] = [
  "canvas.read",
  "canvas.write",
  "events.subscribe",
  "panel.register",
  "tool.register",
  "process.spawn",
];

function runtime() {
  const registry = new NodeTypeRegistry();
  registry.register(text);
  let nextId = 0;
  const core = new BoardCore({ nodeTypes: registry, idFactory: () => `id-${++nextId}`, now: () => 1 });
  const capabilities = createBoardCapabilities(core);
  let activeSubscriptions = 0;
  const events: PluginEventSource = {
    on(event, listener) {
      activeSubscriptions += 1;
      const offCore = core.on(event as never, (value) => listener({ type: event, ...(value as object) } as PluginEvent));
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        activeSubscriptions -= 1;
        offCore();
      };
    },
  };
  return { core, capabilities, events, activeSubscriptions: () => activeSubscriptions };
}

function processFixture(throwOnStop = false) {
  const starts: Array<{ pluginId: string; processId: string; request: Readonly<PluginProcessRequest> }> = [];
  const stops: string[] = [];
  const processes: PluginProcessHost = {
    start(pluginId, processId, request) {
      starts.push({ pluginId, processId, request });
      return {
        stop() {
          stops.push(`${pluginId}:${processId}`);
          if (throwOnStop) throw new Error("fixture process stop failed");
        },
      };
    },
  };
  return { processes, starts, stops };
}

describe("packaged Plugin API v3 host", () => {
  it("loads a deterministic v3 directory and cleans panel, tool, process and event lifecycles", async () => {
    const board = runtime();
    const process = processFixture();
    const host = new PackagedPluginHost({ capabilities: board.capabilities, events: board.events, processes: process.processes, grantedPermissions: taskCardPermissions });

    const context = await host.loadDirectory(fixturePath("v3-task-card"));
    expect(host.getRegistrations()).toEqual({
      panels: ["fixture.packaged-task-card:task-card.panel"],
      tools: ["fixture.packaged-task-card:task-card.create"],
      processes: ["fixture.packaged-task-card:task-card.worker"],
    });
    expect(board.activeSubscriptions()).toBe(1);
    expect(process.starts).toEqual([{
      pluginId: "fixture.packaged-task-card",
      processId: "task-card.worker",
      request: { command: "fixture-task-card-worker", args: ["--deterministic"] },
    }]);

    const result = await host.invokeTool("fixture.packaged-task-card", "task-card.create", {
      nodes: [{ id: "plugin-node", type: "text" }],
    }) as WriteResult & { observedChanges: number };
    expect(result).toMatchObject({ changed: true, revision: 1, observedChanges: 1 });
    expect(result.changeSet).toMatchObject({ origin: "plugin:fixture.packaged-task-card", addedNodeIds: ["plugin-node"] });

    await host.unload("fixture.packaged-task-card");
    expect(host.getRegistrations()).toEqual({ panels: [], tools: [], processes: [] });
    expect(board.activeSubscriptions()).toBe(0);
    expect(process.stops).toEqual(["fixture.packaged-task-card:task-card.worker"]);
    expect(() => context.canvas.create({ nodes: [{ id: "late-node", type: "text" }] })).toThrow(/no longer active/);
    expect(board.core.document.toJSON().nodes.map((node) => node.id)).toEqual(["plugin-node"]);

    await host.loadDirectory(fixturePath("v3-task-card"));
    await host.destroy();
    expect(host.getRegistrations()).toEqual({ panels: [], tools: [], processes: [] });
    expect(board.activeSubscriptions()).toBe(0);
    expect(process.stops).toEqual([
      "fixture.packaged-task-card:task-card.worker",
      "fixture.packaged-task-card:task-card.worker",
    ]);
  });

  it("cleans every contribution after start failure even when process cleanup throws", async () => {
    const board = runtime();
    const process = processFixture(true);
    const host = new PackagedPluginHost({
      capabilities: board.capabilities,
      events: board.events,
      processes: process.processes,
      grantedPermissions: ["panel.register", "tool.register", "process.spawn"],
    });

    await expect(host.loadDirectory(fixturePath("v3-start-failure"))).rejects.toThrow("fixture start failed");
    expect(host.getRegistrations()).toEqual({ panels: [], tools: [], processes: [] });
    expect(process.stops).toEqual(["fixture.start-failure:failure.worker"]);
  });

  it("waits for a pending process start and stops it when unload wins the race", async () => {
    const board = runtime();
    let announceStart!: () => void;
    const started = new Promise<void>((resolveStarted) => { announceStart = resolveStarted; });
    let resolveHandle!: (handle: { stop(): void }) => void;
    const pendingHandle = new Promise<{ stop(): void }>((resolveProcess) => { resolveHandle = resolveProcess; });
    const stops: string[] = [];
    const processes: PluginProcessHost = {
      start() {
        announceStart();
        return pendingHandle;
      },
    };
    const host = new PackagedPluginHost({ capabilities: board.capabilities, events: board.events, processes, grantedPermissions: taskCardPermissions });

    const loading = host.loadDirectory(fixturePath("v3-task-card"));
    await started;
    const unloading = host.unload("fixture.packaged-task-card");
    resolveHandle({ stop: () => { stops.push("stopped"); } });

    await unloading;
    await expect(loading).rejects.toMatchObject({ code: "BOARD_DESTROYED" });
    expect(stops).toEqual(["stopped"]);
    expect(host.getRegistrations()).toEqual({ panels: [], tools: [], processes: [] });
    expect(board.activeSubscriptions()).toBe(0);
  });

  it("rejects v2, denied v3 permissions and legacy zip before importing entry code", async () => {
    const board = runtime();
    const host = new PackagedPluginHost({ capabilities: board.capabilities, events: board.events, grantedPermissions: [] });
    await expect(host.loadDirectory(fixturePath("v2-legacy"))).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const denied = new PackagedPluginHost({
      capabilities: board.capabilities,
      events: board.events,
      grantedPermissions: ["canvas.read"],
    });
    await expect(denied.loadDirectory(fixturePath("v3-denied"))).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(host.loadDirectory(fixturePath("legacy-plugin.zip"))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(board.core.document.toJSON().revision).toBe(0);
  });

  it("rejects traversal and entry symlink escapes before module import", async () => {
    const board = runtime();
    const host = new PackagedPluginHost({ capabilities: board.capabilities, events: board.events, grantedPermissions: [] });
    await expect(host.loadDirectory(fixturePath("v3-entry-traversal"))).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const packagePath = await mkdtemp(resolve(tmpdir(), "pixiboard-v3-package-"));
    const outsideEntry = `${packagePath}-outside.mjs`;
    try {
      await writeFile(outsideEntry, "export default { start() {} };\n", "utf8");
      await symlink(outsideEntry, resolve(packagePath, "entry.mjs"));
      await writeFile(resolve(packagePath, "pixiboard.plugin.json"), JSON.stringify({
        packageFormat: "pixiboard-plugin-directory-v1",
        entry: "./entry.mjs",
        id: "fixture.symlink-escape",
        name: "Symlink Escape",
        version: "1.0.0",
        apiVersion: "3",
        permissions: [],
      }), "utf8");
      await expect(host.loadDirectory(packagePath)).rejects.toMatchObject({
        code: "INVALID_INPUT",
        message: "Plugin package entry symlink escapes the package directory",
      });
    } finally {
      await rm(packagePath, { recursive: true, force: true });
      await rm(outsideEntry, { force: true });
    }
  });

  it("validates untyped packaged event and tool registrations at runtime", async () => {
    const board = runtime();
    const host = new PackagedPluginHost({ capabilities: board.capabilities, events: board.events, grantedPermissions: ["events.subscribe", "tool.register"] });

    await expect(host.loadDirectory(fixturePath("v3-invalid-runtime"))).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "Unsupported plugin event: host-internal-event",
    });
    expect(host.getRegistrations()).toEqual({ panels: [], tools: [], processes: [] });
    expect(board.activeSubscriptions()).toBe(0);
  });

  it("keeps UI, Agent and packaged Plugin writes on equivalent BoardCapabilities transactions", async () => {
    const ui = runtime();
    const agent = runtime();
    const plugin = runtime();
    const uiChanges: BoardChangeSet[] = [];
    const agentChanges: BoardChangeSet[] = [];
    const pluginChanges: BoardChangeSet[] = [];
    ui.core.on("change", (event) => uiChanges.push(event.changeSet));
    agent.core.on("change", (event) => agentChanges.push(event.changeSet));
    plugin.core.on("change", (event) => pluginChanges.push(event.changeSet));

    const input = {
      nodes: [
        { id: "same", type: "text" },
        { id: "same-2", type: "text", x: 4, y: 5, width: 50, height: 60, zIndex: 1 },
      ],
    } as const;
    const uiResult = await ui.capabilities.nodes.create(input, { origin: "ui", label: "Create nodes" });
    const agentTools = createPixiBoardAgentTools(agent.capabilities);
    const agentResult = await agentTools.call("canvas.write", { type: "create", nodes: input.nodes });
    const process = processFixture();
    const pluginHost = new PackagedPluginHost({ capabilities: plugin.capabilities, events: plugin.events, processes: process.processes, grantedPermissions: taskCardPermissions });
    await pluginHost.loadDirectory(fixturePath("v3-task-card"));
    const pluginResult = await pluginHost.invokeTool("fixture.packaged-task-card", "task-card.create", input) as WriteResult;

    expect(await agent.capabilities.document.snapshot()).toEqual(await ui.capabilities.document.snapshot());
    expect(await plugin.capabilities.document.snapshot()).toEqual(await ui.capabilities.document.snapshot());
    expect(uiChanges).toHaveLength(1);
    expect(agentChanges).toHaveLength(1);
    expect(pluginChanges).toHaveLength(1);
    expect(normalizeChangeSet(agentChanges[0])).toEqual(normalizeChangeSet(uiChanges[0]));
    expect(normalizeChangeSet(pluginChanges[0])).toEqual(normalizeChangeSet(uiChanges[0]));
    expect(uiResult.changeSet).toBe(uiChanges[0]);
    expect(agentResult.ok && agentResult.data.changeSet).toBe(agentChanges[0]);
    expect(pluginResult.changeSet).toBe(pluginChanges[0]);
    expect(uiChanges[0].origin).toBe("ui");
    expect(agentChanges[0].origin).toBe("agent:canvas");
    expect(pluginChanges[0].origin).toBe("plugin:fixture.packaged-task-card");
    expect(ui.capabilities.history.canUndo()).toBe(true);
    expect(agent.capabilities.history.canUndo()).toBe(true);
    expect(plugin.capabilities.history.canUndo()).toBe(true);

    const uiUndo = ui.capabilities.history.undo();
    const agentUndo = agent.capabilities.history.undo();
    const pluginUndo = plugin.capabilities.history.undo();
    expect(agentUndo).toEqual(uiUndo);
    expect(pluginUndo).toEqual(uiUndo);
    expect(await agent.capabilities.document.snapshot()).toEqual(await ui.capabilities.document.snapshot());
    expect(await plugin.capabilities.document.snapshot()).toEqual(await ui.capabilities.document.snapshot());

    const uiRedo = ui.capabilities.history.redo();
    const agentRedo = agent.capabilities.history.redo();
    const pluginRedo = plugin.capabilities.history.redo();
    expect(agentRedo).toEqual(uiRedo);
    expect(pluginRedo).toEqual(uiRedo);
    expect(await agent.capabilities.document.snapshot()).toEqual(await ui.capabilities.document.snapshot());
    expect(await plugin.capabilities.document.snapshot()).toEqual(await ui.capabilities.document.snapshot());
    await pluginHost.destroy();
  });
});

function normalizeChangeSet(changeSet: BoardChangeSet): Omit<BoardChangeSet, "origin"> {
  const { origin: _origin, ...rest } = changeSet;
  return rest;
}
