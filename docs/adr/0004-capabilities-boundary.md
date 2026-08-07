# ADR 0004：UI、插件和 Agent 统一使用 Capabilities

- Status: Accepted
- Date: 2026-08-07

## Context

现有项目中用户交互、PluginRuntimeHost、BoardWriteService、canvas plugin 和 MCP 已经形成多条外部写入路径。如果各自直接操作 Store/Scene，会导致 history、persistence、events 和权限语义漂移。

## Decision

- 定义稳定、typed、可序列化的 `BoardCapabilities`。
- 产品 UI、插件 capability proxy 和 Agent tool adapter 都调用该能力层。
- Capabilities 负责权限、origin、transaction、错误、取消和审计。
- 所有写入最终进入同一 Core transaction pipeline。
- Plugin Host 和 Agent Tools 可以在能力层之上增加 DTO/权限/分页，但不复制节点业务逻辑。
- MCP 只负责 transport。

## Consequences

收益：

- UI、API、Plugin 和 Agent 结果一致。
- 权限和审计集中。
- MCP 可替换为 HTTP/direct call，而不影响画布逻辑。
- Desktop app 可以成为 SDK 宿主，而不是继续拥有另一套内部画布 API。

代价：

- Capabilities 契约需要谨慎设计，避免成为新的大而全 Repository。
- 现有 Plugin API v2 插件直接废弃；SDK host 不维护 v2 adapter，也不把旧插件迁移作为切换前置条件。
- 某些低层 UI 操作仍可使用主包 API，但不得绕过 transaction service。
