import type {
  BoardCapabilities,
  BoardChangeSet,
  BoardNode,
  CreateNodeInput,
  ReadNodesInput,
  RequestOptions,
  UpdateNodeInput,
  WriteOptions,
  WriteResult,
} from "@pixi-board/capabilities";
import { BoardDestroyedError, CapabilityError, PermissionDeniedError } from "@pixi-board/capabilities";

export const PLUGIN_API_VERSION = "3" as const;

export type PluginPermission =
  | "canvas.read"
  | "canvas.write"
  | "events.subscribe"
  | "panel.register"
  | "tool.register"
  | "renderer:trusted";

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  apiVersion: typeof PLUGIN_API_VERSION;
  permissions: readonly PluginPermission[];
  contributions?: { panels?: readonly string[]; tools?: readonly string[] };
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

export type PluginContext = {
  manifest: Readonly<PluginManifest>;
  canvas: PluginCanvas;
  events: { subscribe(event: "change" | "selection:change" | "viewport:change", listener: (event: PluginEvent) => void): () => void };
  panels: { register(id: string): void };
  tools: { register(id: string): void };
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
};

export type SerializedPluginError = {
  code: string;
  name: string;
  message: string;
  details?: Record<string, unknown>;
};

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

export function assertV3Manifest(manifest: PluginManifest): void {
  if (!manifest || manifest.apiVersion !== PLUGIN_API_VERSION) {
    throw new CapabilityError("INVALID_INPUT", "Only Plugin API v3 manifests are accepted", { apiVersion: (manifest as { apiVersion?: unknown } | undefined)?.apiVersion });
  }
  if (!manifest.id || !manifest.name || !manifest.version) throw new CapabilityError("INVALID_INPUT", "Plugin manifest requires id, name and version");
}

export class PluginHost {
  private readonly contexts = new Map<string, { definition: PluginDefinition; context: PluginContext; cleanups: Set<() => void> }>();
  private readonly panels = new Set<string>();
  private readonly tools = new Set<string>();
  private destroyed = false;
  constructor(private readonly options: PluginHostOptions) {}

  async load(definition: PluginDefinition): Promise<PluginContext> {
    this.assertAlive();
    assertV3Manifest(definition.manifest);
    if (this.contexts.has(definition.manifest.id)) throw new CapabilityError("INVALID_INPUT", `Plugin already loaded: ${definition.manifest.id}`);
    const granted = new Set(this.options.grantedPermissions ?? definition.manifest.permissions);
    for (const permission of definition.manifest.permissions) if (!granted.has(permission)) throw new PermissionDeniedError(`Permission denied: ${permission}`, { pluginId: definition.manifest.id, permission });
    const requirePermission = (permission: PluginPermission) => { if (!granted.has(permission)) throw new PermissionDeniedError(`Permission denied: ${permission}`, { pluginId: definition.manifest.id, permission }); };
    const cleanups = new Set<() => void>();
    const context: PluginContext = {
      manifest: Object.freeze({ ...definition.manifest, permissions: [...definition.manifest.permissions] }),
      canvas: {
        read: (input, options) => { requirePermission("canvas.read"); return this.options.capabilities.nodes.read(input, options); },
        create: (input, options = {}) => { requirePermission("canvas.write"); return this.options.capabilities.nodes.create(input, { ...options, origin: options.origin ?? `plugin:${definition.manifest.id}` }); },
        update: (input, options = {}) => { requirePermission("canvas.write"); return this.options.capabilities.nodes.update(input, { ...options, origin: options.origin ?? `plugin:${definition.manifest.id}` }); },
        delete: (input, options = {}) => { requirePermission("canvas.write"); return this.options.capabilities.nodes.delete(input, { ...options, origin: options.origin ?? `plugin:${definition.manifest.id}` }); },
      },
      events: { subscribe: (event, listener) => { requirePermission("events.subscribe"); const off = this.options.events.on(event, listener); cleanups.add(off); return () => { cleanups.delete(off); off(); }; } },
      panels: { register: (id) => { requirePermission("panel.register"); if (!definition.manifest.contributions?.panels?.includes(id)) throw new CapabilityError("INVALID_INPUT", `Panel is not declared: ${id}`); this.panels.add(`${definition.manifest.id}:${id}`); cleanups.add(() => this.panels.delete(`${definition.manifest.id}:${id}`)); } },
      tools: { register: (id) => { requirePermission("tool.register"); if (!definition.manifest.contributions?.tools?.includes(id)) throw new CapabilityError("INVALID_INPUT", `Tool is not declared: ${id}`); this.tools.add(`${definition.manifest.id}:${id}`); cleanups.add(() => this.tools.delete(`${definition.manifest.id}:${id}`)); } },
    };
    this.contexts.set(definition.manifest.id, { definition, context, cleanups });
    try { await definition.start(context); return context; } catch (error) { await this.unload(definition.manifest.id); throw error; }
  }

  async unload(pluginId: string): Promise<void> {
    const entry = this.contexts.get(pluginId); if (!entry) return;
    this.contexts.delete(pluginId);
    for (const off of entry.cleanups) off(); entry.cleanups.clear();
    await entry.definition.stop?.();
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return; this.destroyed = true;
    for (const pluginId of [...this.contexts.keys()]) await this.unload(pluginId);
  }

  getRegistrations(): { panels: readonly string[]; tools: readonly string[] } {
    return { panels: [...this.panels], tools: [...this.tools] };
  }

  private assertAlive(): void { if (this.destroyed) throw new BoardDestroyedError(); }
}
