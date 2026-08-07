# CI、Nightly 与 Release Candidate 最终门

## 证据原则

- gate 必须真实执行测试、Chromium、benchmark、Cargo 或 packaging 命令；文件存在性和静态 audit 只能补充说明。
- required browser 显式安装 Playwright Chromium，并设置 `CI=true`、`PIXIBOARD_REQUIRE_BROWSER=1`；不允许 skip。
- SDK 只接受当前 `BoardDocument`。`node scripts/run-core-gate.mjs` 执行 document-only 检查和完整契约测试，不执行普通 release build。
- 平台证据按实际命名：macOS 执行 Tauri `--smoke`；Windows 执行 Cargo tests 与 native release build。未在本机运行的平台必须明确标记为等待 CI runner。

## Pull Request / Main

`.github/workflows/ci.yml` 执行：

| Job | 真实命令 | 证据 |
|---|---|---|
| Core contracts | `node scripts/run-core-gate.mjs` | docs/package/current-document 边界，以及 Core、renderer、capabilities、Agent、MCP、plugin、browser adapter、facade 测试；不做 release build |
| Browser required Chromium | 安装 Chromium；`node scripts/run-browser-contract.mjs` | required Chromium/WebGL browser contracts；不把 Node benchmark 当作 GPU 性能证据 |
| Desktop Tauri macOS | `node scripts/run-desktop-platform-gate.mjs --mode tauri` | 当前仓库 crate 的 `cargo test --locked` 与 macOS runner 上的 `cargo run --locked -- --smoke` |
| Desktop Tauri Windows | `node scripts/run-desktop-platform-gate.mjs --mode tauri` | 当前仓库 crate 的 `cargo test --locked` 与 Windows runner 上的 `cargo build --release --locked` |
| Performance PR | `node scripts/check-performance-gate.mjs pr` | 真实 SDK benchmark runner 写入 schema-v1 JSON，并校验 observed samples、目标结果和 lifecycle soak |

Core gate 与普通开发 CI 分离 release staging，满足快速开发约束；MCP 子进程所需的 Core dist 只做最小 package build，不执行完整 release staging。Browser gate 只运行其必要的消费构建契约。

## Nightly

`.github/workflows/nightly.yml` 每天 `18:17 UTC` 及手工触发：

- 重跑全部 Core、Plugin、Agent、MCP contracts。
- required Chromium/WebGL contract。
- `node scripts/check-performance-gate.mjs nightly` 真实运行 1k/10k/50k/100k Node/instrumented harness 和 100-cycle create/destroy soak，保存 `.artifacts/performance/nightly.json`。
- macOS/Windows 重跑仓库内 Tauri crate；macOS 为 launch smoke，Windows 为 native config/build evidence。

Node harness 不伪装 browser/WebGL 或 Konva。当前报告将这两项列为 `notObserved`，因此 nightly 会诚实 fail-closed，直到固定 Chromium/WebGL 与 matched Konva runner 真实接入。

## Release Candidate

`.github/workflows/release-candidate.yml` 接受完整 40 位 `candidate_sha`，并按完成时间选择该 SHA 上每个 required check 的最新一次结果。随后对同一 commit 执行：

1. `pnpm release:check`：三包 release build、三份 API report diff、主包 bundle budget、三次真实 `pnpm pack`。
2. 仓库外 npm consumer 同时安装 `@pixi-board/core`、`@pixi-board/renderer-pixi`、`pixiboardjs` 三个本地 tarball，执行 Node subpath imports、外部 TypeScript 编译与 Vite production build。
3. required Chromium 消费 candidate commit。
4. RC performance/soak；WebGL/Konva 未 observed 时保持红门。
5. 在同一 candidate checkout 上，macOS/Windows 对仓库内 Tauri 示例执行平台 gate；该 job 依赖三包 release artifact job 已成功。
6. 只有全部 job success，`Release candidate accepted` 才通过。

外部桌面产品集成可在后续 workflow 作为额外 gate，但 RC 不要求用户另填 repository/ref 来替代 SDK 自带示例。

## 当前等待依赖

- 固定 Chromium/WebGL 性能 runner、media-heavy 指标与 matched Konva comparison 尚未实现；nightly/RC performance 因真实 `notObserved` 证据保持 fail-closed。
- Windows native gate 已配置在 `windows-2022` GitHub runner；macOS 开发机不能声称已本地验证 Windows，必须等待该 runner 输出。
- Changesets/version promotion 和未来 `@pixi-board/plugin-sdk` 独立发布不在本次三个现有 public manifest 的 RC 产物内。
