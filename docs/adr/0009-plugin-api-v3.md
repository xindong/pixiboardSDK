# ADR 0009：废弃旧插件，面向新插件定义 Plugin API v3

- Status: Accepted
- Date: 2026-08-07

## Decision

- PixiBoardJS SDK 不提供 Plugin API v2 兼容 adapter。
- 当前官方和内部插件不迁移，随旧应用插件体系直接废弃。
- Plugin API v3 使用 typed SDK DTO、BoardCapabilities、统一 origin/revision/ChangeSet。
- 新插件 contract 设计为跨平台，但 SDK v1 只交付 Desktop zip loader；Web ESM loader 延后，不阻塞 v1。
- 注册自定义 Pixi node renderer 必须声明 `renderer:trusted` 权限，并被宿主作为可信代码安装。
- Plugin API version 独立于 SDK semver 和 document schemaVersion。

## Consequences

- 不需要长期维护 unknown DTO 和两代 capability adapter。
- 不需要为旧插件维护迁移、兼容或重新打包路径，显著降低 desktop 切换范围。
- 未来新插件必须按 v3 重新开发；旧 v2 插件不能运行于新 SDK host。
