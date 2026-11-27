# ADR 0015：主包依赖公开的 core 与 capabilities，不再内联

- Status: Superseded in part by [ADR 0016](0016-single-public-package-subpaths.md)（公开包范围）
- Date: 2026-11-26

## Context

`pixiboardjs` 原先通过 esbuild alias 把 `core`、`capabilities`、`renderer-pixi`、`adapter-browser` 打进自己的 dist，并且关闭了代码拆分。结果是：

- `index`、`node`、`browser` 三个入口各自带一份 core（dist 共约 671 KB，其中 `index.js` 和 `node.js` 几乎相同）；
- 同时 `@pixi-board/core` 与 `@pixi-board/capabilities` 又是独立公开包。

只要使用者同时引用两个入口，或同时安装主包与 core，进程里就有多份 core：错误类的 `instanceof` 失效、节点类型注册表等模块状态各存一份。[ADR 0012](0012-public-capabilities-agent-tools.md) 用 `isCapabilityError` brand 绕过了错误识别，但没有消除多份实体本身。

## Decision

- `pixiboardjs` 把 `@pixi-board/core` 和 `@pixi-board/capabilities` 声明为运行时 `dependencies`（`workspace:*`，打包时由 pnpm 改写为同步发布的版本），构建时保持外部引用。
- 私有包 `renderer-pixi`、`adapter-browser` 继续打进主包，但开启代码拆分，各入口共享同一个 chunk。
- 守护：
  - `scripts/check-packages.mjs` 要求主包依赖这两个公开包；
  - `scripts/check-bundle-budget.mjs` 发现主包 dist 内联 core 或 capabilities 时阻断，并按 `dist/chunk-*.js` 合计预算共享 chunk；
  - `scripts/check-release-gate.mjs` 在真实安装的消费者里断言 `pixiboardjs`、`pixiboardjs/node` 导出的 `DocumentValidationError` 与 `@pixi-board/core` 是同一个构造函数。

## Consequences

- 主包 dist 从约 671 KB 降到约 178 KB，入口文件只剩几百字节的转发。
- 公开 API 名称不变（四个入口的 API report 导出名逐一对照一致），声明文件改为从 `@pixi-board/core` / `@pixi-board/capabilities` 引用类型。
- 构建顺序必须先构建 core 和 capabilities，再构建主包；`build:release` 已按此顺序执行。
- `isCapabilityError` brand 保留，用于使用者装了不同版本副本的情况。
