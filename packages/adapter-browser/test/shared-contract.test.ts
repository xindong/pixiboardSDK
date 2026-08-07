import type { AssetRecord, BoardDocument } from "@pixi-board/core";
import { defineAdapterContractSuite, type AdapterContractHarness, type ContractAsset } from "@pixi-board/adapter-contract-tests";
import { BrowserPersistenceAdapter, type BrowserDocumentRecord, type IndexedDbPort, type ObjectUrlPort, type OpfsPort, type StoredAssetEntry } from "../src";

function clone<T>(value: T): T { return structuredClone(value); }

class MemoryIndexedDb implements IndexedDbPort {
  document?: BrowserDocumentRecord;
  readonly entries = new Map<string, StoredAssetEntry>();
  readonly blobs = new Map<string, Blob>();
  failNextSave = false;

  async loadDocument(signal: AbortSignal): Promise<BrowserDocumentRecord | undefined> { signal.throwIfAborted(); return this.document && clone(this.document); }
  async saveDocument(record: BrowserDocumentRecord, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.failNextSave) { this.failNextSave = false; throw Object.assign(new Error("quota"), { name: "QuotaExceededError" }); }
    this.document = clone(record);
  }
  async getAssetEntry(id: string, signal: AbortSignal): Promise<StoredAssetEntry | undefined> { signal.throwIfAborted(); return this.entries.get(id) && clone(this.entries.get(id)!); }
  async listAssetEntries(signal: AbortSignal): Promise<StoredAssetEntry[]> { signal.throwIfAborted(); return [...this.entries.values()].map(clone); }
  async getAssetBlob(id: string, variant: "original" | "preview" | "waveform", signal: AbortSignal): Promise<Blob | undefined> { signal.throwIfAborted(); return this.blobs.get(`${id}:${variant}`); }
  async putAssetEntry(entry: StoredAssetEntry, binaryWrite: { variant: "original" | "preview" | "waveform"; blob: Blob } | undefined, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.entries.set(entry.id, clone(entry));
    if (binaryWrite) this.blobs.set(`${entry.id}:${binaryWrite.variant}`, binaryWrite.blob);
  }
  async deleteAssetEntry(entry: StoredAssetEntry, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.entries.delete(entry.id);
    for (const variant of Object.keys(entry.binaries)) this.blobs.delete(`${entry.id}:${variant}`);
  }
}

class MemoryOpfs implements OpfsPort {
  readonly blobs = new Map<string, Blob>();
  async isAvailable(signal: AbortSignal): Promise<boolean> { signal.throwIfAborted(); return false; }
  async get(key: string, signal: AbortSignal): Promise<Blob | undefined> { signal.throwIfAborted(); return this.blobs.get(key); }
  async put(key: string, blob: Blob, signal: AbortSignal): Promise<void> { signal.throwIfAborted(); this.blobs.set(key, blob); }
  async delete(key: string, signal: AbortSignal): Promise<void> { signal.throwIfAborted(); this.blobs.delete(key); }
}

class MemoryUrls implements ObjectUrlPort {
  #next = 0;
  readonly revoked: string[] = [];
  create(): string { return `blob:contract-${++this.#next}`; }
  revoke(url: string): void { this.revoked.push(url); }
}

async function createBrowserHarness(): Promise<AdapterContractHarness> {
  const indexedDb = new MemoryIndexedDb();
  const objectUrls = new MemoryUrls();
  const adapter = new BrowserPersistenceAdapter({ indexedDb, opfs: new MemoryOpfs(), objectUrls });
  const leases: Array<{ revoke(): void }> = [];
  const contract = {
    capabilities: new Set(["document.persistence", "assets.metadata", "assets.import", "assets.resolve", "derivatives"]),
    document: {
      load: (options: { signal?: AbortSignal } = {}) => adapter.load(options),
      save: (document: BoardDocument, options: { signal?: AbortSignal } = {}) => adapter.save(document, options),
    },
    assets: {
      put: async (record: AssetRecord, bytes: Uint8Array, options: { signal?: AbortSignal } = {}) => { await adapter.putAsset(record, new Blob([bytes], { type: "application/octet-stream" }), options); },
      get: async (id: string, options: { signal?: AbortSignal } = {}): Promise<ContractAsset | null> => {
        const asset = await adapter.getAsset(id, options);
        if (!asset) return null;
        return { record: asset.entry.record, variant: asset.variant, bytes: new Uint8Array(await asset.blob.arrayBuffer()), mimeType: asset.blob.type };
      },
      delete: (id: string, options: { signal?: AbortSignal } = {}) => adapter.deleteAsset(id, options),
      resolve: async (id: string, variant: "original" | "preview" | "waveform" = "original", options: { signal?: AbortSignal } = {}) => {
        const lease = await adapter.leaseObjectUrl(id, { ...options, variant });
        leases.push(lease);
        return lease.url;
      },
    },
    derivatives: {
      put: async (id: string, variant: "preview" | "waveform", bytes: Uint8Array, mimeType: string, options: { signal?: AbortSignal } = {}) => {
        await adapter.putDerivative(id, variant, new Blob([bytes], { type: mimeType }), options);
      },
    },
    destroy: async () => { for (const lease of leases) lease.revoke(); await adapter.destroy(); },
  };
  return { adapter: contract, failNextSave: () => { indexedDb.failNextSave = true; } };
}

defineAdapterContractSuite("browser", createBrowserHarness);
