# Requirement-by-requirement completion audit

审计基线：`main` / `2f0fc14`（2026-08-07）及其上的交付证据链修复。本矩阵只把当前源码、测试、提交产物或可重复命令作为证据；roadmap、session 状态和“已合并”描述本身不构成完成证据。

状态含义：

- **achieved**：当前范围有直接实现与可定位验收证据。
- **partial**：已有垂直切片、配置或局部验收，但完整 gate 仍有明确缺口。
- **missing**：没有实现或没有可复核验收证据。

## Completion matrix

| Requirement | Status | Evidence | Missing acceptance / next gate |
|---|---|---|---|
| Current-document-only boundary | **achieved** | `docs/adr/0011-new-document-format-only.md` 冻结只支持 SDK 自身新格式；`packages/core/src/document-validation.ts` 拒绝 older/newer schema、旧顶层 `assetId`；当前 Core 不包含 document/node migration surface。`packages/core/test/core.test.ts` 覆盖 future/older schema、legacy `assetId` 和 split snapshot 拒绝。 | schemaVersion/typeVersion 改动时继续保持明确拒绝；不得重新加入 legacy adapter 或隐式转换。 |
| Headless Core | **achieved** | `packages/core/src/*` 没有 DOM/Pixi/Tauri/plugin 依赖；`packages/core/test/core.test.ts` 覆盖 CRUD、Map/index store、transaction atomicity、async transaction 防延迟写入、undo/redo、immutable snapshot、ChangeSet、unknown node 和非 JSON 输入；`packages/core/test/performance.test.ts` 提供 deterministic Core 性能契约。 | 继续保持 Core 与平台层隔离，并把性能回归接入稳定 CI gate。 |
| Unknown node / custom node current-format contract | **achieved（当前格式语义）** | Core unknown-node 测试覆盖 missing event、geometry update、props 禁写和 JSON round-trip；`packages/renderer-pixi/test/renderer.test.ts` 与 `apps/examples-custom-node/test/custom-node.test.ts` 覆盖 placeholder、注册后恢复、task-card 生命周期。 | 该行为只适用于外层已通过当前 Document 校验的节点；不能据此接受旧格式。 |
| Core ↔ Capabilities ↔ Agent equivalence | **achieved** | `packages/capabilities/src/contract.test.ts` 覆盖单 transaction、no-op、abort、headless availability 和错误；`packages/agent-tools/src/contract.test.ts` 对 direct Core、Capabilities、Agent 的 document/revision/ChangeSet/undo/redo、requestId 和 source asset+node 单提交做等价断言。 | MCP transport 的部署证据单独见下一行；不能复制第二套写入链。 |
| MCP direct / real deployment equivalence | **achieved** | `packages/mcp-host/src/contract.test.ts` 6 项与 `packages/mcp-host/src/deployment.test.ts` 5 项（合计 11 tests）覆盖 direct Agent、stdio、HTTP handler 的同输入语义；真实 spawn child/loopback socket 还验证完整 startup stderr、`REQUEST_ABORTED` socket signal acknowledgement、stdin EOF 后 stdout 无 late frame、无 write/save/history，以及统一 child/temp cleanup；`docs/17-mcp-transport-audit.md` 记录边界。 | 后续宿主集成仍需在目标产品环境重复 smoke；MCP 不承担旧 Document 迁移。 |
| Renderer incremental boundary / recovery | **achieved** | `packages/renderer-pixi/test/renderer.test.ts` 19 项 focused tests 覆盖 changed-node-only apply、lazy culling membership（不枚举完整候选集）、revision gap 返回 `rebuild-required`、failed apply 后 desynchronized rebuild recovery；`packages/pixiboardjs/test/facade.test.ts` 覆盖 facade full-snapshot recovery。 | 继续保持增量路径只处理 changed IDs；只有 revision gap、document replacement 或 desynchronized 才允许 full rebuild。 |
| Plugin API v3 / public Plugin SDK | **achieved（contract scope）** | `packages/plugin-sdk/src/index.ts` 只公开 v3 facade，`packages/plugin-sdk/test/contract.test.ts` 验证 `definePlugin` typed surface；`packages/plugin-api-v3/src/packaged-host.test.ts` 覆盖 packaged directory loader、v2/legacy zip 拒绝、权限、path/symlink 防护、生命周期和 UI/Agent/Plugin ChangeSet 等价。 | public dist、外部安装和 tarball 证据归 release gate，不把旧插件迁移或 v2 adapter 纳入 SDK。 |
| Browser persistence / Web adapter | **achieved（adapter scope）** | `packages/adapter-browser/test/browser-persistence-adapter.test.ts` 覆盖当前 Document round-trip、CAS、quota retry、OPFS/IndexedDB fallback、imports、derivative GC、URL lease 和 destroy；`tests/browser/browser-contract.spec.ts` 覆盖真实 Chromium IndexedDB、focus/clipboard、多实例和 WebGL recovery。 | 可发布 web bundle 仍需通过 P6 release gate；媒体 decode/playback 不由 adapter contract 单独证明。 |
| Browser/WebGL renderer acceptance | **partial** | `docs/benchmarks/2026-08-07-renderer-browser-acceptance.json` 记录 Chromium + Pixi WebGL 的 incremental create/update/delete、texture race、dual instance、capture、100-cycle destroy 和 100/500/2000 image + 1/4/8 video adapter-scale 验收；candidate-bound canonical runner 另覆盖 PixiBoardRenderer/Konva 10k/50k/100k 两种模式，并对 SHA、完整 BoardDocument/spatial population、active plan 和 WebGL fail closed。 | canonical 数值仅为 evidence-only，尚无固定机器 baseline delta/绝对预算；media-heavy 仍非实际 decode/playback，GPU memory、draw calls、idle CPU/GPU 和硬件 GPU throughput未观测。 |
| Desktop/Tauri SDK integration | **partial** | `packages/adapter-tauri/test/tauri-adapter.test.ts`、`apps/examples-desktop-sdk/test/desktop-sdk.test.ts` 与 `project-session-controller.test.ts` 覆盖当前 Document persistence、UI/Agent/Plugin v3 ChangeSet、v2 拒绝和 project switch 前 destroy；`.github/workflows/desktop-launch-smoke.yml` 配置 macOS/Windows smoke；docs 记录 macOS cargo/binary smoke。 | Windows 只有 workflow 配置，尚无本审计可复核的成功日志；完整产品媒体 preview/playback/clipboard parity 仍未完成。 |
| Public release gate (`npm pack` / external consumer) | **achieved（本次真实命令证据）** | 本审计依次执行 `pnpm build:release` 与 `pnpm release:check`；三 public tarball 同时安装到仓库外 consumer，Node imports、外部 TypeScript compile、Vite production build 均通过。设置 artifact dir 时，三 tarball、三份正确 API report、bundle JSON 和 manifest 被持久化；dist/tarball 不入库。 | 每个 release candidate 仍需在目标 commit 重新运行 build + release gate；本状态不意味着 dist 已提交。 |
| SemVer / Changesets / API report / bundle budget | **achieved（本次真实命令证据）** | `.changeset/config.json`、三个 public package 的 changelog、`api-extractor.json`、committed `etc/*.api.md` 和 `bundle-budget.json` 均存在；同一 release run 中 API compare 与 bundle budget 通过，bundle report 记录每个受约束文件的 bytes/maxBytes/passed。 | 每次 public API 或 bundle budget 改动后重新运行 API/bundle checks，并保持 reports/budgets 同步。 |
| Deterministic Core/renderer benchmark | **partial** | `apps/benchmark/src/*` 和 `apps/benchmark/test/*` 提供 1k/10k/50k/100k synthetic-card、Core/spatial/culling/update/batch、facade single-save 和 100-cycle lifecycle harness；`docs/benchmarks/2026-08-07-node-instrumented-summary.json` 保留真实 p95 与 observed/notObserved 字段；canonical Chromium Pixi/Konva frame 数据单独记录于 `docs/10-performance-benchmarks.md`。 | 当前 Node instrumented Core p95 与原始 `<2ms`/`<50ms` 目标仍失败；不能把它或 SwiftShader browser 结果解释为硬件 GPU 证据。 |
| Media-heavy real renderer | **partial** | Chromium report 有 100/500/2000 image 和 1/4/8 video 的可见集/lease/destroy 结果，且保留 limitations。 | 尚未验证真实媒体 decode/playback、显存和长时间 media churn；必须由真实 browser/nightly/RC gate 补齐。 |
| Konva comparison | **partial（candidate-bound evidence-only）** | `apps/benchmark/src/browser-runner.mjs` 固定 10k/50k/100k、matched-visible/full-retained、mutation/visible/active plan，候选侧加载当前 workspace `BoardDocument`/`GridSpatialIndex`/`PixiBoardRenderer` 并验证 WebGL，Konva 9.3.22 验证 Canvas2D；artifact 记录 candidate SHA、document/index/active population。 | 尚无固定机器 baseline delta 或获批绝对预算，不能称性能 gate passed；仅适用于稀疏矩形卡片 workload，不代表全面优于 Konva。 |
| Nightly regression gate | **partial** | `.github/workflows/nightly.yml` 分别执行 Node 10k/50k/100k + 100-cycle soak 和 candidate-bound canonical Chromium Pixi WebGL/Konva benchmark，并上传 node/browser/summary JSON；同时配置 required browser contracts、Tauri、Plugin/Agent/MCP/adapters。 | 尚无可复核的完整 nightly artifact/成功日志；真实 media decode/playback、GPU memory/draw calls、硬件 GPU throughput 仍不在已证明范围。 |
| Browser boundary / platform isolation | **achieved（static boundary）** | `scripts/check-browser-boundary.mjs` 从 `packages/pixiboardjs/src/browser.ts` 递归检查源码依赖并拒绝 Tauri；`tests/browser/browser-contract.spec.ts` 还断言网络资源不请求 Tauri。 | 每次新增 browser entry 或 adapter 时继续运行 boundary check；这不代表 release tarball 已通过。 |

## Commands run for this audit

| Command | Result | Interpretation |
|---|---|---|
| `pnpm audit:requirements` | pass：输出本矩阵的静态 evidence/status（含 MCP 11 tests、renderer 19 tests、Konva candidate-bound evidence-only） | 只检查可定位源码、测试、配置和产物；不会把 roadmap 行当完成。 |
| `pnpm build:release` | pass：Core、pixiboardjs、plugin-sdk 三个 public package 的 JS + `.d.ts` 构建成功 | 发布验收例外允许生成本地 dist；dist 不提交。 |
| `pnpm api:check` | pass：API report compare passed（production mode matches committed reports） | 这是本次 worktree 的真实命令输出；每个 release candidate 需重跑。 |
| `pnpm bundle:check` | pass：Bundle budget passed | 这是本次 worktree 的真实命令输出；每个 release candidate 需重跑。 |
| `PIXIBOARD_RELEASE_ARTIFACT_DIR=<temp> PIXIBOARD_BUNDLE_REPORT=<temp>/bundle-report.json pnpm release:check` | pass：`consumer node imports passed`、`consumer npm run check passed: external TypeScript declarations compile`、`consumer npm run build passed`、`API report compare passed`、`Bundle budget passed`、`Release gate passed`；三 tarball、三 API report、bundle JSON 和 manifest 均存在 | 验证 CI output-dir contract；临时 dist/tarball/report 不纳入 Git。 |
| 两次 `node scripts/check-performance-gate.mjs pr` + `check-regression.mjs --tolerance 0.5` | pass：同一环境 fingerprint，25 个真实 baseline/candidate comparisons，0 regressions | 这是快速 Node PR gate；不替代 canonical browser evidence 或硬件 GPU benchmark。 |
| `PIXIBOARD_PERFORMANCE_DIR=<temp> node scripts/check-performance-gate.mjs nightly` | pass：58 个 Node observations、全部 blocking targets、100-cycle soak；candidate SHA `2f0fc14` 的 12-case canonical browser report 结构/公平性通过 | browser 数值明确为 evidence-only/non-blocking；本机为 ANGLE SwiftShader，GPU memory/draw calls 与硬件 throughput 未证明。 |
| `PIXIBOARD_DESKTOP_PLATFORM="macOS local verification" node scripts/run-desktop-platform-gate.mjs --mode tauri` | pass：locked Cargo tests 与真实 `--smoke` 二进制均退出 0 | 只证明本机 macOS；Windows 仍等待 `windows-2022` runner 成功日志。 |
| `pnpm docs:check` | pass：30 required files、53 Markdown files、all local links verified（release/API checks 生成的 ignored temp API reports 计入扫描） | 文档结构与 local-link 检查通过，不等价于剩余产品 requirements 完成；temp/dist 不入库。 |
| `pnpm packages:check` | pass：workspace/public exports/MCP boundary/fixtures/benchmark gates | 这是 package 结构门，不等价于 npm tarball 成功。 |
| `git diff --check` | pass | 审计文档和脚本无 whitespace error。 |

## Audit rule

本审计明确区分“实现/契约存在”和“真实环境 gate 已通过”。当前可以确认的是新 Document 边界、Core/Capabilities/Agent、MCP real deployment、renderer 增量恢复、Plugin API v3 contract、Browser adapter、Desktop scoped fixture、PR Node baseline comparison、candidate-bound Pixi/Konva evidence runner 以及本次 public release/API/bundle gate 已通过；仍不能提前标记完成的是 browser 数值预算、完整 nightly/RC artifact、真实 media-heavy decode/playback、GPU memory/draw calls、硬件 GPU throughput 和 Windows 成功 smoke。旧插件不迁移、不兼容、不重新打包，也不作为任何 SDK parity 证据。
