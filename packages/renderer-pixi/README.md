# @pixi-board/renderer-pixi

Internal PixiJS 8 renderer vertical slice. It consumes immutable core snapshots
and `BoardChangeSet` values, and owns view lifecycle, culling and renderer
registration. The package does not depend on Tauri, plugins, agents or UI.

The first slice includes `rect`, `image` (asset lease delegated to the host) and
`unknown-node` renderers. `PixiBoardRenderer` can use the default lazy PixiJS
8 adapter when factories are omitted; callers may still inject application/view
factories for tests and advanced hosts. Video,
audio, input, capture, texture caching and spatial-index optimisations are
intentionally deferred; culling is exposed as an injectable bounds query.
