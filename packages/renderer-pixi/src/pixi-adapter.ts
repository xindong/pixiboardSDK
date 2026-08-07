import type { AssetRef, BoardNode } from "@pixi-board/core";
import type { PixiApplicationFactory, PixiRuntimeModule, PixiViewFactory } from "./types";

export async function loadPixiRuntime(): Promise<PixiRuntimeModule> {
  return (await import("pixi.js")) as unknown as PixiRuntimeModule;
}

export function createPixiApplicationFactory(options: Record<string, unknown> = {}): PixiApplicationFactory {
  return async () => {
    const pixi = await loadPixiRuntime();
    return new pixi.Application() as any;
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
    createImage: (ref: AssetRef | undefined) => new pixi.Sprite(ref ? pixi.Texture.from(ref.assetId) : undefined),
    createText: (text, style) => new pixi.Text({ text, style }),
  };
}
