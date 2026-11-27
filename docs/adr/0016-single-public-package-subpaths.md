# ADR 0016：只公开 `pixiboardjs`，原公开包改为子路径

- Status: Accepted
- Date: 2026-11-26
- Supersedes: [ADR 0010](0010-public-package-scope.md) 中"同时公开 Core 和 Plugin SDK"、[ADR 0012](0012-public-capabilities-agent-tools.md) 中"capabilities 与 agent-tools 转为公开包"、[ADR 0015](0015-main-package-depends-on-public-core.md) 中"主包依赖公开的 core 与 capabilities"

## Context

此前公开 5 个包：`pixiboardjs`、`@pixi-board/core`、`@pixi-board/capabilities`、`@pixi-board/agent-tools`、`@pixi-board/plugin-sdk`。

- 5 个包在 `.changeset/config.json` 的同一个 fixed 版本组里，`plugin-sdk` 并没有按 ADR 0010 所说独立升 major。分包没有带来版本独立性，只增加了用户要理解的组合和维护面（5 份 tarball、9 份 API report、5 份体积预算）。
- 多个公开包意味着用户可能装到多份 core（见 ADR 0015）。ADR 0015 用外部依赖缓解，但只要还存在可独立安装的 core，版本错配就可能产生第二份实体。
- 项目约定"对外默认只有一个主包"。

## Decision

- 只发布 `pixiboardjs`。原公开包改为私有 workspace 包，以主包子路径提供：

  | 原包 | 子路径 |
  |---|---|
  | `@pixi-board/core` | `pixiboardjs/core` |
  | `@pixi-board/capabilities` | `pixiboardjs/capabilities` |
  | `@pixi-board/agent-tools` | `pixiboardjs/agent-tools` |
  | `@pixi-board/agent-tools/schemas` | `pixiboardjs/agent-tools/schemas` |
  | `@pixi-board/plugin-sdk` | `pixiboardjs/plugin` |

- 所有 workspace 包打进主包，开启代码拆分；JS 与 `.d.ts` 都拆出共享文件，各子路径引用同一份 core 实现和同一份类型声明。主包运行时只依赖 `pixi.js`。
- 包名、目录和仓库内的 `@pixi-board/*` import 保持不变，只是不再发布。私有包仍留在 changesets 的 fixed 组里随主包记版本，`changeset publish` 不会发布私有包。
- 过渡：`scripts/build-legacy-shims.mjs` 生成旧包名的最后一版，每个只转发到对应子路径并依赖同版本 `pixiboardjs`。维护者在发布该版本时手动发布这 4 个 tarball，并执行 `npm deprecate` 指向子路径；之后不再发布旧包名。
- 守护：
  - `check-packages` 要求旧包保持 `private`、主包导出全部子路径、主包不依赖任何 `@pixi-board/*`；
  - `check-bundle-budget` 要求主包 dist 里 core 和 capabilities 各只定义一次；
  - `check-api-report` 为 9 个入口各生成一份报告；
  - `check-release-gate` 在真实安装的消费者里验证各入口和旧包名转发拿到同一个构造函数，并在类型层面把 `pixiboardjs/core` 创建的 core 传给 `pixiboardjs/capabilities`。

## Consequences

- 9 个入口的导出名与改动前逐一对照一致（共 668 个），用户只需要把 import 路径从 `@pixi-board/x` 换成 `pixiboardjs/x`。
- 一个包从根上消除多份 core；发布物从 5 份 tarball 降为 1 份。
- 只用 headless / Agent 能力的使用者也会下载 `pixi.js`，但只导入 `pixiboardjs/core`、`/capabilities`、`/agent-tools` 时不会加载它。
- 插件作者从 `pixiboardjs/plugin` 引用契约，插件 API 版本以 `PLUGIN_API_VERSION` 表达，不再依赖独立包的 major。
- `CapabilityError` 的 brand 字符串保留原值，仍能识别旧版本抛出的错误。
