import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "packages/pixiboardjs/src/browser.ts");
const workspaceEntries = new Map([
  ["@pixi-board/core", resolve(root, "packages/core/src/index.ts")],
  ["@pixi-board/capabilities", resolve(root, "packages/capabilities/src/index.ts")],
  ["@pixi-board/adapter-browser", resolve(root, "packages/adapter-browser/src/index.ts")],
  ["@pixi-board/renderer-pixi", resolve(root, "packages/renderer-pixi/src/index.ts")],
]);
const banned = /(?:^|[/@-])tauri(?:$|[/@-])|@tauri-apps/i;
const visited = new Set();

async function resolveSource(importer, specifier) {
  if (workspaceEntries.has(specifier)) return workspaceEntries.get(specifier);
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(importer), specifier);
  const candidates = extname(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, `${base}.js`, resolve(base, "index.ts")];
  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // Try the next source candidate.
    }
  }
  throw new Error(`Unable to resolve browser source import ${specifier} from ${importer}`);
}

async function visit(file) {
  if (visited.has(file)) return;
  visited.add(file);
  const source = await readFile(file, "utf8");
  const specifiers = new Set();
  const staticImports = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImports = /import\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [staticImports, dynamicImports]) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  for (const specifier of specifiers) {
    if (banned.test(specifier)) {
      throw new Error(`Browser entry statically reaches forbidden Tauri module ${specifier} via ${file}`);
    }
    const dependency = await resolveSource(file, specifier);
    if (dependency !== undefined) await visit(dependency);
  }
}

await visit(entry);
console.log(`browser boundary ok: ${visited.size} source modules, no static Tauri dependency`);
