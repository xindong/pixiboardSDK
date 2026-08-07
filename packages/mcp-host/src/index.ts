import type { AgentCallOptions, AgentToolResponse, AgentTools, CanvasOutput } from "@pixi-board/agent-tools";

export type McpRequest = {
  jsonrpc?: "2.0";
  id: string | number;
  method: "tools/call";
  params: { name: "canvas.read" | "canvas.write"; arguments: unknown; requestId?: string; origin?: string };
};

export type McpResponse = {
  jsonrpc: "2.0";
  id: string | number;
  result: AgentToolResponse<CanvasOutput>;
};

export type McpHost = {
  handle(request: McpRequest, options?: { signal?: AbortSignal }): Promise<McpResponse>;
  close(): void;
  readonly signal: AbortSignal;
};

function abortedResponse(id: string | number, requestId?: string): McpResponse {
  return { jsonrpc: "2.0", id, result: { ok: false, error: { code: "ABORTED", name: "CapabilityError", message: "The capability request was aborted", retryable: true, requestId } } };
}

function combineSignals(first: AbortSignal, second?: AbortSignal): AbortSignal {
  if (!second) return first;
  const controller = new AbortController();
  const abort = (source: AbortSignal) => { if (!controller.signal.aborted) controller.abort(source.reason); };
  if (first.aborted) abort(first); else first.addEventListener("abort", () => abort(first), { once: true });
  if (second.aborted) abort(second); else second.addEventListener("abort", () => abort(second), { once: true });
  return controller.signal;
}

export function createMcpHost(agent: AgentTools): McpHost {
  const controller = new AbortController();
  let closed = false;
  return {
    signal: controller.signal,
    async handle(request, options = {}) {
      const requestId = request.params.requestId;
      const signal = combineSignals(controller.signal, options.signal);
      if (closed || signal.aborted) {
        return abortedResponse(request.id, requestId);
      }
      const callOptions: AgentCallOptions = { signal, requestId, ...(request.params.origin ? { origin: request.params.origin } : {}) };
      const result = await agent.call(request.params.name, request.params.arguments, callOptions);
      if (signal.aborted) return abortedResponse(request.id, requestId);
      return { jsonrpc: "2.0", id: request.id, result: result as AgentToolResponse<CanvasOutput> };
    },
    close() { if (!closed) { closed = true; controller.abort(new Error("MCP host closed")); } },
  };
}

export type StdioEndpoint = { readable: AsyncIterable<string>; write(chunk: string): void };

export function createStdioMcpServer(host: McpHost, endpoint: StdioEndpoint): { close(): void } {
  let stopped = false;
  const close = () => { if (!stopped) { stopped = true; host.close(); } };
  void (async () => {
    for await (const line of endpoint.readable) {
      if (stopped) break;
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line) as McpRequest;
        const response = await host.handle(request);
        endpoint.write(`${JSON.stringify(response)}\n`);
      } catch (error) {
        endpoint.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, result: { ok: false, error: { code: "INVALID_INPUT", name: "CapabilityError", message: error instanceof Error ? error.message : String(error), retryable: false } } })}\n`);
      }
    }
  })();
  return { close };
}

export async function callStdioMcp(endpoint: StdioEndpoint, request: McpRequest): Promise<McpResponse> {
  endpoint.write(`${JSON.stringify(request)}\n`);
  for await (const line of endpoint.readable) {
    if (line.trim()) return JSON.parse(line) as McpResponse;
  }
  throw new Error("stdio MCP endpoint ended before a response");
}

export function createHttpMcpHandler(host: McpHost): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    try {
      const body = await request.json() as McpRequest;
      const response = await host.handle(body, { signal: request.signal });
      return Response.json(response);
    } catch (error) {
      return Response.json({ jsonrpc: "2.0", id: null, result: { ok: false, error: { code: "INVALID_INPUT", name: "CapabilityError", message: error instanceof Error ? error.message : String(error), retryable: false } } }, { status: 400 });
    }
  };
}

export async function callHttpMcp(handler: (request: Request) => Promise<Response>, request: McpRequest, options: { signal?: AbortSignal } = {}): Promise<McpResponse> {
  const response = await handler(new Request("http://mcp.test", { method: "POST", body: JSON.stringify(request), headers: { "content-type": "application/json" }, signal: options.signal }));
  return await response.json() as McpResponse;
}
