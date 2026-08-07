import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CapabilityError } from "@pixi-board/capabilities";
import {
  PluginHost,
  assertV3Manifest,
  type PluginContext,
  type PluginDefinition,
  type PluginHostOptions,
  type PluginManifest,
  type PluginPermission,
} from "./index.ts";

export const PLUGIN_PACKAGE_FORMAT = "pixiboard-plugin-directory-v1" as const;
export const PLUGIN_PACKAGE_MANIFEST = "pixiboard.plugin.json" as const;

export type PluginPackageManifest = PluginManifest & {
  packageFormat: typeof PLUGIN_PACKAGE_FORMAT;
  entry: string;
};

export type InspectedPluginPackage = {
  rootPath: string;
  entryPath: string;
  manifest: Readonly<PluginManifest>;
  load(): Promise<PluginDefinition>;
};

export type PackagedPluginHostOptions = Omit<PluginHostOptions, "grantedPermissions"> & {
  grantedPermissions: readonly PluginPermission[];
};

type PluginModule = {
  start(context: PluginContext): void | Promise<void>;
  stop?(): void | Promise<void>;
};

const packageFields = new Set([
  "packageFormat",
  "entry",
  "id",
  "name",
  "version",
  "apiVersion",
  "permissions",
  "contributions",
]);

export class PluginDirectoryLoader {
  async inspect(packagePath: string): Promise<InspectedPluginPackage> {
    if (extname(packagePath).toLowerCase() === ".zip") {
      throw new CapabilityError("INVALID_INPUT", "Legacy zip plugins are not supported; expected a Plugin API v3 directory package");
    }
    let rootPath: string;
    try {
      const candidate = await realpath(packagePath);
      const stats = await lstat(candidate);
      if (!stats.isDirectory()) {
        throw new CapabilityError("INVALID_INPUT", "Plugin package must be a directory", { packagePath });
      }
      rootPath = candidate;
    } catch (error) {
      if (error instanceof CapabilityError) throw error;
      throw new CapabilityError("INVALID_INPUT", "Plugin package directory could not be opened", { packagePath });
    }

    const manifestPath = resolve(rootPath, PLUGIN_PACKAGE_MANIFEST);
    let value: unknown;
    try {
      const manifestStats = await lstat(manifestPath);
      if (!manifestStats.isFile()) throw new Error("manifest is not a regular file");
      value = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      throw new CapabilityError("INVALID_INPUT", `Plugin package requires valid ${PLUGIN_PACKAGE_MANIFEST}`, {
        packagePath: rootPath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    const packageManifest = parsePackageManifest(value);
    const entryPath = await resolveEntry(rootPath, packageManifest.entry);
    const manifest = freezeManifest(packageManifest);
    return {
      rootPath,
      entryPath,
      manifest,
      load: async () => {
        const namespace = await import(pathToFileURL(entryPath).href) as { default?: unknown };
        const module = namespace.default;
        if (!module || typeof module !== "object" || typeof (module as Partial<PluginModule>).start !== "function") {
          throw new CapabilityError("INVALID_INPUT", "Plugin entry must default-export a module with start(context)", {
            pluginId: manifest.id,
            entry: packageManifest.entry,
          });
        }
        const pluginModule = module as PluginModule;
        if (pluginModule.stop !== undefined && typeof pluginModule.stop !== "function") {
          throw new CapabilityError("INVALID_INPUT", "Plugin module stop must be a function", { pluginId: manifest.id });
        }
        return { manifest: { ...manifest }, start: pluginModule.start, ...(pluginModule.stop ? { stop: pluginModule.stop } : {}) };
      },
    };
  }
}

export class PackagedPluginHost {
  private readonly host: PluginHost;

  constructor(options: PackagedPluginHostOptions, private readonly loader = new PluginDirectoryLoader()) {
    if (!Array.isArray(options.grantedPermissions)) {
      throw new CapabilityError("INVALID_INPUT", "Packaged plugin hosts require an explicit permission grant set");
    }
    this.host = new PluginHost(options);
  }

  async loadDirectory(packagePath: string): Promise<PluginContext> {
    const inspected = await this.loader.inspect(packagePath);
    this.host.assertCanLoad(inspected.manifest);
    return this.host.load(await inspected.load());
  }

  unload(pluginId: string): Promise<void> {
    return this.host.unload(pluginId);
  }

  destroy(): Promise<void> {
    return this.host.destroy();
  }

  invokeTool(pluginId: string, toolId: string, input: Parameters<PluginHost["invokeTool"]>[2]): Promise<unknown> {
    return this.host.invokeTool(pluginId, toolId, input);
  }

  getRegistrations(): ReturnType<PluginHost["getRegistrations"]> {
    return this.host.getRegistrations();
  }
}

function parsePackageManifest(value: unknown): PluginPackageManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CapabilityError("INVALID_INPUT", "Plugin package manifest must be an object");
  }
  const record = value as Record<string, unknown>;
  for (const field of Object.keys(record)) {
    if (!packageFields.has(field)) throw new CapabilityError("INVALID_INPUT", `Unsupported plugin package manifest field: ${field}`);
  }
  if (record.packageFormat !== PLUGIN_PACKAGE_FORMAT) {
    throw new CapabilityError("INVALID_INPUT", "Unsupported plugin package format", { packageFormat: record.packageFormat });
  }
  if (typeof record.entry !== "string" || !record.entry.startsWith("./") || extname(record.entry) !== ".mjs") {
    throw new CapabilityError("INVALID_INPUT", "Plugin package entry must be a relative .mjs path");
  }
  const { packageFormat, entry, ...manifest } = record;
  assertV3Manifest(manifest);
  return { ...manifest, packageFormat, entry } as PluginPackageManifest;
}

async function resolveEntry(rootPath: string, entry: string): Promise<string> {
  const candidate = resolve(rootPath, entry);
  if (isAbsolute(entry) || escapesRoot(rootPath, candidate)) {
    throw new CapabilityError("INVALID_INPUT", "Plugin package entry must remain inside the package directory", { entry });
  }
  let entryPath: string;
  try {
    entryPath = await realpath(candidate);
    const stats = await lstat(entryPath);
    if (!stats.isFile()) throw new Error("entry is not a file");
  } catch (error) {
    throw new CapabilityError("INVALID_INPUT", "Plugin package entry could not be opened", {
      entry,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  if (escapesRoot(rootPath, entryPath)) {
    throw new CapabilityError("INVALID_INPUT", "Plugin package entry symlink escapes the package directory", { entry });
  }
  return entryPath;
}

function escapesRoot(rootPath: string, candidate: string): boolean {
  const fromRoot = relative(rootPath, candidate);
  return fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot);
}

function freezeManifest(packageManifest: PluginPackageManifest): Readonly<PluginManifest> {
  const contributions = packageManifest.contributions
    ? Object.freeze({
        ...(packageManifest.contributions.panels ? { panels: Object.freeze([...packageManifest.contributions.panels]) } : {}),
        ...(packageManifest.contributions.tools ? { tools: Object.freeze([...packageManifest.contributions.tools]) } : {}),
        ...(packageManifest.contributions.processes ? { processes: Object.freeze([...packageManifest.contributions.processes]) } : {}),
      })
    : undefined;
  return Object.freeze({
    id: packageManifest.id,
    name: packageManifest.name,
    version: packageManifest.version,
    apiVersion: packageManifest.apiVersion,
    permissions: Object.freeze([...packageManifest.permissions]),
    ...(contributions ? { contributions } : {}),
  });
}
