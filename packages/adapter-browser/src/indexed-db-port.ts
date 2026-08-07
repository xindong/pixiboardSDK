import type {
  AssetBinaryVariant,
  BrowserDocumentRecord,
  IndexedDbPort,
  SaveBrowserDocumentOptions,
  StoredAssetEntry,
} from "./types";
import { BrowserDocumentConflictError, BrowserStorageCapabilityError } from "./errors";

const DOCUMENT_STORE = "documents";
const ASSET_STORE = "asset-metadata";
const BLOB_STORE = "asset-blobs";
const DOCUMENT_KEY = "current";

function blobKey(id: string, variant: AssetBinaryVariant): IDBValidKey {
  return [id, variant];
}

function abortError(signal: AbortSignal): DOMException {
  return new DOMException(String(signal.reason ?? "The operation was aborted"), "AbortError");
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbortSignal = () => transaction.abort();
    const cleanup = () => signal.removeEventListener("abort", onAbortSignal);

    signal.addEventListener("abort", onAbortSignal, { once: true });
    transaction.addEventListener("complete", () => {
      cleanup();
      resolve();
    }, { once: true });
    transaction.addEventListener("abort", () => {
      cleanup();
      reject(signal.aborted ? abortError(signal) : transaction.error);
    }, { once: true });
    transaction.addEventListener("error", () => {
      cleanup();
      reject(transaction.error);
    }, { once: true });
  });
}

export type NativeIndexedDbPortOptions = {
  databaseName?: string;
  indexedDb?: IDBFactory | null;
};

export class NativeIndexedDbPort implements IndexedDbPort {
  readonly #databaseName: string;
  readonly #indexedDb: IDBFactory;
  #database?: Promise<IDBDatabase>;

  constructor(options: NativeIndexedDbPortOptions = {}) {
    this.#databaseName = options.databaseName ?? "pixiboardjs";
    const factory = Object.prototype.hasOwnProperty.call(options, "indexedDb")
      ? options.indexedDb
      : globalThis.indexedDB;
    if (factory === undefined || factory === null) {
      throw new BrowserStorageCapabilityError("indexeddb");
    }
    this.#indexedDb = factory;
  }

  async loadDocument(signal: AbortSignal): Promise<BrowserDocumentRecord | undefined> {
    return this.#read<BrowserDocumentRecord>(DOCUMENT_STORE, DOCUMENT_KEY, signal);
  }

  async saveDocument(
    record: BrowserDocumentRecord,
    signal: AbortSignal,
    options: SaveBrowserDocumentOptions = {},
  ): Promise<void> {
    const database = await this.#open(signal);
    if (signal.aborted) throw abortError(signal);
    const transaction = database.transaction(DOCUMENT_STORE, "readwrite");
    const done = transactionDone(transaction, signal);
    try {
      if (options.expectedRevision !== undefined) {
        const current = await requestResult(
          transaction.objectStore(DOCUMENT_STORE).get(DOCUMENT_KEY),
        ) as BrowserDocumentRecord | undefined;
        const actualRevision = current?.snapshot.revision ?? null;
        if (actualRevision !== options.expectedRevision) {
          transaction.abort();
          await done.catch(() => undefined);
          throw new BrowserDocumentConflictError(options.expectedRevision, actualRevision);
        }
      }
      transaction.objectStore(DOCUMENT_STORE).put(record, DOCUMENT_KEY);
      await done;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be committed or aborted.
      }
      await done.catch(() => undefined);
      throw error;
    }
  }

  async getAssetEntry(id: string, signal: AbortSignal): Promise<StoredAssetEntry | undefined> {
    return this.#read<StoredAssetEntry>(ASSET_STORE, id, signal);
  }

  async listAssetEntries(signal: AbortSignal): Promise<StoredAssetEntry[]> {
    const database = await this.#open(signal);
    const transaction = database.transaction(ASSET_STORE, "readonly");
    const done = transactionDone(transaction, signal);
    const [entries] = await Promise.all([
      requestResult(transaction.objectStore(ASSET_STORE).getAll()) as Promise<StoredAssetEntry[]>,
      done,
    ]);
    return entries;
  }

  async getAssetBlob(
    id: string,
    variant: AssetBinaryVariant,
    signal: AbortSignal,
  ): Promise<Blob | undefined> {
    return this.#read<Blob>(BLOB_STORE, blobKey(id, variant), signal);
  }

  async putAssetEntry(
    entry: StoredAssetEntry,
    binaryWrite: { variant: AssetBinaryVariant; blob: Blob } | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    await this.#write([ASSET_STORE, BLOB_STORE], signal, (transaction) => {
      transaction.objectStore(ASSET_STORE).put(entry, entry.id);
      if (binaryWrite !== undefined) {
        const blobs = transaction.objectStore(BLOB_STORE);
        const binary = entry.binaries[binaryWrite.variant];
        const key = blobKey(entry.id, binaryWrite.variant);
        if (binary?.storage.kind === "opfs") {
          blobs.delete(key);
        } else {
          blobs.put(binaryWrite.blob, key);
        }
      }
    });
  }

  async commitAssetAndDocument(
    document: BrowserDocumentRecord,
    entry: StoredAssetEntry,
    binaryWrite: { variant: AssetBinaryVariant; blob: Blob } | undefined,
    signal: AbortSignal,
    options: SaveBrowserDocumentOptions = {},
  ): Promise<void> {
    const database = await this.#open(signal);
    if (signal.aborted) throw abortError(signal);
    const transaction = database.transaction(
      [DOCUMENT_STORE, ASSET_STORE, BLOB_STORE],
      "readwrite",
    );
    const done = transactionDone(transaction, signal);
    try {
      const documents = transaction.objectStore(DOCUMENT_STORE);
      if (options.expectedRevision !== undefined) {
        const current = await requestResult(documents.get(DOCUMENT_KEY)) as
          | BrowserDocumentRecord
          | undefined;
        const actualRevision = current?.snapshot.revision ?? null;
        if (actualRevision !== options.expectedRevision) {
          transaction.abort();
          await done.catch(() => undefined);
          throw new BrowserDocumentConflictError(options.expectedRevision, actualRevision);
        }
      }

      const assets = transaction.objectStore(ASSET_STORE);
      const currentEntry = await requestResult(assets.get(entry.id)) as StoredAssetEntry | undefined;
      const committedEntry: StoredAssetEntry = currentEntry === undefined
        ? entry
        : { ...entry, binaries: { ...currentEntry.binaries, ...entry.binaries } };
      documents.put(document, DOCUMENT_KEY);
      assets.put(committedEntry, committedEntry.id);
      if (binaryWrite !== undefined) {
        const blobs = transaction.objectStore(BLOB_STORE);
        const binary = committedEntry.binaries[binaryWrite.variant];
        const key = blobKey(committedEntry.id, binaryWrite.variant);
        if (binary?.storage.kind === "opfs") blobs.delete(key);
        else blobs.put(binaryWrite.blob, key);
      }
      await done;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be committed or aborted.
      }
      await done.catch(() => undefined);
      throw error;
    }
  }

  async deleteAssetEntry(entry: StoredAssetEntry, signal: AbortSignal): Promise<void> {
    await this.#write([ASSET_STORE, BLOB_STORE], signal, (transaction) => {
      transaction.objectStore(ASSET_STORE).delete(entry.id);
      const blobs = transaction.objectStore(BLOB_STORE);
      for (const variant of Object.keys(entry.binaries)) {
        blobs.delete(blobKey(entry.id, variant));
      }
    });
  }

  async close(): Promise<void> {
    const opening = this.#database;
    this.#database = undefined;
    if (opening === undefined) return;
    const database = await opening;
    database.close();
  }

  async #read<T>(storeName: string, key: IDBValidKey, signal: AbortSignal): Promise<T | undefined> {
    const database = await this.#open(signal);
    const transaction = database.transaction(storeName, "readonly");
    const done = transactionDone(transaction, signal);
    const [result] = await Promise.all([
      requestResult(transaction.objectStore(storeName).get(key)) as Promise<T | undefined>,
      done,
    ]);
    return result;
  }

  async #write(
    storeNames: string[],
    signal: AbortSignal,
    write: (transaction: IDBTransaction) => void,
  ): Promise<void> {
    const database = await this.#open(signal);
    if (signal.aborted) throw abortError(signal);
    const transaction = database.transaction(storeNames, "readwrite");
    const done = transactionDone(transaction, signal);
    write(transaction);
    await done;
  }

  async #open(signal: AbortSignal): Promise<IDBDatabase> {
    if (signal.aborted) throw abortError(signal);
    if (this.#database === undefined) {
      this.#database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.#indexedDb.open(this.#databaseName, 1);
        request.addEventListener("upgradeneeded", () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(DOCUMENT_STORE)) database.createObjectStore(DOCUMENT_STORE);
          if (!database.objectStoreNames.contains(ASSET_STORE)) database.createObjectStore(ASSET_STORE);
          if (!database.objectStoreNames.contains(BLOB_STORE)) database.createObjectStore(BLOB_STORE);
        });
        request.addEventListener("success", () => {
          request.result.addEventListener("versionchange", () => request.result.close());
          resolve(request.result);
        }, { once: true });
        request.addEventListener("error", () => reject(request.error), { once: true });
        request.addEventListener("blocked", () => reject(new Error(`IndexedDB open blocked: ${this.#databaseName}`)), { once: true });
      });
    }
    const opening = this.#database;
    let database: IDBDatabase;
    try {
      database = await opening;
    } catch (error) {
      if (this.#database === opening) this.#database = undefined;
      throw error;
    }
    if (signal.aborted) throw abortError(signal);
    return database;
  }
}
