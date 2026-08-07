import { access, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const budgets = [
  ["pixiboardjs", join(root, "packages/pixiboardjs")],
  ["@pixi-board/plugin-sdk", join(root, "packages/plugin-sdk")],
];
const blockers = [];

for (const [name, packageDir] of budgets) {
  const budgetFile = join(packageDir, "bundle-budget.json");
  try {
    const budget = JSON.parse(await readFile(budgetFile, "utf8"));
    for (const [relative, maxBytes] of Object.entries(budget.files ?? {})) {
      try {
        const bytes = (await stat(join(packageDir, relative))).size;
        if (bytes > maxBytes) blockers.push(`${name}: ${relative} is ${bytes} bytes; budget is ${maxBytes}`);
      } catch (error) {
        if (error.code === "ENOENT") blockers.push(`${name}: missing release artifact: ${relative}`);
        else throw error;
      }
    }
  } catch (error) {
    if (error.code === "ENOENT") blockers.push(`${name}: missing bundle-budget.json`);
    else throw error;
  }
}

if (blockers.length) {
  console.error("Bundle budget blocked:");
  for (const blocker of blockers) console.error(`- ${blocker}`);
  process.exitCode = 1;
} else {
  console.log("Bundle budget passed.");
}
