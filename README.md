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

Two things here are structural, not incremental — they follow from the data model rather than from tuning.

**Live render objects track what's on screen, not how big the document is.** The document is flat JSON; the PixiJS scene is a viewport cache the renderer builds and discards. A spatial index answers "what is visible," and only those nodes get render objects. In the benchmark below, growing the document from 10k to 100k nodes leaves the number of live render objects flat.

**Agent writes go through the same transaction pipeline as human edits.** There is no separate automation API. An agent's `canvas.write` produces the same revision, the same ChangeSet, and the same history entry a drag would — so it is undoable, observable, and tagged with an `origin`. Most canvas libraries have no notion of a non-human writer at all; the ones that expose an editor API let automation bypass history and access control.

| | PixiBoardJS | Konva / Fabric.js | tldraw |
|---|---|---|---|
| Live render objects | Track visible content | All nodes retained | All nodes retained |
| Agent writes | Same transaction pipeline as human edits — undoable, audited, `origin`-tagged | Not included | No first-class agent contract |
| Data model | Flat, serializable JSON document | Nested scene graph (parent/child) | Document model + built-in sync |
| Rendering | PixiJS / WebGL | Canvas2D | React / DOM |
| Undo/redo & history | Built-in, transaction-based | Not included | Built-in |
| Access control (UI/plugin/agent) | Built-in `capabilities` contract | Not included | Not included |
| Custom node types | Unified registry, no SDK core changes needed | Custom subclasses | Custom shape classes |
| Platform targets | Browser + Tauri WebView via ports/adapters | Browser | Browser |
| License | MIT | MIT | Source-available; paid license for production SDK use |
| Real-time collaboration | Not in v1 | Not included | Built-in sync engine |

Pick PixiBoardJS for a whiteboard, moodboard, or AI generation canvas where the document is large and media-dense, and where agents or plugins write to it alongside people. Pick tldraw if you want the best-in-class React editing experience and need multiplayer today. Pick Konva/Fabric/raw PixiJS if you want a general 2D graphics toolkit and intend to own the document model yourself.

## Core Features

- **Flat data model** — the document is plain JSON; nodes have no parent/child nesting. Any render object can be destroyed and rebuilt from data at any time.
- **Viewport virtualization, on by default** — `createPixiBoard()` culls to the visible world rectangle (plus a configurable margin) as soon as the host reports a surface size. Spatial indexing, level-of-detail tiers, and texture lifecycle management ship with it.
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

A fuller, copy-pasteable external-consumer example lives in [`apps/examples-vanilla`](apps/examples-vanilla); a custom-node example is in [`apps/examples-custom-node`](apps/examples-custom-node); a Tauri desktop integration example is in [`apps/examples-desktop-sdk`](apps/examples-desktop-sdk); and the source for the live demo at the top of this README is in [`apps/site`](apps/site).

## Agents Are First-Class Writers

An agent doesn't get a side door into the canvas. `canvas.write` lands in the same transaction pipeline a pointer drag does:

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

board.history.undo();   // the agent's write undoes like any other edit
```

What that buys you:

- **Undoable** — the write produces a normal history entry. A user can undo an agent's work without a bespoke rollback path.
- **Audited** — every write carries an `origin` (`user` / `api` / `plugin:<id>` / `agent:<id>`; agent tools default to `agent:canvas`), so you can tell who changed what.
- **Consistent** — UI, plugin, and agent paths produce the same document, revision, and ChangeSet. This is asserted field-by-field in [`packages/agent-tools/src/contract.test.ts`](packages/agent-tools/src/contract.test.ts), not just intended.
- **Headless-capable** — document reads and writes work without a renderer. Tools that need a mounted canvas (preview, capture) report capability unavailability rather than assuming a renderer exists.

Read paths are agent-shaped too: `canvas.read` returns compact node DTOs with field projection and pagination, so a large board doesn't have to arrive as one enormous blob of JSON.

### Transport is yours

`agent-tools` is a contract, not a server. It hands you two tool definitions with JSON Schemas (`import { canvasReadSchema, canvasWriteSchema } from "@pixi-board/agent-tools/schemas"`) and an async `call(name, input)`. Wiring that to MCP, HTTP, a WebSocket, or a direct function call in your own agent loop is a few lines against whatever harness you already run — so the SDK doesn't ship a server and doesn't chase a moving protocol.

### Or skip the tools entirely

`board.capabilities` is public on its own. If you have your own tool schema, your own DTO shape, or your own agent framework's conventions, build directly against it:

```ts
import { createBoardCapabilities, isCapabilityError } from "@pixi-board/capabilities";

const result = await board.capabilities.nodes.create(
  { nodes: [{ type: "rect", x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0 }] },
  { origin: "agent:my-agent" },
);
```

Same transaction pipeline, same ChangeSet, same undo — you just own the translation layer. `agent-tools` is the convenience layer over this, not a privileged path around it.

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
    │ (UI/plugin/││  (PixiJS    ││ browser  ││   tauri    ││ (canvas.read│
    │  agent      ││   render    ││(IndexedDB││ (WebView   ││ /.write +   │
    │  contract)  ││    cache)   ││ /OPFS)   ││  filesystem)││ JSON Schema)│
    └──────┬─────┘└─────┬───────┘└─────────┘└────────────┘└─────────────┘
           │            │                        transport (MCP/HTTP/direct)
           │            │                            is yours to assemble
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
| [`@pixi-board/capabilities`](packages/capabilities) | Unified permissioned read/write surface for UI / plugins / agents | Public |
| [`@pixi-board/agent-tools`](packages/agent-tools) | `canvas.read` / `canvas.write` tool contracts and their JSON Schemas | Public |
| [`@pixi-board/adapter-browser`](packages/adapter-browser) | IndexedDB / OPFS / ObjectURL persistence and asset adapters | Internal |
| [`@pixi-board/adapter-tauri`](packages/adapter-tauri) | Tauri WebView filesystem adapter | Internal |
| [`@pixi-board/plugin-sdk`](packages/plugin-sdk) / [`plugin-api-v3`](packages/plugin-api-v3) | Plugin `definePlugin()` and the v3 capability contract | Public / Internal |

Full dependency direction and ownership boundaries: [package boundaries](docs/03-package-boundaries.md).

## What Virtualization Actually Buys You

The claim isn't "faster than X." It's that the renderer's workload is decoupled from document size. Panning a fixed viewport across three documents that differ by 10× in node count:

| Document nodes | Live render objects |
|---:|---:|
| 10,000 | ~360 |
| 50,000 | ~360 |
| 100,000 | ~360 |

Frame work follows that curve rather than the node count. This is the property to design around; absolute milliseconds depend on your nodes, your assets, and your GPU.

**How to read this number.** It's an excerpt from one local canonical run on 2026-08-07 (Chromium 151, 1920×1080, DPR 1, seed 42, 30 warmup + 120 sampled frames), recorded as `evidence-only`: there is no fixed-machine baseline and no approved absolute budget, so no performance gate has passed. The run used ANGLE SwiftShader, which does not represent hardware GPU throughput, and the workload is sparse rectangular cards. It does **not** support a claim that PixiBoardJS is faster than Konva across canvas workloads — the [benchmark doc](docs/10-performance-benchmarks.md) records the cases where it isn't, including a 100k full-retained p95 of 41.80 ms.

Structural invariants the benchmarks hold to:

- Document node count ≠ Pixi DisplayObject count; ID lookups are O(1). Spatial index cost is per-node, independent of N (uniform grid: O(cells a node covers)).
- Pan/zoom hot paths scale with visible and preloaded node count; a single-node update never triggers a full scene rebuild.
- Level-of-detail tiers give node renderers a cheaper path when zoomed out far enough that culling can't help — every node is legitimately on screen.
- On-demand rendering when idle (no animation/video/interaction); views, texture leases, listeners, and tickers return to baseline after destroy.

```bash
pnpm benchmark:run       # local headless benchmark (10k/50k/100k-node datasets, etc.)
pnpm benchmark:browser   # real Chromium benchmark
pnpm benchmark:check     # compare against historical baseline, detect regressions
```

See [performance goals & benchmarks](docs/10-performance-benchmarks.md) for the full data, including the failing cases.

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
