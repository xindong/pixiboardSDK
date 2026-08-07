import { DocumentValidationError, MigrationError, NodeValidationError } from "./errors";
import { assertJsonValue, cloneValue } from "./json";
import type { DocumentMigrationRegistry } from "./document-migrations";
import type { NodeTypeRegistry } from "./node-type-registry";
import type {
  AssetRecord,
  AssetRef,
  BoardDocument,
  BoardNode,
  DocumentLoadOptions,
  ViewportSnapshot,
} from "./types";

export function validateDocument(
  input: unknown,
  options: DocumentLoadOptions & {
    schemaVersion: number;
    nodeTypes: NodeTypeRegistry;
    migrations: DocumentMigrationRegistry;
  },
): BoardDocument {
  let value = parseInput(input);
  if (!isRecord(value)) throw new DocumentValidationError("Document must be an object");
  const sourceVersion = readInteger(value, "schemaVersion", "document");
  if (sourceVersion > options.schemaVersion) {
    throw new DocumentValidationError(
      `Document schema ${sourceVersion} is newer than supported schema ${options.schemaVersion}`,
    );
  }
  if (sourceVersion < options.schemaVersion) {
    if (!options.migrate) {
      throw new MigrationError(
        `Document schema ${sourceVersion} requires migration to ${options.schemaVersion}`,
      );
    }
    value = options.migrations.migrate(value, options.schemaVersion);
  }

  assertJsonValue(value, "document");
  if (!isRecord(value)) throw new DocumentValidationError("Document must be an object");
  const schemaVersion = readInteger(value, "schemaVersion", "document");
  const revision = readInteger(value, "revision", "document");
  if (schemaVersion < 1) throw new DocumentValidationError("schemaVersion must be positive");
  if (revision < 0) throw new DocumentValidationError("revision must not be negative");
  if (!Array.isArray(value.nodes)) throw new DocumentValidationError("document.nodes must be an array");
  if (!Array.isArray(value.assets)) throw new DocumentValidationError("document.assets must be an array");

  const nodeIds = new Set<string>();
  const nodes = value.nodes.map((node, index) => {
    const validated = validateNode(node, `document.nodes[${index}]`);
    if (nodeIds.has(validated.id)) {
      throw new DocumentValidationError(`Duplicate node id: ${validated.id}`);
    }
    nodeIds.add(validated.id);
    try {
      return options.nodeTypes.validateNode(validated, { migrate: options.migrate });
    } catch (cause) {
      if (cause instanceof NodeValidationError || cause instanceof MigrationError) throw cause;
      throw new NodeValidationError(`Invalid node ${validated.id}`, {
        nodeId: validated.id,
        nodeType: validated.type,
        cause,
      });
    }
  });

  const assetIds = new Set<string>();
  const assets = value.assets.map((asset, index) => {
    const validated = validateAsset(asset, `document.assets[${index}]`);
    if (assetIds.has(validated.id)) {
      throw new DocumentValidationError(`Duplicate asset id: ${validated.id}`);
    }
    assetIds.add(validated.id);
    return validated;
  });

  if (value.viewport !== undefined) validateViewport(value.viewport, "document.viewport");
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw new DocumentValidationError("document.metadata must be an object");
  }

  return {
    ...(cloneValue(value) as BoardDocument),
    schemaVersion,
    revision,
    nodes,
    assets,
    ...(value.viewport === undefined
      ? {}
      : { viewport: cloneValue(value.viewport) as ViewportSnapshot }),
  };
}

export function validateNode(input: unknown, path = "node"): BoardNode {
  assertJsonValue(input, path);
  if (!isRecord(input)) throw new DocumentValidationError(`${path} must be an object`);
  const id = readString(input, "id", path);
  const type = readString(input, "type", path);
  const typeVersion = readInteger(input, "typeVersion", path);
  if (typeVersion < 1) throw new DocumentValidationError(`${path}.typeVersion must be positive`);
  for (const field of ["x", "y", "width", "height", "rotation", "zIndex"] as const) {
    readFiniteNumber(input, field, path);
  }
  if ((input.width as number) < 0 || (input.height as number) < 0) {
    throw new DocumentValidationError(`${path} width and height must not be negative`);
  }
  if (input.name !== undefined && typeof input.name !== "string") {
    throw new DocumentValidationError(`${path}.name must be a string`);
  }
  if (input.locked !== undefined && typeof input.locked !== "boolean") {
    throw new DocumentValidationError(`${path}.locked must be a boolean`);
  }
  if (input.visible !== undefined && typeof input.visible !== "boolean") {
    throw new DocumentValidationError(`${path}.visible must be a boolean`);
  }
  if (!("props" in input)) throw new DocumentValidationError(`${path}.props is required`);
  if (input.assetRefs !== undefined) validateAssetRefs(input.assetRefs, `${path}.assetRefs`);
  return { ...(cloneValue(input) as BoardNode), id, type, typeVersion };
}

export function validateAsset(input: unknown, path = "asset"): AssetRecord {
  assertJsonValue(input, path);
  if (!isRecord(input)) throw new DocumentValidationError(`${path} must be an object`);
  const id = readString(input, "id", path);
  const kind = readString(input, "kind", path);
  if (input.metadata !== undefined && !isRecord(input.metadata)) {
    throw new DocumentValidationError(`${path}.metadata must be an object`);
  }
  return { ...(cloneValue(input) as AssetRecord), id, kind };
}

export function validateViewport(input: unknown, path = "viewport"): ViewportSnapshot {
  assertJsonValue(input, path);
  if (!isRecord(input) || !isRecord(input.offset)) {
    throw new DocumentValidationError(`${path} must include an offset object`);
  }
  const scale = readFiniteNumber(input, "scale", path);
  const x = readFiniteNumber(input.offset, "x", `${path}.offset`);
  const y = readFiniteNumber(input.offset, "y", `${path}.offset`);
  if (scale <= 0) throw new DocumentValidationError(`${path}.scale must be greater than zero`);
  return { scale, offset: { x, y } };
}

function validateAssetRefs(input: unknown, path: string): asserts input is Record<string, AssetRef> {
  if (!isRecord(input)) throw new DocumentValidationError(`${path} must be an object`);
  for (const [name, ref] of Object.entries(input)) {
    if (!name || !isRecord(ref)) throw new DocumentValidationError(`${path}.${name} is invalid`);
    readString(ref, "assetId", `${path}.${name}`);
    if (
      ref.variant !== undefined &&
      ref.variant !== "original" &&
      ref.variant !== "preview" &&
      ref.variant !== "waveform"
    ) {
      throw new DocumentValidationError(`${path}.${name}.variant is invalid`);
    }
  }
}

function parseInput(input: unknown): unknown {
  if (typeof input !== "string") return cloneValue(input);
  try {
    return JSON.parse(input) as unknown;
  } catch (cause) {
    throw new DocumentValidationError("Document JSON could not be parsed", { cause });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new DocumentValidationError(`${path}.${key} must be a non-empty string`);
  }
  return value;
}

function readInteger(record: Record<string, unknown>, key: string, path: string): number {
  const value = record[key];
  if (!Number.isInteger(value)) {
    throw new DocumentValidationError(`${path}.${key} must be an integer`);
  }
  return value as number;
}

function readFiniteNumber(record: Record<string, unknown>, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DocumentValidationError(`${path}.${key} must be a finite number`);
  }
  return value;
}
