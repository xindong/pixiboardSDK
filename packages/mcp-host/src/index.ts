import type { AgentCallOptions, AgentToolResponse, AgentTools, CanvasOutput } from "@pixi-board/agent-tools";

export type McpRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: "tools/call";
  params: { name: "canvas.read" | "canvas.write"; arguments: unknown; requestId?: string; origin?: string };
};

export type McpResponse = { jsonrpc: "2.0"; id: string | number; result: AgentToolResponse<CanvasOutput> };
export type McpErrorResponse = { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string; data?: unknown } };
export type McpEnvelope = McpResponse | McpErrorResponse;

export type McpHost = {
  handle(request: unknown, options?: { signal?: AbortSignal }): Promise<McpEnvelope>;
  close(): void;
  readonly signal: AbortSignal;
};

function abortedResponse(id: string | number, requestId?: string): McpResponse {
  return { jsonrpc: "2.0", id, result: { ok: false, error: { code: "ABORTED", name: "CapabilityError", message: "The capability request was aborted", retryable: true, requestId } } };
}

function protocolError(id: string | number | null, code: number, message: string): McpErrorResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function requestIdOf(value: Record<string, unknown>): string | undefined {
  const params = value.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const requestId = (params as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? requestId : undefined;
}

function idOf(value: unknown): string | number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function combineSignals(first: AbortSignal, second?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  if (!second) return { signal: first, dispose: () => undefined };
  const controller = new AbortController();
  const onFirstAbort = () => controller.abort(first.reason);
  const onSecondAbort = () => controller.abort(second.reason);
  first.addEventListener("abort", onFirstAbort, { once: true });
  second.addEventListener("abort", onSecondAbort, { once: true });
  if (first.aborted) onFirstAbort();
  if (second.aborted) onSecondAbort();
  return {
    signal: controller.signal,
    dispose: () => {
      first.removeEventListener("abort", onFirstAbort);
      second.removeEventListener("abort", onSecondAbort);
    },
  };
}

export function createMcpHost(agent: AgentTools): McpHost {
  const controller = new AbortController();
  let closed = false;
  return {
    signal: controller.signal,
    async handle(request, options = {}) {
      const id = idOf(request);
      if (!request || typeof request !== "object" || Array.isArray(request)) return protocolError(id, -32600, "Invalid Request");
      const value = request as Record<string, unknown>;
      if (value.jsonrpc !== "2.0" || typeof value.id !== "string" && typeof value.id !== "number") return protocolError(id, -32600, "Invalid Request");
      if (value.method !== "tools/call") return protocolError(id, -32601, "Method not found");
      const params = value.params;
      if (!params || typeof params !== "object" || Array.isArray(params)) return protocolError(id, -32602, "Invalid params");
      const p = params as Record<string, unknown>;
      if ((p.name !== "canvas.read" && p.name !== "canvas.write") || !("arguments" in p) || p.requestId !== undefined && typeof p.requestId !== "string" || p.origin !== undefined && typeof p.origin !== "string") return protocolError(id, -32602, "Invalid params");

      const requestId = requestIdOf(value);
      const combined = combineSignals(controller.signal, options.signal);
      try {
        if (closed || combined.signal.aborted) return abortedResponse(id!, requestId);
        const callOptions: AgentCallOptions = { signal: combined.signal, requestId, ...(typeof p.origin === "string" ? { origin: p.origin } : {}) };
        const result = await agent.call(p.name, p.arguments, callOptions);
        // A synchronous capability transaction cannot be rolled back by transport close;
        // once the Agent reports success, preserve the committed result.
        return { jsonrpc: "2.0", id: id!, result: result as AgentToolResponse<CanvasOutput> };
      } finally {
        combined.dispose();
      }
    },
    close() { if (!closed) { closed = true; controller.abort(new Error("MCP host closed")); } },
  };
}

export type StdioEndpoint = { readable: AsyncIterable<string>; write(chunk: string): void; closeInput?: () => void };

export function createStdioMcpServer(host: McpHost, endpoint: StdioEndpoint): { close(): void; ready: Promise<void>; completed: Promise<void> } {
  let stopped = false;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  const close = () => { if (!stopped) { stopped = true; host.close(); endpoint.closeInput?.(); } };
  const completed = (async () => {
    resolveReady();
    let pending = Promise.resolve();
    try {
      for await (const line of endpoint.readable) {
        if (stopped) break;
        if (!line.trim()) continue;
        pending = pending.then(async () => {
          if (stopped) return;
          let request: unknown;
          try { request = JSON.parse(line); } catch { if (!stopped) endpoint.write(`${JSON.stringify(protocolError(null, -32700, "Parse error"))}\n`); return; }
          const response = await host.handle(request);
          if (!stopped) endpoint.write(`${JSON.stringify(response)}\n`);
        });
      }
    } finally {
      if (!stopped) { stopped = true; host.close(); }
      await pending;
      resolveReady();
    }
  })();
  return { close, ready, completed };
}

export async function callStdioMcp(endpoint: StdioEndpoint, request: McpRequest): Promise<McpEnvelope> {
  endpoint.write(`${JSON.stringify(request)}\n`);
  for await (const line of endpoint.readable) if (line.trim()) return JSON.parse(line) as McpEnvelope;
  throw new Error("stdio MCP endpoint ended before a response");
}

export function createHttpMcpHandler(host: McpHost): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json(protocolError(null, -32700, "Parse error"), { status: 400 }); }
    try { return Response.json(await host.handle(body, { signal: request.signal })); }
    catch (error) { return Response.json(protocolError(idOf(body), -32603, error instanceof Error ? error.message : String(error)), { status: 500 }); }
  };
}

export async function callHttpMcp(handler: (request: Request) => Promise<Response>, request: McpRequest, options: { signal?: AbortSignal } = {}): Promise<McpEnvelope> {
  const response = await handler(new Request("http://mcp.test", { method: "POST", body: JSON.stringify(request), headers: { "content-type": "application/json" }, signal: options.signal }));
  return await response.json() as McpEnvelope;
}
