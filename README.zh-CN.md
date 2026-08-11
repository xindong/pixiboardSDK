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

大多数画布库（Konva、Fabric.js、原生 PixiJS）给你的是一个通用场景图，文档建模、撤销重做、持久化、访问控制都要自己搭。PixiBoardJS 从相反的方向出发：扁平文档是事实来源，渲染、历史记录、能力边界都围绕它构建。

| | PixiBoardJS | Konva / Fabric.js | 原生 PixiJS |
|---|---|---|---|
| 数据模型 | 扁平、可序列化的 JSON 文档 | 嵌套场景树（父子关系） | 无文档模型，场景由你自己维护 |
| 目标场景 | 大型、稀疏、媒体密集画布 | 通用 2D 图形/交互 | 通用 WebGL 渲染 |
| 渲染对象 | 可销毁的视口缓存，随数据重建 | 常驻场景树 | 常驻场景树 |
| 撤销重做与历史 | 内置，基于 transaction | 不提供 | 不提供 |
| 访问控制（UI/插件/Agent） | 内置 `capabilities` 契约 | 不提供 | 不提供 |
| 自定义节点类型 | 统一注册机制，无需改动 SDK 内部代码 | 自定义子类 | 自定义类 |
| 平台目标 | 浏览器 + Tauri WebView（port/adapter 注入） | 浏览器 | 浏览器 |

如果你在做白板、灵感画布、AI 生成画布，或者任何需要成百上千到数十万个媒体节点流畅平移缩放、支持真正撤销重做、能可靠持久化的场景，PixiBoardJS 正是为此设计的。如果你需要的是通用 2D 图形工具（游戏、一次性插画），Konva/Fabric/原生 PixiJS 会更合适。

## 核心特性

- **扁平数据模型** —— 文档是纯 JSON，节点没有父子嵌套的通用场景树；任何渲染对象都可以随时销毁并从数据重建。
- **大型稀疏画布性能** —— 运行成本主要随可见节点和活跃媒体数量增长，而不是随文档总节点数线性增长；空间索引 + 视口虚拟化 + 纹理生命周期管理开箱即用。
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
    │ (UI/Plugin/││  (PixiJS    ││ browser  ││   tauri    ││  / mcp-host │
    │  Agent 契约)││   渲染缓存)  ││(IndexedDB││ (WebView   ││ (Agent 读写 │
    │            ││             ││ /OPFS)   ││  文件系统) ││  与 MCP)    │
    └──────┬─────┘└─────┬───────┘└─────────┘└────────────┘└─────────────┘
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
| [`@pixi-board/capabilities`](packages/capabilities) | 面向 UI / 插件 / Agent 的统一受控读写能力 | 内部 |
| [`@pixi-board/adapter-browser`](packages/adapter-browser) | IndexedDB / OPFS / ObjectURL 持久化与资产适配 | 内部 |
| [`@pixi-board/adapter-tauri`](packages/adapter-tauri) | Tauri WebView 文件系统适配 | 内部 |
| [`@pixi-board/plugin-sdk`](packages/plugin-sdk) / [`plugin-api-v3`](packages/plugin-api-v3) | 插件 `definePlugin()` 与 v3 能力契约 | 公开 / 内部 |
| [`@pixi-board/agent-tools`](packages/agent-tools) | `canvas.read` / `canvas.write` 等 Agent 工具契约 | 内部 |
| [`@pixi-board/mcp-host`](packages/mcp-host) | 把 Agent 工具暴露为 MCP transport | 内部 |

完整依赖方向和职责边界见 [包与模块边界](docs/03-package-boundaries.md)。

## 性能目标

PixiBoardJS 的性能承诺限定在**大型、稀疏、媒体密集**的无限画布场景，并以可重复 benchmark 验证，而不是口号：

- 文档节点数 ≠ Pixi DisplayObject 数；ID 查询 O(1)，单节点空间索引更新 O(log N)。
- pan/zoom 热路径主要与可见节点和预加载节点数相关，单节点更新不触发全量 Scene 重建。
- 无动画/视频/交互时按需渲染；destroy 后 view、texture lease、listener、ticker 回到基线。

```bash
pnpm benchmark:run       # 本地 headless 基准（10k/50k/100k 节点等数据集）
pnpm benchmark:browser   # 真实 Chromium 环境基准
pnpm benchmark:check     # 对比历史基线，检测回归
```

详见 [性能目标与基准](docs/10-performance-benchmarks.md)。

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
