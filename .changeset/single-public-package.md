---
"pixiboardjs": minor
---

`pixiboardjs` is now the only published package. Core, capabilities, agent tools and the plugin contract move to subpaths: `pixiboardjs/core`, `pixiboardjs/capabilities`, `pixiboardjs/agent-tools` (schemas at `pixiboardjs/agent-tools/schemas`) and `pixiboardjs/plugin`, with exactly the same exports as `@pixi-board/core`, `@pixi-board/capabilities`, `@pixi-board/agent-tools` and `@pixi-board/plugin-sdk`. Every entry now shares one bundled copy of core and capabilities, so `instanceof` checks and registries behave consistently across entries. The old package names get one final release that forwards to these subpaths and are then deprecated.
