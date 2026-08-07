import type { AssetRecord, BoardDocument } from "@pixi-board/core";
import {
  BrowserAssetBinaryMissingError,
  BrowserAssetNotFoundError,
  BrowserPersistenceAbortError,
  BrowserPersistenceDestroyedError,
  BrowserStorageKeyCollisionError,
} from "./errors";
import { NativeObjectUrlPort } from "./object-url-port";
import type {
  AdapterOperationOptions,
  AssetBinaryVariant,
  AssetGcOptions,
  AssetGcResult,
  BrowserAsset,
  BrowserCleanupError,
  BrowserCleanupOperation,
  BrowserDocumentRecord,
  BrowserPersistenceAdapterOptions,
  GetAssetOptions,
  ObjectUrlLease,
  PutAssetOptions,
  PortLifecycle,
  SaveBrowserDocumentInput,
  StoredAssetBinary,
  StoredAssetEntry,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_OPFS_THRESHOLD_BYTES = 1024 * 1024;

type LeaseState = {
  assetId: string;
  variant: AssetBinaryVariant;
  url: string;
  revoked: boolean;
};

function collect(values: Iterable<string> | undefined, target: Set<string>): void {
  if (values === undefined) return;
  for (const value of values) target.add(value);
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function documentAssetIds(document: BoardDocument | undefined): Set<string> {
  const ids = new Set<string>();
  if (document === undefined) return ids;
  for (const node of document.nodes) {
    for (const reference of Object.values(node.assetRefs ?? {})) ids.add(reference.assetId);
  }
  return ids;
}

function safeAssetId(assetId: string): string {
  return assetId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "asset";
}

function randomStorageToken(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class BrowserPersistenceAdapter {
  readonly #indexedDb: BrowserPersistenceAdapterOptions["indexedDb"];
  readonly #opfs: BrowserPersistenceAdapterOptions["opfs"];
  readonly #objectUrls: NonNullable<BrowserPersistenceAdapterOptions["objectUrls"]>;
  readonly #now: () => number;
  readonly #storageKeyFactory: (assetId: string, variant: AssetBinaryVariant) => string;
  readonly #opfsThresholdBytes: number;
  readonly #defaultGcQuarantineMs: number;
  readonly #onCleanupError: (record: BrowserCleanupError) => void;
  readonly #abortController = new AbortController();
  readonly #leasesByAsset = new Map<string, Set<LeaseState>>();
  readonly #cleanupErrors: BrowserCleanupError[] = [];
  #destroyed = false;
  #destroyPromise?: Promise<void>;

  constructor(options: BrowserPersistenceAdapterOptions) {
    this.#indexedDb = options.indexedDb;
    this.#opfs = options.opfs;
    this.#objectUrls = options.objectUrls ?? new NativeObjectUrlPort();
    this.#now = options.now ?? Date.now;
    this.#storageKeyFactory = options.storageKeyFactory ?? ((assetId, variant) =>
      `${safeAssetId(assetId)}-${safeAssetId(variant)}-${randomStorageToken()}`
    );
    this.#opfsThresholdBytes = options.opfsThresholdBytes ?? DEFAULT_OPFS_THRESHOLD_BYTES;
    this.#defaultGcQuarantineMs = options.defaultGcQuarantineMs ?? DAY_MS;
    this.#onCleanupError = options.onCleanupError ?? (() => undefined);
  }

  get signal(): AbortSignal {
    return this.#abortController.signal;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  get cleanupErrors(): readonly BrowserCleanupError[] {
    return this.#cleanupErrors.map((record) => ({ ...record }));
  }

  async load(options: AdapterOperationOptions = {}): Promise<BoardDocument | null> {
    return (await this.loadDocument(options))?.snapshot ?? null;
  }

  async save(document: BoardDocument, options: AdapterOperationOptions = {}): Promise<void> {
    await this.saveDocument({ snapshot: document }, options);
  }

  async loadDocument(options: AdapterOperationOptions = {}): Promise<BrowserDocumentRecord | null> {
    return this.#run(options.signal, async (signal) => {
      const record = await this.#indexedDb.loadDocument(signal);
      this.#throwIfAborted(signal);
      return record === undefined ? null : cloneValue(record);
    });
  }

  async saveDocument(
    input: SaveBrowserDocumentInput,
    options: AdapterOperationOptions = {},
  ): Promise<void> {
    await this.#run(options.signal, async (signal) => {
      const record: BrowserDocumentRecord = {
        snapshot: cloneValue(input.snapshot),
        metadata: cloneValue(input.metadata ?? {}),
        savedAt: this.#now(),
      };
      this.#throwIfAborted(signal);
      await this.#indexedDb.saveDocument(record, signal);
    });
  }

  async putAsset(record: AssetRecord, blob: Blob, options: PutAssetOptions = {}): Promise<StoredAssetEntry> {
    return this.#run(options.signal, async (signal) => {
      const variant = options.variant ?? "original";
      const previous = await this.#indexedDb.getAssetEntry(record.id, signal);
      const previousBinary = previous?.binaries[variant];
      this.#throwIfAborted(signal);
      const now = this.#now();
      const preferOpfs = options.preferOpfs ?? blob.size >= this.#opfsThresholdBytes;
      const useOpfs = preferOpfs &&
        this.#opfs !== undefined &&
        await this.#opfs.isAvailable(signal);
      this.#throwIfAborted(signal);

      let entry: StoredAssetEntry;
      if (useOpfs && this.#opfs !== undefined) {
        const key = this.#storageKeyFactory(record.id, variant);
        if (previousBinary?.storage.kind === "opfs" && previousBinary.storage.key === key) {
          throw new BrowserStorageKeyCollisionError(key);
        }
        if (await this.#opfs.get(key, signal) !== undefined) {
          throw new BrowserStorageKeyCollisionError(key);
        }
        entry = this.#createEntry(cloneValue(record), variant, blob, { kind: "opfs", key }, previous, now);
        await this.#opfs.put(key, blob, signal);
        try {
          this.#throwIfAborted(signal);
          await this.#indexedDb.putAssetEntry(entry, { variant, blob }, signal);
        } catch (error) {
          await this.#cleanup(
            "metadata-compensation",
            { assetId: record.id, variant, key },
            () => this.#opfs?.delete(key, new AbortController().signal),
          );
          throw error;
        }
      } else {
        entry = this.#createEntry(cloneValue(record), variant, blob, { kind: "indexeddb" }, previous, now);
        this.#throwIfAborted(signal);
        await this.#indexedDb.putAssetEntry(entry, { variant, blob }, signal);
      }

      this.#revokeAssetLeases(record.id, variant);
      const binary = entry.binaries[variant];
      if (previousBinary?.storage.kind === "opfs" &&
        (binary.storage.kind !== "opfs" || binary.storage.key !== previousBinary.storage.key)) {
        const previousKey = previousBinary.storage.key;
        await this.#cleanup(
          "replace-old-opfs",
          { assetId: record.id, variant, key: previousKey },
          () => this.#opfs?.delete(previousKey, new AbortController().signal),
        );
      }
      return cloneValue(entry);
    });
  }

  async putDerivative(
    assetId: string,
    variant: Exclude<AssetBinaryVariant, "original">,
    blob: Blob,
    options: Omit<PutAssetOptions, "variant"> = {},
  ): Promise<StoredAssetEntry> {
    const entry = await this.#run(options.signal, (signal) => this.#indexedDb.getAssetEntry(assetId, signal));
    if (entry === undefined) throw new BrowserAssetNotFoundError(assetId);
    return this.putAsset(entry.record, blob, { ...options, variant });
  }

  async getAsset(id: string, options: GetAssetOptions = {}): Promise<BrowserAsset | null> {
    return this.#run(options.signal, async (signal) => {
      const variant = options.variant ?? "original";
      const entry = await this.#indexedDb.getAssetEntry(id, signal);
      this.#throwIfAborted(signal);
      if (entry === undefined) return null;
      const binary = entry.binaries[variant];
      if (binary === undefined) return null;
      const blob = binary.storage.kind === "opfs"
        ? await this.#opfs?.get(binary.storage.key, signal)
        : await this.#indexedDb.getAssetBlob(id, variant, signal);
      this.#throwIfAborted(signal);
      if (blob === undefined) throw new BrowserAssetBinaryMissingError(id, variant);
      const clonedEntry = cloneValue(entry);
      return { entry: clonedEntry, variant, binary: clonedEntry.binaries[variant], blob };
    });
  }

  async resolveAsset(
    id: string,
    variant: AssetBinaryVariant = "original",
    options: AdapterOperationOptions = {},
  ): Promise<BrowserAsset | null> {
    return this.getAsset(id, { ...options, variant });
  }

  async listAssets(options: AdapterOperationOptions = {}): Promise<StoredAssetEntry[]> {
    return this.#run(options.signal, async (signal) => {
      const entries = await this.#indexedDb.listAssetEntries(signal);
      this.#throwIfAborted(signal);
      return cloneValue(entries).sort((left, right) => left.id.localeCompare(right.id));
    });
  }

  async deleteAsset(id: string, options: AdapterOperationOptions = {}): Promise<boolean> {
    return this.#run(options.signal, async (signal) => {
      const entry = await this.#indexedDb.getAssetEntry(id, signal);
      this.#throwIfAborted(signal);
      if (entry === undefined) return false;
      await this.#indexedDb.deleteAssetEntry(entry, signal);
      this.#revokeAssetLeases(id);
      for (const binary of Object.values(entry.binaries)) {
        if (binary.storage.kind === "opfs") {
          const key = binary.storage.key;
          await this.#cleanup(
            "delete-opfs",
            { assetId: id, key },
            () => this.#opfs?.delete(key, new AbortController().signal),
          );
        }
      }
      return true;
    });
  }

  async leaseObjectUrl(id: string, options: GetAssetOptions = {}): Promise<ObjectUrlLease> {
    return this.#run(options.signal, async (signal) => {
      const variant = options.variant ?? "original";
      const asset = await this.getAsset(id, { signal, variant });
      this.#throwIfAborted(signal);
      if (asset === null) throw new BrowserAssetNotFoundError(id);
      const state: LeaseState = {
        assetId: id,
        variant,
        url: this.#objectUrls.create(asset.blob),
        revoked: false,
      };
      const leases = this.#leasesByAsset.get(id) ?? new Set<LeaseState>();
      leases.add(state);
      this.#leasesByAsset.set(id, leases);
      return {
        get assetId() { return state.assetId; },
        get variant() { return state.variant; },
        get url() { return state.url; },
        get revoked() { return state.revoked; },
        revoke: () => this.#revokeLease(state),
      };
    });
  }

  async collectAssetGarbage(options: AssetGcOptions = {}): Promise<AssetGcResult> {
    return this.#run(options.signal, async (signal) => {
      const document = await this.#indexedDb.loadDocument(signal);
      const entries = await this.#indexedDb.listAssetEntries(signal);
      this.#throwIfAborted(signal);
      const roots = documentAssetIds(document?.snapshot);
      collect(options.assetIds, roots);
      collect(options.historyAssetIds, roots);
      collect(options.activeJobAssetIds, roots);
      collect(options.explicitLeaseAssetIds, roots);
      collect(this.#leasesByAsset.keys(), roots);

      const now = options.now ?? this.#now();
      const quarantineMs = options.quarantineMs ?? this.#defaultGcQuarantineMs;
      const result: AssetGcResult = {
        roots: [...roots].sort(),
        retained: [],
        quarantined: [],
        restored: [],
        deleted: [],
      };

      for (const entry of entries.sort((left, right) => left.id.localeCompare(right.id))) {
        this.#throwIfAborted(signal);
        if (roots.has(entry.id)) {
          result.retained.push(entry.id);
          if (entry.quarantinedAt !== undefined) {
            const restored = { ...entry };
            delete restored.quarantinedAt;
            await this.#indexedDb.putAssetEntry(restored, undefined, signal);
            result.restored.push(entry.id);
          }
          continue;
        }

        if (entry.quarantinedAt === undefined) {
          await this.#indexedDb.putAssetEntry({ ...entry, quarantinedAt: now }, undefined, signal);
          result.quarantined.push(entry.id);
          continue;
        }

        if (now - entry.quarantinedAt < quarantineMs) {
          result.retained.push(entry.id);
          continue;
        }

        await this.#indexedDb.deleteAssetEntry(entry, signal);
        this.#revokeAssetLeases(entry.id);
        for (const binary of Object.values(entry.binaries)) {
          if (binary.storage.kind === "opfs") {
            const key = binary.storage.key;
            await this.#cleanup(
              "gc-opfs",
              { assetId: entry.id, key },
              () => this.#opfs?.delete(key, new AbortController().signal),
            );
          }
        }
        result.deleted.push(entry.id);
      }
      return result;
    });
  }

  destroy(): Promise<void> {
    if (this.#destroyPromise !== undefined) return this.#destroyPromise;
    this.#destroyed = true;
    this.#abortController.abort(new BrowserPersistenceDestroyedError());
    for (const leases of [...this.#leasesByAsset.values()]) {
      for (const lease of [...leases]) this.#revokeLease(lease);
    }
    this.#leasesByAsset.clear();
    const ports: Array<{ name: "indexeddb" | "opfs" | "object-urls"; port: PortLifecycle | undefined }> = [
      { name: "indexeddb", port: this.#indexedDb },
      { name: "opfs", port: this.#opfs },
      { name: "object-urls", port: this.#objectUrls },
    ];
    const seen = new Set<PortLifecycle>();
    this.#destroyPromise = Promise.all(ports.map(async ({ name, port }) => {
      if (port === undefined || seen.has(port)) return;
      seen.add(port);
      const dispose = port.destroy ?? port.close;
      if (dispose === undefined) return;
      await this.#cleanup(
        "destroy-port",
        { port: name },
        () => Promise.resolve(dispose.call(port)),
      );
    })).then(() => undefined);
    return this.#destroyPromise;
  }

  #createEntry(
    record: AssetRecord,
    variant: AssetBinaryVariant,
    blob: Blob,
    storage: StoredAssetBinary["storage"],
    previous: StoredAssetEntry | undefined,
    now: number,
  ): StoredAssetEntry {
    return {
      id: record.id,
      record,
      binaries: {
        ...previous?.binaries,
        [variant]: {
          storage,
          size: blob.size,
          mimeType: blob.type,
          updatedAt: now,
        },
      },
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
  }

  async #run<T>(externalSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#destroyed) throw new BrowserPersistenceDestroyedError();
    const controller = new AbortController();
    const abort = (source: AbortSignal) => controller.abort(source.reason);
    const onInstanceAbort = () => abort(this.signal);
    const onExternalAbort = () => externalSignal && abort(externalSignal);
    this.signal.addEventListener("abort", onInstanceAbort, { once: true });
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    if (this.signal.aborted) abort(this.signal);
    if (externalSignal?.aborted) abort(externalSignal);

    try {
      this.#throwIfAborted(controller.signal);
      return await operation(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw new BrowserPersistenceAbortError(controller.signal.reason);
      throw error;
    } finally {
      this.signal.removeEventListener("abort", onInstanceAbort);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  #throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new BrowserPersistenceAbortError(signal.reason);
  }

  #revokeAssetLeases(assetId: string, variant?: AssetBinaryVariant): void {
    const leases = this.#leasesByAsset.get(assetId);
    if (leases === undefined) return;
    for (const lease of [...leases]) {
      if (variant === undefined || lease.variant === variant) this.#revokeLease(lease);
    }
  }

  #revokeLease(state: LeaseState): void {
    if (state.revoked) return;
    state.revoked = true;
    this.#objectUrls.revoke(state.url);
    const leases = this.#leasesByAsset.get(state.assetId);
    leases?.delete(state);
    if (leases?.size === 0) this.#leasesByAsset.delete(state.assetId);
  }

  async #cleanup(
    operation: BrowserCleanupOperation,
    context: Omit<BrowserCleanupError, "operation" | "error" | "timestamp">,
    cleanup: () => Promise<void> | undefined,
  ): Promise<void> {
    try {
      await cleanup();
    } catch (error) {
      const record: BrowserCleanupError = {
        operation,
        error,
        timestamp: this.#now(),
        ...context,
      };
      this.#cleanupErrors.push(record);
      try {
        this.#onCleanupError({ ...record });
      } catch (observerError) {
        this.#cleanupErrors.push({
          operation: "cleanup-observer",
          error: observerError,
          timestamp: this.#now(),
        });
      }
    }
  }
}
