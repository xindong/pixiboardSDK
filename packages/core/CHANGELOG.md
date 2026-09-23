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

- 199a6e4: Implement selection resize end to end and connect the previously inert `ResizePolicy`.

  - core: `resolveResize()` / `resolveResizeSize()` turn one handle drag into a patch through the node type's policy (`free`, `aspect-ratio`, `fixed`, `custom`), resolving the delta in a rotated node's own frame and anchoring the edges the handle does not own. `nodes.resize()` commits it; a refused resize produces no revision. Policies are now validated at registration instead of failing silently at runtime.
  - core: `TransactionOptions.coalesceKey` merges a per-frame pointer gesture into one history entry, compacting the repeated replace patches so a long drag does not leave thousands of them on a single undo step.
  - pixiboardjs: `board.transform` drives resize gestures for the current selection — handle placement with rotation-aware cursors, single-node and group bounds, and `begin`/`update`/`commit`/`cancel` sessions. Group resize scales the selection as one unit while each node's size still passes through its own policy.
  - pixiboardjs/browser: `attachDomTransformer()` renders the eight control points as real, grabbable DOM elements and drives the gesture from their pointer events.

- 955e863: Connect viewport virtualization to the main package and give node renderers level-of-detail tiers.

  - core: `viewport.visibleWorldBounds(padding?)` projects the current surface back into world coordinates, and `viewport.getScreenSize()` reads it back. Both return/report nothing useful until a host has actually measured the surface — the 1x1 constructor default is a placeholder, and `visibleWorldBounds()` returns `undefined` rather than culling everything against it.
  - pixiboardjs: `createPixiBoard()` now drives the renderer's visible bounds on mount, on `viewport:change`, and on container resize, so live render objects track visible content instead of document size. Previously `PixiBoardRenderer.setVisibleBounds()` existed and was tested but nothing on the facade path ever called it, leaving every SDK consumer fully retained. Configurable through `virtualization: { enabled?, padding? }` (default on, 256 world units of margin); `RuntimeRenderer.setVisibleBounds` is optional, so a renderer that retains everything stays valid.
  - renderer-pixi: `setVisibleBounds(bounds, scale?)` resolves a level-of-detail tier from the viewport scale (`lod: { thresholds }`, default `[0.25, 0.5, 1]`) and exposes it as `context.lod`, which was previously always an empty object. Views retained across a tier change are re-updated once so a node renderer can draw itself more cheaply when zoomed out — the case culling cannot help with, because every node is legitimately on screen. The tier also travels to `acquireTexture` as `lodLevel`/`lodScale` so a host can resolve a lower-resolution asset variant.

### Patch Changes

- 9415656: Prepare reproducible JavaScript and declaration artifacts, formal package exports, API reporting, and release-size gates for the P6 publishability workflow.

All notable changes to `@pixi-board/core` will be documented here.
