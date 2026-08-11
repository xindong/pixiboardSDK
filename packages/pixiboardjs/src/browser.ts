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
