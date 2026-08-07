import type { AssetRef, BoardNode } from "@pixi-board/core";
import type { PixiApplicationFactory, PixiRuntimeModule, PixiViewFactory } from "./types";

export async function loadPixiRuntime(): Promise<PixiRuntimeModule> {
  return (await import("pixi.js")) as unknown as PixiRuntimeModule;
}

export type PixiRuntimeLoader = () => Promise<PixiRuntimeModule>;

export function createPixiApplicationFactory(options: Record<string, unknown> = {}, runtimeLoader: PixiRuntimeLoader = loadPixiRuntime): PixiApplicationFactory {
  return async () => {
    const pixi = await runtimeLoader();
    return { ...(new pixi.Application() as any), initOptions: { ...options } };
  };
}

export function createPixiViewFactory(pixi: PixiRuntimeModule): PixiViewFactory {
  return {
    createContainer: () => new pixi.Container({ isRenderGroup: true }),
    createRect: (width, height, fill) => {
      const graphics = new pixi.Graphics();
      graphics.rect?.(0, 0, width, height).fill?.(fill);
      return graphics;
    },
    createImage: (_ref: AssetRef | undefined) => new pixi.Sprite(),
    createText: (text, style) => new pixi.Text({ text, style }),
  };
}
