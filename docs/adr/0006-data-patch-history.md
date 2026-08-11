# ADR 0006：History 使用数据化正向/逆向 Patch

- Status: Accepted
- Date: 2026-08-07

## Decision

- v1 history entry 保存可序列化的 forward patch 与 inverse patch，不保存任意 apply/revert 闭包。
- History 默认只存在当前 session，不随文档持久化。
- Transaction 是 history、revision 和 ChangeSet 的提交单位。
- 拖拽、resize 等高频手势按帧提交正式 transaction（每帧一个 revision 与 ChangeSet），但同一手势的所有帧共享 `TransactionOptions.coalesceKey`，在 history 中合并为单个 undo entry。合并时按 id 压缩重复的 replace patch，一次 300 帧、50 节点的手势只留每个节点各一条正反向 patch，而不是 15000 条。含 insert/remove 的序列不压缩（顺序相关），手势路径不涉及结构性编辑。
  - 取代原「发 `interaction:preview`、不增加 revision、pointer commit 时才提交」的设计：预览通道要求 renderer 与所有观察者维护一份不在 document 里的临时几何，等价于第二份事实来源，与 ADR 0002「document 是唯一事实来源」冲突。按帧提交 + history 合并用同一条写入管线拿到同样的 undo 粒度。
- Public API 不暴露内部 patch 格式为长期协作协议；后续协作可以复用或替换内部实现。

## Consequences

- History 更易测试、审计和调试。
- Plugin/Agent 批量写入可生成确定性的逆向修改。
- 比闭包 command 多一些 patch 生成成本，但避免函数捕获和跨包依赖。

