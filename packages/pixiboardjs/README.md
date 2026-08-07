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
