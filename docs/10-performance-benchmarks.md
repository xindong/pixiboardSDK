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

## 2026-08-07 验收落地

已将原 benchmark skeleton 接成可执行的 deterministic core/renderer harness：

- `apps/benchmark/src/harness.ts` 固定 seed `42` 生成 1k、10k、50k、100k Synthetic Card，并实际驱动 `BoardCore`、`GridSpatialIndex`、`PixiBoardRenderer` 和 `pixiboardjs` facade。
- `apps/benchmark/src/adapter.ts` 的 `createPixiBoardBenchmarkAdapter()` 是真实 adapter；`apps/benchmark/src/run.ts` 的 `runBenchmark()` 是可调用 runner，负责执行 harness 并写出 JSON report。
- SDK-facing 入口为 `apps/benchmark/src/sdk-adapter.mjs`；`pnpm benchmark:report` 实际写出 JSON report（可用 `PIXIBOARD_BENCHMARK_REPORT=/tmp/report.json` 指定路径）。
- 每个数据规模执行 document load、spatial rebuild/query、可见集合 culling、renderer single-node apply、core single-node update 和 1000-node batch update；facade batch 额外断言一次 revision、一次 change、一次 persistence save。
- create/destroy soak 执行 100 cycles，记录 listener、ticker、active view、texture lease 峰值与销毁后的基线。
- renderer 使用 instrumented Pixi adapter，不创建真实 WebGL context；空间查询先由真实 `GridSpatialIndex` 计算，再注入 renderer 的 culling query，以隔离空间索引和 view lifecycle 成本。

完整实测摘要见 [`docs/benchmarks/2026-08-07-node-instrumented-summary.json`](benchmarks/2026-08-07-node-instrumented-summary.json)。环境为 macOS arm64、Node `22.22.0`、Apple M4（10 cores）。关键 p95（ms）如下：

| 场景 | 1k | 10k | 50k | 100k |
|---|---:|---:|---:|---:|
| document load | 42.7983 | 602.1180 | 2370.5136 | 10561.2732 |
| spatial rebuild | 1.7657 | 13.8899 | 85.7040 | 272.6589 |
| spatial query | 1.2179 | 0.9904 | 0.3643 | 1.2369 |
| renderer culling/first interactive（instrumented） | 8.7803 | 466.2531 | 208.4991 | 1104.0040 |
| renderer single-node apply | 19.6701 | 126.3248 | 1589.0450 | 1417.2063 |
| core single-node update | 65.8196 | 1040.1944 | 3410.7470 | 7852.4993 |
| core batch update 1000 | 188.6862 | 889.2466 | 8750.7738 | 10467.9096 |

这些结果显示当前 core 的单节点和 batch 目标（分别 `<2ms`、`<50ms`）均未达标；报告保留了真实失败值，没有调整目标或伪造 browser 结果。culling 的 active views 均等于选出的 visible set，且未创建全量 100k views。

以下指标明确为 `not-observed`：browser/WebGL frame p50/p95/p99 与 long-frame ratio、GPU memory、draw calls/batches、idle CPU/GPU、1080p capture、受控 JS heap 回归和 Konva 对照。它们必须在固定 Chromium/WebGL 设备上由后续 nightly/release-candidate job 测量。

运行方式（不构建、不做类型检查）：

```text
pnpm benchmark:run
pnpm benchmark:test
```

## 2026-08-07 Chromium / Konva 对照（evidence-only）

浏览器 runner 提供 candidate-bound canonical matrix。正式 nightly/RC 命令为：

```text
node scripts/run-browser-benchmark-gate.mjs nightly
```

该命令固定并强制 10k/50k/100k × matched-visible/full-retained × PixiBoardJS/Konva、30 帧预热和 120 帧采样；输出写入 `.artifacts/performance/nightly-browser.json`，不提交到仓库。结构完整性、候选 SHA、Pixi WebGL、两端 mutation/visible/active plan 和人口公平性 fail closed。数值性能没有稳定机器基线或可辩护的跨环境绝对预算，因此明确标为 `evidence-only` / `blockingPerformanceCriteria: false`，不得称为“性能 gate 通过”。

PixiBoardJS 一侧从当前 checkout 的 `packages/core/src` 与 `packages/renderer-pixi/src` 加载 `BoardDocument`、`GridSpatialIndex` 和 `PixiBoardRenderer`，并记录 candidate SHA/package version。`matched-visible` 会把全部 N 个节点交给 renderer rebuild 和空间索引，只为当前 viewport reconcile 可见 view；报告分别记录 `datasetCount`、candidate document count、spatial-index population 与 active population。Konva 仍是锁定版本的第三方 Canvas2D comparator。Pixi 8.19.0、Konva 9.3.22、Playwright 1.62.1 与 TypeScript 5.9.3 均由 benchmark package 直接锁定并从本地安装内容提供，不使用 jsDelivr Pixi。

下面表格是 2026-08-07 一次本地 canonical 运行的历史摘录，不是当前 commit 的基线，也不绑定后续 release candidate；候选发布证据必须重新运行上述命令并以 artifact 内的 SHA 为准。

固定条件为 Chromium `151.0.7922.34`、1920×1080、DPR 1、seed 42；每组 30 帧预热、120 帧采样。PixiBoardJS 使用 workspace `PixiBoardRenderer` 并逐组验证 WebGL 2 context；该 headless 环境实际 renderer 为 ANGLE SwiftShader。Konva 9.3.22 逐组验证为 Canvas2D。

该次运行的公平性检查全部通过：`matched-visible` 两端 visible ID、create/update/delete payload 和活动对象范围相同；`full-retained` 两端均保留完整 renderer object population，逐帧 mutation 后活动数均为 `document nodes + 1`。

以下是 frame-work/render-completion latency（ms，`p50 / p95 / p99`），不是 RAF-to-RAF presentation interval：

| 模式 | 节点数 | PixiBoardJS | Konva | >33ms ratio（Pixi / Konva） |
|---|---:|---:|---:|---:|
| matched-visible | 10k | 0.60 / 1.20 / 1.30 | 0.50 / 1.10 / 1.20 | 0 / 0 |
| matched-visible | 50k | 0.60 / 0.80 / 0.88 | 0.70 / 1.10 / 1.28 | 0 / 0 |
| matched-visible | 100k | 0.60 / 0.71 / 0.80 | 0.70 / 1.00 / 1.20 | 0 / 0 |
| full-retained | 10k | 3.80 / 4.30 / 5.49 | 5.80 / 6.90 / 7.42 | 0 / 0 |
| full-retained | 50k | 17.30 / 18.62 / 24.07 | 41.70 / 46.84 / 50.53 | 0 / 1 |
| full-retained | 100k | 35.95 / 41.80 / 69.12 | 93.60 / 147.03 / 180.83 | 1 / 1 |

单次 first-interactive / 1920×1080 capture latency（ms）：

| 模式 | 节点数 | PixiBoardJS | Konva |
|---|---:|---:|---:|
| matched-visible | 10k | 50.20 / 169.80 | 11.00 / 12.80 |
| matched-visible | 50k | 80.20 / 145.10 | 16.10 / 13.30 |
| matched-visible | 100k | 134.90 / 142.30 | 20.60 / 10.60 |
| full-retained | 10k | 156.00 / 156.30 | 62.10 / 17.10 |
| full-retained | 50k | 573.10 / 156.80 | 280.30 / 56.10 |
| full-retained | 100k | 1388.30 / 180.40 | 545.90 / 113.80 |

失败值没有隐藏：full-retained 50k Konva 和 100k 两端的 >33ms ratio 为 1；full-retained 100k PixiBoardJS p95 为 41.80ms。matched-visible 的三个规模均保持 353–369 个活动对象，说明该 workload 的帧工作主要随可见内容而非文档总节点数变化。

限制：这些数据只适用于固定的稀疏矩形卡片 workload，且 SwiftShader 不能代表硬件 GPU 吞吐。capture 使用双方产品级路径 `PixiBoardRenderer.capture(viewport)` 与 `Konva.Stage.toDataURL()`。JS heap 仅为未 GC 的 `performance.memory` 瞬时快照，不能解释为 peak、retained heap 或 leak；GPU memory、双方等价 draw calls 和 idle CPU/GPU 仍为 `notObserved`。因此结果不支持“PixiBoardJS 在所有画布场景都比 Konva 快”。
