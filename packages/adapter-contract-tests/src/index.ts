import type { AssetRecord, BoardDocument } from "@pixi-board/core";
import { describe, expect, it } from "vitest";

export type ContractVariant = "original" | "preview" | "waveform";

export type ContractAsset = {
  record: AssetRecord;
  variant: ContractVariant;
  bytes: Uint8Array;
  mimeType: string;
};

export type AdapterContract = {
  readonly capabilities: ReadonlySet<string>;
  readonly document: {
    load(options?: { signal?: AbortSignal }): Promise<BoardDocument | null>;
    save(document: BoardDocument, options?: { signal?: AbortSignal }): Promise<void>;
  };
  readonly assets: {
    put(record: AssetRecord, bytes: Uint8Array, options?: { signal?: AbortSignal }): Promise<void>;
    get(id: string, options?: { signal?: AbortSignal }): Promise<ContractAsset | null>;
    delete(id: string, options?: { signal?: AbortSignal }): Promise<boolean>;
    resolve(id: string, variant?: ContractVariant, options?: { signal?: AbortSignal }): Promise<string | null>;
  };
  readonly derivatives: {
    put(id: string, variant: Exclude<ContractVariant, "original">, bytes: Uint8Array, mimeType: string, options?: { signal?: AbortSignal }): Promise<void>;
  };
  destroy(): Promise<void>;
};

export type AdapterContractHarness = {
  readonly adapter: AdapterContract;
  readonly failNextSave?: () => void;
};

export type ContractFactory = () => Promise<AdapterContractHarness> | AdapterContractHarness;

export function boardDocument(assetId = "asset-1"): BoardDocument {
  return {
    schemaVersion: 1,
    revision: 1,
    assets: [{ id: assetId, kind: "image" }],
    nodes: [{
      id: "node-1",
      type: "media",
      typeVersion: 1,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      zIndex: 0,
      assetRefs: { primary: { assetId } },
      props: {},
    }],
  };
}

export function defineAdapterContractSuite(name: string, factory: ContractFactory): void {
  describe(`${name} adapter contract`, () => {
    it("round-trips documents and assets through narrow ports", async () => {
      const { adapter } = await factory();
      const document = boardDocument();
      await adapter.document.save(document);
      expect(await adapter.document.load()).toEqual(document);

      const bytes = new Uint8Array([1, 2, 3]);
      await adapter.assets.put({ id: "asset-1", kind: "image" }, bytes);
      expect(await adapter.assets.get("asset-1")).toMatchObject({
        record: { id: "asset-1", kind: "image" },
        variant: "original",
        bytes,
      });
      await adapter.derivatives.put("asset-1", "preview", new Uint8Array([4]), "image/webp");
      expect(await adapter.assets.resolve("asset-1", "preview")).toBeTypeOf("string");
      expect(await adapter.assets.delete("asset-1")).toBe(true);
      expect(await adapter.assets.get("asset-1")).toBeNull();
      await adapter.destroy();
    });

    it("maps cancellation and recovers from a retryable save failure", async () => {
      const { adapter, failNextSave } = await factory();
      const cancelled = new AbortController();
      cancelled.abort(new Error("contract cancellation"));
      await expect(adapter.document.load({ signal: cancelled.signal })).rejects.toMatchObject({
        name: "AbortError",
      });

      failNextSave?.();
      await expect(adapter.document.save(boardDocument("failed"))).rejects.toMatchObject({
        retryable: true,
      });
      await expect(adapter.document.save(boardDocument("recovered"))).resolves.toBeUndefined();
      await adapter.destroy();
    });

    it("negotiates the common capability set", async () => {
      const { adapter } = await factory();
      for (const capability of ["document.persistence", "assets.metadata", "assets.resolve", "derivatives"]) {
        expect(adapter.capabilities.has(capability)).toBe(true);
      }
      await adapter.destroy();
    });
  });
}
