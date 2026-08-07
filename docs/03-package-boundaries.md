# 包与模块边界

## 对外策略

普通 SDK 用户只安装：

```bash
pnpm add pixiboardjs
```

内部可以拆包，但不默认要求用户理解版本组合。

## 初始物理包

```text
packages/
├── core
├── renderer-pixi
├── capabilities
├── adapter-browser
├── adapter-tauri
├── plugin-host
├── agent-tools
├── mcp-host
└── pixiboardjs
```

为避免过早拆分，实施早期允许先落为：

```text
packages/
├── core
├── renderer-pixi
└── pixiboardjs
    └── src/
        ├── capabilities/
        ├── adapters/browser/
        ├── input/
        └── runtime/
```

等接口稳定后再把 capabilities 和 adapters 拆为独立 workspace package。

## 依赖方向

```text
core
  ▲
  │
renderer-pixi
  ▲
  │
pixiboardjs
  ▲
  ├──────── capabilities
  │               ▲
  │               ├── plugin-host
  │               └── agent-tools ── mcp-host
  │
  ├── adapter-browser
  └── adapter-tauri
```

硬约束：

- `core` 不依赖任何上层包。
- `renderer-pixi` 不依赖 plugins、Agent、Tauri 或产品 UI。
- `capabilities` 不直接访问 renderer 私有对象。
- `plugin-host` 和 `agent-tools` 通过 capabilities 操作画布。
- `mcp-host` 只负责 transport，不包含画布业务逻辑。

## 包责任

### `@pixi-board/core`

Public beta 起公开给高级和 headless 用户：

- document schema/types。
- store、transaction、history。
- selection/viewport state。
- node type definitions 的数据部分。
- events、serialization、migration。
- geometry。

### `@pixi-board/renderer-pixi`

初期内部包：

- Pixi Application。
- NodeRenderer interface 和 registry runtime。
- scene、view cache、spatial index。
- texture/media runtime。
- overlays、capture。

PixiJS 由主包锁定并安装单一版本，普通用户不额外安装 Pixi。`renderer-pixi` 在 1.x 保持内部包，不采用 peer dependency；改变该策略需要新 ADR。

### `pixiboardjs`

主要公开包：

- `createPixiBoard()`。
- `PixiBoard`、`NodeHandle`。
- 默认内置节点。
- 默认浏览器输入与 adapter helper。
- capabilities 门面。
- lifecycle、errors、feature detection。

建议 exports：

```json
{
  ".": "./dist/index.js",
  "./browser": "./dist/browser.js",
  "./node": "./dist/node.js",
  "./types": "./dist/types.js"
}
```

### `@pixi-board/plugin-sdk`

直接升级为 Plugin API v3，并替换现有 `unknown`：

- `definePlugin()`。
- manifests、permissions。
- typed PluginContext。
- panels/actions/tools/contributions。

插件 SDK 不依赖完整 renderer，避免插件 bundle 带入 PixiJS。

### `@pixi-board/plugin-host`

内部或高级宿主包：

- plugin lifecycle。
- permission/capability proxy。
- tool registry。
- contribution registry。
- host file token 和 jobs。

插件加载器与宿主分离：Desktop 可加载 zip，本地 Web 可 dynamic import ESM。

### `@pixi-board/agent-tools`

初期内部包：

- `canvas.read`/`canvas.write` schemas。
- 过滤、分页、字段投影。
- Agent 错误格式和 compact result。
- 默认 placement/layout service。
- 调用 BoardCapabilities。

### `@pixi-board/mcp-host`

- 把 tool registry 暴露为 MCP。
- 鉴权、timeout、serialization。
- 不知道 Store、Scene 或 asset pipeline。

## 用户包与内部包的版本

- `pixiboardjs` 使用正常 semver。
- 首个稳定版前，内部包可保持 lockstep version。
- 内部包如果未公开，标记 `private: true`。
- `pixiboardjs` 和公开的 `core` 在 1.x lockstep version，并承担兼容承诺。
- plugin API 与 document schema version 分开管理，不能共用一个数字表达不同兼容维度。

## 目标仓库结构

```text
pixiboardSDK/
├── apps/
│   ├── examples-vanilla/
│   ├── examples-custom-node/
│   └── benchmark/
├── packages/
│   ├── core/
│   ├── renderer-pixi/
│   ├── pixiboardjs/
│   ├── plugin-sdk/
│   └── ...
├── docs/
├── scripts/
├── package.json
└── pnpm-workspace.yaml
```

当前文档项目只创建规划骨架；实现阶段按迁移里程碑逐步建立 packages，不提前生成无内容包。
