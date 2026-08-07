import { describe, expect, it, vi } from "vitest";
import { BoardCore, NodeTypeRegistry, type NodeTypeDefinition } from "@pixi-board/core";
import { createBoardCapabilities } from "@pixi-board/capabilities";
import { createPixiBoardAgentTools, type AgentTools } from "@pixi-board/agent-tools";
import { createPixiBoard } from "pixiboardjs";
import { createHttpMcpHandler, createMcpHost, createStdioMcpServer, type McpRequest } from "./index.ts";

const text: NodeTypeDefinition = { type: "text", version: 1, defaults: {}, validate: (value) => value ?? {}, getBounds: (node) => ({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height }) };

function agent(): { core: BoardCore; tools: AgentTools } {
  const registry = new NodeTypeRegistry();
  registry.register(text);
  const core = new BoardCore({ nodeTypes: registry, idFactory: (() => { let n = 0; return () => `tx-${++n}`; })(), now: () => 100 });
  return { core, tools: createPixiBoardAgentTools(createBoardCapabilities(core)) };
}

function request(): McpRequest {
  return { jsonrpc: "2.0", id: "mcp-1", method: "tools/call", params: { name: "canvas.write", arguments: { type: "create", nodes: [{ id: "same", type: "text", x: 7, y: 8, props: { body: "hello" } }] }, requestId: "req-1", origin: "agent:equivalence" } };
}

async function settle(): Promise<void> { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); }

async function stdioCall(tools: AgentTools, value: McpRequest): Promise<{ result: unknown }> {
  const writes: string[] = [];
  let resolveLine!: (line: string) => void;
  const lines: string[] = [];
  const readable = (async function* () { while (true) { if (!lines.length) { const line = await new Promise<string>((resolve) => { resolveLine = resolve; }); if (line === "__close__") return; lines.push(line); } yield lines.shift()!; } })();
  const server = createStdioMcpServer(createMcpHost(tools), { readable, write: (line) => writes.push(line) });
  await Promise.resolve();
  resolveLine(JSON.stringify(value));
  await settle();
  server.close();
  return JSON.parse(writes[0]);
}

describe("MCP host transport contract", () => {
  it("keeps direct Agent, stdio, and HTTP results/document/history/persistence equivalent", async () => {
    const makeBoard = async () => {
      const save = vi.fn(async () => undefined);
      let n = 0;
      const board = await createPixiBoard({ headless: true, persistence: { save }, core: { nodeTypes: (() => { const registry = new NodeTypeRegistry(); registry.register(text); return registry; })(), idFactory: () => `tx-${++n}`, now: () => 100 } });
      await board.ready;
      return { board, save, tools: createPixiBoardAgentTools(board.capabilities) };
    };
    const direct = await makeBoard();
    const stdio = await makeBoard();
    const http = await makeBoard();
    const directResult = await direct.tools.call("canvas.write", request().params.arguments, { requestId: "req-1", origin: "agent:equivalence" });

    const stdioResponse = await stdioCall(stdio.tools, request());

    const httpResponse = await createHttpMcpHandler(createMcpHost(http.tools))(new Request("http://mcp.test", { method: "POST", body: JSON.stringify(request()), headers: { "content-type": "application/json" } }));
    const httpPayload = await httpResponse.json();
    expect(stdioResponse.result).toEqual(httpPayload.result);
    expect(stdioResponse.result).toEqual(directResult);
    expect(direct.board.document.toJSON()).toEqual(stdio.board.document.toJSON());
    expect(stdio.board.document.toJSON()).toEqual(http.board.document.toJSON());
    expect(direct.board.document.toJSON().revision).toBe(1);
    expect(direct.board.history.canUndo()).toBe(true);
    expect(stdio.board.history.canUndo()).toBe(true);
    expect(http.board.history.canUndo()).toBe(true);
    await settle();
    expect(direct.save).toHaveBeenCalledTimes(1);
    expect(stdio.save).toHaveBeenCalledTimes(1);
    expect(http.save).toHaveBeenCalledTimes(1);
    expect(directResult.ok && directResult.data.changeSet).toMatchObject({ revision: 1, origin: "agent:equivalence", addedNodeIds: ["same"] });

    const undos = [direct.board.history.undo(), stdio.board.history.undo(), http.board.history.undo()];
    expect(undos[1]).toEqual(undos[0]);
    expect(undos[2]).toEqual(undos[0]);
    expect(undos[0]).toMatchObject({ revision: 2, origin: "history", removedNodeIds: ["same"] });
    expect(direct.board.document.toJSON()).toEqual(stdio.board.document.toJSON());
    expect(stdio.board.document.toJSON()).toEqual(http.board.document.toJSON());
    const redos = [direct.board.history.redo(), stdio.board.history.redo(), http.board.history.redo()];
    expect(redos[1]).toEqual(redos[0]);
    expect(redos[2]).toEqual(redos[0]);
    expect(redos[0]).toMatchObject({ revision: 3, origin: "history", addedNodeIds: ["same"] });
    await settle();
    expect(direct.save).toHaveBeenCalledTimes(3);
    expect(stdio.save).toHaveBeenCalledTimes(3);
    expect(http.save).toHaveBeenCalledTimes(3);
    await Promise.all([direct.board.destroy(), stdio.board.destroy(), http.board.destroy()]);
  });

  it("maps validation errors and preserves requestId equivalently across transports", async () => {
    const direct = agent();
    const stdio = agent();
    const http = agent();
    const bad = { ...request(), id: 2, params: { ...request().params, arguments: { type: "write", nodes: [] } } } as McpRequest;
    const directResult = await direct.tools.call("canvas.write", bad.params.arguments, { requestId: "req-1" });
    const stdioResult = await stdioCall(stdio.tools, bad);
    const httpResponse = await createHttpMcpHandler(createMcpHost(http.tools))(new Request("http://mcp.test", { method: "POST", body: JSON.stringify(bad), headers: { "content-type": "application/json" } }));
    const httpResult = await httpResponse.json() as { result: unknown };
    expect(stdioResult.result).toEqual(directResult);
    expect(httpResult.result).toEqual(directResult);
    expect(directResult).toMatchObject({ ok: false, error: { code: "INVALID_INPUT", requestId: "req-1" } });
    expect(direct.core.document.toJSON().revision).toBe(0);
    expect(stdio.core.document.toJSON().revision).toBe(0);
    expect(http.core.document.toJSON().revision).toBe(0);
  });

  it("aborts and closes without a late write", async () => {
    const fixture = agent();
    const host = createMcpHost(fixture.tools);
    const controller = new AbortController();
    controller.abort();
    const direct = await fixture.tools.call("canvas.write", request().params.arguments, { requestId: "req-1", origin: "agent:equivalence", signal: controller.signal });
    const aborted = await host.handle(request(), { signal: controller.signal });
    expect(aborted.result).toEqual(direct);
    expect(aborted.result).toMatchObject({ ok: false, error: { code: "ABORTED", requestId: "req-1" } });
    host.close();
    const closed = await host.handle(request());
    expect(closed.result).toMatchObject({ ok: false, error: { code: "ABORTED" } });
    expect(fixture.core.document.toJSON().revision).toBe(0);
  });

  it("stdio endpoint can be stopped while requests are pending", async () => {
    const fixture = agent();
    const writes: string[] = [];
    let resolveLine!: (line: string) => void;
    const readable = (async function* () { await new Promise<string>((resolve) => { resolveLine = resolve; }); })();
    const server = createStdioMcpServer(createMcpHost(fixture.tools), { readable, write: (line) => writes.push(line) });
    await Promise.resolve();
    server.close();
    resolveLine?.("__close__");
    await settle();
    expect(writes).toHaveLength(0);
    expect(fixture.core.document.toJSON().revision).toBe(0);
  });

  it("closing an in-flight host aborts the delegated Agent before it can write", async () => {
    const fixture = agent();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const delayed: AgentTools = {
      schemas: fixture.tools.schemas,
      async call(name, input, options) {
        started();
        await gate;
        return fixture.tools.call(name, input, options);
      },
    };
    const host = createMcpHost(delayed);
    const pending = host.handle(request());
    await entered;
    host.close();
    release();
    const response = await pending;
    expect(response.result).toMatchObject({ ok: false, error: { code: "ABORTED", requestId: "req-1" } });
    expect(fixture.core.document.toJSON().revision).toBe(0);
    expect(fixture.core.history.canUndo()).toBe(false);
  });

  it("destroying the board rejects an in-flight MCP request without persistence", async () => {
    const save = vi.fn(async () => undefined);
    const registry = new NodeTypeRegistry();
    registry.register(text);
    const board = await createPixiBoard({ headless: true, persistence: { save }, core: { nodeTypes: registry } });
    await board.ready;
    const tools = createPixiBoardAgentTools(board.capabilities);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const delayed: AgentTools = {
      schemas: tools.schemas,
      async call(name, input, options) {
        started();
        await gate;
        return tools.call(name, input, options);
      },
    };
    const pending = createMcpHost(delayed).handle(request());
    await entered;
    await board.destroy();
    release();
    const response = await pending;
    expect(response.result).toMatchObject({ ok: false, error: { code: "BOARD_DESTROYED", requestId: "req-1" } });
    await settle();
    expect(save).not.toHaveBeenCalled();
  });
});
