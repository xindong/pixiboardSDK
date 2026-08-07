import type { TauriErrorPayload } from "./types";

export class TauriAdapterError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: unknown;
  readonly cause?: unknown;

  constructor(code: string, message: string, options: { retryable?: boolean; details?: unknown; cause?: unknown } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export class TauriAdapterAbortError extends TauriAdapterError {
  constructor(reason?: unknown) {
    super("CANCELLED", "Tauri adapter operation was aborted", { cause: reason });
    this.name = "AbortError";
  }
}

export class TauriAdapterDestroyedError extends TauriAdapterError {
  constructor() { super("DESTROYED", "Tauri project lease has been destroyed"); }
}

export class TauriAdapterStaleLeaseError extends TauriAdapterError {
  constructor() { super("STALE_LEASE", "Tauri operation belongs to an inactive project lease"); }
}

export class TauriAdapterConflictError extends TauriAdapterError {
  constructor(details?: unknown, cause?: unknown) {
    super("CONFLICT", "Tauri project revision conflict", { retryable: true, details, cause });
  }
}

export class TauriAdapterUnavailableError extends TauriAdapterError {
  constructor(message = "Tauri capability is unavailable", details?: unknown) {
    super("UNAVAILABLE", message, { retryable: true, details });
  }
}

export class TauriAdapterNotFoundError extends TauriAdapterError {
  constructor(message = "Tauri resource was not found", details?: unknown) {
    super("NOT_FOUND", message, { details });
  }
}

export class TauriAdapterPermissionError extends TauriAdapterError {
  constructor(message = "Tauri capability permission was denied", details?: unknown) {
    super("PERMISSION_DENIED", message, { details });
  }
}

export function mapTauriError(error: unknown): TauriAdapterError {
  if (error instanceof TauriAdapterError) return error;
  const payload = readPayload(error);
  const code = payload.code?.toUpperCase() ?? "TAURI_INVOKE";
  const message = payload.message ?? (error instanceof Error ? error.message : String(error));
  if (code === "CANCELLED" || code === "ABORTED") return new TauriAdapterAbortError(payload.details ?? error);
  if (code === "STALE_LEASE") return new TauriAdapterStaleLeaseError();
  if (code === "CONFLICT") return new TauriAdapterConflictError(payload.details, error);
  if (code === "NOT_FOUND") return new TauriAdapterNotFoundError(message, payload.details);
  if (code === "PERMISSION_DENIED" || code === "FORBIDDEN") return new TauriAdapterPermissionError(message, payload.details);
  if (code === "UNAVAILABLE" || code === "NO_PROJECT") return new TauriAdapterUnavailableError(message, payload.details);
  return new TauriAdapterError(code, message, { retryable: payload.retryable, details: payload.details, cause: error });
}

function readPayload(error: unknown): TauriErrorPayload {
  if (typeof error === "string") {
    try { return JSON.parse(error) as TauriErrorPayload; } catch { return { message: error }; }
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as TauriErrorPayload & { error?: unknown };
    if (typeof candidate.error === "string") return readPayload(candidate.error);
    if (typeof candidate.error === "object" && candidate.error !== null) return readPayload(candidate.error);
    return candidate;
  }
  return { message: String(error) };
}
