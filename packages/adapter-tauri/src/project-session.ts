import type { AssetRecord, BoardDocument } from "@pixi-board/core";
import {
  TauriAdapterAbortError,
  TauriAdapterDestroyedError,
  TauriAdapterStaleLeaseError,
  mapTauriError,
} from "./errors";
import type {
  AcquireProjectOptions,
  PickFilesOptions,
  TauriAdapterOptions,
  TauriAssetPort,
  TauriCommandNames,
  TauriDerivativePort,
  TauriDialogPort,
  TauriDocumentPort,
  TauriDownloadPort,
  TauriHostFile,
  TauriInvoke,
  TauriOperationContext,
  TauriProcessPort,
  TauriProjectLease,
  TauriRevealPort,
} from "./types";

const DEFAULT_COMMANDS: TauriCommandNames = {
  acquireProject: "pixiboard_sdk_project_acquire",
  releaseProject: "pixiboard_sdk_project_release",
  cancelOperation: "pixiboard_sdk_operation_cancel",
  loadDocument: "pixiboard_sdk_document_load",
  saveDocument: "pixiboard_sdk_document_save",
  getAsset: "pixiboard_sdk_asset_get",
  putAssets: "pixiboard_sdk_asset_put",
  deleteAssets: "pixiboard_sdk_asset_delete",
  importAsset: "pixiboard_sdk_asset_import",
  resolveAsset: "pixiboard_sdk_asset_resolve",
  putDerivative: "pixiboard_sdk_derivative_put",
  pickFiles: "pixiboard_sdk_dialog_pick_files",
  downloadAsset: "pixiboard_sdk_download_asset",
  revealProject: "pixiboard_sdk_reveal_project",
  revealAsset: "pixiboard_sdk_reveal_asset",
  runProcess: "pixiboard_sdk_process_run",
};

type LeaseState = {
  boardId: string;
  projectRoot: string;
  leaseId: string;
  controller: AbortController;
  destroyed: boolean;
};

export class TauriAdapterHost {
  readonly #invoke: TauriInvoke;
  readonly #convertFileSrc: (path: string) => string;
  readonly #commands: TauriCommandNames;
  readonly #idFactory: () => string;
  readonly #leases = new Map<string, TauriProjectLeaseImpl>();

  constructor(options: TauriAdapterOptions) {
    this.#invoke = options.invoke;
    this.#convertFileSrc = options.convertFileSrc ?? ((path) => path);
    this.#commands = { ...DEFAULT_COMMANDS, ...options.commands };
    this.#idFactory = options.idFactory ?? (() => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  }

  get activeBoardIds(): readonly string[] { return [...this.#leases.keys()]; }

  async acquire(options: AcquireProjectOptions): Promise<TauriProjectLease> {
    const existing = this.#leases.get(options.boardId);
    if (existing) await existing.destroy();
    const state: LeaseState = {
      boardId: options.boardId,
      projectRoot: options.projectRoot,
      leaseId: this.#idFactory(),
      controller: new AbortController(),
      destroyed: false,
    };
    await this.#invoke(this.#commands.acquireProject, {
      boardId: state.boardId,
      projectRoot: state.projectRoot,
      leaseId: state.leaseId,
    }).catch((error) => { throw mapTauriError(error); });
    const lease = new TauriProjectLeaseImpl(this, state);
    this.#leases.set(state.boardId, lease);
    return lease;
  }

  async switchProject(options: AcquireProjectOptions): Promise<TauriProjectLease> {
    return this.acquire(options);
  }

  async destroy(): Promise<void> {
    await Promise.all([...this.#leases.values()].map((lease) => lease.destroy()));
    this.#leases.clear();
  }

  async invokeFor<T>(state: LeaseState, command: string, args: Record<string, unknown>, externalSignal?: AbortSignal): Promise<T> {
    if (state.destroyed) throw new TauriAdapterDestroyedError();
    const controller = new AbortController();
    const abort = (signal: AbortSignal) => { if (!controller.signal.aborted) controller.abort(signal.reason); };
    const onLeaseAbort = () => abort(state.controller.signal);
    const onExternalAbort = () => externalSignal && abort(externalSignal);
    state.controller.signal.addEventListener("abort", onLeaseAbort, { once: true });
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    if (state.controller.signal.aborted) abort(state.controller.signal);
    if (externalSignal?.aborted) abort(externalSignal);
    const context: TauriOperationContext = {
      boardId: state.boardId,
      projectRoot: state.projectRoot,
      leaseId: state.leaseId,
      requestId: this.#idFactory(),
    };
    if (controller.signal.aborted) {
      void this.#invoke(this.#commands.cancelOperation, { context }).catch(() => undefined);
      throw new TauriAdapterAbortError(controller.signal.reason);
    }
    const operation = this.#invoke(command, { ...args, context });
    const cancellation = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => {
        void this.#invoke(this.#commands.cancelOperation, { context }).catch(() => undefined);
        reject(new TauriAdapterAbortError(controller.signal.reason));
      }, { once: true });
    });
    try {
      const result = await Promise.race([operation, cancellation]);
      if (state.destroyed || state.controller.signal.aborted) throw new TauriAdapterStaleLeaseError();
      return result as T;
    } catch (error) {
      if (controller.signal.aborted) throw new TauriAdapterAbortError(controller.signal.reason);
      throw mapTauriError(error);
    } finally {
      state.controller.signal.removeEventListener("abort", onLeaseAbort);
      externalSignal?.removeEventListener("abort", onExternalAbort);
      void operation.catch(() => undefined);
    }
  }

  release(state: LeaseState): Promise<void> {
    if (state.destroyed) return Promise.resolve();
    state.destroyed = true;
    state.controller.abort(new TauriAdapterDestroyedError());
    const current = this.#leases.get(state.boardId);
    if (current?.state === state) this.#leases.delete(state.boardId);
    return this.#invoke(this.#commands.releaseProject, {
      boardId: state.boardId,
      projectRoot: state.projectRoot,
      leaseId: state.leaseId,
    }).then(() => undefined).catch((error) => { throw mapTauriError(error); });
  }

  commands(): TauriCommandNames { return this.#commands; }
  convertFileSrc(path: string): string { return this.#convertFileSrc(path); }
}

class TauriProjectLeaseImpl implements TauriProjectLease {
  readonly boardId: string;
  readonly projectRoot: string;
  readonly leaseId: string;
  readonly signal: AbortSignal;
  readonly capabilities = new Set([
    "document.persistence", "assets.metadata", "assets.import", "assets.resolve", "derivatives",
    "desktop.dialog", "desktop.download", "desktop.reveal", "desktop.process",
  ]);
  readonly document: TauriDocumentPort;
  readonly assets: TauriAssetPort;
  readonly derivatives: TauriDerivativePort;
  readonly dialog: TauriDialogPort;
  readonly download: TauriDownloadPort;
  readonly reveal: TauriRevealPort;
  readonly process: TauriProcessPort;
  #destroyPromise?: Promise<void>;

  constructor(private readonly host: TauriAdapterHost, readonly state: LeaseState) {
    this.boardId = state.boardId;
    this.projectRoot = state.projectRoot;
    this.leaseId = state.leaseId;
    this.signal = state.controller.signal;
    const call = <T>(command: string, args: Record<string, unknown>, signal?: AbortSignal) => host.invokeFor<T>(state, command, args, signal);
    const commands = host.commands();
    this.document = {
      load: (options = {}) => call<BoardDocument | null>(commands.loadDocument, {}, options.signal),
      save: (document, options = {}) => call<void>(commands.saveDocument, { document }, options.signal),
      destroy: () => this.destroy(),
    };
    this.assets = {
      metadata: {
        get: (id, options = {}) => call<AssetRecord | null>(commands.getAsset, { id }, options.signal),
        put: (records, options = {}) => call<void>(commands.putAssets, { records }, options.signal),
        delete: (ids, options = {}) => call<void>(commands.deleteAssets, { ids }, options.signal),
      },
      importer: {
        import: (source, options = {}) => call<AssetRecord>(commands.importAsset, { source }, options.signal),
      },
      resolver: {
        resolve: async (id, variant = "original", options = {}) => {
          const path = await call<string | null>(commands.resolveAsset, { id, variant }, options.signal);
          return path === null ? null : host.convertFileSrc(path);
        },
      },
    };
    this.derivatives = {
      put: (input, options = {}) => call<AssetRecord>(commands.putDerivative, {
        assetId: input.assetId,
        variant: input.variant,
        bytes: [...input.bytes],
        mimeType: input.mimeType,
      }, options.signal),
    };
    this.dialog = {
      pickFiles: (options: PickFilesOptions = {}, operation = {}) => call<TauriHostFile[]>(commands.pickFiles, { options }, operation.signal),
    };
    this.download = {
      asset: (assetId, options = {}) => call<string>(commands.downloadAsset, { assetId, suggestedName: options.suggestedName }, options.signal),
    };
    this.reveal = {
      project: (options = {}) => call<void>(commands.revealProject, {}, options.signal),
      asset: (assetId, options = {}) => call<void>(commands.revealAsset, { assetId }, options.signal),
    };
    this.process = {
      run: (input, options = {}) => call(commands.runProcess, input, options.signal),
    };
  }

  destroy(): Promise<void> {
    if (this.#destroyPromise === undefined) this.#destroyPromise = this.host.release(this.state);
    return this.#destroyPromise;
  }
}

export { DEFAULT_COMMANDS };

export function createTauriAdapter(options: TauriAdapterOptions): TauriAdapterHost {
  return new TauriAdapterHost(options);
}
