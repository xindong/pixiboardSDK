import { BrowserDocumentConflictError } from "../src/errors";
import type {
  AssetBinaryVariant,
  BrowserDocumentRecord,
  BrowserDownloadRequest,
  DownloadPort,
  IndexedDbPort,
  ObjectUrlPort,
  OpfsPort,
  SaveBrowserDocumentOptions,
  StoredAssetEntry,
} from "../src/types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function blobKey(id: string, variant: AssetBinaryVariant): string {
  return `${id}::${variant}`;
}

export class MemoryBrowserStorage {
  document?: BrowserDocumentRecord;
  readonly entries = new Map<string, StoredAssetEntry>();
  readonly indexedDbBlobs = new Map<string, Blob>();
  readonly opfsBlobs = new Map<string, Blob>();
  readonly downloads: BrowserDownloadRequest[] = [];
}

export class MemoryIndexedDbContractPort implements IndexedDbPort {
  constructor(readonly storage: MemoryBrowserStorage) {}

  async loadDocument(signal: AbortSignal): Promise<BrowserDocumentRecord | undefined> {
    signal.throwIfAborted();
    return this.storage.document === undefined ? undefined : clone(this.storage.document);
  }

  async saveDocument(
    record: BrowserDocumentRecord,
    signal: AbortSignal,
    options: SaveBrowserDocumentOptions = {},
  ): Promise<void> {
    signal.throwIfAborted();
    this.#assertRevision(options);
    this.storage.document = clone(record);
  }

  async getAssetEntry(id: string, signal: AbortSignal): Promise<StoredAssetEntry | undefined> {
    signal.throwIfAborted();
    const entry = this.storage.entries.get(id);
    return entry === undefined ? undefined : clone(entry);
  }

  async listAssetEntries(signal: AbortSignal): Promise<StoredAssetEntry[]> {
    signal.throwIfAborted();
    return [...this.storage.entries.values()].map(clone);
  }

  async getAssetBlob(
    id: string,
    variant: AssetBinaryVariant,
    signal: AbortSignal,
  ): Promise<Blob | undefined> {
    signal.throwIfAborted();
    return this.storage.indexedDbBlobs.get(blobKey(id, variant));
  }

  async putAssetEntry(
    entry: StoredAssetEntry,
    binaryWrite: { variant: AssetBinaryVariant; blob: Blob } | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const current = this.storage.entries.get(entry.id);
    const committed = current === undefined
      ? clone(entry)
      : clone({ ...entry, binaries: { ...current.binaries, ...entry.binaries } });
    this.storage.entries.set(entry.id, committed);
    this.#writeBlob(committed, binaryWrite);
  }

  async commitAssetAndDocument(
    document: BrowserDocumentRecord,
    entry: StoredAssetEntry,
    binaryWrite: { variant: AssetBinaryVariant; blob: Blob } | undefined,
    signal: AbortSignal,
    options: SaveBrowserDocumentOptions = {},
  ): Promise<void> {
    signal.throwIfAborted();
    this.#assertRevision(options);
    const nextDocument = clone(document);
    const current = this.storage.entries.get(entry.id);
    const committed = current === undefined
      ? clone(entry)
      : clone({ ...entry, binaries: { ...current.binaries, ...entry.binaries } });
    this.storage.document = nextDocument;
    this.storage.entries.set(entry.id, committed);
    this.#writeBlob(committed, binaryWrite);
  }

  async deleteAssetEntry(entry: StoredAssetEntry, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.storage.entries.delete(entry.id);
    for (const variant of Object.keys(entry.binaries)) {
      this.storage.indexedDbBlobs.delete(blobKey(entry.id, variant as AssetBinaryVariant));
    }
  }

  #assertRevision(options: SaveBrowserDocumentOptions): void {
    const actualRevision = this.storage.document?.snapshot.revision ?? null;
    if (options.expectedRevision !== undefined && options.expectedRevision !== actualRevision) {
      throw new BrowserDocumentConflictError(options.expectedRevision, actualRevision);
    }
  }

  #writeBlob(
    entry: StoredAssetEntry,
    binaryWrite: { variant: AssetBinaryVariant; blob: Blob } | undefined,
  ): void {
    if (binaryWrite === undefined) return;
    const key = blobKey(entry.id, binaryWrite.variant);
    if (entry.binaries[binaryWrite.variant].storage.kind === "opfs") {
      this.storage.indexedDbBlobs.delete(key);
    } else {
      this.storage.indexedDbBlobs.set(key, binaryWrite.blob);
    }
  }
}

export class MemoryOpfsContractPort implements OpfsPort {
  constructor(readonly storage: MemoryBrowserStorage) {}

  async isAvailable(signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    return true;
  }

  async get(key: string, signal: AbortSignal): Promise<Blob | undefined> {
    signal.throwIfAborted();
    return this.storage.opfsBlobs.get(key);
  }

  async put(key: string, blob: Blob, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.storage.opfsBlobs.set(key, blob);
  }

  async delete(key: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.storage.opfsBlobs.delete(key);
  }
}

export class MemoryObjectUrlContractPort implements ObjectUrlPort {
  readonly active = new Set<string>();
  #next = 0;

  create(): string {
    const url = `blob:memory-contract-${++this.#next}`;
    this.active.add(url);
    return url;
  }

  revoke(url: string): void {
    this.active.delete(url);
  }
}

export class MemoryDownloadContractPort implements DownloadPort {
  constructor(readonly storage: MemoryBrowserStorage) {}

  download(request: BrowserDownloadRequest): void {
    this.storage.downloads.push({ ...request });
  }
}
