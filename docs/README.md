# PixiBoardJS 文档总览

- [开发者文档](developers/README.md)：面向 SDK 使用者的安装、公开 API、接入方式和可复制示例。
- [开发者文档一致性清单](developers/api-consistency.md)：当前公开代码与知识文档的差异、规划边界和维护顺序。

下面的文档主要面向维护者，记录产品目标、架构决策、迁移顺序和交付验收；它们不是当前公开 API 的完整参考。开发 SDK 时请先阅读开发者文档，再按需要查阅这些设计资料。

1. [00-product-goals.md](00-product-goals.md)：为什么做、做什么、不做什么。
2. [01-current-state.md](01-current-state.md)：现有 `pixi-board` 的可复用基础和主要耦合。
3. [02-target-architecture.md](02-target-architecture.md)：SDK 最终分层与运行时数据流。
4. [03-package-boundaries.md](03-package-boundaries.md)：一个用户包与多个内部包如何共存。
5. [04-public-api.md](04-public-api.md)：用户实际调用的 API 轮廓。
6. [05-custom-node-system.md](05-custom-node-system.md)：自定义节点数据与 Pixi Renderer 生命周期。
7. [06-capabilities-plugins-agents.md](06-capabilities-plugins-agents.md)：应用、插件和 Agent 在哪一层。
8. [07-platform-assets-persistence.md](07-platform-assets-persistence.md)：Web/Tauri 的资产和持久化适配。
9. [08-migration-plan.md](08-migration-plan.md)：现有文件如何逐批迁移。
10. [09-delivery-roadmap.md](09-delivery-roadmap.md)：阶段交付物、工期与退出条件。
11. [10-performance-benchmarks.md](10-performance-benchmarks.md)：高性能承诺如何被证明。
12. [11-testing-release-compatibility.md](11-testing-release-compatibility.md)：测试矩阵、版本和发布策略。
13. [12-risks-open-decisions.md](12-risks-open-decisions.md)：风险登记和已经冻结的实现决策。
14. [13-traceability.md](13-traceability.md)：目标、文档、代码迁移和验收之间的映射。
15. [14-parallel-execution.md](14-parallel-execution.md)：并行 session 的任务、依赖、worktree 和合并顺序。
16. [15-release-gate.md](15-release-gate.md)：P6 真实 npm tarball、workspace 改写与外部 consumer 发布门。
17. [16-requirement-completion-audit.md](16-requirement-completion-audit.md)：按 requirement 对照源码、测试和可重复命令的完成审计。

## 架构决策记录

- [adr/0001-flat-document-model.md](adr/0001-flat-document-model.md)
- [adr/0002-document-source-pixi-cache.md](adr/0002-document-source-pixi-cache.md)
- [adr/0003-single-public-package.md](adr/0003-single-public-package.md)
- [adr/0004-capabilities-boundary.md](adr/0004-capabilities-boundary.md)
- [adr/0005-document-runtime-details.md](adr/0005-document-runtime-details.md)
- [adr/0006-data-patch-history.md](adr/0006-data-patch-history.md)
- [adr/0007-renderer-and-pixi-policy.md](adr/0007-renderer-and-pixi-policy.md)
- [adr/0008-browser-storage.md](adr/0008-browser-storage.md)
- [adr/0009-plugin-api-v3.md](adr/0009-plugin-api-v3.md)
- [adr/0010-public-package-scope.md](adr/0010-public-package-scope.md)
- [adr/0011-new-document-format-only.md](adr/0011-new-document-format-only.md)
- [adr/0012-public-capabilities-agent-tools.md](adr/0012-public-capabilities-agent-tools.md)

## 完成定义

规划阶段完成必须同时满足：

- 产品目标和非目标明确。
- 所有目标层都有责任边界和依赖方向。
- 现有主要代码都有目标归属或保留理由。
- 公共 API、自定义节点、插件和 Agent 路径有具体契约草案。
- 每个迁移阶段都有交付物、验收项、风险门和回滚策略。
- 性能目标由可重复 benchmark 定义，而不是只使用“比 Konva 快”等口号。
- SDK 只支持自身新 Document 格式；旧格式明确拒绝且不进入迁移、desktop 或 release 验收。
- 文档通过 `pnpm docs:check`。
