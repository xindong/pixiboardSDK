import { writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { createPixiBoardAgentTools, type AgentTools } from "@pixi-board/agent-tools";
import { createBoardCapabilities } from "@pixi-board/capabilities";
import { BoardCore, NodeTypeRegistry, type BoardChangeSet, type NodeTypeDefinition } from "@pixi-board/core";
import { createHttpMcpHandler, createMcpHost, createStdioMcpServer, type StdioEndpoint } from "./index.ts";

const text: NodeTypeDefinition = {
  type: "text",
  version: 1,
  defaults: {},
  validate: (value) => value ?? {},
  getBounds: (node) => ({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height }),
};

function changeShape(changeSet: BoardChangeSet): unknown {
  const { transactionId, revision, origin, addedNodeIds, updatedNodeIds, removedNodeIds, assetChangedNodeIds, selectionChanged, viewportChanged, timestamp } = changeSet;
  return { transactionId, revision, origin, addedNodeIds, updatedNodeIds, removedNodeIds, assetChangedNodeIds, selectionChanged, viewportChanged, timestamp };
}

export function createDeploymentRuntime() {
  const registry = new NodeTypeRegistry();
  registry.register(text);
  let transaction = 0;
  const core = new BoardCore({ nodeTypes: registry, idFactory: () => `tx-${++transaction}`, now: () => 100 });
  const changes: unknown[] = [];
  const saves: unknown[] = [];
  const history: Array<{ canUndo: boolean; canRedo: boolean }> = [];
  core.on("change", (event) => {
    changes.push(changeShape(event.changeSet));
    saves.push(core.document.toJSON());
  });
  core.on("history:change", (event) => history.push(event));
  const base = createPixiBoardAgentTools(createBoardCapabilities(core));
  const tools: AgentTools = {
    schemas: base.schemas,
    async call(name, input, options = {}) {
      if (options.requestId === "abort-after-start") {
        process.stderr.write("REQUEST_STARTED\n");
        if (options.signal?.aborted) {
          process.stderr.write("REQUEST_ABORTED\n");
        } else {
          await new Promise<void>((resolve) => options.signal?.addEventListener("abort", () => {
            process.stderr.write("REQUEST_ABORTED\n");
            resolve();
          }, { once: true }));
        }
        const result = await base.call(name, input, options);
        process.stderr.write("REQUEST_FINISHED\n");
        return result;
      }
      return base.call(name, input, options);
    },
  };
  return {
    core,
    tools,
    snapshot: () => ({
      document: core.document.toJSON(),
      revision: core.document.toJSON().revision,
      historyState: { canUndo: core.history.canUndo(), canRedo: core.history.canRedo() },
      history,
      changes,
      saves,
    }),
  };
}

async function* lines(input: NodeJS.ReadableStream): AsyncGenerator<string> {
  let buffered = "";
  for await (const chunk of input) {
    buffered += String(chunk);
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      yield buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
    }
  }
  if (buffered) yield buffered;
}

function writeState(path: string | undefined, snapshot: () => unknown): void {
  if (path) writeFileSync(path, `${JSON.stringify(snapshot())}\n`, "utf8");
}

async function requestBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

async function serveHttpRequest(handler: (request: Request) => Promise<Response>, incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
  const abort = new AbortController();
  incoming.on("aborted", () => abort.abort());
  outgoing.on("close", () => { if (!outgoing.writableEnded) abort.abort(); });
  const body = await requestBody(incoming);
  const request = new Request(`http://127.0.0.1${incoming.url ?? "/"}`, {
    method: incoming.method,
    headers: incoming.headers as HeadersInit,
    ...(incoming.method === "GET" || incoming.method === "HEAD" ? {} : { body }),
    signal: abort.signal,
  });
  const response = await handler(request);
  if (outgoing.destroyed) return;
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => outgoing.setHeader(name, value));
  outgoing.end(await response.text());
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const runtime = createDeploymentRuntime();
  const host = createMcpHost(runtime.tools);
  if (mode === "stdio") {
    const endpoint: StdioEndpoint = {
      readable: lines(process.stdin),
      write: (chunk) => { process.stdout.write(chunk); },
      closeInput: () => { process.stdin.destroy(); },
    };
    const server = createStdioMcpServer(host, endpoint);
    process.stderr.write("READY\n");
    await server.completed;
    writeState(process.env.PIXIBOARD_MCP_STATE_PATH, runtime.snapshot);
    return;
  }
  if (mode === "http") {
    const handler = createHttpMcpHandler(host);
    const server = createServer((request, response) => { void serveHttpRequest(handler, request, response).catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); if (!response.destroyed) { response.statusCode = 500; response.end(); } }); });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP MCP child did not bind a TCP port");
    process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
    await new Promise<void>((resolve) => {
      const shutdown = () => { host.close(); server.close(() => resolve()); server.closeAllConnections(); };
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    });
    writeState(process.env.PIXIBOARD_MCP_STATE_PATH, runtime.snapshot);
    return;
  }
  throw new Error(`Unknown deployment child mode: ${mode ?? "<missing>"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
}
