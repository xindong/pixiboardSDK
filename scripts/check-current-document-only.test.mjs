import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { auditCurrentOnlySource } from "./check-current-document-only.mjs";

const here = dirname(fileURLToPath(import.meta.url));

for (const fixture of ["normalize-document.ts", "old-manifest.ts"]) {
  test(`rejects compatibility fixture ${fixture}`, async () => {
    const text = await readFile(resolve(here, "fixtures/current-only", fixture), "utf8");
    const blockers = auditCurrentOnlySource(text, `fixture/${fixture}`);
    assert.ok(blockers.length > 0, `${fixture} unexpectedly passed the current-only audit`);
    assert.match(blockers.join("\n"), /not structurally tied to an explicit rejection/);
  });
}

test("accepts an explicit current-document rejection branch", () => {
  const blockers = auditCurrentOnlySource(`
    const sourceVersion = readInteger(value, "schemaVersion", "document");
    if (sourceVersion < options.schemaVersion) {
      throw new DocumentValidationError(
        \`Document schema \${sourceVersion} is older than supported schema \${options.schemaVersion}\`,
      );
    }
  `, "packages/core/src/document-validation.ts");
  assert.deepEqual(blockers, []);
});

test("rejects a version comparison that only normalizes old input", () => {
  const blockers = auditCurrentOnlySource(`
    const sourceVersion = readInteger(value, "schemaVersion", "document");
    if (sourceVersion < options.schemaVersion) {
      value.schemaVersion = options.schemaVersion;
    }
  `, "packages/core/src/document-validation.ts");
  assert.match(blockers.join("\n"), /not structurally tied to an explicit rejection/);
});

test("rejects plugin version comparisons hidden in expressions", () => {
  const blockers = auditCurrentOnlySource(`
    const PLUGIN_API_VERSION = "3" as const;
    export function load(manifest: { apiVersion: string }) {
      return manifest.apiVersion !== PLUGIN_API_VERSION
        ? { ...manifest, apiVersion: PLUGIN_API_VERSION }
        : manifest;
    }
  `, "fixture/plugin-ternary.ts");
  assert.match(blockers.join("\n"), /Plugin version comparison is not structurally tied to an explicit rejection/);
});

test("rejects reversed and guarded plugin rejection predicates", () => {
  for (const predicate of [
    "manifest.apiVersion === PLUGIN_API_VERSION",
    "manifest.apiVersion !== PLUGIN_API_VERSION && strict",
  ]) {
    const blockers = auditCurrentOnlySource(`
      const PLUGIN_API_VERSION = "3" as const;
      if (${predicate}) throw new Error("rejected");
    `, "fixture/plugin-predicate.ts");
    assert.match(blockers.join("\n"), /Plugin version comparison is not structurally tied to an explicit rejection/);
  }
});

test("rejects aliased plugin apiVersion compatibility logic", () => {
  const blockers = auditCurrentOnlySource(`
    const version = manifest.apiVersion;
    if (version !== "3") return { ...manifest, apiVersion: "3" };
  `, "packages/plugin-sdk/src/compat.ts");
  assert.match(blockers.join("\n"), /unreviewed plugin apiVersion line/);
});

test("does not apply schema allowlist entries to arbitrary files", () => {
  const blockers = auditCurrentOnlySource(`
    export function copyCurrent(input: Record<string, unknown>) {
      return { ...input, schemaVersion: this.schemaVersion };
    }
  `, "packages/core/src/adapt.ts");
  assert.match(blockers.join("\n"), /unreviewed BoardDocument schema line/);
});
