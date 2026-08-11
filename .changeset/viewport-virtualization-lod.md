---
"pixiboardjs": minor
"@pixi-board/core": minor
---

Connect viewport virtualization to the main package and give node renderers level-of-detail tiers.

- core: `viewport.visibleWorldBounds(padding?)` projects the current surface back into world coordinates, and `viewport.getScreenSize()` reads it back. Both return/report nothing useful until a host has actually measured the surface — the 1x1 constructor default is a placeholder, and `visibleWorldBounds()` returns `undefined` rather than culling everything against it.
- pixiboardjs: `createPixiBoard()` now drives the renderer's visible bounds on mount, on `viewport:change`, and on container resize, so live render objects track visible content instead of document size. Previously `PixiBoardRenderer.setVisibleBounds()` existed and was tested but nothing on the facade path ever called it, leaving every SDK consumer fully retained. Configurable through `virtualization: { enabled?, padding? }` (default on, 256 world units of margin); `RuntimeRenderer.setVisibleBounds` is optional, so a renderer that retains everything stays valid.
- renderer-pixi: `setVisibleBounds(bounds, scale?)` resolves a level-of-detail tier from the viewport scale (`lod: { thresholds }`, default `[0.25, 0.5, 1]`) and exposes it as `context.lod`, which was previously always an empty object. Views retained across a tier change are re-updated once so a node renderer can draw itself more cheaply when zoomed out — the case culling cannot help with, because every node is legitimately on screen. The tier also travels to `acquireTexture` as `lodLevel`/`lodScale` so a host can resolve a lower-resolution asset variant.
