# @pixi-board/renderer-pixi

Internal PixiJS 8 renderer vertical slice. It consumes immutable core snapshots
and `BoardChangeSet` values, and owns view lifecycle, culling and renderer
registration. The package does not depend on Tauri, plugins, agents or UI.

The renderer includes `rect`, `image` (asset lease delegated to the host),
`unknown-node`, and an injectable custom renderer registry. `PixiBoardRenderer`
can use the default lazy PixiJS 8 adapter when factories are omitted; callers
may inject application/view factories, a spatial index, and a capture adapter
for tests and advanced hosts. The default spatial index is a real uniform grid
over pure document bounds (not a full-scan fallback). Capture supports viewport,
node, and bounds PNG contracts while preserving the document as the source of
truth and Pixi views as disposable cache.
