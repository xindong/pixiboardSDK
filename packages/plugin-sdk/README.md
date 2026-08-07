# @pixi-board/plugin-sdk

Public Plugin API v3 authoring contract. It exports `definePlugin`, typed
manifest/context/canvas/event contracts, and no host implementation.

`PluginHost`, permission enforcement, package loading, and process lifecycle
remain private runtime concerns in `@pixi-board/plugin-api-v3`.
