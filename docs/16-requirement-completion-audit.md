# Requirement-by-requirement completion audit

审计基线：`main` / `e2e8b42`（2026-08-07）。本矩阵只接受源码、测试、可重复命令输出或明确产物作为证据；`docs/09`、`docs/14` 中的 roadmap、session 状态和“已合并”描述不单独构成完成证据。

状态含义：

- **achieved**：当前范围内有直接、可定位的实现与测试证据。
- **partial**：有垂直切片或局部证据，但未覆盖 roadmap 的完整验收范围；包含已有 gate 但仍被阻断的情况。
- **missing**：没有实现、产物或可复核验收证据。

## Completion matrix

| Requirement | Status | Evidence | Missing acceptance / next gate |
|---|---|---|---|
| P0：真实旧 snapshot/schema-v4 migration 与 round-trip | **missing** | `packages/core/test/core.test.ts` 仅有 synthetic schema 1→2 与 node props migration；未发现 SDK fixtures。`../pixi-board` 的 `apps/desktop/src-tauri/src/models.rs` / `project_store.rs` 仍是 schema-v4 split `board.json`/`assets.json` serde 读写，无迁移 fixture runner。 | 固化真实旧项目 fixture，覆盖 schema-v4、旧 node type、资产引用、未知字段，执行 load→save→reload 无损断言。 |
| P1：Headless Core 基础契约 | **achieved（范围限定）** | `packages/core/src/*` 无 DOM/Pixi/Tauri/plugin import；`packages/core/test/core.test.ts` 覆盖 CRUD、批量 transaction 原子性、undo/redo、immutable snapshot、ChangeSet、future schema rejection。 | 旧模型 adapter/真实旧 fixture 仍是 P0/P7 未完成项。 |
| Unknown node preservation | **achieved（当前 v1 语义）** | `packages/core/test/core.test.ts` 的 unknown-node round-trip：触发 `node-type:missing`，允许 geometry update，拒绝 props update，保留 nested props、asset/custom fields；`packages/renderer-pixi/test/renderer.test.ts` 覆盖 unknown placeholder。 | 将同样断言接入真实旧 snapshot fixture；不能用该结果替代 migration 完成。 |
| P2：Pixi renderer/custom node vertical slice | **partial** | `packages/renderer-pixi/test/renderer.test.ts` 覆盖 registry、incremental ChangeSet、culling/spatial、unknown placeholder、异步 destroy race、texture lease、hit-test、capture、task-card recreate。`tests/browser/browser-contract.spec.ts` 与 `apps/examples-vanilla/src/browser-contract.js` 定义 WebGL recovery。 | 缺真实 benchmark 阈值、media-heavy、双实例压力和长时间 resource soak。Browser gate 默认可 skip；需 `PIXIBOARD_REQUIRE_BROWSER=1`/CI 的实际成功输出。 |
| P3：Facade/desktop scoped parity | **partial** | `packages/pixiboardjs/test/facade.test.ts` 覆盖双实例 listener/resize 隔离、destroy cleanup、selection/viewport/history/capture。`apps/examples-desktop-sdk/test/desktop-sdk.test.ts` 覆盖 headless per-board lease 与 UI/Agent/Plugin v3 ChangeSet dispatch。 | 缺实际 Tauri app、旧项目打开迁移、媒体导入/preview/playback/export/reveal、clipboard/copy/paste/rename 等完整 parity；MemoryTauriDocumentPort 不是 Tauri smoke。 |
| P4：Core ↔ Capabilities ↔ Agent 等价 | **achieved（direct path）** | `packages/agent-tools/src/contract.test.ts` 对 direct Core、Capabilities、Agent 的最终 document/revision/ChangeSet/undo/redo 做相等断言；也覆盖 source asset+node 单 transaction、requestId、错误映射。 | MCP transport 不在此结论内。 |
| Plugin API v3 contract | **partial** | `packages/plugin-api-v3/src/contract.test.ts` 与 `apps/examples-desktop-sdk/test/desktop-sdk.test.ts` 覆盖新 v3 fixture、permissions atomicity、event cleanup、v2 manifest rejection、UI/Agent/Plugin 共用 ChangeSet。 | 缺 packaged plugin host、zip loader、外部安装 fixture；当前包为 private `@pixi-board/plugin-api-v3`，不是文档承诺的 public `@pixi-board/plugin-sdk`。 |
| MCP direct-vs-transport equivalence | **missing** | SDK 中没有 `packages/mcp-host` 或 MCP transport package；现有 `../pixi-board` MCP/v2 测试不属于新 SDK v3 contract。 | 实现 HTTP/stdio transport，针对同一输入断言 direct Agent 与 MCP 的 document、revision、ChangeSet、history、persistence 语义一致。 |
| P5：Browser adapter vertical slice | **achieved（adapter scope）** | `packages/adapter-browser/test/browser-persistence-adapter.test.ts` 覆盖 round-trip、CAS、quota recovery、OPFS/IndexedDB fallback、URL/GC、cancellation、destroy；`tests/browser/browser-contract.spec.ts` 覆盖 browser boundary/recovery contract。 | 缺 memory/browser/Tauri 同 suite、真实 File/Blob/text/image/video/audio import parity、可发布 web bundle artifact。 |
| P6：npm pack / external consumer release gate | **partial** | `scripts/check-release-gate.mjs` 会阻断 `.ts` runtime exports、internal/private deps、`0.0.0` placeholders；`docs/15-release-gate.md` 明确当前 gate blocked。实际 `pnpm release:check` 在 2026-08-07 因 `ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`（缺安装 workspace dependency）退出 1。 | 先提供 publishable JS + `.d.ts` + 正式 dependency versions，再运行 clean external Node/Vite consumer。 |
| SemVer / API report / Changesets / bundle budget | **missing** | `packages/pixiboardjs/VERSIONING.md` 只有策略 prose；仓库无 `.changeset/`、API Extractor/report、生成 CHANGELOG 或 bundle budget check。 | 增加配置、生成物和 CI/RC gate；分别管理 SDK semver、schemaVersion、node typeVersion、plugin apiVersion、Agent schema。 |
| P7：deterministic performance thresholds | **missing** | `apps/benchmark/src/runner.mjs` 与 `scenarios.mjs` 返回 `status: "not-implemented"` / `observed:false`；`apps/benchmark/README.md` 明确不运行 Pixi/WebGL/Konva、不伪造 measurement。 | 固定环境实测 10k/50k/100k、p50/p95/p99、first interactive、active views、core latency、capture。 |
| Konva comparison | **missing** | `docs/10-performance-benchmarks.md` 只有公平对照政策；无 Konva adapter、matching dataset 或结果文件。 | 在同节点数/可见密度/素材/DPR/viewport/path/runtime 下产出可复核 Pixi vs Konva 数据，只做适用场景结论。 |
| Memory/texture/listener soak | **missing** | benchmark 仅列出 `create-destroy-soak` 场景名；没有执行 harness、采样结果或 CI/nightly gate。 | 实现多实例、快速 view churn、texture lease、listener/ticker destroy soak，并以 >10% regression 阈值接入 CI/nightly。 |

## Commands run

| Command | Result | Interpretation |
|---|---|---|
| `pnpm docs:check` | pass：28 required files、37 Markdown files、local links verified | 文档结构通过，不代表产品 requirements 完成。 |
| `pnpm packages:check` | pass：workspace/public export/fixture skeleton present | 仅 package skeleton contract。 |
| `pnpm audit:requirements` | pass（报告型脚本） | 输出本矩阵的静态 evidence/status；不会把计划行当完成。 |
| `pnpm release:check` | exit 1：`ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`，`@pixi-board/adapter-browser` 未安装 | release gate 有脚本但当前仍未通过；没有 external consumer pass。 |
| `pnpm test:core` / `pnpm test:contracts` / renderer、adapter、facade tests | 当前 worktree 无 `node_modules`，`vitest: command not found` | 未验证；不能引用为本次运行通过。源码中的测试断言仍可作为静态 evidence。 |

## Audit rule

`docs/14-parallel-execution.md` 的 commit/session 汇总只说明工作线声称合并；它不能替代本矩阵要求的测试输出、fixture、发布物或性能数据。尤其是 migration、MCP、真实 Tauri smoke、API report/Changesets/bundle budget、Konva 和 soak，在这些产物出现前均不得标记 achieved。
