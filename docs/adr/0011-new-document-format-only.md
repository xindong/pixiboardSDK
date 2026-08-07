# ADR 0011：SDK 只支持自身新 Document 格式

- Status: Accepted
- Date: 2026-08-07

## Context

旧 Pixi Board 使用 schema-v4、split board/assets snapshot 和旧项目存储流程。把这些格式纳入 PixiBoardJS 会让 Core、Desktop 接入、发布门和长期版本策略共同承担旧应用的数据生命周期，并引入长期 legacy adapter、round-trip fixture 与迁移备份责任。

## Decision

- PixiBoardJS 只接受自身定义的当前 `BoardDocument` 格式。
- 旧 snapshot、schema-v4、旧项目目录、旧 `assetId` 和旧 node data shape 在 SDK 边界明确拒绝。
- SDK 不实现 document migration、node data migration 或 legacy adapter，不做隐式或自动格式转换。
- 旧应用继续读取、保存和管理旧数据；是否在应用外部另行转换不属于 SDK 责任。
- 旧项目打开、legacy round-trip、真实旧 fixture 和 backup-before-migration 不属于 P0、Core、Desktop、Release Candidate 或 1.0 的交付与验收要求。
- `schemaVersion` 和 `typeVersion` 是当前格式判别字段；不匹配时返回明确校验错误，而不是启动迁移链。

## Consequences

收益：

- SDK 文档契约、测试矩阵和发布门只覆盖一个新格式。
- Core、adapter 和 Desktop host 不需要长期维护两套数据语义。
- 旧应用的数据安全与生命周期保持在原应用边界内。

代价：

- 旧项目不能直接交给 PixiBoardJS 打开。
- 如果未来产品决定提供一次性转换工具，必须作为 SDK 外独立项目重新决策，且不能演变为 SDK legacy adapter。
