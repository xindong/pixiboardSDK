# ADR 0012：公开 capabilities 与 agent-tools，删除 mcp-host

- Status: Accepted
- Date: 2026-08-11
- Supersedes: [ADR 0010](0010-public-package-scope.md) 中关于 `capabilities`、`agent-tools`、`mcp-host` 的可见性决定

## Context

ADR 0010 把 `capabilities`、`agent-tools` 和 `mcp-host` 都定为内部包。实际检查发现两个问题：

1. **内部包对第三方等于不存在。** 它们 `private: true`、不在 `build:release`、不在 release gate 的 publicPackages，`pixiboardjs` 也没有 re-export `agent-tools`。在仓库外建干净 consumer 验证：三个包全部 `MODULE_NOT_FOUND`。因此「留着但不公开」在功能上等价于删除。

2. **`mcp-host` 接不上任何真实客户端。** 它只实现 `tools/call`，没有 `initialize` / `tools/list` 握手，MCP 客户端第一步就会失败。

同时出现了明确的外部需求：第三方 agent 项目希望嵌入本画布，用自己的 agent 实现操作它。这要求受控写入面本身可被独立安装。

## Decision

- **`@pixi-board/capabilities` 与 `@pixi-board/agent-tools` 转为公开包**，与 `pixiboardjs` / `core` / `plugin-sdk` 同属 changesets 的 fixed 版本组。
- **删除 `@pixi-board/mcp-host`**，transport 不属于 SDK 范围。
- `agent-tools` 保留 `./schemas` 子路径导出，JSON Schema 是给 LLM 的一等公民入口，单独出 API report。
- 两个包的依赖**外部化**，不复制 `pixiboardjs` 的 esbuild alias 内联策略，避免 npm 上出现多份 `capabilities` 实体。

### 分层理由

| 层 | 归属 | 理由 |
|---|---|---|
| `capabilities` | SDK | 权限、事务、origin、错误映射，是画布语义的一部分 |
| `agent-tools` | SDK | JSON Schema、compact DTO、字段投影、source→asset 单次提交翻译，接入方自行实现容易破坏「单一写入通道」不变量 |
| transport（MCP / HTTP / WS） | 接入方 | 协议仍在演进，且与画布语义正交 |

## 跨副本错误识别

`pixiboardjs` 用 esbuild alias 把 `capabilities` 内联进自己的 dist，所以它抛出的 `CapabilityError` 与从 `@pixi-board/capabilities` 导入的类不是同一个构造函数，`instanceof` 为 false。这个隐患在 `capabilities` 公开前就已存在（`core` 早已公开且同样被内联）。

`CapabilityError` 因此带一个跨副本可识别的 brand，并导出 `isCapabilityError(value)`。`agent-tools` 的错误映射与 `mapCoreError` 都改用它，`instanceof` 为真的路径行为不变。

## Consequences

收益：

- 第三方 agent 项目可以只装 `@pixi-board/capabilities` 自建工具层，或直接用 `@pixi-board/agent-tools` 的既有契约。
- 对外叙事收敛为「画布 + 受控写入面 + agent 工具契约；传输自行组装」，不再宣传一个装不上的 MCP server。
- 消除了既有的跨副本 `instanceof` 隐患。

代价：

- 两个包的公开 API 从此受 semver 约束。JSON Schema 的字段名变更对下游 agent 行为的破坏不会在 TypeScript 层报错，需要按 breaking change 对待。
- 公开包数量从 3 增至 5，release gate、API report 和 bundle budget 的维护面相应扩大。
- 失去 MCP transport 的部署等价性证据；该证据随包一并删除，不再是验收项。
