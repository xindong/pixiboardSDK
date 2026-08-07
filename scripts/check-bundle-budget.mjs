import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const budgets = [
  ["pixiboardjs", join(root, "packages/pixiboardjs")],
  ["@pixi-board/core", join(root, "packages/core")],
  ["@pixi-board/plugin-sdk", join(root, "packages/plugin-sdk")],
];
const blockers = [];
const packages = [];

for (const [name, packageDir] of budgets) {
  const budgetFile = join(packageDir, "bundle-budget.json");
  try {
    const budget = JSON.parse(await readFile(budgetFile, "utf8"));
    const files = [];
    for (const [relative, maxBytes] of Object.entries(budget.files ?? {})) {
      try {
        const bytes = (await stat(join(packageDir, relative))).size;
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
