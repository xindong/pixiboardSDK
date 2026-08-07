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

The real Tauri boundary is in `@pixi-board/adapter-tauri`. The minimal launch
smoke lives in `src-tauri/` and uses the checked-in `smoke/` page, so it does
not require a frontend build:

```sh
cargo run --manifest-path apps/examples-desktop-sdk/src-tauri/Cargo.toml -- --smoke
```

Project sessions only accept the new SDK document format. They do not open,
migrate, or round-trip legacy schema-v4 projects, and there is no legacy adapter.
The CI workflow at `.github/workflows/desktop-launch-smoke.yml` is a configured
macOS/Windows gate; report a local macOS run separately from the Windows CI
evidence, which must not be described as locally executed.

Run only this fixture's tests with:

```sh
pnpm --dir apps/examples-desktop-sdk test
```
