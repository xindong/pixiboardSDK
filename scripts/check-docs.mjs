import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "README.md",
  "docs/README.md",
  "docs/00-product-goals.md",
  "docs/01-current-state.md",
  "docs/02-target-architecture.md",
  "docs/03-package-boundaries.md",
  "docs/04-public-api.md",
  "docs/05-custom-node-system.md",
  "docs/06-capabilities-plugins-agents.md",
  "docs/07-platform-assets-persistence.md",
  "docs/08-migration-plan.md",
  "docs/09-delivery-roadmap.md",
  "docs/10-performance-benchmarks.md",
  "docs/11-testing-release-compatibility.md",
  "docs/12-risks-open-decisions.md",
  "docs/13-traceability.md",
  "docs/14-parallel-execution.md",
  "docs/adr/0001-flat-document-model.md",
  "docs/adr/0002-document-source-pixi-cache.md",
  "docs/adr/0003-single-public-package.md",
  "docs/adr/0004-capabilities-boundary.md",
  "docs/adr/0005-document-runtime-details.md",
  "docs/adr/0006-data-patch-history.md",
  "docs/adr/0007-renderer-and-pixi-policy.md",
  "docs/adr/0008-browser-storage.md",
  "docs/adr/0009-plugin-api-v3.md",
  "docs/adr/0010-public-package-scope.md"
];

for (const file of requiredFiles) {
  await access(resolve(root, file));
}

const index = await readFile(resolve(root, "docs/README.md"), "utf8");
for (const file of requiredFiles.filter((file) => file.startsWith("docs/") && file !== "docs/README.md")) {
  const relative = file.slice("docs/".length);
  if (!index.includes(relative)) {
    throw new Error(`docs/README.md does not link to ${relative}`);
  }
}

async function collectMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".cindy-worktrees") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(path));
    } else if (entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

const markdownFiles = await collectMarkdownFiles(root);
for (const markdownFile of markdownFiles) {
  const markdown = await readFile(markdownFile, "utf8");
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split("#", 1)[0];
    if (!target || target.startsWith("http:") || target.startsWith("https:") || target.startsWith("mailto:")) {
      continue;
    }
    await access(resolve(dirname(markdownFile), target));
  }
}

console.log(
  `Documentation check passed: ${requiredFiles.length} required files, ${markdownFiles.length} Markdown files, and all local links verified.`,
);
