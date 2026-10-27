# pixiboardjs

[![npm](https://img.shields.io/npm/v/pixiboardjs)](https://www.npmjs.com/package/pixiboardjs)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/xindong/pixiboardSDK/blob/main/LICENSE)

The single public PixiBoardJS package — a high-performance infinite canvas SDK
for large, media-heavy boards. It composes Core, Pixi renderer, capabilities,
and platform ports behind the `createPixiBoard()` facade without exposing the
mutable store or Pixi scene.

[Live demo](https://xindong.github.io/pixiboardSDK/) · [Full documentation & source](https://github.com/xindong/pixiboardSDK)

The facade performs one full renderer rebuild at mount. Later Core commits
forward detached immutable changed-node updates directly to the renderer, so a
single-node render commit does not create or scan a full document snapshot.

Install target for SDK consumers:

```sh
pnpm add pixiboardjs@alpha
```

The public surface is the package root. `./browser`, `./node`, `./types` and
the Node-only `./node-media-provider` are explicit subpath contracts so
consumers can select platform ports without depending on internal workspace
packages. The media provider is not imported by the browser entries and must
only be loaded in Node.

```ts
import { createPixiBoard } from "pixiboardjs";

const board = await createPixiBoard({ container });
await board.ready;
const node = await board.nodes.create({
  type: "card",
  x: 0,
  y: 0,
  width: 240,
  height: 120,
});
node.x(100);
await board.destroy();
```

See [`VERSIONING.md`](VERSIONING.md) for the separate SDK, document, node,
plugin and Agent-tool version dimensions.

### Node media provider

The host injects `sharp`; install it in the Node application if it is not
already available. `ffmpeg` and `ffprobe` are executable dependencies used for
video/audio probing and previews. Pass their paths explicitly, or set
`FFMPEG_PATH` / `FFPROBE_PATH`:

```ts
import sharp from "sharp";
import { createNodeMediaProvider } from "pixiboardjs/node-media-provider";

const media = createNodeMediaProvider({
  sharp,
  ffmpegPath: "/opt/homebrew/bin/ffmpeg",
  ffprobePath: "/opt/homebrew/bin/ffprobe",
});
```

If paths are omitted, the provider checks `FFMPEG_PATH` / `FFPROBE_PATH` and
common installation locations before falling back to the executable names on
`PATH`. Do not import this subpath from browser code.

`pnpm build:release` reproducibly creates ESM JavaScript, source maps and
declaration artifacts under `dist/`. The public facade bundles private workspace
implementation packages and keeps `pixi.js` as its only registry runtime
dependency.

`pnpm api:report` refreshes the approved API reports. `pnpm release:check`
requires those real artifacts, packs the facade, and installs the tarball into
clean Node and Vite consumers outside the repository before checking API and
bundle-size budgets. It never creates or substitutes release artifacts.

## Connections and node agents (alpha.5)

```ts
import { attachConnections, createNodeAgentController } from "pixiboardjs/browser";

const connections = await attachConnections(board, {
  surface: container, enabled: true, persistSettings: false,
});
connections.create("source-node", "result-node");

const agent = createNodeAgentController(board, {
  context: { scope: "upstream", maxDepth: 2, maxNodes: 20, maxChars: 24000 },
  getNeighborIds: connections.getNeighborIds,
  onSubmit: async ({ prompt, signal }) => sendToYourAgent(prompt, signal),
});
await agent.submit({ nodeId: "result-node" }, "Describe the sources and improve this result");
```

Connections live in `document.metadata.connections` as `{ id, source, target }`.
They follow moving/rotating nodes, support selection/deletion, configurable
styles, viewport culling, and atomic copy/paste with nodes. Metadata edits and
node deletion participate in undo/redo. No relationship fields are read from
node props.

Node agents collect bounded node/selection/upstream/downstream context, resolve
assets through host callbacks, and reject cancelled or stale preparation. The
SDK supplies no AI provider, credentials or generation service.

Use `board.nodes.convert(id, { type, props, assetRefs })` to replace a placeholder
with a result while keeping its ID, geometry and connections. Register the target
node type first. Old content properties and assets are replaced.

Advanced browser hosts can import registry, geometry and Pixi renderer helpers
from `pixiboardjs/browser`; no private workspace imports are needed. See the
[connection and node-agent guide](https://github.com/xindong/pixiboardSDK/blob/main/docs/developers/connections-and-node-agent-local.md)
for lifecycle, style and host integration details. Call `destroy()` on controllers
when removing a host surface.

The browser ESM budget is 270,000 bytes (uncompressed) for the native connection
renderer and node-agent additions; the root and Node budgets are unchanged.
