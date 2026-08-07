# Requirement-by-requirement completion audit

审计基线：`main` / `029ad01`（2026-08-07）。本矩阵只接受源码、测试、可重复命令输出或明确产物作为证据；`docs/09`、`docs/14` 中的 roadmap、session 状态和“已合并”描述不单独构成完成证据。

状态含义：

- **achieved**：当前范围内有直接、可定位的实现与测试证据。
- **partial**：有垂直切片或局部证据，但未覆盖 roadmap 的完整验收范围；包含已有 gate 但仍被阻断的情况。
- **missing**：没有实现、产物或可复核验收证据。

## Completion matrix

| Requirement | Status | Evidence | Missing acceptance / next gate |
|---|---|---|---|
| P0：SDK Document 格式边界与旧格式拒绝 | **achieved** | Core 与 Facade 只接受当前 SDK `BoardDocument`；测试覆盖旧/future schema、旧顶层 `assetId`、已注册 node typeVersion 不匹配。`DocumentMigrationRegistry`、node migration callback 和 `migrate` load option 已删除。 | schemaVersion/typeVersion 变化时必须继续明确拒绝不匹配输入；不得重新加入 legacy adapter。 |
| P1：Headless Core 基础契约 | **achieved** | `packages/core/src/*` 无 DOM/Pixi/Tauri/plugin import；Core 26/26 覆盖 CRUD、transaction、undo/redo、immutable snapshot、ChangeSet、格式拒绝与 100k 性能。100k 单更新 p95 `0.42ms`、1000 节点 batch p95 `32.16ms`。 | 保持 `<2ms` / `<50ms` 回归门，并继续验证 history 与 detached snapshot 语义。 |
| Unknown node preservation | **achieved（当前格式语义）** | `packages/core/test/core.test.ts` 的 unknown-node round-trip：触发 `node-type:missing`，允许 geometry update，拒绝 props update，保留 nested props、asset/custom fields；`packages/renderer-pixi/test/renderer.test.ts` 覆盖 unknown placeholder。 | 仅需在合法的当前 SDK Document fixture 中保持该行为；不能据此接受 legacy document。 |
| P2：Pixi renderer/custom node vertical slice | **partial** | `packages/renderer-pixi/test/renderer.test.ts` 覆盖 registry、incremental ChangeSet、culling/spatial、unknown placeholder、异步 destroy race、texture lease、hit-test、capture、task-card recreate。`tests/browser/browser-contract.spec.ts` 与 `apps/examples-vanilla/src/browser-contract.js` 定义 WebGL recovery。 | 缺真实 benchmark 阈值、media-heavy、双实例压力和长时间 resource soak。Browser gate 默认可 skip；需 `PIXIBOARD_REQUIRE_BROWSER=1`/CI 的实际成功输出。 |
| P3：Facade/desktop scoped parity | **partial** | Facade 9/9；共享 adapter suite + Browser/Tauri 共 26 tests；Desktop 示例 4/4。存在真实 Tauri app，macOS `cargo test` 与二进制 `--smoke` 成功；项目切换先销毁旧 facade/lease。 | Windows 当前只有 CI 配置；media preview/playback/capture 与更完整的 clipboard/rename 产品交互仍由 Renderer/media gate 验收。 |
| P4：Core ↔ Capabilities ↔ Agent 等价 | **achieved（direct path）** | `packages/agent-tools/src/contract.test.ts` 对 direct Core、Capabilities、Agent 的最终 document/revision/ChangeSet/undo/redo 做相等断言；也覆盖 source asset+node 单 transaction、requestId、错误映射。 | MCP transport 不在此结论内。 |
| Plugin API v3 contract | **partial** | private v3 host 已覆盖 packaged directory loader、旧/v2 zip 拒绝、permission preflight、path/symlink 防护、生命周期与 UI/Agent/Plugin ChangeSet 等价。 | public `@pixi-board/plugin-sdk` 的真实 dist、API report、外部安装 fixture 尚待 release gate 合并通过。 |
| MCP direct-vs-transport equivalence | **achieved（transport scope）** | `packages/mcp-host/src/index.ts` 提供 MCP host、stdio line round-trip 与 HTTP `Request`/`Response` handler；契约测试对同一输入断言 direct Agent、stdio、HTTP 的 document、revision、ChangeSet、history、persistence 与错误语义一致。 | 真实 child-process stdio/socket deployment smoke 仍属于宿主集成 gate；本实现只接受 SDK 当前 Document，不承担旧数据兼容或迁移。 |
| P5：Browser adapter vertical slice | **achieved（capability scope）** | Browser adapter 17/17，覆盖当前 Document、File/Blob/Text/URL import、image/video/audio/text asset+node transaction、OPFS/IndexedDB、CAS/quota、download/export、derivative GC；Chromium 5/5 覆盖真实 IndexedDB、焦点/clipboard、多实例与 WebGL recovery。 | 可发布 web bundle 仍由 P6 验证；Renderer media-heavy 生命周期归 P2 gate。 |
| P6：npm pack / external consumer release gate | **partial** | `scripts/check-release-gate.mjs` 会阻断 `.ts` runtime exports、internal/private deps、`0.0.0` placeholders；`docs/15-release-gate.md` 明确当前 gate blocked。实际 `pnpm release:check` 在 2026-08-07 因 `ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`（缺安装 workspace dependency）退出 1。 | 先提供 publishable JS + `.d.ts` + 正式 dependency versions，再运行 clean external Node/Vite consumer。 |
| SemVer / API report / Changesets / bundle budget | **missing** | `packages/pixiboardjs/VERSIONING.md` 只有策略 prose；仓库无 `.changeset/`、API Extractor/report、生成 CHANGELOG 或 bundle budget check。 | 增加配置、生成物和 CI/RC gate；分别管理 SDK semver、schemaVersion、node typeVersion、plugin apiVersion、Agent schema。 |
| P7：deterministic performance thresholds | **partial** | 可执行 Node/instrumented harness 已覆盖 10k/50k/100k、Core/空间索引/culling/update/batch 与 100-cycle soak；Core 100k latency 目标已达成，报告保留旧基线的真实失败值。 | Browser/WebGL frame、capture、matched Konva、受控 heap/GPU 指标与 nightly regression 尚未全部交付。 |
| Konva comparison | **missing** | `docs/10-performance-benchmarks.md` 只有公平对照政策；无 Konva adapter、matching dataset 或结果文件。 | 在同节点数/可见密度/素材/DPR/viewport/path/runtime 下产出可复核 Pixi vs Konva 数据，只做适用场景结论。 |
| Memory/texture/listener soak | **partial** | Node/instrumented harness 执行 100-cycle create/destroy，listener/ticker/observer/view/texture lease 每轮回到零；regression comparator 阻断 >10% p95 回归和 observed→not-observed。 | 仍需真实 Chromium media-heavy、多实例/rapid view churn soak，并接入 nightly。 |

## Commands run

| Command | Result | Interpretation |
|---|---|---|
| `pnpm docs:check` | pass：30 required files、41 Markdown files、local links verified | 文档结构与 current-document-only policy checks 通过，不代表剩余产品 requirements 完成。 |
| `pnpm packages:check` | pass：workspace、public exports、MCP boundary、fixtures、executable benchmark gates | 静态 package 边界通过；发布物仍由 release gate 证明。 |
| `pnpm audit:requirements` | pass（报告型脚本） | 输出本矩阵的静态 evidence/status；不会把计划行当完成。 |
| `git diff --check` | pass | 本次 docs/ADR/audit/check scripts 改动无 whitespace error。 |
| `pnpm release:check` | exit 1：`ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`，`@pixi-board/adapter-browser` 未安装 | release gate 有脚本但当前仍未通过；没有 external consumer pass。 |
| Core / Capabilities / Agent / Facade / Renderer / MCP | pass：26 + 4 + 6 + 9 + 10 + 6 tests | 当前主分支实际执行通过。 |
| Browser / adapters / Desktop | Chromium 5/5；adapter 26 tests；Desktop 4/4；macOS Cargo smoke pass | Windows 仅 CI 配置，不能视为本机实测。 |

## Audit rule

`docs/14-parallel-execution.md` 的 commit/session 汇总只说明工作线声称合并；它不能替代测试输出、fixture、发布物或性能数据。当前仍不得提前标记完成的重点是 public release artifact/API report、matched Konva/WebGL、Renderer media-heavy soak、Windows CI 与最终 nightly/RC gate。旧数据 migration/round-trip 不属于完成条件。
