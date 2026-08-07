import { describe, expect, it, vi } from "vitest";
import { BoardCore, NodeTypeRegistry, type BoardChangeSet, type NodeTypeDefinition } from "@pixi-board/core";
import { createBoardCapabilities } from "@pixi-board/capabilities";
import { createPixiBoardAgentTools, type AgentTools } from "@pixi-board/agent-tools";
import { createHttpMcpHandler, createMcpHost, createStdioMcpServer, type McpEnvelope, type McpRequest, type StdioEndpoint } from "./index.ts";

const text: NodeTypeDefinition = { type: "text", version: 1, defaults: {}, validate: (value) => value ?? {}, getBounds: (node) => ({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height }) };

type Fixture = { core: BoardCore; tools: AgentTools; save: ReturnType<typeof vi.fn>; changes: BoardChangeSet[]; publicChanges: BoardChangeSet[]; history: Array<{ canUndo: boolean; canRedo: boolean }> };

async function makeFixture(): Promise<Fixture> {
  const registry = new NodeTypeRegistry(); registry.register(text);
  let transaction = 0;
  const save = vi.fn(async () => undefined);
  const core = new BoardCore({ nodeTypes: registry, idFactory: () => `tx-${++transaction}`, now: () => 100 });
  const changes: BoardChangeSet[] = [];
  const publicChanges: BoardChangeSet[] = [];
  const history: Array<{ canUndo: boolean; canRedo: boolean }> = [];
  core.on("change", (event) => { changes.push(event.changeSet); void save(core.document.toJSON()); });
  core.on("change", (event) => publicChanges.push(event.changeSet));
  core.on("history:change", (event) => history.push(event));
  return { core, tools: createPixiBoardAgentTools(createBoardCapabilities(core)), save, changes, publicChanges, history };
}

function writeRequest(id = "mcp-1", requestId = "req-1"): McpRequest {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "canvas.write", arguments: { type: "create", nodes: [{ id: "same", type: "text", x: 7, y: 8, props: { body: "hello" } }] }, requestId, origin: "agent:equivalence" } };
}

function readRequest(id: string, requestId: string): McpRequest {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "canvas.read", arguments: { type: "nodes", fields: ["position", "props"] }, requestId, origin: "agent:equivalence" } };
}

async function settle(): Promise<void> { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); }

class Lines implements StdioEndpoint {
  readonly readable: AsyncIterable<string> = this;
  readonly writes: string[] = [];
  #queue: string[] = [];
  #waiter?: (result: IteratorResult<string>) => void;
  #closed = false;
  push(line: string): void { if (this.#waiter) { const waiter = this.#waiter; this.#waiter = undefined; waiter({ done: false, value: line }); } else this.#queue.push(line); }
  closeInput(): void { this.#closed = true; this.#waiter?.({ done: true, value: undefined }); this.#waiter = undefined; }
  write(chunk: string): void { this.writes.push(chunk); }
  async *[Symbol.asyncIterator](): AsyncIterator<string> { while (true) { if (this.#queue.length) { yield this.#queue.shift()!; continue; } if (this.#closed) return; const next = await new Promise<IteratorResult<string>>((resolve) => { this.#waiter = resolve; }); if (next.done) return; yield next.value; } }
}

async function stdioRoundTrip(tools: AgentTools, request: McpRequest): Promise<McpEnvelope> {
  const endpoint = new Lines();
  const server = createStdioMcpServer(createMcpHost(tools), endpoint);
  await server.ready;
  endpoint.push(JSON.stringify(request));
  while (!endpoint.writes.length) await settle();
  server.close(); endpoint.closeInput(); await server.completed;
  return JSON.parse(endpoint.writes[0]) as McpEnvelope;
}

function changeShape(changes: BoardChangeSet[]): unknown[] {
  return changes.map(({ transactionId, revision, origin, addedNodeIds, updatedNodeIds, removedNodeIds, assetChangedNodeIds, selectionChanged, viewportChanged, timestamp }) => ({ transactionId, revision, origin, addedNodeIds, updatedNodeIds, removedNodeIds, assetChangedNodeIds, selectionChanged, viewportChanged, timestamp }));
}

describe("MCP host transport contract", () => {
  it("compares direct Agent, stdio, and HTTP write ChangeSets/events/history/persistence exactly", async () => {
    const direct = await makeFixture(); const stdio = await makeFixture(); const http = await makeFixture();
    const request = writeRequest();
    const directResult = await direct.tools.call("canvas.write", request.params.arguments, { requestId: "req-1", origin: "agent:equivalence" });
    const stdioResult = await stdioRoundTrip(stdio.tools, request);
    const httpResponse = await createHttpMcpHandler(createMcpHost(http.tools))(new Request("http://mcp.test", { method: "POST", body: JSON.stringify(request), headers: { "content-type": "application/json" } }));
    const httpResult = await httpResponse.json() as McpEnvelope;
    await settle();
    expect(stdioResult).toEqual({ jsonrpc: "2.0", id: "mcp-1", result: directResult });
    expect(httpResult).toEqual({ jsonrpc: "2.0", id: "mcp-1", result: directResult });
    expect(direct.core.document.toJSON()).toEqual(stdio.core.document.toJSON());
    expect(stdio.core.document.toJSON()).toEqual(http.core.document.toJSON());
    expect(changeShape(direct.changes)).toEqual(changeShape(stdio.changes));
    expect(changeShape(stdio.changes)).toEqual(changeShape(http.changes));
    expect(changeShape(direct.publicChanges)).toEqual(changeShape(stdio.publicChanges));
    expect(changeShape(stdio.publicChanges)).toEqual(changeShape(http.publicChanges));
    expect(direct.history).toEqual(stdio.history); expect(stdio.history).toEqual(http.history);
    expect(direct.save).toHaveBeenCalledTimes(1); expect(stdio.save).toHaveBeenCalledTimes(1); expect(http.save).toHaveBeenCalledTimes(1);

    const undo = [direct.core.history.undo(), stdio.core.history.undo(), http.core.history.undo()];
    const redo = [direct.core.history.redo(), stdio.core.history.redo(), http.core.history.redo()];
    await settle();
    expect(undo[0]).toEqual(undo[1]); expect(undo[1]).toEqual(undo[2]);
    expect(redo[0]).toEqual(redo[1]); expect(redo[1]).toEqual(redo[2]);
    expect(changeShape(direct.changes)).toEqual(changeShape(stdio.changes)); expect(changeShape(stdio.changes)).toEqual(changeShape(http.changes));
    expect(direct.core.document.toJSON()).toEqual(stdio.core.document.toJSON()); expect(stdio.core.document.toJSON()).toEqual(http.core.document.toJSON());
    expect(direct.history).toEqual(stdio.history); expect(stdio.history).toEqual(http.history);
    expect(direct.save).toHaveBeenCalledTimes(3); expect(stdio.save).toHaveBeenCalledTimes(3); expect(http.save).toHaveBeenCalledTimes(3);
  });

  it("keeps successful canvas.read and read-domain errors equivalent", async () => {
    const direct = await makeFixture(); const stdio = await makeFixture(); const http = await makeFixture();
    const write = writeRequest();
    await direct.tools.call("canvas.write", write.params.arguments, { requestId: "seed", origin: "agent:equivalence" });
    await stdio.tools.call("canvas.write", write.params.arguments, { requestId: "seed", origin: "agent:equivalence" });
    await http.tools.call("canvas.write", write.params.arguments, { requestId: "seed", origin: "agent:equivalence" });
    const request = readRequest("read-1", "read-req");
    const directRead = await direct.tools.call("canvas.read", request.params.arguments, { requestId: "read-req", origin: "agent:equivalence" });
    const stdioRead = await stdioRoundTrip(stdio.tools, request); const httpRead = await (await createHttpMcpHandler(createMcpHost(http.tools))(new Request("http://mcp.test", { method: "POST", body: JSON.stringify(request), headers: { "content-type": "application/json" } }))).json() as McpEnvelope;
    expect(stdioRead).toEqual({ jsonrpc: "2.0", id: "read-1", result: directRead }); expect(httpRead).toEqual(stdioRead);
    const bad = { ...request, id: "bad-read", params: { ...request.params, arguments: { type: "preview", id: "missing" } } } satisfies McpRequest;
    const directError = await direct.tools.call("canvas.read", bad.params.arguments, { requestId: "read-req" }); const stdioError = await stdioRoundTrip(stdio.tools, bad); const httpError = await (await createHttpMcpHandler(createMcpHost(http.tools))(new Request("http://mcp.test", { method: "POST", body: JSON.stringify(bad), headers: { "content-type": "application/json" } }))).json() as McpEnvelope;
    expect(stdioError).toEqual({ jsonrpc: "2.0", id: "bad-read", result: directError }); expect(httpError).toEqual(stdioError);
  });

  it("returns JSON-RPC protocol errors for malformed method/params and invalid JSON", async () => {
    const fixture = await makeFixture(); const host = createMcpHost(fixture.tools);
    expect(await host.handle({ jsonrpc: "2.0", id: 1, method: "nope", params: {} })).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } });
    expect(await host.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {} })).toEqual({ jsonrpc: "2.0", id: 2, error: { code: -32602, message: "Invalid params" } });
    const endpoint = new Lines(); const server = createStdioMcpServer(host, endpoint); await server.ready; endpoint.push("not-json"); while (!endpoint.writes.length) await settle(); expect(JSON.parse(endpoint.writes[0])).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); server.close(); endpoint.closeInput(); await server.completed;
  });

  it("keeps multiple stdio frames ordered and completes deterministically", async () => {
    const fixture = await makeFixture();
    const endpoint = new Lines();
    const server = createStdioMcpServer(createMcpHost(fixture.tools), endpoint);
    await server.ready;
    endpoint.push(JSON.stringify(readRequest("read-1", "read-1")));
    endpoint.push(JSON.stringify(readRequest("read-2", "read-2")));
    while (endpoint.writes.length < 2) await settle();
    expect(endpoint.writes.map((line) => JSON.parse(line).id)).toEqual(["read-1", "read-2"]);
    server.close(); endpoint.closeInput(); await server.completed;
    expect(endpoint.writes).toHaveLength(2);
  });

  it("aborts a pending request without late result, change, or persistence", async () => {
    const fixture = await makeFixture(); let release!: () => void; let started!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); const entered = new Promise<void>((resolve) => { started = resolve; });
    const delayed: AgentTools = { schemas: fixture.tools.schemas, async call(name, input, options) { started(); await gate; return fixture.tools.call(name, input, options); } };
    const host = createMcpHost(delayed); const controller = new AbortController(); const pending = host.handle(writeRequest(), { signal: controller.signal }); await entered; controller.abort(); release();
    const result = await pending; expect(result).toMatchObject({ jsonrpc: "2.0", id: "mcp-1", result: { ok: false, error: { code: "ABORTED" } } }); await settle();
    expect(fixture.core.document.toJSON().revision).toBe(0); expect(fixture.changes).toHaveLength(0); expect(fixture.publicChanges).toHaveLength(0); expect(fixture.save).not.toHaveBeenCalled();
  });

  it("suppresses a pending stdio response after close", async () => {
    const fixture = await makeFixture(); let release!: () => void; let started!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); const entered = new Promise<void>((resolve) => { started = resolve; });
    const delayed: AgentTools = { schemas: fixture.tools.schemas, async call(name, input, options) { started(); await gate; return fixture.tools.call(name, input, options); } };
    const endpoint = new Lines(); const server = createStdioMcpServer(createMcpHost(delayed), endpoint); await server.ready; endpoint.push(JSON.stringify(writeRequest())); await entered; server.close(); release(); endpoint.closeInput(); await server.completed;
    expect(endpoint.writes).toHaveLength(0); expect(fixture.core.document.toJSON().revision).toBe(0); expect(fixture.save).not.toHaveBeenCalled();
  });
});
