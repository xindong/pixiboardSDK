import type { AssetRecord, BoardDocument } from "@pixi-board/core";
import { describe, expect, it } from "vitest";
import {
  BrowserStorageKeyCollisionError,
  BrowserPersistenceAdapter,
  BrowserPersistenceDestroyedError,
  type BrowserDocumentRecord,
  type AssetBinaryVariant,
  type IndexedDbPort,
  type ObjectUrlPort,
  type OpfsPort,
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
  failNextAssetPut = false;

  async loadDocument(signal: AbortSignal): Promise<BrowserDocumentRecord | undefined> {
    signal.throwIfAborted();
    return this.document === undefined ? undefined : clone(this.document);
  }

  async saveDocument(record: BrowserDocumentRecord, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
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
}

class MemoryOpfsPort implements OpfsPort {
  available = true;
  readonly blobs = new Map<string, Blob>();
  readonly deletedKeys: string[] = [];
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
    this.deletedKeys.push(key);
    this.blobs.delete(key);
  }
}

class MemoryObjectUrlPort implements ObjectUrlPort {
  readonly created: string[] = [];
  readonly revoked: string[] = [];

  create(): string {
    const url = `blob:memory-${this.created.length + 1}`;
    this.created.push(url);
    return url;
  }

  revoke(url: string): void {
    this.revoked.push(url);
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
    opfsThresholdBytes: 0,
  });
  return { adapter, indexedDb, opfs, objectUrls };
}

describe("BrowserPersistenceAdapter contract", () => {
  it("round-trips document snapshot and metadata without replacing the previous commit on failure", async () => {
    const { adapter, indexedDb } = setup();
    const first = documentWithAssetIds("asset-1");
    const second = documentWithAssetIds("asset-2");

    await adapter.saveDocument({ snapshot: first, metadata: { projectId: "p-1" } });
    expect(await adapter.loadDocument()).toEqual({
      snapshot: first,
      metadata: { projectId: "p-1" },
      savedAt: 1000,
    });
    expect(await adapter.load()).toEqual(first);

    indexedDb.failNextDocumentSave = true;
    await expect(adapter.saveDocument({ snapshot: second, metadata: { projectId: "p-2" } }))
      .rejects.toThrow("document transaction failed");
    expect(await adapter.loadDocument()).toMatchObject({ snapshot: first, metadata: { projectId: "p-1" } });
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
    expect(lease.revoked).toBe(false);

    await adapter.putAsset(asset("hero"), new Blob(["replacement"]));
    expect(lease.revoked).toBe(true);
    expect(objectUrls.revoked).toEqual([lease.url]);
    expect(opfs.blobs.has("hero-original-generation-1")).toBe(false);
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

    indexedDb.failNextAssetPut = true;
    await expect(adapter.putAsset(asset("new"), new Blob(["not committed"])))
      .rejects.toThrow("asset transaction failed");
    expect(indexedDb.entries.has("new")).toBe(false);
    expect(indexedDb.blobs.has("new::original")).toBe(false);
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
    adapter.destroy();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(adapter.signal.aborted).toBe(true);
    expect(indexedDb.entries.has("in-flight")).toBe(false);
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

  it("releases URLs on destroy and rejects every later operation", async () => {
    const { adapter, objectUrls } = setup();
    await adapter.putAsset(asset("asset"), new Blob(["asset"]));
    const released = await adapter.leaseObjectUrl("asset");
    const active = await adapter.leaseObjectUrl("asset");

    released.revoke();
    released.revoke();
    expect(released.revoked).toBe(true);
    expect(active.revoked).toBe(false);

    adapter.destroy();
    adapter.destroy();
    expect(active.revoked).toBe(true);
    expect(objectUrls.revoked).toEqual([released.url, active.url]);
    expect(adapter.destroyed).toBe(true);
    await expect(adapter.load()).rejects.toBeInstanceOf(BrowserPersistenceDestroyedError);
    await expect(adapter.putAsset(asset("late"), new Blob(["late"])))
      .rejects.toBeInstanceOf(BrowserPersistenceDestroyedError);
    await expect(adapter.listAssets()).rejects.toBeInstanceOf(BrowserPersistenceDestroyedError);
    await expect(adapter.deleteAsset("asset")).rejects.toBeInstanceOf(BrowserPersistenceDestroyedError);
    await expect(adapter.collectAssetGarbage()).rejects.toBeInstanceOf(BrowserPersistenceDestroyedError);
  });
});
