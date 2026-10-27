# @pixi-board/capabilities

The permissioned read/write surface over a PixiBoardJS document. UI, plugins and
agents all go through this one contract, so every mutation lands in the same
transaction pipeline and produces the same revision, ChangeSet and history entry.

Most applications get an instance from `board.capabilities` (see `pixiboardjs`)
rather than constructing one. `createBoardCapabilities(core)` builds a surface
over a headless `BoardCore` when no renderer is involved.

Every write takes an `origin` (`user` / `api` / `plugin:<id>` / `agent:<id>`), so
a host can tell who changed what. `availability` reports which capabilities the
current runtime actually has — `preview`, `capture`, and unified media `import`.

An optional `AssetImportService` handles browser files, Agent paths and URLs.
The adapter probes original bytes, stores assets and derivatives, and returns
`{ asset, assetRefs, width, height, duration, previewStatus }`. Capabilities
complete that work before opening the Core transaction, so an asset record and
its node are committed together. `assetRefs` remain semantic slots: videos use
`poster`, audio uses `waveform`, documents use `preview`, and `primary` always
points to original bytes.

Use `isCapabilityError(error)` instead of `instanceof CapabilityError` when the
error may have crossed a package boundary: `pixiboardjs` inlines this package
into its bundle, so a board's error is not an instance of the class imported
here.
