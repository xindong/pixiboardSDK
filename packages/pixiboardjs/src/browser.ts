export * from "./index";
export * from "@pixi-board/adapter-browser";

import {
  BrowserPersistenceAdapter,
  NativeIndexedDbPort,
  NativeObjectUrlPort,
  NativeOpfsPort,
} from "@pixi-board/adapter-browser";

export function indexedDbPersistence(options: { database?: string } = {}): BrowserPersistenceAdapter {
  return new BrowserPersistenceAdapter({
    indexedDb: new NativeIndexedDbPort({ databaseName: options.database }),
    opfs: new NativeOpfsPort(),
    objectUrls: new NativeObjectUrlPort(),
  });
}

