# Desktop SDK integration fixture

This headless fixture is the smallest desktop-host wiring example for PixiBoardJS.
`src/index.ts` composes the host around the formal `pixiboardjs` export; it does
not define a second `createPixiBoard` facade.

```text
createPixiBoard
  ├─ BoardCore
  ├─ BoardCapabilities  ── UI / Plugin API v3
  ├─ Agent tools          ── canvas.read / canvas.write
  └─ DesktopDocumentPort  ── fake Tauri bridge in tests
```

The host owns one Core instance and forwards its `ChangeSet` to the UI,
Agent-facing persistence and v3 plugins. The port is intentionally narrow and
does not expose the legacy `TauriBoardRepository`. Plugin manifests must declare
`apiVersion: 3`; v2 manifests are rejected without an adapter or migration path.
The host reuses the internal `@pixi-board/plugin-api-v3` contract package.

Run only this fixture's tests with:

```sh
pnpm --dir apps/examples-desktop-sdk test
```
