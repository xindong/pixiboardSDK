import type {
  BoardCapabilities,
  BoardChangeSet,
  BoardNode,
  CreateNodeInput,
  JsonValue,
  ReadNodesInput,
  RequestOptions,
  UpdateNodeInput,
  WriteOptions,
  WriteResult,
} from "@pixi-board/capabilities";
import {
  BoardDestroyedError,
  CapabilityError,
  CapabilityUnavailableError,
  PermissionDeniedError,
} from "@pixi-board/capabilities";

export const PLUGIN_API_VERSION = "3" as const;

export type PluginPermission =
  | "canvas.read"
  | "canvas.write"
  | "events.subscribe"
  | "panel.register"
  | "tool.register"
  | "process.spawn"
  | "renderer:trusted";

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  apiVersion: typeof PLUGIN_API_VERSION;
  permissions: readonly PluginPermission[];
  contributions?: {
    panels?: readonly string[];
    tools?: readonly string[];
    processes?: readonly string[];
  };
};

export type PluginEvent =
  | { type: "change"; revision: number; changeSet: BoardChangeSet }
  | { type: "selection:change"; nodeIds: readonly string[]; previousNodeIds: readonly string[] }
  | { type: "viewport:change"; viewport: unknown; previousViewport: unknown };

export type PluginEventSource = {
  on(event: "change" | "selection:change" | "viewport:change", listener: (event: PluginEvent) => void): () => void;
};

export type PluginCanvas = {
  read(input?: ReadNodesInput, options?: RequestOptions): Promise<{ nodes: readonly BoardNode[]; page: { hasMore: boolean; nextCursor?: string }; revision: number; requestId?: string }>;
  create(input: { nodes: readonly CreateNodeInput[] }, options?: WriteOptions): Promise<WriteResult>;
  update(input: { nodes: readonly UpdateNodeInput[] }, options?: WriteOptions): Promise<WriteResult>;
  delete(input: { nodeIds: readonly string[] }, options?: WriteOptions): Promise<WriteResult>;
};

export type PluginToolHandler = (input: JsonValue) => unknown | Promise<unknown>;

export type PluginProcessRequest = {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
};

export type PluginProcessHandle = {
  stop(): void | Promise<void>;
};

export type PluginProcessHost = {
  start(pluginId: string, processId: string, request: Readonly<PluginProcessRequest>): PluginProcessHandle | Promise<PluginProcessHandle>;
};

export type PluginContext = {
  manifest: Readonly<PluginManifest>;
  canvas: PluginCanvas;
  events: { subscribe(event: "change" | "selection:change" | "viewport:change", listener: (event: PluginEvent) => void): () => void };
  panels: { register(id: string): () => void };
  tools: { register(id: string, handler?: PluginToolHandler): () => void };
  processes: { start(id: string, request: PluginProcessRequest): Promise<PluginProcessHandle> };
};

export type PluginDefinition = {
  manifest: PluginManifest;
  start(context: PluginContext): void | Promise<void>;
  stop?(): void | Promise<void>;
};

export type PluginHostOptions = {
  capabilities: BoardCapabilities;
  events: PluginEventSource;
  grantedPermissions?: readonly PluginPermission[];
  processes?: PluginProcessHost;
};

export type SerializedPluginError = {
  code: string;
  name: string;
  message: string;
  details?: Record<string, unknown>;
};

type Cleanup = () => void | Promise<void>;

const knownPermissions = new Set<PluginPermission>([
  "canvas.read",
  "canvas.write",
  "events.subscribe",
  "panel.register",
  "tool.register",
  "process.spawn",
  "renderer:trusted",
]);

export function serializePluginError(error: unknown): SerializedPluginError {
  if (error instanceof CapabilityError) return { code: error.code, name: error.name, message: error.message, ...(error.details ? { details: { ...error.details } } : {}) };
  if (error instanceof Error) return { code: "INTERNAL_ERROR", name: error.name, message: error.message };
  return { code: "INTERNAL_ERROR", name: "Error", message: String(error) };
}

export function serializeChangeSet(changeSet: BoardChangeSet): BoardChangeSet {
  return {
    ...changeSet,
    addedNodeIds: [...changeSet.addedNodeIds],
    updatedNodeIds: [...changeSet.updatedNodeIds],
    removedNodeIds: [...changeSet.removedNodeIds],
    assetChangedNodeIds: [...changeSet.assetChangedNodeIds],
  };
}

export function assertV3Manifest(value: unknown): asserts value is PluginManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CapabilityError("INVALID_INPUT", "Plugin manifest must be an object");
  }
  const manifest = value as Partial<PluginManifest>;
  if (manifest.apiVersion !== PLUGIN_API_VERSION) {
    throw new CapabilityError("INVALID_INPUT", "Only Plugin API v3 manifests are accepted", { apiVersion: manifest.apiVersion });
  }
  for (const field of ["id", "name", "version"] as const) {
    if (typeof manifest[field] !== "string" || !manifest[field]?.trim()) {
      throw new CapabilityError("INVALID_INPUT", `Plugin manifest requires ${field}`);
    }
  }
  if (manifest.id!.includes(":")) {
    throw new CapabilityError("INVALID_INPUT", "Plugin manifest id cannot contain ':'");
  }
  if (!Array.isArray(manifest.permissions)) {
    throw new CapabilityError("INVALID_INPUT", "Plugin manifest permissions must be an array");
  }
  assertUniqueStrings(manifest.permissions, "permissions");
  for (const permission of manifest.permissions) {
    if (!knownPermissions.has(permission as PluginPermission)) {
      throw new CapabilityError("INVALID_INPUT", `Unknown plugin permission: ${permission}`);
    }
  }
  if (manifest.contributions !== undefined) {
    if (!manifest.contributions || typeof manifest.contributions !== "object" || Array.isArray(manifest.contributions)) {
      throw new CapabilityError("INVALID_INPUT", "Plugin manifest contributions must be an object");
    }
    for (const field of Object.keys(manifest.contributions)) {
      if (!["panels", "tools", "processes"].includes(field)) {
        throw new CapabilityError("INVALID_INPUT", `Unknown plugin contribution: ${field}`);
      }
    }
    for (const kind of ["panels", "tools", "processes"] as const) {
      const ids = manifest.contributions[kind];
      if (ids !== undefined) {
        if (!Array.isArray(ids)) throw new CapabilityError("INVALID_INPUT", `contributions.${kind} must be an array`);
        assertUniqueStrings(ids, `contributions.${kind}`);
        if (ids.some((id) => id.includes(":"))) {
          throw new CapabilityError("INVALID_INPUT", `contributions.${kind} ids cannot contain ':'`);
        }
      }
    }
  }
}

export class PluginHost {
  private readonly contexts = new Map<string, { definition: PluginDefinition; context: PluginContext; cleanups: Cleanup[]; deactivate(): void }>();
  private readonly panels = new Set<string>();
  private readonly tools = new Map<string, PluginToolHandler | undefined>();
  private readonly processes = new Set<string>();
  private destroyed = false;

  constructor(private readonly options: PluginHostOptions) {}

  assertCanLoad(manifest: unknown): asserts manifest is PluginManifest {
    this.assertAlive();
    assertV3Manifest(manifest);
    if (this.contexts.has(manifest.id)) {
      throw new CapabilityError("INVALID_INPUT", `Plugin already loaded: ${manifest.id}`);
    }
    const granted = new Set(this.options.grantedPermissions ?? manifest.permissions);
    for (const permission of manifest.permissions) {
      if (!granted.has(permission)) {
        throw new PermissionDeniedError(`Permission denied: ${permission}`, { pluginId: manifest.id, permission });
      }
    }
  }

  async load(definition: PluginDefinition): Promise<PluginContext> {
    this.assertCanLoad(definition.manifest);
    if (typeof definition.start !== "function") {
      throw new CapabilityError("INVALID_INPUT", "Plugin module must export a start function", { pluginId: definition.manifest.id });
    }
    const manifest = freezeManifest(definition.manifest);
    const requested = new Set(manifest.permissions);
    const cleanups: Cleanup[] = [];
    let active = true;
    const pluginKey = (id: string) => `${manifest.id}:${id}`;
    const assertPluginActive = () => {
      this.assertAlive();
      if (!active) throw new BoardDestroyedError(`Plugin is no longer active: ${manifest.id}`);
    };
    const requirePermission = (permission: PluginPermission) => {
      assertPluginActive();
      if (!requested.has(permission)) {
        throw new PermissionDeniedError(`Permission not declared: ${permission}`, { pluginId: manifest.id, permission });
      }
    };
    const addCleanup = (cleanup: Cleanup): Cleanup => {
      let active = true;
      const wrapped = async () => {
        if (!active) return;
        active = false;
        await cleanup();
      };
      cleanups.push(wrapped);
      return wrapped;
    };
    const context: PluginContext = {
      manifest,
      canvas: {
        read: (input, options) => { requirePermission("canvas.read"); return this.options.capabilities.nodes.read(input, options); },
        create: (input, options = {}) => { requirePermission("canvas.write"); return this.options.capabilities.nodes.create(input, { ...options, origin: `plugin:${manifest.id}` }); },
        update: (input, options = {}) => { requirePermission("canvas.write"); return this.options.capabilities.nodes.update(input, { ...options, origin: `plugin:${manifest.id}` }); },
        delete: (input, options = {}) => { requirePermission("canvas.write"); return this.options.capabilities.nodes.delete(input, { ...options, origin: `plugin:${manifest.id}` }); },
      },
      events: {
        subscribe: (event, listener) => {
          requirePermission("events.subscribe");
          if (!["change", "selection:change", "viewport:change"].includes(event)) {
            throw new CapabilityError("INVALID_INPUT", `Unsupported plugin event: ${String(event)}`);
          }
          if (typeof listener !== "function") throw new CapabilityError("INVALID_INPUT", "Plugin event listener must be a function");
          const unsubscribe = this.options.events.on(event, listener);
          if (typeof unsubscribe !== "function") throw new CapabilityError("INTERNAL_ERROR", "Plugin event source must return an unsubscribe function");
          const off = addCleanup(unsubscribe);
          return () => { void off(); };
        },
      },
      panels: {
        register: (id) => {
          requirePermission("panel.register");
          assertDeclared(manifest, "panels", id);
          const key = pluginKey(id);
          if (this.panels.has(key)) throw new CapabilityError("INVALID_INPUT", `Panel already registered: ${id}`);
          this.panels.add(key);
          const off = addCleanup(() => { this.panels.delete(key); });
          return () => { void off(); };
        },
      },
      tools: {
        register: (id, handler) => {
          requirePermission("tool.register");
          assertDeclared(manifest, "tools", id);
          if (handler !== undefined && typeof handler !== "function") {
            throw new CapabilityError("INVALID_INPUT", "Plugin tool handler must be a function");
          }
          const key = pluginKey(id);
          if (this.tools.has(key)) throw new CapabilityError("INVALID_INPUT", `Tool already registered: ${id}`);
          this.tools.set(key, handler);
          const off = addCleanup(() => { this.tools.delete(key); });
          return () => { void off(); };
        },
      },
      processes: {
        start: async (id, request) => {
          requirePermission("process.spawn");
          assertDeclared(manifest, "processes", id);
          if (!this.options.processes) throw new CapabilityUnavailableError("process.spawn");
          if (!request || typeof request.command !== "string" || !request.command.trim()) {
            throw new CapabilityError("INVALID_INPUT", "Plugin process command must be a non-empty string");
          }
          if (request.args !== undefined && (!Array.isArray(request.args) || request.args.some((arg) => typeof arg !== "string"))) {
            throw new CapabilityError("INVALID_INPUT", "Plugin process args must be an array of strings");
          }
          if (request.cwd !== undefined && typeof request.cwd !== "string") {
            throw new CapabilityError("INVALID_INPUT", "Plugin process cwd must be a string");
          }
          if (request.env !== undefined && (!request.env || typeof request.env !== "object" || Array.isArray(request.env) || Object.values(request.env).some((value) => typeof value !== "string"))) {
            throw new CapabilityError("INVALID_INPUT", "Plugin process env must contain string values");
          }
          const key = pluginKey(id);
          if (this.processes.has(key)) throw new CapabilityError("INVALID_INPUT", `Process already started: ${id}`);
          this.processes.add(key);
          let startPromise: Promise<PluginProcessHandle>;
          try {
            startPromise = Promise.resolve(this.options.processes.start(manifest.id, id, freezeProcessRequest(request))).then((handle) => {
              if (!handle || typeof handle.stop !== "function") {
                throw new CapabilityError("INTERNAL_ERROR", "Plugin process host must return a stoppable handle", { pluginId: manifest.id, processId: id });
              }
              return handle;
            });
          } catch (error) {
            this.processes.delete(key);
            throw error;
          }
          const stop = addCleanup(async () => {
            try {
              const handle = await startPromise;
              await handle.stop();
            }
            finally { this.processes.delete(key); }
          });
          try { await startPromise; }
          catch (error) {
            try { await stop(); }
            catch { /* Preserve the process start failure after clearing registration state. */ }
            throw error;
          }
          if (!active) {
            await stop();
            throw new BoardDestroyedError(`Plugin is no longer active: ${manifest.id}`);
          }
          return { stop };
        },
      },
    };
    this.contexts.set(manifest.id, {
      definition: { ...definition, manifest },
      context,
      cleanups,
      deactivate: () => { active = false; },
    });
    try {
      await definition.start(context);
      return context;
    } catch (error) {
      try { await this.unload(manifest.id); }
      catch { /* Preserve the plugin start failure after best-effort cleanup. */ }
      throw error;
    }
  }

  async unload(pluginId: string): Promise<void> {
    const entry = this.contexts.get(pluginId);
    if (!entry) return;
    this.contexts.delete(pluginId);
    entry.deactivate();
    const errors: unknown[] = [];
    try { await entry.definition.stop?.(); }
    catch (error) { errors.push(error); }
    for (const cleanup of [...entry.cleanups].reverse()) {
      try { await cleanup(); }
      catch (error) { errors.push(error); }
    }
    entry.cleanups.length = 0;
    if (errors.length) throw new AggregateError(errors, `Plugin unload failed: ${pluginId}`);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    const errors: unknown[] = [];
    for (const pluginId of [...this.contexts.keys()]) {
      try { await this.unload(pluginId); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Plugin host destroy failed");
  }

  async invokeTool(pluginId: string, toolId: string, input: JsonValue): Promise<unknown> {
    this.assertAlive();
    const key = `${pluginId}:${toolId}`;
    if (!this.tools.has(key)) throw new CapabilityError("INVALID_INPUT", `Tool is not registered: ${key}`);
    const handler = this.tools.get(key);
    if (!handler) throw new CapabilityUnavailableError(`tool:${key}`);
    return handler(input);
  }

  getRegistrations(): { panels: readonly string[]; tools: readonly string[]; processes: readonly string[] } {
    return { panels: [...this.panels], tools: [...this.tools.keys()], processes: [...this.processes] };
  }

  private assertAlive(): void {
    if (this.destroyed) throw new BoardDestroyedError();
  }
}

function assertDeclared(manifest: Readonly<PluginManifest>, kind: "panels" | "tools" | "processes", id: string): void {
  if (typeof id !== "string" || !id.trim()) throw new CapabilityError("INVALID_INPUT", `${kind} contribution id must be a non-empty string`);
  if (!manifest.contributions?.[kind]?.includes(id)) {
    throw new CapabilityError("INVALID_INPUT", `${kind.slice(0, -1)} is not declared: ${id}`);
  }
}

function assertUniqueStrings(value: readonly unknown[], field: string): void {
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) throw new CapabilityError("INVALID_INPUT", `${field} must contain non-empty strings`);
    if (seen.has(item)) throw new CapabilityError("INVALID_INPUT", `${field} contains a duplicate: ${item}`);
    seen.add(item);
  }
}

function freezeManifest(manifest: PluginManifest): Readonly<PluginManifest> {
  const contributions = manifest.contributions
    ? Object.freeze({
        ...(manifest.contributions.panels ? { panels: Object.freeze([...manifest.contributions.panels]) } : {}),
        ...(manifest.contributions.tools ? { tools: Object.freeze([...manifest.contributions.tools]) } : {}),
        ...(manifest.contributions.processes ? { processes: Object.freeze([...manifest.contributions.processes]) } : {}),
      })
    : undefined;
  return Object.freeze({
    ...manifest,
    permissions: Object.freeze([...manifest.permissions]),
    ...(contributions ? { contributions } : {}),
  });
}

function freezeProcessRequest(request: PluginProcessRequest): Readonly<PluginProcessRequest> {
  return Object.freeze({
    command: request.command,
    ...(request.args ? { args: Object.freeze([...request.args]) } : {}),
    ...(request.cwd ? { cwd: request.cwd } : {}),
    ...(request.env ? { env: Object.freeze({ ...request.env }) } : {}),
  });
}
