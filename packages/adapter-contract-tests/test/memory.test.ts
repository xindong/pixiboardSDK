import type { AssetRecord, BoardDocument } from "@pixi-board/core";
import { defineAdapterContractSuite, type AdapterContractHarness, type ContractAsset } from "../src";

async function createMemoryHarness(): Promise<AdapterContractHarness> {
  let document: BoardDocument | null = null;
  let failNextSave = false;
  const assets = new Map<string, { record: AssetRecord; variants: Map<string, Uint8Array>; mimeTypes: Map<string, string> }>();
  let destroyed = false;
  const guard = (signal?: AbortSignal) => {
    if (destroyed) throw Object.assign(new Error("destroyed"), { name: "AbortError" });
    if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
  };
  const contract = {
    capabilities: new Set(["document.persistence", "assets.metadata", "assets.import", "assets.resolve", "derivatives"]),
    document: {
      async load(options: { signal?: AbortSignal } = {}) { guard(options.signal); return document && structuredClone(document); },
      async save(next: BoardDocument, options: { signal?: AbortSignal } = {}) {
        guard(options.signal);
        if (failNextSave) { failNextSave = false; throw Object.assign(new Error("retryable"), { retryable: true }); }
        document = structuredClone(next);
      },
    },
    assets: {
      async put(record: AssetRecord, bytes: Uint8Array, options: { signal?: AbortSignal } = {}) { guard(options.signal); assets.set(record.id, { record: structuredClone(record), variants: new Map([["original", bytes.slice()]]), mimeTypes: new Map([["original", "application/octet-stream"]]) }); },
      async get(id: string, options: { signal?: AbortSignal } = {}): Promise<ContractAsset | null> { guard(options.signal); const value = assets.get(id); if (!value) return null; return { record: structuredClone(value.record), variant: "original", bytes: value.variants.get("original")!.slice(), mimeType: "application/octet-stream" }; },
      async delete(id: string, options: { signal?: AbortSignal } = {}) { guard(options.signal); return assets.delete(id); },
      async resolve(id: string, variant: "original" | "preview" | "waveform" = "original", options: { signal?: AbortSignal } = {}) { guard(options.signal); return assets.get(id)?.variants.has(variant) ? `tauri://asset/${id}/${variant}` : null; },
    },
    derivatives: {
      async put(assetId: string, variant: "preview" | "waveform", bytes: Uint8Array, mimeType: string, options: { signal?: AbortSignal } = {}) { guard(options.signal); const value = assets.get(assetId); if (!value) throw Object.assign(new Error("not found"), { code: "NOT_FOUND" }); value.variants.set(variant, bytes.slice()); value.mimeTypes.set(variant, mimeType); },
    },
    async destroy() { destroyed = true; },
  };
  return { adapter: contract, failNextSave: () => { failNextSave = true; } };
}

defineAdapterContractSuite("memory", createMemoryHarness);
