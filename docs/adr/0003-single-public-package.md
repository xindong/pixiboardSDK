# ADR 0003：一个主要公开包，多个内部包

- Status: Accepted
- Date: 2026-08-07

## Context

SDK 需要清晰的 core、renderer、capabilities 和 adapter 边界，但要求普通用户自行安装和匹配多个包会增加接入、版本和重复 Pixi runtime 风险。

## Decision

- 普通用户只安装 `pixiboardjs`。
- 仓库内部允许拆分多个 workspace package。
- `@pixi-board/plugin-sdk` 继续作为插件作者的独立公共契约。
- `@pixi-board/core` 从 Public beta 起同时公开给 headless/高级用户，并与主包在 1.x lockstep version。
- renderer、Tauri adapter、plugin host、Agent tools 和 MCP host 初期保持内部或高级包。
- 主包可以使用 `pixiboardjs/browser` 等 subpath exports 暴露平台 helper。

## Consequences

收益：

- 普通接入简单。
- 内部依赖方向仍可通过包边界保持。
- 主包统一 PixiJS 版本和默认装配。

代价：

- 主包需要注意 bundle 拆分和 lazy loading。
- 内部包版本与主包发布需要自动编排。
- 高级用户的 tree-shaking/独立 core 需求需通过子入口或后续公开包满足。
