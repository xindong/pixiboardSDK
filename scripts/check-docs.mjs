import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = await findRepositoryRoot(root);
const workspaceRoot = dirname(repositoryRoot);
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
  "docs/15-release-gate.md",
  "docs/16-requirement-completion-audit.md",
  "docs/adr/0001-flat-document-model.md",
  "docs/adr/0002-document-source-pixi-cache.md",
  "docs/adr/0003-single-public-package.md",
  "docs/adr/0004-capabilities-boundary.md",
  "docs/adr/0005-document-runtime-details.md",
  "docs/adr/0006-data-patch-history.md",
  "docs/adr/0007-renderer-and-pixi-policy.md",
  "docs/adr/0008-browser-storage.md",
  "docs/adr/0009-plugin-api-v3.md",
  "docs/adr/0010-public-package-scope.md",
  "docs/adr/0011-new-document-format-only.md"
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

const forbiddenLegacyAcceptanceText = [
  "旧项目 fixture 可无损读取和 round-trip",
  "旧 schema v4 项目可迁移和保存",
  "旧项目可打开和保存",
  "旧项目打开和迁移",
  "old project fixtures",
  "新旧 snapshot migration",
  "旧 fixture round-trip",
  "旧 document/node type migration fixtures 全绿",
  "migration fixture 必须覆盖真实旧项目",
  "保存新格式前可生成备份",
];
for (const file of requiredFiles.filter((file) => file.startsWith("docs/") && file.endsWith(".md"))) {
  const markdown = await readFile(resolve(root, file), "utf8");
  for (const forbidden of forbiddenLegacyAcceptanceText) {
    if (markdown.includes(forbidden)) {
      throw new Error(`${file} reintroduces a forbidden legacy-data acceptance requirement: ${forbidden}`);
    }
  }
}

const documentBoundaryAdr = await readFile(
  resolve(root, "docs/adr/0011-new-document-format-only.md"),
  "utf8",
);
for (const requiredDecision of [
  "只接受自身定义的当前 `BoardDocument` 格式",
  "不实现 document migration、node data migration 或 legacy adapter",
  "旧应用继续读取、保存和管理旧数据",
]) {
  if (!documentBoundaryAdr.includes(requiredDecision)) {
    throw new Error(`ADR 0011 is missing required document-boundary decision: ${requiredDecision}`);
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
    await accessLocalLink(markdownFile, target);
  }
}

async function accessLocalLink(markdownFile, target) {
  const localTarget = resolve(dirname(markdownFile), target);
  try {
    await access(localTarget);
    return;
  } catch (error) {
    const segments = target.split(/[\\/]/);
    const sourceProjectIndex = segments.indexOf("pixi-board");
    if (sourceProjectIndex < 0) throw error;
    const sourceProjectTarget = resolve(
      workspaceRoot,
      "pixi-board",
      ...segments.slice(sourceProjectIndex + 1),
    );
    await access(sourceProjectTarget);
  }
}

async function findRepositoryRoot(start) {
  let current = start;
  for (;;) {
    try {
      if ((await stat(resolve(current, ".git"))).isDirectory()) return current;
    } catch {
      // A linked worktree has a .git file; continue to its common repository.
    }
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

console.log(
  `Documentation check passed: ${requiredFiles.length} required files, ${markdownFiles.length} Markdown files, and all local links verified.`,
);
