import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const reports = [
  ["pixiboardjs", join(root, "packages/pixiboardjs/etc/pixiboardjs.api.md")],
  ["@pixi-board/core", join(root, "packages/core/etc/pixi-board-core.api.md")],
];
const blockers = [];

for (const [name, report] of reports) {
  try {
    const text = await readFile(report, "utf8");
    if (!text.includes("## API Report File")) blockers.push(`${name}: unexpected API report header`);
    if (text.includes("placeholder")) blockers.push(`${name}: API report is a placeholder`);
  } catch (error) {
    if (error.code === "ENOENT") blockers.push(`${name}: missing generated API report`);
    else throw error;
  }
}

if (blockers.length) {
  console.error("API report blocked:");
  for (const blocker of blockers) console.error(`- ${blocker}`);
  process.exitCode = 1;
} else {
  console.log("API report baselines are present.");
}
