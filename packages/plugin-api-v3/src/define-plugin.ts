import {
  definePlugin as definePublicPlugin,
  type PluginDeveloperContract,
  type PluginManifest,
  type TypedPluginContext,
} from "@pixi-board/plugin-sdk";
import type { PluginDefinition } from "./index.ts";

export type { PluginDeveloperContract, TypedPluginContext } from "@pixi-board/plugin-sdk";

export function definePlugin<Manifest extends PluginManifest>(
  definition: PluginDeveloperContract<Manifest>,
): PluginDefinition & { readonly manifest: Readonly<Manifest> } {
  return definePublicPlugin(definition) as unknown as PluginDefinition & {
    readonly manifest: Readonly<Manifest>;
  };
}
