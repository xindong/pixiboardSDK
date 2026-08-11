<div align="center">

# PixiBoardJS

**面向大型媒体与 AI 工作流的高性能无限画布 SDK**

扁平数据模型 · PixiJS 渲染 · 自定义节点 · Capabilities / Plugin / Agent 一套契约

[![CI gates](https://github.com/xindong/pixiboardSDK/actions/workflows/ci.yml/badge.svg)](https://github.com/xindong/pixiboardSDK/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/xindong/pixiboardSDK/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/xindong/pixiboardSDK/actions/workflows/deploy-pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](pnpm-workspace.yaml)

**[🎮 在线可交互 Demo](https://xindong.github.io/pixiboardSDK/)** · [文档](docs/README.md) · [架构决策记录](docs/adr) · [English](README.md)

</div>

---

## 这是什么

PixiBoardJS 是从真实桌面媒体应用中提炼出来的无限画布 SDK：文档是扁平、可序列化的 JSON，PixiJS 场景只是一份可以随时销毁重建的**视口渲染缓存**。它不是又一个通用场景树图形库，而是专门为大型、稀疏、媒体密集的画布场景设计的——图片、视频、音频、Markdown、模型预览、AI 生成中的节点，都可以在同一个文档模型里统一管理。

> 仓库当前处于从架构规划向可运行 SDK 交付的阶段。核心包（`core` / `renderer-pixi` / `pixiboardjs`）已实现并通过测试，见 [交付路线](docs/09-delivery-roadmap.md) 了解各阶段验收状态。

**[👉 点这里看在线可交互 Demo](https://xindong.github.io/pixiboardSDK/)** —— 这是真实运行的 `pixiboardjs` 包，不是截图；可以拖拽节点、缩放平移、撤销重做、切换自定义节点状态。

## 为什么选择 PixiBoardJS

有两件事是结构性的，来自数据模型本身，而不是靠调优得来的。

**活动渲染对象跟随屏幕上的内容，而不是文档规模。** 文档是扁平 JSON，PixiJS 场景只是渲染器随时构建和丢弃的视口缓存。空间索引负责回答「什么是可见的」，只有这些节点会拿到渲染对象。在下面的基准里，文档从 1 万节点涨到 10 万节点，活动渲染对象数量保持不变。

**Agent 的写入和人类编辑走同一条事务管线。** 这里没有另一套自动化 API。Agent 的 `canvas.write` 产出的 revision、ChangeSet 和历史条目，与一次拖拽完全相同——因此可撤销、可观测、带 `origin` 标记。大多数画布库根本没有「非人类写入者」这个概念；少数暴露了编辑器 API 的，也让自动化绕过了历史记录和访问控制。

| | PixiBoardJS | Konva / Fabric.js | tldraw |
|---|---|---|---|
| 活动渲染对象 | 跟随可见内容 | 全量常驻 | 全量常驻 |
| Agent 写入 | 与人类编辑同一事务管线，可撤销、可审计、带 `origin` | 不提供 | 无一等公民的 Agent 契约 |
| 数据模型 | 扁平、可序列化的 JSON 文档 | 嵌套场景树（父子关系） | 文档模型 + 内置 sync |
| 渲染方式 | PixiJS / WebGL | Canvas2D | React / DOM |
| 撤销重做与历史 | 内置，基于 transaction | 不提供 | 内置 |
| 访问控制（UI/插件/Agent） | 内置 `capabilities` 契约 | 不提供 | 不提供 |
| 自定义节点类型 | 统一注册机制，无需改动 SDK 内部代码 | 自定义子类 | 自定义 shape 类 |
| 平台目标 | 浏览器 + Tauri WebView（port/adapter 注入） | 浏览器 | 浏览器 |
| 许可证 | MIT | MIT | 源码可见；SDK 生产使用需付费许可 |
| 实时协作 | v1 不做 | 不提供 | 内置 sync 引擎 |

如果你在做白板、灵感画布或 AI 生成画布，文档大、媒体密集，并且 Agent 或插件要和人一起往里写，选 PixiBoardJS。如果你要的是最好的 React 编辑体验、并且现在就需要多人协作，选 tldraw。如果你要的是通用 2D 图形工具、并打算自己维护文档模型，选 Konva/Fabric/原生 PixiJS。

## 核心特性

- **扁平数据模型** —— 文档是纯 JSON，节点没有父子嵌套的通用场景树；任何渲染对象都可以随时销毁并从数据重建。
- **视口虚拟化，默认开启** —— 只要宿主报告了画布尺寸，`createPixiBoard()` 就会裁剪到可见世界矩形（外加可配置的边距）。空间索引、LOD 分级和纹理生命周期管理一并提供。
- **Node Type Registry** —— 内置矩形、文本、图片、视频、音频节点与用户自定义节点使用同一套注册机制，新增节点类型不需要修改 SDK 内部 union 类型。
- **单一写入通道** —— 用户交互、公共 API、插件、Agent 的所有修改都进入同一条 transaction/command 管线，撤销重做、事件、持久化天然一致。
- **Capabilities 边界** —— 面向 UI、插件和 Agent 的统一受控能力（`canvas.read` / `canvas.write` 等），不依赖任何私有实现细节。
- **Web + Tauri** —— 同一套 core 与 capabilities 可以运行在现代浏览器和 Tauri WebView 中，平台差异通过 port/adapter 注入。
- **一个用户包** —— 普通使用者只需要 `pnpm add pixiboardjs`；内部包边界只用于维护依赖方向和测试隔离，不转嫁给用户。

## 快速开始

```bash
pnpm add pixiboardjs
```

```ts
import { createPixiBoard } from "pixiboardjs";

const board = await createPixiBoard({
  container: document.querySelector("#board"),
});
await board.ready;

await board.nodes.create({
  type: "rect",
  x: 40,
  y: 40,
  width: 120,
  height: 80,
  props: { fill: 0x7c8cf8 },
});

board.viewport.fitBounds({ minX: 0, minY: 0, maxX: 400, maxY: 300 });
board.history.undo();
```

更完整的可复制外部消费者示例见 [`apps/examples-vanilla`](apps/examples-vanilla)，自定义节点示例见 [`apps/examples-custom-node`](apps/examples-custom-node)，Tauri 桌面集成示例见 [`apps/examples-desktop-sdk`](apps/examples-desktop-sdk)，本 README 顶部的在线 Demo 源码见 [`apps/site`](apps/site)。

## Agent 是一等公民的写入者

Agent 不是从侧门进入画布的。`canvas.write` 落进的是和指针拖拽同一条事务管线：

```bash
pnpm add @pixi-board/agent-tools
```

```ts
import { createPixiBoardAgentTools } from "@pixi-board/agent-tools";

const tools = createPixiBoardAgentTools(board.capabilities);

await tools.call("canvas.write", {
  type: "create",
  nodes: [{ type: "rect", x: 40, y: 40, width: 120, height: 80 }],
});

board.history.undo();   // Agent 的写入和其它编辑一样可以撤销
```

由此得到：

- **可撤销** —— 写入产生正常的历史条目，用户撤销 Agent 的工作不需要另写一套回滚路径。
- **可审计** —— 每笔写入都带 `origin`（`user` / `api` / `plugin:<id>` / `agent:<id>`，Agent 工具默认为 `agent:canvas`），谁改了什么一目了然。
- **一致** —— UI、插件和 Agent 三条路径产出相同的 document、revision 和 ChangeSet。这一点由 [`packages/agent-tools/src/contract.test.ts`](packages/agent-tools/src/contract.test.ts) 逐字段断言，不只是设计意图。
- **支持 headless** —— 文档读写不需要 renderer。需要挂载画布的工具（preview、capture）会明确报告能力不可用，而不是假设 renderer 一定存在。

读取路径同样是为 Agent 设计的：`canvas.read` 返回紧凑的节点 DTO，支持字段投影和分页，大画布不必整块 JSON 一次性返回。

### 传输层由你决定

`agent-tools` 是契约，不是 server。它给你两个带 JSON Schema 的工具定义（`import { canvasReadSchema, canvasWriteSchema } from "@pixi-board/agent-tools/schemas"`）和一个异步的 `call(name, input)`。把它接到 MCP、HTTP、WebSocket，还是在自己的 agent 循环里直接函数调用，都只是针对你已有 harness 的几行代码——所以 SDK 不附带 server，也不去追一个仍在演进的协议。

### 也可以完全不用工具层

`board.capabilities` 本身就是公开的。如果你有自己的工具 schema、自己的 DTO 形状，或者要遵循自己 agent 框架的约定，直接基于它构建：

```ts
import { createBoardCapabilities, isCapabilityError } from "@pixi-board/capabilities";

const result = await board.capabilities.nodes.create(
  { nodes: [{ type: "rect", x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0 }] },
  { origin: "agent:my-agent" },
);
```

同一条事务管线、同一份 ChangeSet、同样可撤销，只是翻译层归你自己维护。`agent-tools` 是它之上的便利层，而不是绕过它的特权通道。

## 架构总览

```text
                     ┌─────────────────────────┐
                     │        pixiboardjs        │   唯一对外发布的用户包
                     │  createPixiBoard / NodeHandle
                     └────────────┬─────────────┘
           ┌────────────┬─────────┼─────────┬────────────┐
           │            │         │         │            │
    ┌──────▼─────┐┌─────▼──────┐┌─▼───────┐┌▼──────────┐┌▼───────────┐
    │capabilities││renderer-pixi││ adapter- ││  adapter-  ││ agent-tools │
    │ (UI/Plugin/││  (PixiJS    ││ browser  ││   tauri    ││ (canvas.read│
    │  Agent 契约)││   渲染缓存)  ││(IndexedDB││ (WebView   ││ /.write +   │
    │            ││             ││ /OPFS)   ││  文件系统) ││ JSON Schema)│
    └──────┬─────┘└─────┬───────┘└─────────┘└────────────┘└─────────────┘
           │            │                     传输层（MCP/HTTP/直接调用）自行组装
           │            │
           └─────┬──────┘
                 │
            ┌────▼─────┐
            │   core    │   文档是事实来源；不感知 DOM / Pixi / Tauri
            │ document /│
            │ store /   │
            │ history / │
            │ viewport  │
            └──────────┘
```

- **数据是事实，渲染是缓存**：任何可持久状态必须存在于 `BoardDocument`；Pixi 容器、纹理、临时动画状态都不是文档真相。
- **核心不感知平台**：`core` 不 import DOM、Pixi、Tauri 或插件 SDK，平台能力全部以 port/adapter 注入。
- 完整设计原则见 [产品目标与范围](docs/00-product-goals.md) 和 [目标技术架构](docs/02-target-architecture.md)。

## 包结构

| 包 | 说明 | 对外可见性 |
|---|---|---|
| [`pixiboardjs`](packages/pixiboardjs) | 唯一用户包：`createPixiBoard()`、`NodeHandle`、内置节点、capabilities 门面 | 公开 |
| [`@pixi-board/core`](packages/core) | 文档 / store / transaction / history / selection / viewport，无 DOM 依赖 | 公开 |
| [`@pixi-board/renderer-pixi`](packages/renderer-pixi) | PixiJS 渲染器：scene、空间索引、视口虚拟化、纹理生命周期 | 内部 |
| [`@pixi-board/capabilities`](packages/capabilities) | 面向 UI / 插件 / Agent 的统一受控读写能力 | 公开 |
| [`@pixi-board/agent-tools`](packages/agent-tools) | `canvas.read` / `canvas.write` 工具契约及其 JSON Schema | 公开 |
| [`@pixi-board/adapter-browser`](packages/adapter-browser) | IndexedDB / OPFS / ObjectURL 持久化与资产适配 | 内部 |
| [`@pixi-board/adapter-tauri`](packages/adapter-tauri) | Tauri WebView 文件系统适配 | 内部 |
| [`@pixi-board/plugin-sdk`](packages/plugin-sdk) / [`plugin-api-v3`](packages/plugin-api-v3) | 插件 `definePlugin()` 与 v3 能力契约 | 公开 / 内部 |

完整依赖方向和职责边界见 [包与模块边界](docs/03-package-boundaries.md)。

## 虚拟化到底带来了什么

这里要说的不是「比谁快」，而是渲染器的工作量与文档规模解耦。在三份节点数相差 10 倍的文档上平移同一个视口：

| 文档节点数 | 活动渲染对象 |
|---:|---:|
| 10,000 | ~360 |
| 50,000 | ~360 |
| 100,000 | ~360 |

帧工作量跟随的是这条曲线，而不是节点总数。这是值得围绕它做设计的性质；绝对毫秒数取决于你的节点、素材和 GPU。

**这个数字该怎么读。** 它摘自 2026-08-07 的一次本地 canonical 运行（Chromium 151、1920×1080、DPR 1、seed 42、30 帧预热 + 120 帧采样），标记为 `evidence-only`：没有固定机器基线，也没有获批的绝对预算，因此**不构成任何性能 gate 通过**。该运行使用 ANGLE SwiftShader，不能代表硬件 GPU 吞吐，workload 是稀疏矩形卡片。它**不支持**「PixiBoardJS 在所有画布场景都比 Konva 快」这一说法——[基准文档](docs/10-performance-benchmarks.md)如实记录了它更慢的用例，包括 100k full-retained 下 p95 为 41.80ms。

benchmark 守住的结构性不变量：

- 文档节点数 ≠ Pixi DisplayObject 数；ID 查询 O(1)。空间索引成本按节点计、与 N 无关（均匀网格：O(该节点覆盖的格子数)）。
- pan/zoom 热路径主要与可见节点和预加载节点数相关，单节点更新不触发全量 Scene 重建。
- LOD 分级为节点渲染器提供缩得足够远时的降级路径——此时所有节点都合法地位于视口内，culling 已经无能为力。
- 无动画/视频/交互时按需渲染；destroy 后 view、texture lease、listener、ticker 回到基线。

```bash
pnpm benchmark:run       # 本地 headless 基准（10k/50k/100k 节点等数据集）
pnpm benchmark:browser   # 真实 Chromium 环境基准
pnpm benchmark:check     # 对比历史基线，检测回归
```

完整数据（含未达标用例）详见 [性能目标与基准](docs/10-performance-benchmarks.md)。

## 开发

```bash
pnpm install

# 静态边界与文档检查
pnpm docs:check
pnpm packages:check

# 分层测试
pnpm test:core          # @pixi-board/core
pnpm test:contracts     # capabilities / agent-tools 契约
pnpm test:adapters      # adapter-browser / adapter-tauri / 契约测试套件
pnpm test:browser       # Chromium 渲染器契约

# 构建可发布产物
pnpm build:release
```

完整贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。CI 在 [`.github/workflows/ci.yml`](.github/workflows/ci.yml) 中对每次 push/PR 运行静态边界检查、核心契约测试、Chromium 浏览器契约与性能回归门；桌面 Tauri 集成的 macOS/Windows 门见 [`desktop-launch-smoke.yml`](.github/workflows/desktop-launch-smoke.yml)。

## 文档

- [文档总览与推荐阅读顺序](docs/README.md)
- [产品目标与范围](docs/00-product-goals.md) · [现有代码评估](docs/01-current-state.md) · [目标技术架构](docs/02-target-architecture.md)
- [包与模块边界](docs/03-package-boundaries.md) · [公共 API 设计](docs/04-public-api.md) · [自定义节点系统](docs/05-custom-node-system.md)
- [Capabilities、插件与 Agent](docs/06-capabilities-plugins-agents.md) · [平台、资产与持久化](docs/07-platform-assets-persistence.md)
- [代码迁移计划](docs/08-migration-plan.md) · [交付路线与验收](docs/09-delivery-roadmap.md)
- [性能目标与基准](docs/10-performance-benchmarks.md) · [测试、发布与兼容策略](docs/11-testing-release-compatibility.md)
- [风险与已决事项](docs/12-risks-open-decisions.md) · [目标追踪矩阵](docs/13-traceability.md)
- [架构决策记录（ADR）](docs/adr)

## License

[MIT](LICENSE) © 2026 [Xindong](https://github.com/xindong)
