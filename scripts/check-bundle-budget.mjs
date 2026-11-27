import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const budgets = [
  ["pixiboardjs", join(root, "packages/pixiboardjs")],
];
async function globBytes(packageDir, pattern) {
  const dir = dirname(pattern), [prefix, suffix] = basename(pattern).split("*");
  const matches = (await readdir(join(packageDir, dir))).filter(name => name.startsWith(prefix) && name.endsWith(suffix));
  if (!matches.length) throw Object.assign(new Error(`no files match ${pattern}`), { code: "ENOENT" });
  let total = 0;
  for (const name of matches) total += (await stat(join(packageDir, dir, name))).size;
  return total;
}

const blockers = [];
const packages = [];

for (const [name, packageDir] of budgets) {
  const budgetFile = join(packageDir, "bundle-budget.json");
  try {
    const budget = JSON.parse(await readFile(budgetFile, "utf8"));
    const files = [];
    for (const [relative, maxBytes] of Object.entries(budget.files ?? {})) {
      try {
        // "dist/chunk-*.js" budgets the combined size of hashed shared chunks.
        const bytes = relative.includes("*") ? await globBytes(packageDir, relative) : (await stat(join(packageDir, relative))).size;
        files.push({ path: relative, bytes, maxBytes, passed: bytes <= maxBytes });
        if (bytes > maxBytes) blockers.push(`${name}: ${relative} is ${bytes} bytes; budget is ${maxBytes}`);
      } catch (error) {
        files.push({ path: relative, maxBytes, passed: false, error: error.code === "ENOENT" ? "missing release artifact" : String(error) });
        if (error.code === "ENOENT") blockers.push(`${name}: missing release artifact: ${relative}`);
        else throw error;
      }
    }
    packages.push({ name, budgetFile: budgetFile.slice(root.length + 1), files });
  } catch (error) {
    if (error.code === "ENOENT") blockers.push(`${name}: missing bundle-budget.json`);
    else throw error;
  }
}

// Every pixiboardjs entry must share one bundled copy of core and
// capabilities: a second copy breaks instanceof checks and splits module state.
const mainDist = join(root, "packages/pixiboardjs/dist");
const definitions = new Map();
for (const entry of await readdir(mainDist)) {
  if (!entry.endsWith(".js")) continue;
  const text = await readFile(join(mainDist, entry), "utf8");
  for (const marker of ["BoardCore = class", "class BoardCore", "function createBoardCapabilities("]) {
    if (text.includes(marker)) definitions.set(marker, [...(definitions.get(marker) ?? []), entry]);
  }
}
for (const [marker, files] of definitions) {
  if (files.length > 1) blockers.push(`pixiboardjs: ${marker} is defined in ${files.length} files (${files.join(", ")})`);
}
if (!definitions.has("function createBoardCapabilities(") || !(definitions.has("BoardCore = class") || definitions.has("class BoardCore"))) {
  blockers.push("pixiboardjs: dist does not bundle core and capabilities");
}

const reportPath = process.env.PIXIBOARD_BUNDLE_REPORT && resolve(process.env.PIXIBOARD_BUNDLE_REPORT);
if (reportPath) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), passed: blockers.length === 0, packages, blockers }, null, 2)}\n`);
  console.log(`Bundle budget report written to ${reportPath}`);
}

if (blockers.length) {
  console.error("Bundle budget blocked:");
  for (const blocker of blockers) console.error(`- ${blocker}`);
  process.exitCode = 1;
} else {
  console.log("Bundle budget passed.");
}
