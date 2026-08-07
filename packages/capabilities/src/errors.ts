export type CapabilityErrorCode =
  | "NODE_NOT_FOUND" | "NODE_TYPE_NOT_REGISTERED" | "NODE_VALIDATION"
  | "DOCUMENT_VALIDATION" | "TRANSACTION_CONFLICT"
  | "ASSET_UNAVAILABLE" | "PERMISSION_DENIED" | "BOARD_DESTROYED"
  | "ABORTED" | "CAPABILITY_UNAVAILABLE" | "INVALID_INPUT" | "INTERNAL_ERROR";

export class CapabilityError extends Error {
  readonly name = "CapabilityError";
  readonly code: CapabilityErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(code: CapabilityErrorCode, message: string, details?: Readonly<Record<string, unknown>>) { super(message); this.code = code; this.details = details; }
}

export class CapabilityUnavailableError extends CapabilityError {
  readonly capability: string;
  constructor(capability: string) { super("CAPABILITY_UNAVAILABLE", `Capability unavailable: ${capability}`, { capability }); this.capability = capability; }
}

export class AssetUnavailableError extends CapabilityError {
  constructor(assetId: string, variant?: string) { super("ASSET_UNAVAILABLE", `Asset unavailable: ${assetId}${variant ? ` (${variant})` : ""}`, { assetId, variant }); }
}

export class PermissionDeniedError extends CapabilityError {
  constructor(message = "Permission denied", details?: Readonly<Record<string, unknown>>) { super("PERMISSION_DENIED", message, details); }
}

export class BoardDestroyedError extends CapabilityError {
  constructor(message = "Board has been destroyed") { super("BOARD_DESTROYED", message); }
}

export function mapCoreError(error: unknown): CapabilityError {
  if (error instanceof CapabilityError) return error;
  const { NodeNotFoundError, NodeTypeNotRegisteredError, NodeValidationError, DocumentValidationError, TransactionConflictError } = coreErrors;
  const message = error instanceof Error ? error.message : String(error);
  const code: CapabilityErrorCode = error instanceof NodeNotFoundError ? "NODE_NOT_FOUND"
    : error instanceof NodeTypeNotRegisteredError ? "NODE_TYPE_NOT_REGISTERED"
    : error instanceof NodeValidationError ? "NODE_VALIDATION"
    : error instanceof DocumentValidationError ? "DOCUMENT_VALIDATION"
    : error instanceof TransactionConflictError ? "TRANSACTION_CONFLICT"
    : error instanceof RangeError ? "INVALID_INPUT"
    : error instanceof AssetUnavailableError ? "ASSET_UNAVAILABLE"
    : error instanceof PermissionDeniedError ? "PERMISSION_DENIED"
    : error instanceof BoardDestroyedError ? "BOARD_DESTROYED"
    : error instanceof Error && error.name === "AssetUnavailableError" ? "ASSET_UNAVAILABLE"
    : error instanceof Error && error.name === "PermissionDeniedError" ? "PERMISSION_DENIED"
    : error instanceof Error && error.name === "BoardDestroyedError" ? "BOARD_DESTROYED"
    : "INTERNAL_ERROR";
  return new CapabilityError(code, message);
}

import * as coreErrors from "@pixi-board/core";

export function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CapabilityError("ABORTED", "The capability request was aborted");
}
