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

export class BrowserStorageCapabilityError extends BrowserPersistenceError {
  readonly capability: "indexeddb" | "opfs" | "object-url";

  constructor(capability: "indexeddb" | "opfs" | "object-url") {
    super(`Browser storage capability is unavailable: ${capability}`);
    this.capability = capability;
  }
}

export class BrowserDocumentConflictError extends BrowserPersistenceError {
  readonly expectedRevision: number | null;
  readonly actualRevision: number | null;

  constructor(expectedRevision: number | null, actualRevision: number | null) {
    super(
      `Browser document revision conflict: expected ${String(expectedRevision)}, found ${String(actualRevision)}`,
    );
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class BrowserStorageQuotaError extends BrowserPersistenceError {
  readonly retryable = true;

  constructor(cause?: unknown) {
    super("Browser storage quota was exceeded", { cause });
  }
}

export function isBrowserQuotaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "QuotaExceededError" || candidate.code === 22 || candidate.code === 1014;
}
