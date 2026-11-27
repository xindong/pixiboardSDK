# @pixi-board/plugin-sdk

> Internal workspace package, not published. Install `pixiboardjs` and import from `pixiboardjs/plugin` (ADR 0016).

Plugin API v3 authoring contract, published as `pixiboardjs/plugin`. It exports `definePlugin`, typed
manifest/context/canvas/event contracts, and no host implementation.

`PluginHost`, permission enforcement, package loading, and process lifecycle
remain private runtime concerns in `@pixi-board/plugin-api-v3`.
