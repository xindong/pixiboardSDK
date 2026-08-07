# @pixi-board/renderer-pixi

Internal PixiJS 8 renderer vertical slice. It consumes an immutable full
snapshot for rebuilds, then applies `BoardDocumentUpdate` and `BoardChangeSet`
values by changed ID. Normal incremental commits do not scan the full document;
the document remains truth and the Pixi scene remains a disposable cache. The
package owns view lifecycle, culling and renderer registration and does not
depend on Tauri, plugins, agents or UI.

The renderer includes `rect`, `image` (asset lease delegated to the host),
`unknown-node`, and an injectable custom renderer registry. `PixiBoardRenderer`
can use the default lazy PixiJS 8 adapter when factories are omitted; callers
may inject application/view factories, a spatial index, and a capture adapter
for tests and advanced hosts. The default spatial index is a real uniform grid
over pure document bounds (not a full-scan fallback). Capture supports viewport,
node, and bounds PNG contracts while preserving the document as the source of
truth and Pixi views as disposable cache.
