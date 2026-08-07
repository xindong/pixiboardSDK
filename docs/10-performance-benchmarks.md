# 性能目标与基准

## 定位

PixiBoardJS 的性能承诺限定为大型、稀疏、媒体密集无限画布。不能在没有对照数据时宣称“全面快于 Konva”。

## 不变量

1. 文档节点数不等于 Pixi DisplayObject 数。
2. ID 查询为 O(1)。
3. 单节点空间索引更新目标为 O(log N)。
4. pan/zoom 热路径主要与可见节点和预加载节点数相关。
5. 单节点更新不得全量重建 Scene。
6. 一个 transaction 只产生一次 revision、ChangeSet 和 persistence schedule。
7. 无动画、视频和交互时使用按需渲染。
8. View、Texture lease、listener 和 ticker 在 destroy 后回到基线。

## 当前需要修复的热路径

源项目 [`boardStore.ts`](../../pixi-board/apps/desktop/src/board/boardStore.ts) 中需要关注：

- `replaceNodes()` 的逐节点 `findIndex`。
- `nextZIndex()` 的全量 reduce。
- 返回内部可变对象。
- node type 与 asset replacement 联动。

目标运行结构：

```text
nodeById: Map<string, Node>
orderedIds: stable ordering structure
maxZIndex: cached counter/index
assetById: Map<string, Asset>
revision: number
```

## Benchmark 数据集

### Synthetic Card

- 1k、10k、50k、100k 节点。
- 少量共享纹理。
- 固定尺寸和随机世界坐标。
- 用于测 document、spatial index、culling、pan/zoom 和 selection。

### Media Heavy

- 100、500、2k 独立图片纹理。
- 1、4、8 个视频节点。
- 不同 preview 尺寸和 LOD。
- 用于测纹理上传、显存、media runtime 和 asset churn。

### Custom Node

- task card：Graphics + Text。
- chart node：多图元更新。
- animated node：按需 ticker。
- 用于验证第三方 renderer 性能边界。

### Konva 对照

只比较双方都能合理表达的场景：

- 同节点数。
- 同可见密度。
- 同素材尺寸。
- 同设备、浏览器、DPR 和 viewport。
- 同样的 pan/zoom 路径和运行时长。

对照结论只能表述适用场景，不推广为所有 Canvas 工作负载。

## 初始工程目标

以下阈值是实现期基线，首次 benchmark 后允许通过 ADR 校准：

| 场景 | 初始目标 |
|---|---|
| 10k nodes，200 可见 | pan/zoom p95 frame ≤ 16.7ms；>33ms frame <1% |
| 50k nodes，300 可见 | p95 frame ≤ 20ms |
| 100k sparse，300 可见 | 不创建 100k DisplayObject；fixture 解析后首个可交互 ≤2s |
| active views | ≤ visible+padding 目标数的 1.5 倍 |
| 单节点 core update | p95 <2ms，禁止全量扫描 |
| 1000 节点 batch update | 一个 transaction/change/save；core p95 <50ms |
| idle 10s | 无视频/动画时接近零持续 render |
| viewport 1080p capture | p95 <500ms，且不破坏 culling 状态 |
| 100 次 create/destroy | listener/ticker/view/texture 回到基线 |

## 指标

- p50、p95、p99 frame time。
- long frame 比例。
- document load 和 first interactive。
- core transaction latency。
- active Pixi View 数量。
- texture lease 和 GPU 资源估计。
- JS heap。
- draw calls/batches（工具允许时）。
- asset preparation queue 深度。
- idle CPU/GPU 活动。
- destroy 后残留 listener/ticker。

只报告平均 FPS 会掩盖卡顿，不能作为唯一指标。

## 操作场景

- 连续水平/垂直 pan。
- 鼠标中心 zoom in/out。
- fit all / fit selected。
- 框选和拖拽 1、10、100 个节点。
- 单节点连续移动和 resize transient commit。
- 批量创建/更新/删除 1k 节点。
- 快速来回滚动触发 View 延迟销毁。
- preview refresh 和 texture replacement。
- 100 张图片并发导入并取消。
- 视频启动、切换和关闭。
- 多实例和长时间 soak。

## 自定义节点性能契约

- create/update/destroy 纳入 diagnostics。
- update 不应默认每帧调用，只在数据、LOD 或 runtime state 变化时调用。
- 第三方 ticker 必须通过 context 注册，销毁时自动清理。
- texture 必须通过 lease API。
- development mode 对慢 renderer 输出 node type 和耗时。
- 单个自定义节点不能让 renderer 全局退出虚拟化。

## CI 策略

- PR：小型 deterministic core/renderer benchmark，检测数量级退化。
- Nightly：Chromium/WebGL 10k/50k/100k、memory soak、多实例。
- Release candidate：固定机器完整 benchmark、Konva 对照、media-heavy。
- 相同环境中 p95 或内存退化超过 10% 时阻断稳定发布，除非有记录的基线调整。

## 对外表述门槛

只有 benchmark 支持后，才能使用：

> PixiBoardJS 针对大型稀疏媒体画布优化，渲染成本主要由可见内容而非文档总节点数决定。

不得无条件使用：

> PixiBoardJS 在所有画布场景都比 Konva 快。

