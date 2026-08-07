import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateSyntheticCards } from "./synthetic-card.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const count = Number(args.get("--count") ?? "10000");
const seed = Number(args.get("--seed") ?? "42");
const output = args.get("--out");
const dataset = generateSyntheticCards({ count, seed });

if (output) {
  const destination = resolve(process.cwd(), output);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(dataset)}\n`, "utf8");
  console.log(`Generated ${dataset.count} synthetic-card nodes at ${destination}`);
} else {
  console.log(JSON.stringify({ name: dataset.name, count: dataset.count, seed: dataset.seed, sharedAssets: dataset.sharedAssets.length }));
}
