export * from "./index";
export * from "./dom-transformer";
export * from "./overlay-projection";
export * from "./overlay-layer";
export * from "./overlay-builtins";
export * from "@pixi-board/adapter-browser";

import {
  BrowserPersistenceAdapter,
  NativeDownloadPort,
  NativeIndexedDbPort,
  NativeObjectUrlPort,
  NativeOpfsPort,
} from "@pixi-board/adapter-browser";

export function indexedDbPersistence(options: { database?: string } = {}): BrowserPersistenceAdapter {
  return new BrowserPersistenceAdapter({
    indexedDb: new NativeIndexedDbPort({ databaseName: options.database }),
    opfs: new NativeOpfsPort(),
    objectUrls: new NativeObjectUrlPort(),
    download: new NativeDownloadPort(),
  });
}

export * from "./connections";
export * from "./node-agent";

// Advanced browser hosts can share the same registry, geometry and Pixi runtime
// as the facade without importing private workspace packages.
export { NodeTypeRegistry, rotatedRectBounds } from "@pixi-board/core";
export { createPixiApplicationFactory, loadPixiRuntime, PixiBoardRenderer } from "@pixi-board/renderer-pixi";
