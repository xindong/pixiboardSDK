import type { AssetRef, BoardNode } from "@pixi-board/core";
import type { PixiApplicationFactory, PixiRuntimeModule, PixiViewFactory } from "./types";

export async function loadPixiRuntime(): Promise<PixiRuntimeModule> {
  return (await import("pixi.js")) as unknown as PixiRuntimeModule;
}

export type PixiRuntimeLoader = () => Promise<PixiRuntimeModule>;

export function createPixiApplicationFactory(options: Record<string, unknown> = {}, runtimeLoader: PixiRuntimeLoader = loadPixiRuntime): PixiApplicationFactory {
  return async () => {
    const pixi = await runtimeLoader();
    const app = new pixi.Application() as any;
    Object.defineProperty(app, "initOptions", {
      // Pixi's TickerPlugin defaults to autoStart: true, which renders every
      // display frame forever regardless of whether the scene changed. The
      // renderer drives its own on-demand render loop (see
      // PixiBoardRenderer.requestFrame), so the ticker must start stopped;
      // callers can still opt back into continuous rendering explicitly.
      value: { autoStart: false, sharedTicker: false, ...options },
      configurable: true,
    });
    return app;
  };
}

export function createPixiViewFactory(pixi: PixiRuntimeModule): PixiViewFactory {
  return {
    createContainer: () => new pixi.Container({ isRenderGroup: true, sortableChildren: true }),
    createRect: (width, height, fill) => {
      const graphics = new pixi.Graphics();
      graphics.rect?.(0, 0, width, height).fill?.(fill);
      return graphics;
    },
    createImage: (_ref: AssetRef | undefined) => new pixi.Sprite(),
    createText: (text, style) => new pixi.Text({ text, style }),
  };
}
