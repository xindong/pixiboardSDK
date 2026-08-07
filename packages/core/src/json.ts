import { DocumentValidationError } from "./errors";
import type { JsonValue } from "./types";

export function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export function immutableClone<T>(value: T): Readonly<T> {
  return deepFreeze(cloneValue(value));
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function assertJsonValue(
  value: unknown,
  path = "value",
  ancestors = new WeakSet<object>(),
): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DocumentValidationError(`${path} must contain only finite numbers`);
    }
    return;
  }

  if (Array.isArray(value)) {
    assertNotCircular(value, path, ancestors);
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, ancestors));
    ancestors.delete(value);
    return;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DocumentValidationError(`${path} must be a plain JSON object`);
    }
    if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) {
      throw new DocumentValidationError(`${path} must not contain symbol keys`);
    }
    assertNotCircular(value, path, ancestors);
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${path}.${key}`, ancestors);
    }
    ancestors.delete(value);
    return;
  }

  throw new DocumentValidationError(`${path} is not JSON-serializable`);
}

function assertNotCircular(value: object, path: string, ancestors: WeakSet<object>): void {
  if (ancestors.has(value)) {
    throw new DocumentValidationError(`${path} must not contain circular references`);
  }
  ancestors.add(value);
}

export function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
