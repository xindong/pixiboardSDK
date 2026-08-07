export class BrowserPersistenceError extends Error {
  readonly cause?: unknown;

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = new.target.name;
    this.cause = options.cause;
  }
}

export class BrowserPersistenceDestroyedError extends BrowserPersistenceError {
  constructor() {
    super("BrowserPersistenceAdapter has been destroyed");
  }
}

export class BrowserPersistenceAbortError extends BrowserPersistenceError {
  constructor(reason?: unknown) {
    super("Browser persistence operation was aborted", { cause: reason });
    this.name = "AbortError";
  }
}

export class BrowserAssetNotFoundError extends BrowserPersistenceError {
  constructor(assetId: string) {
    super(`Browser asset not found: ${assetId}`);
  }
}

export class BrowserAssetBinaryMissingError extends BrowserPersistenceError {
  constructor(assetId: string, variant = "original") {
    super(`Stored ${variant} binary is missing for browser asset: ${assetId}`);
  }
}

export class BrowserStorageKeyCollisionError extends BrowserPersistenceError {
  constructor(key: string) {
    super(`OPFS storage key is already in use: ${key}`);
  }
}
