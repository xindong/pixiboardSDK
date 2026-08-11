# @pixi-board/capabilities

The permissioned read/write surface over a PixiBoardJS document. UI, plugins and
agents all go through this one contract, so every mutation lands in the same
transaction pipeline and produces the same revision, ChangeSet and history entry.

Most applications get an instance from `board.capabilities` (see `pixiboardjs`)
rather than constructing one. `createBoardCapabilities(core)` builds a surface
over a headless `BoardCore` when no renderer is involved.

Every write takes an `origin` (`user` / `api` / `plugin:<id>` / `agent:<id>`), so
a host can tell who changed what. `availability` reports which capabilities the
current runtime actually has — `preview` and `capture` need a mounted renderer.

Use `isCapabilityError(error)` instead of `instanceof CapabilityError` when the
error may have crossed a package boundary: `pixiboardjs` inlines this package
into its bundle, so a board's error is not an instance of the class imported
here.
