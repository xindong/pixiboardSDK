import type { AssetRecord, BoardDocument } from "@pixi-board/core";
import { defineAdapterContractSuite, type AdapterContractHarness, type ContractAsset } from "@pixi-board/adapter-contract-tests";
import { describe, expect, it } from "vitest";
import { TauriAdapterDestroyedError, TauriAdapterHost } from "../src";

type ProjectState = { document: BoardDocument | null; assets: Map<string, AssetRecord>; derivatives: Set<string> };

class TauriTestPort {
  readonly projects = new Map<string, ProjectState>();
  readonly acquired: string[] = [];
  readonly released: string[] = [];
  readonly cancelled: string[] = [];
  failNextSave = false;
  blockSave = false;
  #releaseBlockedSave?: () => void;

  async invoke<Result>(command: string, args: Record<string, unknown> = {}): Promise<Result> {
    const context = args.context as { projectRoot: string; leaseId: string; requestId: string } | undefined;
    if (command === "pixiboard_sdk_project_acquire") {
      const projectRoot = String(args.projectRoot);
      if (!this.projects.has(projectRoot)) this.projects.set(projectRoot, { document: null, assets: new Map(), derivatives: new Set() });
      this.acquired.push(String(args.leaseId));
      return undefined as Result;
    }
    if (command === "pixiboard_sdk_project_release") {
      this.released.push(String(args.leaseId));
      return undefined as Result;
    }
    if (command === "pixiboard_sdk_operation_cancel") {
      this.cancelled.push(context?.requestId ?? "unknown");
      this.#releaseBlockedSave?.();
      return undefined as Result;
    }
    if (!context) throw { code: "INVALID_INPUT", message: "missing context" };
    const project = this.projects.get(context.projectRoot);
    if (!project) throw { code: "STALE_LEASE", message: "unknown project" };
    if (command === "pixiboard_sdk_document_load") return structuredClone(project.document) as Result;
    if (command === "pixiboard_sdk_document_save") {
      if (this.failNextSave) { this.failNextSave = false; throw { code: "UNAVAILABLE", message: "disk busy", retryable: true }; }
      if (this.blockSave) {
        this.blockSave = false;
        await new Promise<void>((resolve) => { this.#releaseBlockedSave = resolve; });
      }
      project.document = structuredClone(args.document as BoardDocument);
      return undefined as Result;
    }
    if (command === "pixiboard_sdk_asset_get") return project.assets.get(String(args.id)) ?? null as Result;
    if (command === "pixiboard_sdk_asset_put") {
      for (const record of args.records as AssetRecord[]) project.assets.set(record.id, structuredClone(record));
      return undefined as Result;
    }
    if (command === "pixiboard_sdk_asset_delete") {
      for (const id of args.ids as string[]) project.assets.delete(id);
      return undefined as Result;
    }
    if (command === "pixiboard_sdk_asset_import") return { id: "imported", kind: "file" } as Result;
    if (command === "pixiboard_sdk_asset_resolve") {
      const id = String(args.id);
      if (!project.assets.has(id)) return null as Result;
      return `asset://${id}/${String(args.variant)}` as Result;
    }
    if (command === "pixiboard_sdk_derivative_put") {
      const id = String(args.assetId);
      if (!project.assets.has(id)) throw { code: "NOT_FOUND", message: id };
      project.derivatives.add(`${id}:${String(args.variant)}`);
      return project.assets.get(id) as Result;
    }
    if (command === "pixiboard_sdk_dialog_pick_files") return [] as Result;
    if (command === "pixiboard_sdk_download_asset") return `/tmp/${String(args.assetId)}` as Result;
    if (command === "pixiboard_sdk_reveal_project" || command === "pixiboard_sdk_reveal_asset") return undefined as Result;
    if (command === "pixiboard_sdk_process_run") return { code: 0, stdout: "", stderr: "" } as Result;
    throw { code: "UNAVAILABLE", message: `unknown command ${command}` };
  }
}

async function createHarness(): Promise<AdapterContractHarness> {
  const port = new TauriTestPort();
  const host = new TauriAdapterHost({ invoke: port.invoke.bind(port), convertFileSrc: (path) => `tauri://${path}`, idFactory: (() => { let id = 0; return () => `lease-${++id}`; })() });
  const lease = await host.acquire({ boardId: "contract", projectRoot: "project-contract" });
  const bytes = new Map<string, Uint8Array>();
  const contract = {
    capabilities: lease.capabilities,
    document: lease.document,
    assets: {
      put: async (record: AssetRecord, payload: Uint8Array, options: { signal?: AbortSignal } = {}) => { bytes.set(record.id, payload.slice()); await lease.assets.metadata.put([record], options); },
      get: async (id: string, options: { signal?: AbortSignal } = {}): Promise<ContractAsset | null> => { const record = await lease.assets.metadata.get(id, options); return record ? { record, variant: "original", bytes: bytes.get(id)?.slice() ?? new Uint8Array(), mimeType: "application/octet-stream" } : null; },
      delete: async (id: string, options: { signal?: AbortSignal } = {}) => { const exists = (await lease.assets.metadata.get(id, options)) !== null; await lease.assets.metadata.delete([id], options); return exists; },
      resolve: (id: string, variant: "original" | "preview" | "waveform" = "original", options: { signal?: AbortSignal } = {}) => lease.assets.resolver.resolve(id, variant, options),
    },
    derivatives: {
      put: async (id: string, variant: "preview" | "waveform", payload: Uint8Array, mimeType: string, options: { signal?: AbortSignal } = {}) => { bytes.set(id, payload.slice()); await lease.derivatives.put({ assetId: id, variant, bytes: payload, mimeType }, options); },
    },
    destroy: () => lease.destroy(),
  };
  return { adapter: contract, failNextSave: () => { port.failNextSave = true; } };
}

defineAdapterContractSuite("tauri", createHarness);

describe("TauriAdapterHost", () => {
  it("keeps per-board leases isolated and switches by destroying the old lease first", async () => {
    const port = new TauriTestPort();
    const host = new TauriAdapterHost({ invoke: port.invoke.bind(port), idFactory: (() => { let id = 0; return () => `lease-${++id}`; })() });
    const first = await host.acquire({ boardId: "board-a", projectRoot: "project-a" });
    const second = await host.acquire({ boardId: "board-b", projectRoot: "project-b" });
    expect(host.activeBoardIds).toEqual(["board-a", "board-b"]);
    const switched = await host.switchProject({ boardId: "board-a", projectRoot: "project-c" });
    expect(first.leaseId).not.toBe(switched.leaseId);
    expect(port.released).toContain(first.leaseId);
    expect(host.activeBoardIds).toEqual(["board-b", "board-a"]);
    await expect(first.document.load()).rejects.toBeInstanceOf(TauriAdapterDestroyedError);
    await second.destroy();
    await switched.destroy();
  });

  it("cancels an in-flight operation and sends a backend cancellation token", async () => {
    const port = new TauriTestPort();
    const host = new TauriAdapterHost({ invoke: port.invoke.bind(port), idFactory: () => "lease-cancel" });
    const lease = await host.acquire({ boardId: "cancel", projectRoot: "project-cancel" });
    port.blockSave = true;
    const controller = new AbortController();
    const pending = lease.document.save({ schemaVersion: 1, revision: 1, nodes: [], assets: [] }, { signal: controller.signal });
    controller.abort("switch");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(port.cancelled).toHaveLength(1);
    await lease.destroy();
  });

  it("maps structured Tauri errors into stable adapter categories", async () => {
    const port = new TauriTestPort();
    const host = new TauriAdapterHost({ invoke: port.invoke.bind(port), idFactory: () => "lease-errors" });
    const lease = await host.acquire({ boardId: "errors", projectRoot: "project-errors" });
    await expect(lease.assets.metadata.get("missing")).resolves.toBeNull();
    await expect(lease.derivatives.put({ assetId: "missing", variant: "preview", bytes: new Uint8Array(), mimeType: "" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await lease.destroy();
  });
});
