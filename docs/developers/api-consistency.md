# 文档—代码一致性清单

> 审计基线：`feat/publish-capabilities-agent-tools` 当前代码与公开导出。此表区分“当前可用 API”和架构文档中的目标设计；不要把目标设计复制到应用代码中。

## 已实现且适合开发者文档

| 能力 | 代码来源 | 文档状态 |
|---|---|---|
| `createPixiBoard`、生命周期、`ready`、`destroy` | `packages/pixiboardjs/src/index.ts` | 开发者文档已覆盖 |
| 节点 CRUD、`NodeHandle`、selection、viewport、history | `packages/pixiboardjs/src/types.ts` | 开发者文档已覆盖 |
| transaction 与 `coalesceKey` | `packages/pixiboardjs/src/index.ts` | 开发者文档已覆盖 |
| document snapshot / JSON / load / validate | `packages/pixiboardjs/src/types.ts` | 开发者文档已覆盖 |
| custom node registration 与 resize policy | `packages/pixiboardjs/src/types.ts` | 开发者文档已覆盖 |
| `pixiboardjs/browser` DOM transformer | `packages/pixiboardjs/src/dom-transformer.ts` | 开发者文档已覆盖 |
| `BoardCapabilities` 与 `agent-tools` read/write | `packages/capabilities`, `packages/agent-tools` | 开发者文档已覆盖 |

## 代码已实现，但原有知识文档缺失或滞后

| 项目 | 证据 | 建议 |
|---|---|---|
| `pixiboardjs/node`、`pixiboardjs/types` 子路径 | `packages/pixiboardjs/package.json:46-55` | 在 API reference 中说明适用场景；不要把它们误写成额外主包 |
| `DomTransformer.refresh()`、`dragging()`、`destroy()` | `packages/pixiboardjs/src/dom-transformer.ts` | browser 接入章节补生命周期说明 |
| `adapter-contract-tests` | `packages/adapter-contract-tests` | 只在维护者/发布文档说明为一致性测试，不作为使用者 API |
| 当前公开发布的 capabilities/agent-tools 包 | `packages/*/package.json` | 根 README 与开发者文档明确安装、版本和 transport 边界 |

## 文档承诺但当前公开代码不支持

| 项目 | 文档位置 | 代码证据 | 建议 |
|---|---|---|---|
| `capability:change` 公开事件会触发 | `docs/04-public-api.md:161-171` | `PublicBoardEventMap` 有类型，但 `bindCoreEvents` 未转发 | 在决定实现前从开发者承诺中移除或标注 future；补测试后再公开 |
| `node-type:missing` 可由 `board.on()` 订阅 | `docs/05-custom-node-system.md:168-177` | core 内部事件未进入 public event map/转发层 | 先明确事件契约，再实现转发或改文档为 placeholder 行为 |
| `board.capabilities.has("assets.import")` | `docs/07-platform-assets-persistence.md:47-64` | `BoardCapabilities` 只有 `availability.preview/capture` | 改为介绍当前 `availability`；新增通用查询需独立 API 决策 |
| `persistence:error` 与 `flush()` | `docs/07-platform-assets-persistence.md:166-183` | `DocumentPersistence` 只有 `load/save/destroy?` | 从当前 API 章节移到未来设计，或先补公开接口和测试 |
| Plugin SDK 的 actions、file drop、selection contributions | `docs/06-capabilities-plugins-agents.md:57-67` | `PluginManifest.contributions` 仅有 panels/tools/processes | 修正文档，避免 SDK 使用者依赖不存在的 contributions |
| `plugin-host` 作为当前包 | `docs/03-package-boundaries.md` | `packages/plugin-host` 不存在 | 仅保留在架构路线中，并明显标记未实现 |
| 标准 MCP Host / MCP handshake | 旧版 `docs/06...` 相关段落 | 当前 agent-tools 是 transport-neutral contract；MCP host 已移除 | 开发者文档只介绍 `tools.call`/schemas，不承诺 MCP server |
| README/旧 Demo 中无需注册即可创建 `type: "rect"` | `README.md:67-86`、Demo info panel | Core node registry 要求先注册；renderer 内建绘制器不等于 core 数据定义 | 改为使用 `app.rect` 并先注册，或提供明确的内建注册入口 |

## 文档写了代码没写 / 规划与实现边界

- `docs/` 中关于完整平台资产 pipeline、Tauri shell、Plugin Host、MCP bridge、持久化失败恢复的内容是目标架构，不应直接当作当前 SDK 的稳定 API。
- 任何新开发者章节都必须链接实际包导出或可运行 fixture；如果只能引用 ADR/roadmap，应标注“规划/维护者资料”。
- 后续新增 API 时同时更新：发布包类型报告、开发者文档示例、最小 smoke 测试和本清单。

## 维护顺序

1. 先修复制示例会失败的 `rect` 文案。
2. 再处理公开事件与 persistence/capability 查询等产品决策项。
3. 最后清理架构文档中的过时包名和未实现承诺，并保留清晰的 future 标记。
