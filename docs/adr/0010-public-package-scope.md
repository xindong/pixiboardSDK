# ADR 0010：Public Beta 同时公开 Main、Core 和 Plugin SDK

- Status: Accepted
- Date: 2026-08-07

## Decision

Public beta 首批公开：

```text
pixiboardjs
@pixi-board/core
@pixi-board/plugin-sdk
```

- `pixiboardjs` 与 `@pixi-board/core` 在 1.x 采用 lockstep version，减少兼容矩阵。
- `@pixi-board/plugin-sdk` 按独立 Plugin API major 管理。
- `renderer-pixi`、adapter-tauri、plugin-host、agent-tools 和 mcp-host 初期保持内部。
- Beta 首发只提供 Vanilla 示例；React/Vue wrapper 不进入 v1 关键路径。
- 2026-08-07 查询 npm registry 时 `pixiboardjs` 尚未被占用；P0 需要实际发布预留版本才能锁定名称。

## Consequences

- Headless、Agent 和高级用户可以直接消费 Core。
- Core 从 beta 开始承担公开 API、类型和 semver 责任。
- 需要为 Main/Core 提供独立 external consumer 和 API report。

