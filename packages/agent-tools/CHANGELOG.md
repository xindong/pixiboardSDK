# Changelog

## 0.1.0-alpha.1

### Minor Changes

- 955e863: Publish `@pixi-board/capabilities` and `@pixi-board/agent-tools`; remove `@pixi-board/mcp-host`.

  A third-party agent project can now embed the canvas and drive it from its own
  agent layer without taking the renderer: install `@pixi-board/core` +
  `@pixi-board/capabilities` (+ optionally `@pixi-board/agent-tools`) and run
  headless. Both packages externalize their dependencies, so there is exactly one
  `capabilities` implementation on npm.

  `agent-tools` keeps its `./schemas` subpath so the `canvas.read` / `canvas.write`
  JSON Schemas can be registered directly with an agent framework's tool registry.

  `mcp-host` is deleted. It only implemented `tools/call` — no `initialize` or
  `tools/list` handshake — so it could not be attached to a real MCP client, and it
  was never published. Transport (MCP, HTTP, in-process) is now explicitly the
  integrator's concern; the SDK ships the tool contract and its schemas.

  `CapabilityError` now carries a `brand` field, and `isCapabilityError()` is
  exported. `pixiboardjs` inlines capabilities into its bundle, so an error thrown
  by a board is not an `instanceof` the class a separately installed consumer
  imports; the brand makes that identification work across copies. Error mapping in
  `capabilities` and `agent-tools` uses it, which also fixes the pre-existing case
  where such an error was flattened to `INTERNAL_ERROR`.

### Patch Changes

- Updated dependencies [9415656]
- Updated dependencies [955e863]
- Updated dependencies [199a6e4]
- Updated dependencies [955e863]
  - @pixi-board/core@0.1.0-alpha.1
  - @pixi-board/capabilities@0.1.0-alpha.1

All notable changes to `@pixi-board/agent-tools` will be documented here.
