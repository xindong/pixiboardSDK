import type { AssetRecord, BoardDocument } from "@pixi-board/core";

export type TauriInvoke = <Result>(command: string, args?: Record<string, unknown>) => Promise<Result>;
export type TauriFileSource = { token: string; name: string; size: number; mimeType?: string };
export type TauriHostFile = TauriFileSource & { path?: never };
export type TauriAssetVariant = "original" | "preview" | "waveform";

export type TauriOperationContext = {
  boardId: string;
  projectRoot: string;
  leaseId: string;
  requestId: string;
};

export type TauriErrorPayload = {
  code?: string;
  message?: string;
  retryable?: boolean;
  details?: unknown;
};

export type TauriDocumentPort = {
  load(options?: { signal?: AbortSignal }): Promise<BoardDocument | null>;
  save(document: BoardDocument, options?: { signal?: AbortSignal }): Promise<void>;
  destroy(): Promise<void>;
};

export type TauriAssetPort = {
  readonly metadata: {
    get(id: string, options?: { signal?: AbortSignal }): Promise<AssetRecord | null>;
    put(records: AssetRecord[], options?: { signal?: AbortSignal }): Promise<void>;
    delete(ids: string[], options?: { signal?: AbortSignal }): Promise<void>;
  };
  readonly importer: {
    import(source: TauriFileSource, options?: { signal?: AbortSignal }): Promise<AssetRecord>;
  };
  readonly resolver: {
    resolve(id: string, variant?: TauriAssetVariant, options?: { signal?: AbortSignal }): Promise<string | null>;
  };
};

export type TauriDerivativePort = {
  put(input: {
    assetId: string;
    variant: Exclude<TauriAssetVariant, "original">;
    bytes: Uint8Array;
    mimeType: string;
  }, options?: { signal?: AbortSignal }): Promise<AssetRecord>;
};

export type PickFilesOptions = { multiple?: boolean; filters?: Array<{ name: string; extensions: string[] }> };

export type TauriDialogPort = {
  pickFiles(options?: PickFilesOptions, operation?: { signal?: AbortSignal }): Promise<TauriHostFile[]>;
};

export type TauriDownloadPort = {
  asset(assetId: string, options?: { suggestedName?: string; signal?: AbortSignal }): Promise<string>;
};

export type TauriRevealPort = {
  project(options?: { signal?: AbortSignal }): Promise<void>;
  asset(assetId: string, options?: { signal?: AbortSignal }): Promise<void>;
};

export type TauriProcessPort = {
  run(input: { executable: string; args?: string[]; cwd?: string }, options?: { signal?: AbortSignal }): Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>;
};

export type TauriProjectLease = {
  readonly boardId: string;
  readonly projectRoot: string;
  readonly leaseId: string;
  readonly signal: AbortSignal;
  readonly document: TauriDocumentPort;
  readonly assets: TauriAssetPort;
  readonly derivatives: TauriDerivativePort;
  readonly dialog: TauriDialogPort;
  readonly download: TauriDownloadPort;
  readonly reveal: TauriRevealPort;
  readonly process: TauriProcessPort;
  readonly capabilities: ReadonlySet<string>;
  destroy(): Promise<void>;
};

export type AcquireProjectOptions = { boardId: string; projectRoot: string };
export type TauriAdapterOptions = {
  invoke: TauriInvoke;
  convertFileSrc?: (path: string) => string;
  commands?: Partial<TauriCommandNames>;
  idFactory?: () => string;
};

export type TauriCommandNames = {
  acquireProject: string;
  releaseProject: string;
  cancelOperation: string;
  loadDocument: string;
  saveDocument: string;
  getAsset: string;
  putAssets: string;
  deleteAssets: string;
  importAsset: string;
  resolveAsset: string;
  putDerivative: string;
  pickFiles: string;
  downloadAsset: string;
  revealProject: string;
  revealAsset: string;
  runProcess: string;
};
