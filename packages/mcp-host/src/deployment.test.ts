import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { McpEnvelope, McpRequest } from "./index.ts";
import { createDeploymentRuntime } from "./deployment-child.ts";

function writeRequest(id = "write-1", requestId = "write-request"): McpRequest {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "canvas.write", arguments: { type: "create", nodes: [{ id: "same", type: "text", x: 7, y: 8, props: { body: "hello" } }] }, requestId, origin: "agent:deployment" } };
}

function readRequest(id = "read-1", requestId = "read-request"): McpRequest {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "canvas.read", arguments: { type: "nodes", fields: ["position", "props"] }, requestId, origin: "agent:deployment" } };
}

function errorRequest(id = "error-1"): McpRequest {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "canvas.read", arguments: { type: "preview", id: "missing" }, requestId: "error-request", origin: "agent:deployment" } };
}

type Child = {
  process: ChildProcessWithoutNullStreams;
  statePath: string;
  stderr: () => string;
  outputLines: () => readonly string[];
  nextLine(): Promise<string>;
  waitForStderr(text: string): Promise<void>;
  finish(): Promise<void>;
  cleanup(): Promise<void>;
};

const activeChildren = new Set<Child>();

function launch(mode: "stdio" | "http"): Child {
  const directory = mkdtempSync(join(tmpdir(), "pixiboard-mcp-"));
  const statePath = join(directory, "state.json");
  const childPath = fileURLToPath(new URL("./deployment-child.ts", import.meta.url));
  const childProcess = spawn(process.execPath, [childPath, mode], { env: { ...process.env, PIXIBOARD_MCP_STATE_PATH: statePath }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const lines: string[] = [];
  const allLines: string[] = [];
  const lineWaiters: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
  const stderrWaiters: Array<{ text: string; resolve: () => void; reject: (error: Error) => void }> = [];
  childProcess.stdout.setEncoding("utf8");
  childProcess.stderr.setEncoding("utf8");
  childProcess.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    let newline = stdout.indexOf("\n");
    while (newline >= 0) {
      const line = stdout.slice(0, newline);
      stdout = stdout.slice(newline + 1);
      allLines.push(line);
      const waiter = lineWaiters.shift();
      if (waiter) waiter.resolve(line); else lines.push(line);
      newline = stdout.indexOf("\n");
    }
  });
  childProcess.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    for (let index = stderrWaiters.length - 1; index >= 0; index -= 1) {
      if (stderr.includes(stderrWaiters[index].text)) stderrWaiters.splice(index, 1)[0].resolve();
    }
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    childProcess.once("error", (error) => reject(new Error(`MCP ${mode} child failed to launch: ${error.message}\nFull stderr:\n${stderr}`)));
    childProcess.once("exit", (code, signal) => {
      const error = new Error(`MCP ${mode} child exited before expected output with code ${code} signal ${signal ?? "none"}\nFull stderr:\n${stderr}`);
      for (const waiter of lineWaiters.splice(0)) waiter.reject(error);
      for (const waiter of stderrWaiters.splice(0)) waiter.reject(error);
      resolve({ code, signal });
    });
  });
  const child: Child = {
    process: childProcess,
    statePath,
    stderr: () => stderr,
    outputLines: () => allLines,
    nextLine: () => lines.length ? Promise.resolve(lines.shift()!) : new Promise((resolve, reject) => lineWaiters.push({ resolve, reject })),
    waitForStderr: (text) => stderr.includes(text) ? Promise.resolve() : new Promise((resolve, reject) => stderrWaiters.push({ text, resolve, reject })),
    finish: async () => {
      const result = await exited;
      if (result.code !== 0) throw new Error(`MCP ${mode} child exited with code ${result.code} signal ${result.signal ?? "none"}\nFull stderr:\n${stderr}`);
    },
    cleanup: async () => {
      if (childProcess.exitCode === null && childProcess.signalCode === null) childProcess.kill("SIGTERM");
      await exited.catch(() => undefined);
      rmSync(directory, { recursive: true, force: true });
      activeChildren.delete(child);
    },
  };
  activeChildren.add(child);
  return child;
}

afterEach(async () => { await Promise.all([...activeChildren].map((child) => child.cleanup())); });

function state(child: Child): unknown { return JSON.parse(readFileSync(child.statePath, "utf8")); }
function send(child: Child, value: unknown): void { child.process.stdin.write(`${typeof value === "string" ? value : JSON.stringify(value)}\n`); }
async function response(child: Child): Promise<McpEnvelope> { return JSON.parse(await child.nextLine()) as McpEnvelope; }

async function directBaseline() {
  const runtime = createDeploymentRuntime();
  const write = await runtime.tools.call("canvas.write", writeRequest().params.arguments, { requestId: "write-request", origin: "agent:deployment" });
  const read = await runtime.tools.call("canvas.read", readRequest().params.arguments, { requestId: "read-request", origin: "agent:deployment" });
  const error = await runtime.tools.call("canvas.read", errorRequest().params.arguments, { requestId: "error-request", origin: "agent:deployment" });
  return { write, read, error, state: runtime.snapshot() };
}

async function post(port: number, body: string): Promise<{ status: number; json: McpEnvelope }> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body });
  return { status: response.status, json: await response.json() as McpEnvelope };
}

describe("MCP real deployment smoke", () => {
  it("keeps real child stdio frames ordered and semantically equivalent", async () => {
    const direct = await directBaseline();
    const child = launch("stdio");
    await child.waitForStderr("READY");
    send(child, "not-json");
    send(child, writeRequest());
    send(child, readRequest());
    send(child, errorRequest());
    const replies = [await response(child), await response(child), await response(child), await response(child)];
    expect(replies).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { jsonrpc: "2.0", id: "write-1", result: direct.write },
      { jsonrpc: "2.0", id: "read-1", result: direct.read },
      { jsonrpc: "2.0", id: "error-1", result: direct.error },
    ]);
    child.process.stdin.end();
    await child.finish();
    expect(state(child)).toEqual(direct.state);
  });

  it("keeps loopback HTTP document, revision, history, persistence, and errors equivalent", async () => {
    const direct = await directBaseline();
    const child = launch("http");
    const port = (JSON.parse(await child.nextLine()) as { port: number }).port;
    const malformed = await post(port, "not-json");
    const write = await post(port, JSON.stringify(writeRequest()));
    const read = await post(port, JSON.stringify(readRequest()));
    const error = await post(port, JSON.stringify(errorRequest()));
    expect(malformed).toEqual({ status: 400, json: { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } } });
    expect(write.json).toEqual({ jsonrpc: "2.0", id: "write-1", result: direct.write });
    expect(read.json).toEqual({ jsonrpc: "2.0", id: "read-1", result: direct.read });
    expect(error.json).toEqual({ jsonrpc: "2.0", id: "error-1", result: direct.error });
    child.process.kill("SIGTERM");
    await child.finish();
    expect(state(child)).toEqual(direct.state);
  });

  it("aborts on real stdin close without a late response, write, or save", async () => {
    const child = launch("stdio");
    await child.waitForStderr("READY");
    send(child, writeRequest("abort-write", "abort-after-start"));
    await child.waitForStderr("REQUEST_STARTED");
    child.process.stdin.end();
    await child.finish();
    expect(child.outputLines()).toEqual([]);
    expect(state(child)).toMatchObject({ revision: 0, changes: [], saves: [], history: [] });
  });

  it("aborts a real loopback HTTP socket without a late write or save", async () => {
    const child = launch("http");
    const port = (JSON.parse(await child.nextLine()) as { port: number }).port;
    const pending = httpRequest({ host: "127.0.0.1", port, path: "/mcp", method: "POST", headers: { "content-type": "application/json" } });
    pending.on("error", () => undefined);
    pending.end(JSON.stringify(writeRequest("abort-write", "abort-after-start")));
    await child.waitForStderr("REQUEST_STARTED");
    pending.destroy();
    await child.waitForStderr("REQUEST_FINISHED");
    child.process.kill("SIGTERM");
    await child.finish();
    expect(state(child)).toMatchObject({ revision: 0, changes: [], saves: [], history: [] });
  });
});
