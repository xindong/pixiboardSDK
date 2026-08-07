# PixiBoardJS 文档总览

这套文档定义 PixiBoardJS 的产品边界、目标架构、迁移顺序和可验证的交付标准。目标是让实现阶段可以按里程碑推进，而不是在重构过程中重新讨论基本方向。

## 推荐阅读顺序

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

## 完成定义

规划阶段完成必须同时满足：

- 产品目标和非目标明确。
- 所有目标层都有责任边界和依赖方向。
- 现有主要代码都有目标归属或保留理由。
- 公共 API、自定义节点、插件和 Agent 路径有具体契约草案。
- 每个迁移阶段都有交付物、验收项、风险门和回滚策略。
- 性能目标由可重复 benchmark 定义，而不是只使用“比 Konva 快”等口号。
- 文档通过 `pnpm docs:check`。
