import type { AssetRecord, BoardDocument } from "@pixi-board/core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPFS_THRESHOLD_BYTES,
  BrowserDocumentConflictError,
  BrowserPersistenceAdapter,
  BrowserPersistenceDestroyedError,
  BrowserStorageCapabilityError,
  BrowserStorageQuotaError,
  BrowserStorageKeyCollisionError,
  NativeIndexedDbPort,
  type BrowserDocumentRecord,
  type BrowserCleanupError,
  type AssetBinaryVariant,
  type IndexedDbPort,
  type ObjectUrlPort,
  type OpfsPort,
  type SaveBrowserDocumentOptions,
  type StoredAssetEntry,
} from "../src";

function clone<T>(value: T): T {
  return structuredClone(value);
}

class MemoryIndexedDbPort implements IndexedDbPort {
  document?: BrowserDocumentRecord;
  readonly entries = new Map<string, StoredAssetEntry>();
  readonly blobs = new Map<string, Blob>();
  failNextDocumentSave = false;
  quotaNextDocumentSave = false;
  failNextAssetPut = false;
  blockNextAssetPutUntilRelease = false;
  assetPutStarted?: Promise<void>;
  closeCalls = 0;
  #markAssetPutStarted?: () => void;
  #releaseAssetPut?: () => void;

  constructor() {
    this.resetAssetPutGate();
  }

  resetAssetPutGate(): void {
    this.assetPutStarted = new Promise<void>((resolve) => {
      this.#markAssetPutStarted = resolve;
    });
  }

  releaseAssetPut(): void {
    this.#releaseAssetPut?.();
  }

  async loadDocument(signal: AbortSignal): Promise<BrowserDocumentRecord | undefined> {
    signal.throwIfAborted();
    return this.document === undefined ? undefined : clone(this.document);
  }

  async saveDocument(
    record: BrowserDocumentRecord,
    signal: AbortSignal,
    options: SaveBrowserDocumentOptions = {},
  ): Promise<void> {
    signal.throwIfAborted();
    const actualRevision = this.document?.snapshot.revision ?? null;
    if (options.expectedRevision !== undefined && options.expectedRevision !== actualRevision) {
      throw new BrowserDocumentConflictError(options.expectedRevision, actualRevision);
    }
    if (this.quotaNextDocumentSave) {
      this.quotaNextDocumentSave = false;
      throw new DOMException("quota full", "QuotaExceededError");
    }
    if (this.failNextDocumentSave) {
      this.failNextDocumentSave = false;
      throw new Error("document transaction failed");
    }
    this.document = clone(record);
  }

  async getAssetEntry(id: string, signal: AbortSignal): Promise<StoredAssetEntry | undefined> {
    signal.throwIfAborted();
    const entry = this.entries.get(id);
    return entry === undefined ? undefined : clone(entry);
  }

  async listAssetEntries(signal: AbortSignal): Promise<StoredAssetEntry[]> {
    signal.throwIfAborted();
    return [...this.entries.values()].map(clone);
  }

  async getAssetBlob(
    id: string,
    variant: AssetBinaryVariant,
    signal: AbortSignal,
  ): Promise<Blob | undefined> {
    signal.throwIfAborted();
    return this.blobs.get(`${id}::${variant}`);
  }

  async putAssetEntry(
    entry: StoredAssetEntry,
    binaryWrite: { variant: AssetBinaryVariant; blob: Blob } | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    if (this.blockNextAssetPutUntilRelease) {
      this.blockNextAssetPutUntilRelease = false;
      this.#markAssetPutStarted?.();
      await new Promise<void>((resolve, reject) => {
        this.#releaseAssetPut = resolve;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      signal.throwIfAborted();
    }
    if (this.failNextAssetPut) {
      this.failNextAssetPut = false;
      throw new Error("asset transaction failed");
    }
    const nextEntries = new Map(this.entries);
    const nextBlobs = new Map(this.blobs);
    nextEntries.set(entry.id, clone(entry));
    if (binaryWrite !== undefined) {
      const key = `${entry.id}::${binaryWrite.variant}`;
      const binary = entry.binaries[binaryWrite.variant];
      if (binary.storage.kind === "opfs") nextBlobs.delete(key);
      else nextBlobs.set(key, binaryWrite.blob);
    }
    this.entries.clear();
    this.blobs.clear();
    for (const [id, value] of nextEntries) this.entries.set(id, value);
    for (const [id, value] of nextBlobs) this.blobs.set(id, value);
  }

  async deleteAssetEntry(entry: StoredAssetEntry, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.entries.delete(entry.id);
    for (const variant of Object.keys(entry.binaries)) this.blobs.delete(`${entry.id}::${variant}`);
  }

  close(): void {
    this.closeCalls += 1;
  }
}

class MemoryOpfsPort implements OpfsPort {
  available = true;
  readonly blobs = new Map<string, Blob>();
  readonly deletedKeys: string[] = [];
  readonly deleteAttempts: string[] = [];
  failNextDelete = false;
  destroyCalls = 0;
  blockNextPutUntilAbort = false;
  putStarted?: Promise<void>;
  #markPutStarted?: () => void;

  constructor() {
    this.resetPutStarted();
  }

  resetPutStarted(): void {
    this.putStarted = new Promise<void>((resolve) => {
      this.#markPutStarted = resolve;
    });
  }

  async isAvailable(signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    return this.available;
  }

  async get(key: string, signal: AbortSignal): Promise<Blob | undefined> {
    signal.throwIfAborted();
    return this.blobs.get(key);
  }

  async put(key: string, blob: Blob, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.#markPutStarted?.();
    if (this.blockNextPutUntilAbort) {
      this.blockNextPutUntilAbort = false;
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    signal.throwIfAborted();
    this.blobs.set(key, blob);
  }

  async delete(key: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.deleteAttempts.push(key);
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error(`OPFS delete failed: ${key}`);
    }
    this.deletedKeys.push(key);
    this.blobs.delete(key);
  }

  destroy(): void {
    this.destroyCalls += 1;
  }
}

class MemoryObjectUrlPort implements ObjectUrlPort {
  readonly created: string[] = [];
  readonly revoked: string[] = [];
  closeCalls = 0;

  create(): string {
    const url = `blob:memory-${this.created.length + 1}`;
    this.created.push(url);
    return url;
  }

  revoke(url: string): void {
    this.revoked.push(url);
  }

  close(): void {
    this.closeCalls += 1;
  }
}

function asset(id: string, kind = "image"): AssetRecord {
  return { id, kind };
}

function documentWithAssetIds(...assetIds: string[]): BoardDocument {
  return {
    schemaVersion: 1,
    revision: 1,
    assets: assetIds.map((id) => asset(id)),
    nodes: assetIds.map((id, index) => ({
      id: `node-${index}`,
      type: "media",
      typeVersion: 1,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      zIndex: index,
      assetRefs: { primary: { assetId: id } },
      props: {},
    })),
  };
}

function setup(options: {
  opfsAvailable?: boolean;
  now?: () => number;
  storageKeyFactory?: (id: string, variant: AssetBinaryVariant) => string;
  opfsThresholdBytes?: number;
  onCleanupError?: (record: BrowserCleanupError) => void;
} = {}) {
  const indexedDb = new MemoryIndexedDbPort();
  const opfs = new MemoryOpfsPort();
  const objectUrls = new MemoryObjectUrlPort();
  opfs.available = options.opfsAvailable ?? true;
  let key = 0;
  const adapter = new BrowserPersistenceAdapter({
    indexedDb,
    opfs,
    objectUrls,
    now: options.now ?? (() => 1000),
    storageKeyFactory: options.storageKeyFactory ?? ((id, variant) =>
      `${id}-${variant}-generation-${++key}`
    ),
    opfsThresholdBytes: options.opfsThresholdBytes ?? 0,
    onCleanupError: options.onCleanupError,
  });
  return { adapter, indexedDb, opfs, objectUrls };
}

describe("BrowserPersistenceAdapter contract", () => {
  it("round-trips document snapshot and metadata without replacing the previous commit on failure", async () => {
    const { adapter, indexedDb } = setup();
    const first = documentWithAssetIds("asset-1");
    const metadata = { projectId: "p-1" };
    const second = documentWithAssetIds("asset-2");

    await adapter.saveDocument({ snapshot: first, metadata });
    first.nodes[0].x = 999;
    metadata.projectId = "mutated-after-save";
    expect(await adapter.loadDocument()).toEqual({
      snapshot: documentWithAssetIds("asset-1"),
      metadata: { projectId: "p-1" },
      savedAt: 1000,
    });
    const loaded = await adapter.loadDocument();
    if (loaded === null) throw new Error("expected saved document");
    loaded.snapshot.nodes[0].x = 777;
    loaded.metadata.projectId = "mutated-after-load";
    expect(await adapter.load()).toEqual(documentWithAssetIds("asset-1"));

    indexedDb.failNextDocumentSave = true;
    await expect(adapter.saveDocument({ snapshot: second, metadata: { projectId: "p-2" } }))
      .rejects.toThrow("document transaction failed");
    expect(await adapter.loadDocument()).toMatchObject({
      snapshot: documentWithAssetIds("asset-1"),
      metadata: { projectId: "p-1" },
    });
  });

  it("allows only one stale browser instance to win a compare-and-swap race", async () => {
    const indexedDb = new MemoryIndexedDbPort();
    const first = new BrowserPersistenceAdapter({ indexedDb });
    const second = new BrowserPersistenceAdapter({ indexedDb });
    await first.saveDocument({ snapshot: documentWithAssetIds("base"), expectedRevision: null });
    const firstUpdate = documentWithAssetIds("first");
    firstUpdate.revision = 2;
    const secondUpdate = documentWithAssetIds("second");
    secondUpdate.revision = 2;

    const writes = await Promise.allSettled([
      first.saveDocument({ snapshot: firstUpdate, expectedRevision: 1 }),
      second.saveDocument({ snapshot: secondUpdate, expectedRevision: 1 }),
    ]);

    expect(writes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(writes.find(({ status }) => status === "rejected")).toMatchObject({
      status: "rejected",
      reason: {
        name: "BrowserDocumentConflictError",
        expectedRevision: 1,
        actualRevision: 2,
      },
    });
    expect([firstUpdate, secondUpdate]).toContainEqual(await second.load());
  });

  it("normalizes quota failures and permits a later retry", async () => {
    const { adapter, indexedDb } = setup();
    await adapter.save(documentWithAssetIds("committed"));
    indexedDb.quotaNextDocumentSave = true;

    await expect(adapter.save(documentWithAssetIds("too-large"))).rejects.toMatchObject({
      name: "BrowserStorageQuotaError",
      retryable: true,
    });
    expect(await adapter.load()).toEqual(documentWithAssetIds("committed"));
    await expect(adapter.save(documentWithAssetIds("recovered"))).resolves.toBeUndefined();
    expect(new BrowserStorageQuotaError().message).toBe("Browser storage quota was exceeded");
  });

  it("uses OPFS generations, resolves assets, and compensates an IndexedDB metadata failure", async () => {
    const { adapter, indexedDb, opfs, objectUrls } = setup();
    const originalBlob = new Blob(["original"], { type: "image/png" });
    const original = await adapter.putAsset(asset("hero"), originalBlob);
    expect(original.binaries.original.storage).toEqual({
      kind: "opfs",
      key: "hero-original-generation-1",
    });
    expect(indexedDb.blobs.has("hero::original")).toBe(false);
    await adapter.putDerivative("hero", "preview", new Blob(["preview"], { type: "image/webp" }));
    expect(await (await adapter.getAsset("hero"))?.blob.text()).toBe("original");
    expect(await (await adapter.resolveAsset("hero", "preview"))?.blob.text()).toBe("preview");
    expect((await adapter.listAssets()).map(({ id }) => id)).toEqual(["hero"]);

    const lease = await adapter.leaseObjectUrl("hero");
    indexedDb.failNextAssetPut = true;
    await expect(adapter.putAsset(asset("hero"), new Blob(["failed replacement"])))
      .rejects.toThrow("asset transaction failed");
    expect(indexedDb.entries.get("hero")?.binaries.original.storage).toEqual({
      kind: "opfs",
      key: "hero-original-generation-1",
    });
    expect(await opfs.blobs.get("hero-original-generation-1")?.text()).toBe("original");
    expect(opfs.blobs.has("hero-original-generation-3")).toBe(false);
    expect(opfs.deletedKeys).toContain("hero-original-generation-3");
    expect(lease.revoked).toBe(false);

    await adapter.putAsset(asset("hero"), new Blob(["replacement"]));
    expect(lease.revoked).toBe(true);
    expect(objectUrls.revoked).toEqual([lease.url]);
    expect(opfs.blobs.has("hero-original-generation-1")).toBe(false);
    expect(opfs.deletedKeys).toContain("hero-original-generation-1");
    expect(await (await adapter.getAsset("hero"))?.blob.text()).toBe("replacement");
    expect(await (await adapter.getAsset("hero", { variant: "preview" }))?.blob.text()).toBe("preview");
  });

  it("rejects a reused OPFS generation key before it can overwrite the previous commit", async () => {
    const { adapter, indexedDb, opfs } = setup({
      storageKeyFactory: () => "shared-generation",
    });
    await adapter.putAsset(asset("hero"), new Blob(["stable"]));
    indexedDb.failNextAssetPut = true;

    await expect(adapter.putAsset(asset("hero"), new Blob(["replacement"])))
      .rejects.toBeInstanceOf(BrowserStorageKeyCollisionError);
    expect(await opfs.blobs.get("shared-generation")?.text()).toBe("stable");
    expect(indexedDb.entries.get("hero")?.binaries.original.storage).toEqual({
      kind: "opfs",
      key: "shared-generation",
    });
    expect(await (await adapter.getAsset("hero"))?.blob.text()).toBe("stable");
  });

  it("falls back to an atomic IndexedDB Blob write when OPFS is unavailable", async () => {
    const { adapter, indexedDb } = setup({ opfsAvailable: false });
    const blob = new Blob(["fallback"], { type: "video/mp4" });

    const entry = await adapter.putAsset(asset("video", "video"), blob);
    expect(entry.binaries.original.storage).toEqual({ kind: "indexeddb" });
    expect(await indexedDb.blobs.get("video::original")?.text()).toBe("fallback");
    expect(await (await adapter.getAsset("video"))?.blob.text()).toBe("fallback");

    const previousEntry = clone(indexedDb.entries.get("video"));
    indexedDb.failNextAssetPut = true;
    await expect(adapter.putAsset(asset("video", "changed-kind"), new Blob(["not committed"])))
      .rejects.toThrow("asset transaction failed");
    expect(indexedDb.entries.get("video")).toEqual(previousEntry);
    expect(await indexedDb.blobs.get("video::original")?.text()).toBe("fallback");
  });

  it("uses the default 1 MiB threshold for small Blob fallback and large OPFS storage", async () => {
    const indexedDb = new MemoryIndexedDbPort();
    const opfs = new MemoryOpfsPort();
    const adapter = new BrowserPersistenceAdapter({
      indexedDb,
      opfs,
      objectUrls: new MemoryObjectUrlPort(),
      storageKeyFactory: (id, variant) => `${id}-${variant}-large`,
    });

    const small = await adapter.putAsset(asset("small"), new Blob(["small"]));
    const large = await adapter.putAsset(
      asset("large"),
      new Blob([new Uint8Array(DEFAULT_OPFS_THRESHOLD_BYTES)]),
    );

    expect(small.binaries.original.storage).toEqual({ kind: "indexeddb" });
    expect(await indexedDb.blobs.get("small::original")?.text()).toBe("small");
    expect(large.binaries.original.storage).toEqual({ kind: "opfs", key: "large-original-large" });
    expect(opfs.blobs.get("large-original-large")?.size).toBe(DEFAULT_OPFS_THRESHOLD_BYTES);
    await adapter.destroy();
  });

  it("honors caller cancellation and aborts an in-flight write through the instance signal", async () => {
    const { adapter, indexedDb, opfs } = setup();
    const caller = new AbortController();
    caller.abort("cancelled by caller");
    await expect(adapter.putAsset(asset("cancelled"), new Blob(["x"]), { signal: caller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(indexedDb.entries.has("cancelled")).toBe(false);

    opfs.blockNextPutUntilAbort = true;
    opfs.resetPutStarted();
    const pending = adapter.putAsset(asset("in-flight"), new Blob(["pending"]));
    await opfs.putStarted;
    const destroying = adapter.destroy();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await destroying;
    expect(adapter.signal.aborted).toBe(true);
    expect(indexedDb.entries.has("in-flight")).toBe(false);

    const late = setup({ opfsAvailable: false });
    late.indexedDb.blockNextAssetPutUntilRelease = true;
    late.indexedDb.resetAssetPutGate();
    const pendingMetadata = late.adapter.putAsset(asset("late-metadata"), new Blob(["pending"]));
    await late.indexedDb.assetPutStarted;
    const lateDestroy = late.adapter.destroy();
    late.indexedDb.releaseAssetPut();
    await expect(pendingMetadata).rejects.toMatchObject({ name: "AbortError" });
    await lateDestroy;
    expect(late.indexedDb.entries.has("late-metadata")).toBe(false);
    expect(late.indexedDb.blobs.has("late-metadata::original")).toBe(false);
  });

  it("revokes every asset URL lease after delete and removes metadata and binary", async () => {
    const { adapter, indexedDb, opfs, objectUrls } = setup();
    const entry = await adapter.putAsset(asset("delete-me"), new Blob(["binary"]));
    const first = await adapter.leaseObjectUrl("delete-me");
    const second = await adapter.leaseObjectUrl("delete-me");

    expect(await adapter.deleteAsset("delete-me")).toBe(true);
    expect(first.revoked).toBe(true);
    expect(second.revoked).toBe(true);
    expect(objectUrls.revoked).toEqual([first.url, second.url]);
    expect(indexedDb.entries.has("delete-me")).toBe(false);
    const original = entry.binaries.original;
    expect(opfs.blobs.has(original.storage.kind === "opfs" ? original.storage.key : "")).toBe(false);
    expect(await adapter.getAsset("delete-me")).toBeNull();
    expect(await adapter.deleteAsset("delete-me")).toBe(false);
  });

  it("records delete and GC OPFS cleanup failures and reports them through onCleanupError", async () => {
    const reported: BrowserCleanupError[] = [];
    const deleted = setup({ onCleanupError: (record) => reported.push(record) });
    const deleteEntry = await deleted.adapter.putAsset(asset("delete-cleanup"), new Blob(["delete"]));
    const deleteKey = deleteEntry.binaries.original.storage;
    if (deleteKey.kind !== "opfs") throw new Error("expected OPFS asset");
    deleted.opfs.failNextDelete = true;

    expect(await deleted.adapter.deleteAsset("delete-cleanup")).toBe(true);
    expect(deleted.opfs.blobs.has(deleteKey.key)).toBe(true);
    expect(deleted.adapter.cleanupErrors).toMatchObject([{
      operation: "delete-opfs",
      assetId: "delete-cleanup",
      key: deleteKey.key,
    }]);
    expect(reported).toHaveLength(1);
    expect(reported[0].operation).toBe("delete-opfs");

    const collected = setup();
    const gcEntry = await collected.adapter.putAsset(asset("gc-cleanup"), new Blob(["gc"]));
    const gcKey = gcEntry.binaries.original.storage;
    if (gcKey.kind !== "opfs") throw new Error("expected OPFS asset");
    await collected.adapter.collectAssetGarbage({ now: 100, quarantineMs: 0 });
    collected.opfs.failNextDelete = true;

    const result = await collected.adapter.collectAssetGarbage({ now: 101, quarantineMs: 0 });
    expect(result.deleted).toEqual(["gc-cleanup"]);
    expect(collected.indexedDb.entries.has("gc-cleanup")).toBe(false);
    expect(collected.opfs.blobs.has(gcKey.key)).toBe(true);
    expect(collected.adapter.cleanupErrors).toMatchObject([{
      operation: "gc-opfs",
      assetId: "gc-cleanup",
      key: gcKey.key,
    }]);
    expect(reported.map(({ operation }) => operation)).toEqual(["delete-opfs"]);
  });

  it("quarantines then prunes unreferenced assets while retaining document, job, history, explicit, and URL roots", async () => {
    const { adapter, indexedDb } = setup({ opfsAvailable: false });
    for (const id of ["document", "history", "job", "explicit", "leased", "stale", "revived"]) {
      await adapter.putAsset(asset(id), new Blob([id]));
    }
    await adapter.save(documentWithAssetIds("document"));
    const lease = await adapter.leaseObjectUrl("leased");

    const first = await adapter.collectAssetGarbage({
      historyAssetIds: ["history"],
      activeJobAssetIds: ["job"],
      explicitLeaseAssetIds: ["explicit"],
      now: 100,
      quarantineMs: 10,
    });
    expect(first.roots).toEqual(["document", "explicit", "history", "job", "leased"]);
    expect(first.quarantined).toEqual(["revived", "stale"]);

    const restored = await adapter.collectAssetGarbage({ assetIds: ["revived"], now: 105, quarantineMs: 10 });
    expect(restored.restored).toEqual(["revived"]);
    expect(indexedDb.entries.get("revived")?.quarantinedAt).toBeUndefined();

    const pruned = await adapter.collectAssetGarbage({ assetIds: ["revived"], now: 110, quarantineMs: 10 });
    expect(pruned.deleted).toEqual(["stale"]);
    expect(indexedDb.entries.has("stale")).toBe(false);
    expect(indexedDb.entries.has("leased")).toBe(true);
    expect(lease.revoked).toBe(false);
  });

  it("releases URLs, closes ports on destroy, and rejects every later operation", async () => {
    const { adapter, indexedDb, opfs, objectUrls } = setup();
    await adapter.putAsset(asset("asset"), new Blob(["asset"]));
    const released = await adapter.leaseObjectUrl("asset");
    const active = await adapter.leaseObjectUrl("asset");

    released.revoke();
    released.revoke();
    expect(released.revoked).toBe(true);
    expect(active.revoked).toBe(false);

    const firstDestroy = adapter.destroy();
    const secondDestroy = adapter.destroy();
    expect(secondDestroy).toBe(firstDestroy);
    await firstDestroy;
    expect(active.revoked).toBe(true);
    expect(objectUrls.revoked).toEqual([released.url, active.url]);
    expect(indexedDb.closeCalls).toBe(1);
    expect(opfs.destroyCalls).toBe(1);
    expect(objectUrls.closeCalls).toBe(1);
    expect(adapter.destroyed).toBe(true);
    await expect(adapter.load()).rejects.toBeInstanceOf(BrowserPersistenceDestroyedError);
    await expect(adapter.putAsset(asset("late"), new Blob(["late"])))
      .rejects.toBeInstanceOf(BrowserPersistenceDestroyedError);
    await expect(adapter.listAssets()).rejects.toBeInstanceOf(BrowserPersistenceDestroyedError);
    await expect(adapter.deleteAsset("asset")).rejects.toBeInstanceOf(BrowserPersistenceDestroyedError);
    await expect(adapter.collectAssetGarbage()).rejects.toBeInstanceOf(BrowserPersistenceDestroyedError);
  });

  it("throws a stable capability error when IndexedDB is unavailable", () => {
    expect(() => new NativeIndexedDbPort({ indexedDb: null }))
      .toThrow(BrowserStorageCapabilityError);
    expect(() => new NativeIndexedDbPort({ indexedDb: null }))
      .toThrow("Browser storage capability is unavailable: indexeddb");
  });
});
