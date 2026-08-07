import type { OpfsPort } from "./types";

type StorageManagerWithDirectory = StorageManager & {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
};

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException(String(signal.reason ?? "The operation was aborted"), "AbortError");
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

export type NativeOpfsPortOptions = {
  directoryName?: string;
  getRootDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

export class NativeOpfsPort implements OpfsPort {
  readonly #directoryName: string;
  readonly #getRootDirectory: () => Promise<FileSystemDirectoryHandle>;
  #directory?: Promise<FileSystemDirectoryHandle>;

  constructor(options: NativeOpfsPortOptions = {}) {
    this.#directoryName = options.directoryName ?? "pixiboardjs-assets";
    this.#getRootDirectory = options.getRootDirectory ?? (() => {
      const storage = globalThis.navigator?.storage as StorageManagerWithDirectory | undefined;
      if (typeof storage?.getDirectory !== "function") {
        throw new Error("OPFS is not available in this environment");
      }
      return storage.getDirectory();
    });
  }

  async isAvailable(signal: AbortSignal): Promise<boolean> {
    try {
      throwIfAborted(signal);
      await this.#getDirectory();
      throwIfAborted(signal);
      return true;
    } catch (error) {
      if (signal.aborted) throw error;
      return false;
    }
  }

  async get(key: string, signal: AbortSignal): Promise<Blob | undefined> {
    throwIfAborted(signal);
    try {
      const handle = await (await this.#getDirectory()).getFileHandle(key);
      const file = await handle.getFile();
      throwIfAborted(signal);
      return file;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async put(key: string, blob: Blob, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const directory = await this.#getDirectory();
    const handle = await directory.getFileHandle(key, { create: true });
    const writable = await handle.createWritable();
    try {
      throwIfAborted(signal);
      await writable.write(blob);
      throwIfAborted(signal);
      await writable.close();
    } catch (error) {
      await writable.abort(error).catch(() => undefined);
      await directory.removeEntry(key).catch(() => undefined);
      throw error;
    }
  }

  async delete(key: string, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    try {
      await (await this.#getDirectory()).removeEntry(key);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    throwIfAborted(signal);
  }

  async #getDirectory(): Promise<FileSystemDirectoryHandle> {
    if (this.#directory === undefined) {
      this.#directory = this.#getRootDirectory().then((root) =>
        root.getDirectoryHandle(this.#directoryName, { create: true }),
      );
    }
    const opening = this.#directory;
    try {
      return await opening;
    } catch (error) {
      if (this.#directory === opening) this.#directory = undefined;
      throw error;
    }
  }
}
