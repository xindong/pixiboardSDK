# Custom task-card fixture

This executable Vitest fixture uses only public `pixiboardjs` custom-node
registration plus the renderer contract. It proves that `acme.task-card` can be
registered and created, that its Pixi view is destroyed while offscreen and
rebuilt from document props, and that a saved document reload preserves its
title and status.

Run it with:

```sh
pnpm --filter pixiboardjs-example-custom-node test
```
