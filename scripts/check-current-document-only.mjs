import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/check-current-document-only.mjs");
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicSourceRoots = ["packages/core/src", "packages/pixiboardjs/src", "packages/plugin-sdk/src", "packages/plugin-api-v3/src"];
const publicManifests = ["packages/core/package.json", "packages/pixiboardjs/package.json", "packages/plugin-sdk/package.json", "packages/plugin-api-v3/package.json"];

export function auditCurrentOnlySource(text, display) {
  const blockers = [];
  if (/\bmigrat(?:e|es|ed|ing|ion|ions|or|ors)\b|migrationRegistr(?:y|ies)|documentMigrations/i.test(text)) blockers.push(`${display}: migration surface detected`);
  if (/\b(?:normalize|upgrade|downgrade|convert|coerce|adapt|transform|rewrite)(?:Current|Legacy|Old)?(?:Document|Manifest)\b/i.test(text)) blockers.push(`${display}: document/plugin compatibility helper detected`);

  const source = ts.createSourceFile(display, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  visit(source);

  if (["packages/plugin-sdk/src/index.ts", "packages/plugin-api-v3/src/index.ts"].includes(display)) {
    if (!/PLUGIN_API_VERSION\s*=\s*["']3["']\s+as\s+const/.test(text)) blockers.push(`${display}: Plugin API v3 constant is missing`);
  }
  for (const line of text.split("\n")) {
    if (/\bschemaVersion\b/i.test(line) && !isApprovedCurrentSchemaLine(line, display)) blockers.push(`${display}: unreviewed BoardDocument schema line detected: ${line.trim()}`);
    if (/\bsourceVersion\b/i.test(line) && !isApprovedSourceVersionLine(line, display)) blockers.push(`${display}: unreviewed sourceVersion line detected: ${line.trim()}`);
    if (/\bapiVersion\b/i.test(line) && !isApprovedPluginVersionLine(line, display)) blockers.push(`${display}: unreviewed plugin apiVersion line detected: ${line.trim()}`);
    if (/\blegacy\b/i.test(line) && !/(?:reject|not supported|invalid|forbidden|expected a Plugin API v3)/i.test(line)) blockers.push(`${display}: legacy compatibility surface detected: ${line.trim()}`);
    if (/\b(?:backward|backwards)[ -]?compatib/i.test(line)) blockers.push(`${display}: backwards-compatibility surface detected: ${line.trim()}`);
  }
  if (/\bplugin-api-v[012]\b|\b(?:v0|v1|v2)(?:Manifest|Plugin|Api)\b/i.test(text)) blockers.push(`${display}: old plugin API helper/surface detected`);
  if (/apiVersion[^\n]{0,80}(?:["']v?[012](?:\.\d+){0,2}["']|\b[012](?:\.\d+){0,2}\b|[<>]=?\s*3)/i.test(text)) blockers.push(`${display}: pre-v3 plugin apiVersion handling detected`);
  for (const match of text.matchAll(/PLUGIN_API_VERSION\s*=\s*([^;\n]+)/g)) if (!/^["']3["'](?:\s+as\s+const)?\s*$/.test(match[1].trim())) blockers.push(`${display}: PLUGIN_API_VERSION is not exactly v3`);
  return [...new Set(blockers)];

  function visit(node) {
    if (ts.isBinaryExpression(node) && isComparisonOperator(node.operatorToken.kind)) {
      const category = versionComparisonCategory(node, source);
      if (category && !comparisonHasRejectionBranch(node, category, source)) {
        blockers.push(`${display}: ${category} version comparison is not structurally tied to an explicit rejection: ${node.getText(source)}`);
      }
    }
    ts.forEachChild(node, visit);
  }
}

async function main() {
  const blockers = [];
  for (const sourceRoot of publicSourceRoots) {
    for (const file of await sourceFiles(resolve(root, sourceRoot))) {
      if (/\.(?:test|spec)\.ts$/.test(file)) continue;
      const display = relative(root, file);
      blockers.push(...auditCurrentOnlySource(await readFile(file, "utf8"), display));
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
  } else console.log(`Current-only gate passed: scanned ${publicSourceRoots.length} public source trees and ${publicManifests.length} public manifests; version comparisons are structurally rejection-only.`);
}

async function sourceFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(target));
    else if (extname(entry.name) === ".ts") output.push(target);
  }
  return output;
}

function versionComparisonCategory(expression, source) {
  let category = null;
  const inspect = (node) => {
    if (ts.isBinaryExpression(node) && isComparisonOperator(node.operatorToken.kind)) {
      const operands = `${node.left.getText(source)} ${node.right.getText(source)}`;
      if (/\b(?:sourceVersion|schemaVersion)\b/.test(operands)) category ??= "BoardDocument";
      if (/\bmanifest\.(?:apiVersion|version)\b|\b(?:pluginVersion|apiVersion|PLUGIN_API_VERSION)\b/.test(operands)) category = "Plugin";
    }
    ts.forEachChild(node, inspect);
  };
  inspect(expression);
  return category;
}

function comparisonHasRejectionBranch(comparison, category, source) {
  if (!isApprovedVersionPredicate(comparison, category, source)) return false;
  let child = comparison;
  for (let parent = comparison.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent) && parent.expression === child) return branchRejects(parent.thenStatement, category, source);
    if (ts.isParenthesizedExpression(parent)) continue;
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.BarBarToken) continue;
    return false;
  }
  return false;
}

function isApprovedVersionPredicate(comparison, category, source) {
  const text = comparison.getText(source).replaceAll(/\s+/g, " ").trim();
  if (category === "Plugin") return text === "manifest.apiVersion !== PLUGIN_API_VERSION";
  return [
    "sourceVersion > options.schemaVersion",
    "sourceVersion < options.schemaVersion",
    "schemaVersion < 1",
  ].includes(text);
}

function isComparisonOperator(kind) {
  return [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(kind);
}

function branchRejects(statement, category, source) {
  if (ts.isThrowStatement(statement)) return approvedThrow(statement.expression, category, source);
  if (ts.isReturnStatement(statement)) return approvedRejectionReturn(statement.expression, source);
  if (ts.isBlock(statement)) return statement.statements.length > 0 && branchRejects(statement.statements.at(-1), category, source);
  if (ts.isIfStatement(statement) && statement.elseStatement) return branchRejects(statement.thenStatement, category, source) && branchRejects(statement.elseStatement, category, source);
  return false;
}

function approvedThrow(expression, category, source) {
  const text = expression?.getText(source) ?? "";
  return category === "BoardDocument" ? /new\s+DocumentValidationError\s*\(/.test(text) : /new\s+(?:Error|CapabilityError)\s*\(/.test(text);
}

function approvedRejectionReturn(expression, source) {
  if (!expression) return false;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return true;
  const text = expression.getText(source);
  return /^(?:reject|rejected|unsupported|invalid)\s*\(/i.test(text) || /(?:accepted|ok|valid)\s*:\s*false|status\s*:\s*["'](?:rejected|unsupported|invalid)["']/i.test(text);
}

function isApprovedSourceVersionLine(line, display) {
  if (display !== "packages/core/src/document-validation.ts") return false;
  return [
    /^\s*const sourceVersion = readInteger\(value, ["']schemaVersion["'], ["']document["']\);/,
    /^\s*if \(sourceVersion [<>] options\.schemaVersion\) \{$/,
    /Document schema \$\{sourceVersion\} is (?:newer|older) than supported schema \$\{options\.schemaVersion\}/,
  ].some((pattern) => pattern.test(line));
}

function isApprovedPluginVersionLine(line, display) {
  const approvedByFile = {
    "packages/plugin-sdk/src/index.ts": [
      /^export type PluginManifest = .*apiVersion: typeof PLUGIN_API_VERSION;/,
      /^\s*if \(manifest\.apiVersion !== PLUGIN_API_VERSION\) throw new Error\(/,
    ],
    "packages/plugin-api-v3/src/index.ts": [
      /^\s*apiVersion: typeof PLUGIN_API_VERSION;/,
      /^\s*if \(manifest\.apiVersion !== PLUGIN_API_VERSION\) \{$/,
      /Only Plugin API v3 manifests are accepted.*apiVersion: manifest\.apiVersion/,
    ],
    "packages/plugin-api-v3/src/package-loader.ts": [
      /^\s*["']apiVersion["'],$/,
      /^\s*apiVersion: packageManifest\.apiVersion,$/,
    ],
    "packages/plugin-api-v3/src/fixture.ts": [/^\s*apiVersion: ["']3["'],$/],
  };
  return (approvedByFile[display] ?? []).some((pattern) => pattern.test(line));
}

function isApprovedCurrentSchemaLine(line, display) {
  const approvedByFile = {
    "packages/core/src/document-validation.ts": [
      /^\s*schemaVersion:\s*number;/,
      /readInteger\([^,]+,\s*["']schemaVersion["']/,
      /^\s*if \(sourceVersion [<>] options\.schemaVersion\) \{$/,
      /supported schema \$\{options\.schemaVersion\}/,
      /^\s*schemaVersion,?\s*$/,
      /^\s*if \(schemaVersion < 1\) throw new DocumentValidationError\(["']schemaVersion must be positive["']\);/,
    ],
    "packages/core/src/core.ts": [
      /^\s*schemaVersion\?:\s*number;/,
      /^\s*private readonly schemaVersion:\s*number;/,
      /^\s*this\.schemaVersion\s*=\s*options\.schemaVersion\s*\?\?\s*1;/,
      /^\s*schemaVersion:\s*this\.schemaVersion,$/,
      /createEmptyDocument\(this\.schemaVersion\)/,
      /^function createEmptyDocument\(schemaVersion:\s*number\): BoardDocument \{$/,
      /^\s*if \(!Number\.isInteger\(schemaVersion\) \|\| schemaVersion < 1\) \{$/,
      /schemaVersion must be a positive integer/,
      /^\s*return \{ schemaVersion, revision:\s*0, nodes:\s*\[\], assets:\s*\[\] \};$/,
    ],
    "packages/core/src/types.ts": [/^\s*schemaVersion:\s*number;/],
  };
  return (approvedByFile[display] ?? []).some((pattern) => pattern.test(line));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
