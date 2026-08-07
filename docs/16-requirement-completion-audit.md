# Requirement-by-requirement completion audit

审计基线：`main` / `3d00fa8`（2026-08-07）。本矩阵只接受源码、测试、可重复命令输出或明确产物作为证据；`docs/09`、`docs/14` 中的 roadmap、session 状态和“已合并”描述不单独构成完成证据。

状态含义：

- **achieved**：当前范围内有直接、可定位的实现与测试证据。
- **partial**：有垂直切片或局部证据，但未覆盖 roadmap 的完整验收范围；包含已有 gate 但仍被阻断的情况。
- **missing**：没有实现、产物或可复核验收证据。

## Completion matrix

| Requirement | Status | Evidence | Missing acceptance / next gate |
|---|---|---|---|
| P0：SDK Document 格式边界与旧格式拒绝 | **partial** | `packages/core/src/document-validation.ts` 在 `migrate:false` 时拒绝较旧 schema，并拒绝 future schema；但 `packages/pixiboardjs/src/index.ts` 的持久化加载仍传入 `{ migrate: true }`，Core 仍公开 `DocumentMigrationRegistry` 与 node migration callback。未发现 schema-v4/旧项目 adapter。 | 移除或禁用公开 migration 入口；主包只按当前 schemaVersion/typeVersion 加载；增加旧 snapshot、schema-v4、旧 `assetId` 和 legacy shape 的明确拒绝测试。不得新增 legacy adapter。 |
| P1：Headless Core 基础契约 | **achieved（范围限定）** | `packages/core/src/*` 无 DOM/Pixi/Tauri/plugin import；`packages/core/test/core.test.ts` 覆盖 CRUD、批量 transaction 原子性、undo/redo、immutable snapshot、ChangeSet、future schema rejection。 | 当前通用 migration surface 与 ADR 0011 的最终边界不一致；本项不要求任何旧 fixture 或 adapter。 |
| Unknown node preservation | **achieved（当前格式语义）** | `packages/core/test/core.test.ts` 的 unknown-node round-trip：触发 `node-type:missing`，允许 geometry update，拒绝 props update，保留 nested props、asset/custom fields；`packages/renderer-pixi/test/renderer.test.ts` 覆盖 unknown placeholder。 | 仅需在合法的当前 SDK Document fixture 中保持该行为；不能据此接受 legacy document。 |
| P2：Pixi renderer/custom node vertical slice | **partial** | `packages/renderer-pixi/test/renderer.test.ts` 覆盖 registry、incremental ChangeSet、culling/spatial、unknown placeholder、异步 destroy race、texture lease、hit-test、capture、task-card recreate。`tests/browser/browser-contract.spec.ts` 与 `apps/examples-vanilla/src/browser-contract.js` 定义 WebGL recovery。 | 缺真实 benchmark 阈值、media-heavy、双实例压力和长时间 resource soak。Browser gate 默认可 skip；需 `PIXIBOARD_REQUIRE_BROWSER=1`/CI 的实际成功输出。 |
| P3：Facade/desktop scoped parity | **partial** | `packages/pixiboardjs/test/facade.test.ts` 覆盖双实例 listener/resize 隔离、destroy cleanup、selection/viewport/history/capture。`apps/examples-desktop-sdk/test/desktop-sdk.test.ts` 覆盖 headless per-board lease 与 UI/Agent/Plugin v3 ChangeSet dispatch。 | 缺实际 Tauri app、SDK 新格式项目 load/save/switch、媒体导入/preview/playback/export/reveal、clipboard/copy/paste/rename 等完整 parity；MemoryTauriDocumentPort 不是 Tauri smoke。旧项目不属于此 gate。 |
| P4：Core ↔ Capabilities ↔ Agent 等价 | **achieved（direct path）** | `packages/agent-tools/src/contract.test.ts` 对 direct Core、Capabilities、Agent 的最终 document/revision/ChangeSet/undo/redo 做相等断言；也覆盖 source asset+node 单 transaction、requestId、错误映射。 | MCP transport 不在此结论内。 |
| Plugin API v3 contract | **partial** | `packages/plugin-api-v3/src/contract.test.ts` 与 `apps/examples-desktop-sdk/test/desktop-sdk.test.ts` 覆盖新 v3 fixture、permissions atomicity、event cleanup、v2 manifest rejection、UI/Agent/Plugin 共用 ChangeSet。 | 缺 packaged plugin host、zip loader、外部安装 fixture；当前包为 private `@pixi-board/plugin-api-v3`，不是文档承诺的 public `@pixi-board/plugin-sdk`。 |
| MCP direct-vs-transport equivalence | **achieved（transport scope）** | `packages/mcp-host/src/index.ts` 提供 MCP host、stdio line round-trip 与 HTTP `Request`/`Response` handler；契约测试对同一输入断言 direct Agent、stdio、HTTP 的 document、revision、ChangeSet、history、persistence 与错误语义一致。 | 真实 child-process stdio/socket deployment smoke 仍属于宿主集成 gate；本实现只接受 SDK 当前 Document，不承担旧数据兼容或迁移。 |
| P5：Browser adapter vertical slice | **achieved（adapter scope）** | `packages/adapter-browser/test/browser-persistence-adapter.test.ts` 覆盖 SDK 新 Document round-trip、CAS、quota recovery、OPFS/IndexedDB fallback、URL/GC、cancellation、destroy；`tests/browser/browser-contract.spec.ts` 覆盖 browser boundary/recovery contract。 | 缺 memory/browser/Tauri 同 suite、真实 File/Blob/text/image/video/audio import parity、可发布 web bundle artifact。 |
| P6：npm pack / external consumer release gate | **partial** | `scripts/check-release-gate.mjs` 会阻断 `.ts` runtime exports、internal/private deps、`0.0.0` placeholders；`docs/15-release-gate.md` 明确当前 gate blocked。实际 `pnpm release:check` 在 2026-08-07 因 `ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`（缺安装 workspace dependency）退出 1。 | 先提供 publishable JS + `.d.ts` + 正式 dependency versions，再运行 clean external Node/Vite consumer。 |
| SemVer / API report / Changesets / bundle budget | **missing** | `packages/pixiboardjs/VERSIONING.md` 只有策略 prose；仓库无 `.changeset/`、API Extractor/report、生成 CHANGELOG 或 bundle budget check。 | 增加配置、生成物和 CI/RC gate；分别管理 SDK semver、schemaVersion、node typeVersion、plugin apiVersion、Agent schema。 |
| P7：deterministic performance thresholds | **missing** | `apps/benchmark/src/runner.mjs` 与 `scenarios.mjs` 返回 `status: "not-implemented"` / `observed:false`；`apps/benchmark/README.md` 明确不运行 Pixi/WebGL/Konva、不伪造 measurement。 | 固定环境实测 10k/50k/100k、p50/p95/p99、first interactive、active views、core latency、capture。 |
| Konva comparison | **missing** | `docs/10-performance-benchmarks.md` 只有公平对照政策；无 Konva adapter、matching dataset 或结果文件。 | 在同节点数/可见密度/素材/DPR/viewport/path/runtime 下产出可复核 Pixi vs Konva 数据，只做适用场景结论。 |
| Memory/texture/listener soak | **missing** | benchmark 仅列出 `create-destroy-soak` 场景名；没有执行 harness、采样结果或 CI/nightly gate。 | 实现多实例、快速 view churn、texture lease、listener/ticker destroy soak，并以 >10% regression 阈值接入 CI/nightly。 |

## Commands run

| Command | Result | Interpretation |
|---|---|---|
| `pnpm docs:check` | pass：30 required files、39 Markdown files、local links verified | 文档结构与 ADR 0011 legacy-data policy checks 通过，不代表产品 requirements 完成。 |
| `pnpm packages:check` | pass：workspace/public export/fixture skeleton present | 仅 package skeleton contract。 |
| `pnpm audit:requirements` | pass（报告型脚本） | 输出本矩阵的静态 evidence/status；不会把计划行当完成。 |
| `git diff --check` | pass | 本次 docs/ADR/audit/check scripts 改动无 whitespace error。 |
| `pnpm release:check` | exit 1：`ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`，`@pixi-board/adapter-browser` 未安装 | release gate 有脚本但当前仍未通过；没有 external consumer pass。 |
| `pnpm test:core` / `pnpm test:contracts` / renderer、adapter、facade tests | 当前 worktree 无 `node_modules`，`vitest: command not found` | 未验证；不能引用为本次运行通过。源码中的测试断言仍可作为静态 evidence。 |

## Audit rule

`docs/14-parallel-execution.md` 的 commit/session 汇总只说明工作线声称合并；它不能替代本矩阵要求的测试输出、fixture、发布物或性能数据。尤其是 Document 格式拒绝、真实 Tauri smoke、API report/Changesets/bundle budget、Konva 和 soak，在这些产物出现前均不得标记 achieved。旧数据 migration/round-trip 不属于完成条件。
