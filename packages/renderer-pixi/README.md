# @pixi-board/renderer-pixi

Internal PixiJS 8 renderer vertical slice. It consumes immutable core snapshots
and `BoardChangeSet` values, and owns view lifecycle, culling and renderer
registration. The package does not depend on Tauri, plugins, agents or UI.

The first slice includes `rect`, `image` (asset lease delegated to the host) and
`unknown-node` renderers. Video, audio, input, capture, texture caching and
spatial-index optimisations are intentionally deferred; culling is exposed as
an injectable bounds query so hosts can provide RBush or another index.
