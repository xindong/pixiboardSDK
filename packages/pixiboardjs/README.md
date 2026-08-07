# pixiboardjs

The single public PixiBoardJS package. It composes Core, Pixi renderer,
capabilities, and platform ports behind the `createPixiBoard()` facade without
exposing the mutable store or Pixi scene.

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
