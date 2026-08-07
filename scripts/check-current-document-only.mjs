import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = new Map();
for (const relative of [
  "packages/core/src/index.ts",
  "packages/core/src/core.ts",
  "packages/core/src/types.ts",
  "packages/core/src/node-type-registry.ts",
  "packages/pixiboardjs/src/index.ts",
  "packages/pixiboardjs/src/types.ts",
]) {
  sources.set(relative, await readFile(resolve(root, relative), "utf8"));
}

const blockers = [];
check("packages/core/src/index.ts", /document-migrations/, "Core publicly exports document migration APIs");
check("packages/core/src/core.ts", /DocumentMigrationRegistry|\bmigrations\??:/, "Core accepts a document migration registry");
check("packages/core/src/types.ts", /\bmigrate\??\s*:/, "public Core types expose migrate options or callbacks");
check("packages/core/src/node-type-registry.ts", /definition\.migrate|runMigration\(/, "node type validation still performs data migration");
check("packages/pixiboardjs/src/index.ts", /migrate:\s*true/, "facade persistence enables migration");
check("packages/pixiboardjs/src/types.ts", /Pick<DocumentLoadOptions,\s*["']migrate["']>/, "facade validation exposes migrate options");

if (blockers.length > 0) {
  console.error("Current BoardDocument-only gate failed; SDK migration surfaces are forbidden by ADR 0011:");
  for (const blocker of blockers) console.error(`- ${blocker}`);
  process.exitCode = 1;
} else {
  console.log("Current BoardDocument-only gate passed: no public or implicit document/node migration path detected.");
}

function check(file, pattern, message) {
  if (pattern.test(sources.get(file))) blockers.push(`${message} (${file})`);
}
