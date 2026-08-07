# ADR 0008：Browser 使用 IndexedDB + OPFS 混合存储

- Status: Accepted
- Date: 2026-08-07

## Decision

- IndexedDB 保存 document、asset metadata、索引、迁移状态和小型配置。
- OPFS 保存原始媒体与 derivatives；环境不支持 OPFS 时回退到 IndexedDB Blob store。
- 导入资产默认复制进入 SDK 管理存储，确保刷新和重新打开后可用。
- 大文件外部引用模式作为 experimental host capability，不是默认路径。
- 远程 URL 资产默认保存 URL、metadata 和 preview；原始文件离线缓存为显式 opt-in。
- Asset GC 使用 mark-and-sweep，根集合包括当前文档、history、活跃 jobs 和显式 leases。
- 未引用资产先进入可配置 quarantine，默认 24 小时，再由显式或配额触发的 prune 删除。

## Consequences

- Web SDK 可以提供完整本地媒体闭环，而不是只提供 adapter interface。
- 浏览器实现需要处理 quota、事务恢复、OPFS fallback 和 GC。
- 默认复制会增加存储使用，但行为比临时 File/Object URL 更可靠。

