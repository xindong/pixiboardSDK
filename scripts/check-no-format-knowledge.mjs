// The preview surface of @pixi-board/core must stay format-agnostic: formats are
// supplied by registered renderers, never listed here. Built-in and third-party
// renderers are meant to be peers, and a format literal in core would be a back door.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const files = ["asset-previews.ts", "preview-renderer.ts", "preview-registry.ts"].map((f) => `packages/core/src/${f}`);
const FORMAT = /["'`](pdf|docx?|xlsx?|pptx?|md|markdown|html?|txt|csv|json|zip|glb|gltf|fbx|obj|stl|ply|model|text-file|file)["'`]/;
const ZIP_NAME = /\.(pdf|docx?|xlsx?|pptx?|zip|glb|gltf|fbx)\b|ZIP_NO_MODEL/i;

const failures = [];
for (const file of files) {
  const lines = (await readFile(resolve(root, file), "utf8")).split("\n");
  lines.forEach((line, index) => {
    const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    if (FORMAT.test(code) || ZIP_NAME.test(code)) failures.push(`${file}:${index + 1}: ${line.trim()}`);
  });
}
if (failures.length) {
  console.error("Format knowledge found in the core preview surface (move it into a PreviewRenderer):\n" + failures.join("\n"));
  process.exit(1);
}
console.log(`No format knowledge in ${files.length} core preview files.`);
