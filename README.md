<div align="center">

# PixiBoardJS

**A high-performance infinite canvas SDK for large, media-heavy, AI-native boards**

Flat document model · PixiJS rendering · custom nodes · one contract for Capabilities / Plugins / Agents

[![CI gates](https://github.com/xindong/pixiboardSDK/actions/workflows/ci.yml/badge.svg)](https://github.com/xindong/pixiboardSDK/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/xindong/pixiboardSDK/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/xindong/pixiboardSDK/actions/workflows/deploy-pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](pnpm-workspace.yaml)

**[🎮 Live interactive demo](https://xindong.github.io/pixiboardSDK/)** · [Docs](docs/README.md) · [ADRs](docs/adr) · [简体中文](README.zh-CN.md)

</div>

---

## What is this?

PixiBoardJS is an infinite canvas SDK extracted from a real desktop media application: the document is a flat, serializable JSON tree, and the PixiJS scene is nothing more than a disposable **viewport render cache**. It is not another general-purpose scene-graph graphics library — it's purpose-built for large, sparse, media-dense canvases where images, video, audio, markdown, model previews, and AI-generated content all live in the same document model.

> This repository is transitioning from architecture planning to a shippable SDK. The core packages (`core` / `renderer-pixi` / `pixiboardjs`) are implemented and tested — see the [delivery roadmap](docs/09-delivery-roadmap.md) for stage-by-stage acceptance status.

**[👉 Try the live demo](https://xindong.github.io/pixiboardSDK/)** — this runs the real `pixiboardjs` package, not a recording. Drag nodes, pan/zoom, undo/redo, and toggle custom node state directly.

## Why PixiBoardJS?

Most canvas libraries (Konva, Fabric.js, raw PixiJS) give you a general-purpose scene graph and leave document modeling, undo/redo, persistence, and access control entirely up to you. PixiBoardJS starts from the opposite end: a flat document is the source of truth, and everything else — rendering, history, capabilities — is built around it.

| | PixiBoardJS | Konva / Fabric.js | Raw PixiJS |
|---|---|---|---|
| Data model | Flat, serializable JSON document | Nested scene graph (parent/child) | No document model — you own the scene |
| Target scenario | Large, sparse, media-heavy canvases | General 2D graphics/interactivity | General WebGL rendering |
| Rendering objects | Disposable viewport cache, rebuilt from data | Persistent scene tree | Persistent scene tree |
| Undo/redo & history | Built-in, transaction-based | Not included | Not included |
| Access control (UI/plugin/agent) | Built-in `capabilities` contract | Not included | Not included |
| Custom node types | Unified registry, no SDK core changes needed | Custom subclasses | Custom classes |
| Platform targets | Browser + Tauri WebView via ports/adapters | Browser | Browser |

If you're building a whiteboard, moodboard, AI generation canvas, or any UI where hundreds to hundreds of thousands of media-rich nodes need to pan/zoom smoothly and survive reloads with real undo/redo — PixiBoardJS is built for that. If you need a general 2D graphics toolkit for games or one-off illustrations, Konva/Fabric/raw PixiJS are a better fit.

## Core Features

- **Flat data model** — the document is plain JSON; nodes have no parent/child nesting. Any render object can be destroyed and rebuilt from data at any time.
- **Large sparse-canvas performance** — cost scales with visible and active-media node count, not total document size. Spatial indexing, viewport virtualization, and texture lifecycle management ship out of the box.
- **Node Type Registry** — built-in rect/text/image/video/audio nodes and user-defined custom nodes share one registration mechanism; adding a node type never requires touching an SDK-internal union type.
- **Single write channel** — every mutation (user interaction, public API, plugin, agent) flows through the same transaction/command pipeline, so undo/redo, events, and persistence stay naturally consistent.
- **Capabilities boundary** — a unified, permissioned surface (`canvas.read` / `canvas.write`, etc.) for UI, plugins, and agents that never depends on private implementation details.
- **Web + Tauri** — the same core and capabilities run in modern browsers and in a Tauri WebView; platform differences are injected via ports/adapters.
- **One user-facing package** — everyday consumers only need `pnpm add pixiboardjs`; internal package boundaries exist for dependency direction and test isolation, not to be exposed to users.

## Quick Start

```bash
pnpm add pixiboardjs
```

```ts
import { createPixiBoard } from "pixiboardjs";
import { PixiBoardRenderer } from "@pixi-board/renderer-pixi";

const board = await createPixiBoard({
  container: document.querySelector("#board"),
  rendererFactory: (options) => new PixiBoardRenderer(options),
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

A fuller, copy-pasteable external-consumer example lives in [`apps/examples-vanilla`](apps/examples-vanilla); a custom-node example is in [`apps/examples-custom-node`](apps/examples-custom-node); a Tauri desktop integration example is in [`apps/examples-desktop-sdk`](apps/examples-desktop-sdk); and the source for the live demo at the top of this README is in [`apps/site`](apps/site).

## Architecture

```text
                     ┌─────────────────────────┐
                     │        pixiboardjs        │   the only package users install
                     │  createPixiBoard / NodeHandle
                     └────────────┬─────────────┘
           ┌────────────┬─────────┼─────────┬────────────┐
           │            │         │         │            │
    ┌──────▼─────┐┌─────▼──────┐┌─▼───────┐┌▼──────────┐┌▼───────────┐
    │capabilities││renderer-pixi││ adapter- ││  adapter-  ││ agent-tools │
    │ (UI/plugin/││  (PixiJS    ││ browser  ││   tauri    ││  / mcp-host │
    │  agent      ││   render    ││(IndexedDB││ (WebView   ││ (agent read/│
    │  contract)  ││    cache)   ││ /OPFS)   ││  filesystem)││ write + MCP)│
    └──────┬─────┘└─────┬───────┘└─────────┘└────────────┘└─────────────┘
           │            │
           └─────┬──────┘
                 │
            ┌────▼─────┐
            │   core    │   document is the source of truth; no DOM/Pixi/Tauri awareness
            │ document /│
            │ store /   │
            │ history / │
            │ viewport  │
            └──────────┘
```

- **Data is truth, rendering is a cache** — anything that must persist lives in `BoardDocument`; Pixi containers, textures, and transient animation state are never the source of truth.
- **Core is platform-agnostic** — `core` never imports DOM, Pixi, Tauri, or a plugin SDK; all platform capabilities are injected via ports/adapters.
- See [product goals & scope](docs/00-product-goals.md) and [target architecture](docs/02-target-architecture.md) for the full design rationale.

## Package Structure

| Package | Description | Visibility |
|---|---|---|
| [`pixiboardjs`](packages/pixiboardjs) | The single user-facing package: `createPixiBoard()`, `NodeHandle`, built-in nodes, capabilities facade | Public |
| [`@pixi-board/core`](packages/core) | Document / store / transaction / history / selection / viewport — no DOM dependency | Public |
| [`@pixi-board/renderer-pixi`](packages/renderer-pixi) | PixiJS renderer: scene, spatial index, viewport virtualization, texture lifecycle | Internal |
| [`@pixi-board/capabilities`](packages/capabilities) | Unified permissioned read/write surface for UI / plugins / agents | Internal |
| [`@pixi-board/adapter-browser`](packages/adapter-browser) | IndexedDB / OPFS / ObjectURL persistence and asset adapters | Internal |
| [`@pixi-board/adapter-tauri`](packages/adapter-tauri) | Tauri WebView filesystem adapter | Internal |
| [`@pixi-board/plugin-sdk`](packages/plugin-sdk) / [`plugin-api-v3`](packages/plugin-api-v3) | Plugin `definePlugin()` and the v3 capability contract | Public / Internal |
| [`@pixi-board/agent-tools`](packages/agent-tools) | `canvas.read` / `canvas.write` and other agent tool contracts | Internal |
| [`@pixi-board/mcp-host`](packages/mcp-host) | Exposes agent tools as an MCP transport | Internal |

Full dependency direction and ownership boundaries: [package boundaries](docs/03-package-boundaries.md).

## Performance Goals

PixiBoardJS's performance promise is scoped to **large, sparse, media-dense** infinite canvases and is verified with repeatable benchmarks, not marketing claims:

- Document node count ≠ Pixi DisplayObject count; ID lookups are O(1), single-node spatial index updates are O(log N).
- Pan/zoom hot paths scale with visible and preloaded node count; a single-node update never triggers a full scene rebuild.
- On-demand rendering when idle (no animation/video/interaction); views, texture leases, listeners, and tickers return to baseline after destroy.

```bash
pnpm benchmark:run       # local headless benchmark (10k/50k/100k-node datasets, etc.)
pnpm benchmark:browser   # real Chromium benchmark
pnpm benchmark:check     # compare against historical baseline, detect regressions
```

See [performance goals & benchmarks](docs/10-performance-benchmarks.md) for details.

## Development

```bash
pnpm install

# static boundary and doc checks
pnpm docs:check
pnpm packages:check

# layered test suites
pnpm test:core          # @pixi-board/core
pnpm test:contracts     # capabilities / agent-tools contracts
pnpm test:adapters      # adapter-browser / adapter-tauri / contract test suite
pnpm test:browser       # Chromium renderer contract

# build publishable artifacts
pnpm build:release
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution workflow. CI runs static boundary checks, core contract tests, Chromium browser contracts, and a performance regression gate on every push/PR — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml); desktop Tauri integration gates for macOS/Windows live in [`desktop-launch-smoke.yml`](.github/workflows/desktop-launch-smoke.yml).

## Documentation

- [Docs index & recommended reading order](docs/README.md)
- [Product goals & scope](docs/00-product-goals.md) · [Current-state assessment](docs/01-current-state.md) · [Target architecture](docs/02-target-architecture.md)
- [Package boundaries](docs/03-package-boundaries.md) · [Public API design](docs/04-public-api.md) · [Custom node system](docs/05-custom-node-system.md)
- [Capabilities, plugins & agents](docs/06-capabilities-plugins-agents.md) · [Platform, assets & persistence](docs/07-platform-assets-persistence.md)
- [Code migration plan](docs/08-migration-plan.md) · [Delivery roadmap & acceptance](docs/09-delivery-roadmap.md)
- [Performance goals & benchmarks](docs/10-performance-benchmarks.md) · [Testing, release & compatibility strategy](docs/11-testing-release-compatibility.md)
- [Risks & open decisions](docs/12-risks-open-decisions.md) · [Goal traceability matrix](docs/13-traceability.md)
- [Architecture Decision Records (ADR)](docs/adr)

## License

[MIT](LICENSE) © 2026 [Xindong](https://github.com/xindong)
