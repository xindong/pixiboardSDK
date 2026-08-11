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
pnpm add pixiboardjs
```

The public surface is the package root. `./browser`, `./node` and `./types`
are explicit subpath contracts so consumers can select platform ports without
depending on internal workspace packages.

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

`pnpm build:release` reproducibly creates ESM JavaScript, source maps and
declaration artifacts under `dist/`. The public facade bundles private workspace
implementation packages and keeps `pixi.js` as its only registry runtime
dependency.

`pnpm api:report` refreshes the approved API reports. `pnpm release:check`
requires those real artifacts, packs the facade, and installs the tarball into
clean Node and Vite consumers outside the repository before checking API and
bundle-size budgets. It never creates or substitutes release artifacts.
