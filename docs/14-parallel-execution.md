# 并行实施看板

更新时间：2026-08-07 14:23 CST

## 当前状态

| 工作线 | 状态 | 主分支结果 | 统筹结论 |
|---|---|---|---|
| Core | 已合并 | `730c024` | 17 个定向测试通过；扁平 Store、Registry、同步 transaction、data patch history、Selection、Viewport 和 ChangeSet 已落地。 |
| Package / Benchmark | 已合并 | `87300aa` | package contract、Vanilla consumer fixture、10k/50k/100k synthetic-card 与 no-fake-results benchmark skeleton 已落地。 |
| Capabilities / Agent | 退回重构 | 暂未合并 | `f92dc8e` 实现了第二套 Store/Revision/History，与 Core 漂移；必须重构为 `BoardCore` adapter 后再合并。 |
| Renderer code map | 已完成只读勘察 | 未改源项目 | 已定位 `BoardScene`、NodeView、RBush、texture/media runtime、input、overlay/capture 和 teardown 接入点。 |

Capabilities 重构必须满足：

- 不复制 `BoardNode`、`AssetRecord`、`BoardChangeSet` 和 Core errors。
- 所有 create/update/delete 通过同一个 Core transaction，返回同一 revision、history entry 和 ChangeSet。
- Agent 的资产加节点写入不得拆成多次 commit。
- contract tests 同时断言 direct Core、BoardCapabilities 和 Agent adapter 的最终 document、revision、ChangeSet 与 undo/redo 一致。
- Headless preview/capture availability、AbortSignal 和 requestId 必须有明确契约。

## 统筹原则

- 主 session 负责架构决策、依赖排序、结果审查、合并和最终验证。
- 每个并行 session 使用独立 git worktree，完成后提交 commit；不直接写入主工作树。
- Session 任务必须绑定到 `docs/` 已冻结的契约，不得擅自扩大范围。
- 依赖关系优先于“谁先完成”：Core 契约是 Renderer 和 Capabilities 的共同底座。
- 旧插件不迁移、不兼容、不重新打包；插件工作只允许设计新 Plugin API v3 示例。

## 第一批 session

| Session | Worktree | 工作范围 | 依赖 | 合并顺序 |
|---|---|---|---|---:|
| `51c1f68e-398d-4233-b5da-9da3fb373b27` | `.cindy-worktrees/dazzling-leakey` | `@pixi-board/core` vertical slice：扁平文档、Store、Registry、Transaction、Patch History、Selection、Viewport、ChangeSet | 无 | 1 |
| `8c27ce48-8092-461e-bbd3-d0900299b1fa` | `.cindy-worktrees/bold-hodgkin` | BoardCapabilities 与 Agent Tools contracts、mock backend、canvas.read/write schema | Core 类型边界；可先用最小契约 | 2 |
| `c3eb4e32-4c7a-4177-ab8e-c0466c1ad2c8` | `.cindy-worktrees/steady-edison` | pnpm workspace、主包 exports 占位、Vanilla consumer fixture、benchmark skeleton | 包结构；不实现 Renderer | 3 |

## 下一批 session

Core 合并并完成主工作树定向验证后，再启动：

1. `renderer-pixi`：Pixi Scene、NodeRendererRegistry、View/Texture lifecycle、capture。
2. `adapter-browser`：IndexedDB + OPFS、Blob fallback、Object URL、asset GC。
3. Desktop integration：只改新的 SDK 宿主接线；不迁移旧插件。
4. New Plugin API v3 example：全新插件示例，不读取或复用旧插件包。

## 主 session 合并流程

```text
session 完成
  -> 主 session 检查 commit/files
  -> 在 worktree 定向测试已通过
  -> 检查是否违反 docs/ADR
  -> 主分支 cherry-pick 或合并 commit
  -> 更新 workspace 依赖和集成测试
  -> 启动下一批依赖 session
```

## 暂不并行的工作

- Renderer 不在 Core 契约未落定前实现深度集成。
- Desktop 不在主包入口和 capabilities 定型前改 `MediaWhiteboard`。
- Agent Tools 不复制现有 `board-plugin-canvas` 的旧实现，只实现新 contract。
- 旧插件不做任何迁移、兼容、重新打包或 parity 验证。

## 统筹检查表

- [x] Core commit 已完成，测试和 public types 可读。
- [ ] Capabilities 只依赖 core contract，不依赖 Pixi/Tauri。
- [x] Package skeleton 无 `workspace:*` 发布泄漏。
- [ ] Renderer registry 使用 core 的 NodeTypeDefinition 和 bounds。
- [ ] Browser adapter 通过 adapter contract，不恢复宽泛 Repository。
- [ ] New Plugin API v3 示例使用 BoardCapabilities。
- [ ] 主分支集成后运行 docs check、package tests 和 benchmark smoke。
