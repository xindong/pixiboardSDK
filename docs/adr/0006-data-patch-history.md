# ADR 0006：History 使用数据化正向/逆向 Patch

- Status: Accepted
- Date: 2026-08-07

## Decision

- v1 history entry 保存可序列化的 forward patch 与 inverse patch，不保存任意 apply/revert 闭包。
- History 默认只存在当前 session，不随文档持久化。
- Transaction 是 history、revision 和 ChangeSet 的提交单位。
- 拖拽、resize 等高频预览发 `interaction:preview`，不增加 document revision/history；pointer commit 时提交一次正式 transaction。
- Public API 不暴露内部 patch 格式为长期协作协议；后续协作可以复用或替换内部实现。

## Consequences

- History 更易测试、审计和调试。
- Plugin/Agent 批量写入可生成确定性的逆向修改。
- 比闭包 command 多一些 patch 生成成本，但避免函数捕获和跨包依赖。

