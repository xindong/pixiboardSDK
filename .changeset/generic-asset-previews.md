---
"pixiboardjs": minor
"@pixi-board/core": minor
"@pixi-board/capabilities": patch
"@pixi-board/agent-tools": patch
"@pixi-board/plugin-sdk": patch
---

Add validated content-addressed preview variants, shared preview state and stable viewport/reset sizing helpers, and a host-configurable preview lifecycle in the site. The site accepts arbitrary files, classifies ZIP model archives by their directory, preserves preview state, and guards stale texture decodes. Hosts can supply preview jobs without coupling the SDK to a transport or renderer service.
