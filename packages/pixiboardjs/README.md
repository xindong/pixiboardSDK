# pixiboardjs

The single public PixiBoardJS package. This package currently contains the
publish/exports contract only; the `dist/` artifacts are produced by the
implementation work in later roadmap milestones.

Install target for SDK consumers:

```sh
pnpm add pixiboardjs
```

The public surface is the package root. `./browser`, `./node` and `./types`
are explicit subpath contracts so an eventual build can keep browser, Node and
type-only consumers tree-shakeable without exposing internal packages.

See [`VERSIONING.md`](VERSIONING.md) for the separate SDK, document, node,
plugin and Agent-tool version dimensions.
