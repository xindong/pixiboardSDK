import { access, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const packageDir = join(root, "packages/pixiboardjs");
const budget = JSON.parse(await readFile(join(packageDir, "bundle-budget.json"), "utf8"));
const blockers = [];

for (const [relative, maxBytes] of Object.entries(budget.files ?? {})) {
  try {
    const bytes = (await stat(join(packageDir, relative))).size;
    if (bytes > maxBytes) blockers.push(`${relative} is ${bytes} bytes; budget is ${maxBytes}`);
  } catch (error) {
    if (error.code === "ENOENT") blockers.push(`missing release artifact: ${relative}`);
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
