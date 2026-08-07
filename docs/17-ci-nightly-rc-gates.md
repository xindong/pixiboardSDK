# CI、Nightly 与 Release Candidate 最终门

## 证据原则

- 对外发布包固定为 `pixiboardjs`、`@pixi-board/core`、`@pixi-board/plugin-sdk`。RC 必须同时上传三份 tarball 和三份 API report，并执行已合入的 API、外部消费与 bundle budget 检查。
- SDK 只接受当前 `BoardDocument` 与 Plugin API v3。PR 与 RC 都执行 `scripts/check-current-document-only.mjs`，扫描 Core、facade、plugin-sdk、plugin-api-v3 的公开源码和 manifest；BoardDocument `schemaVersion` 分支采用 fail-closed allowlist，新增缺省/间接旧 schema 分支也必须先经过审查；明确拒绝旧格式的错误分支允许保留。
- Chromium job 设置 `PIXIBOARD_REQUIRE_BROWSER=1` 并显式安装 Chromium，缺少浏览器时失败而不是 skip。
- 文件存在性不是测试证据；contract、浏览器、benchmark、Cargo 和打包命令必须真实执行。
- 平台证据按实际 runner 命名。本机 macOS 结果不能代表 Windows。

## Pull Request / Main

`.github/workflows/ci.yml` 保持聚焦：

- Static boundaries：文档、公开包、current-only 和 browser/Tauri 静态边界。
- Core and integration contracts：Core、renderer、capabilities、Agent、MCP、plugin、adapter 与 facade 契约。
- Browser required Chromium contracts：真实 Chromium 中执行公开入口、IndexedDB、adapter、focus/clipboard 与 WebGL context recovery contracts；media benchmark/soak 独立由 nightly/RC performance gate 承担。

PR 不执行完整 release staging、三包 pack、全量 benchmark 或桌面平台矩阵。Core gate 只为真实 MCP/package export 需要构建 Core，不执行普通前端 release build/typecheck。

## Nightly

`.github/workflows/nightly.yml` 每天 `18:17 UTC` 及手工触发：

- 重跑 Core、Plugin、Agent、MCP、adapter 与 facade contracts。
- 重跑 focused required Chromium browser contracts；canonical performance evidence 由独立 job 执行，避免把契约失败和 benchmark 失败混为一个证据。真实 media decode/playback 仍是未完成项。
- `scripts/check-performance-gate.mjs nightly` 生成 `.artifacts/performance/nightly/`：
  - Node 真实 1k/10k/50k/100k dataset、Core load/update、spatial index/query、instrumented renderer culling/incremental apply、facade batch 与 100-cycle SDK create/destroy soak；
  - canonical browser runner 固定执行 10k/50k/100k × matched-visible/full-retained × PixiBoardJS/Konva、30 warmup/120 samples；
  - candidate 侧从当前 checkout 加载 Core/renderer 源码，完整 rebuild/index N-node `BoardDocument`，记录 candidate SHA、document/index/active population，并验证真实 Pixi WebGL；
  - Konva 9.3.22 从 frozen workspace dependency 本地提供，在相同 Chromium、1920×1080、DPR、seed、pan path、visible/mutation plan 下验证 Canvas2D；不从 CDN 下载运行时。
- macOS 与 Windows 都对 `apps/examples-desktop-sdk/src-tauri/Cargo.toml` 执行 `cargo test --locked`；macOS 追加真实 launch smoke，Windows 追加 native release build。

浏览器结构完整性、candidate binding、WebGL/Canvas2D 和公平性 fail closed。数值性能没有固定机器 baseline delta 或获批绝对预算，明确标记为 evidence-only/non-blocking；job 成功不能表述为浏览器性能阈值通过。CI 可能使用 SwiftShader，因此报告也不声称硬件 GPU throughput、GPU memory 或 draw-call 成绩。

## Release Candidate

`.github/workflows/release-candidate.yml` 校验完整 40 位 `candidate_sha`，查找该 SHA 成功的 `CI gates` run，并确认三个命名 job 均成功，然后对同一 SHA 执行：

1. 固定 Node/pnpm 与 `pnpm install --frozen-lockfile`。
2. 三个公开包的 release build、current-document-only、API Extractor production compare、bundle budgets、外部 Node/Vite consumer，以及三次真实 pack。
3. 上传 `pixiboardjs-*.tgz`、`pixi-board-core-*.tgz`、`pixi-board-plugin-sdk-*.tgz` 和三个 `*.api.md`。
4. required Chromium browser contracts；不把这些契约误称为 media-heavy benchmark。
5. Core benchmark 阈值，以及 candidate-bound canonical Chromium WebGL/Konva evidence；浏览器数值仍为 evidence-only/non-blocking。
6. adapter contract suites。
7. macOS/Windows 仓库内 Tauri crate 的 Cargo/platform gate。
8. 只有所有依赖 job 成功，`Release candidate accepted` 才通过。

## 本地证据边界

- macOS 可本地执行静态、contract、release、Chromium benchmark 和 macOS Cargo gate。
- Windows native test/build 只能由 `windows-2022` runner 证明；在该 runner 成功前必须标记为平台待验证。
- browser benchmark 的 Pixi 8.19.0、Konva 9.3.22、Playwright 1.62.1 和 TypeScript 5.9.3 都由 benchmark package 直接锁定；frozen install 或本地资产解析失败时 nightly/RC fail closed。
