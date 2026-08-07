import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/check-current-document-only.mjs");
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicSourceRoots = ["packages/core/src", "packages/pixiboardjs/src", "packages/plugin-sdk/src", "packages/plugin-api-v3/src"];
const publicManifests = ["packages/core/package.json", "packages/pixiboardjs/package.json", "packages/plugin-sdk/package.json", "packages/plugin-api-v3/package.json"];
const blockers = [];

for (const sourceRoot of publicSourceRoots) {
  for (const file of await sourceFiles(resolve(root, sourceRoot))) {
    if (/\.(?:test|spec)\.ts$/.test(file)) continue;
    const text = await readFile(file, "utf8"), display = relative(root, file);
    if (/\bmigrat(?:e|es|ed|ing|ion|ions|or|ors)\b|migrationRegistr(?:y|ies)|documentMigrations/i.test(text)) blockers.push(`${display}: migration surface detected`);
    if (display === "packages/core/src/document-validation.ts") {
      for (const operator of [">", "<"]) {
        const rejection = new RegExp(`if \\(sourceVersion \\${operator} options\\.schemaVersion\\) \\{\\s*throw new DocumentValidationError\\(`, "s");
        if (!rejection.test(text)) blockers.push(`${display}: schemaVersion ${operator} current must throw DocumentValidationError`);
      }
    }
    if (["packages/plugin-sdk/src/index.ts", "packages/plugin-api-v3/src/index.ts"].includes(display)) {
      if (!/PLUGIN_API_VERSION\s*=\s*["']3["']\s+as\s+const/.test(text)) blockers.push(`${display}: Plugin API v3 constant is missing`);
      if (!/if\s*\(\s*manifest\.apiVersion\s*!==\s*PLUGIN_API_VERSION\s*\)\s*(?:\{\s*)?throw\s+new\s+(?:Error|CapabilityError)\s*\(/.test(text)) blockers.push(`${display}: non-v3 manifests are not structurally rejected`);
    }
    for (const line of text.split("\n")) {
      if (/schemaVersion[^\n]{0,80}(?:===?|<=?|>=?)\s*0\b|schemaVersion\s*:\s*0\b/i.test(line) && !/(?:throw|reject|error|invalid|older|unsupported)/i.test(line)) blockers.push(`${display}: pre-current BoardDocument schema handling detected: ${line.trim()}`);
      if (/schemaVersion/i.test(line) && !isApprovedCurrentSchemaLine(line, display)) blockers.push(`${display}: unreviewed BoardDocument schema branch detected: ${line.trim()}`);
    }
    if (/\bplugin-api-v[012]\b|\b(?:v0|v1|v2)(?:Manifest|Plugin|Api)\b/i.test(text)) blockers.push(`${display}: old plugin API helper/surface detected`);
    if (/apiVersion[^\n]{0,80}(?:["']v?[012](?:\.\d+){0,2}["']|\b[012](?:\.\d+){0,2}\b|[<>]=?\s*3)/i.test(text)) blockers.push(`${display}: pre-v3 plugin apiVersion handling detected`);
    for (const match of text.matchAll(/PLUGIN_API_VERSION\s*=\s*([^;\n]+)/g)) if (!/^["']3["'](?:\s+as\s+const)?\s*$/.test(match[1].trim())) blockers.push(`${display}: PLUGIN_API_VERSION is not exactly v3`);
    for (const line of text.split("\n")) {
      if (/\blegacy\b/i.test(line) && !/(?:reject|not supported|invalid|forbidden|expected a Plugin API v3)/i.test(line)) blockers.push(`${display}: legacy compatibility surface detected: ${line.trim()}`);
      if (/\b(?:backward|backwards)[ -]?compatib/i.test(line)) blockers.push(`${display}: backwards-compatibility surface detected: ${line.trim()}`);
    }
  }
}
for (const manifestPath of publicManifests) {
  const text = await readFile(resolve(root, manifestPath), "utf8");
  if (/migration|legacy|plugin-api-v[012]/i.test(text)) blockers.push(`${manifestPath}: public manifest exposes a legacy/migration entry`);
}

if (blockers.length) {
  console.error("Current BoardDocument/Plugin API v3-only gate failed; compatibility or migration surfaces are forbidden:");
  for (const blocker of [...new Set(blockers)]) console.error(`- ${blocker}`);
  process.exitCode = 1;
} else console.log(`Current-only gate passed: scanned ${publicSourceRoots.length} public source trees and ${publicManifests.length} public manifests; only explicit legacy rejection remains.`);

async function sourceFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(target));
    else if (extname(entry.name) === ".ts") output.push(target);
  }
  return output;
}

function isApprovedCurrentSchemaLine(line, display) {
  if (display === "packages/core/src/document-validation.ts" && /^\s*if \(sourceVersion [<>] options\.schemaVersion\) \{$/.test(line)) return true;
  return [
    /^\s*schemaVersion\??:\s*number;/,
    /readInteger\([^,]+,\s*["']schemaVersion["']/,
    /supported schema \$\{options\.schemaVersion\}/,
    /^\s*schemaVersion,?\s*$/,
    /readonly schemaVersion:\s*number/,
    /this\.schemaVersion\s*=\s*options\.schemaVersion\s*\?\?\s*1/,
    /schemaVersion:\s*this\.schemaVersion/,
    /createEmptyDocument\(this\.schemaVersion\)/,
    /createEmptyDocument\(schemaVersion:\s*number\)/,
    /Number\.isInteger\(schemaVersion\)\s*\|\|\s*schemaVersion\s*<\s*1/,
    /schemaVersion\s*<\s*1\).*throw.*positive/,
    /schemaVersion must be a positive integer/,
    /return \{ schemaVersion, revision:\s*0, nodes:\s*\[\], assets:\s*\[\] \}/,
  ].some((pattern) => pattern.test(line));
}
