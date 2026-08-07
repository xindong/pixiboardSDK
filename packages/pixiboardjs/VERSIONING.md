# Versioning policy

`pixiboardjs` follows normal SemVer. Until the first stable release, prerelease
identifiers (for example `0.1.0-alpha.0`) communicate internal-alpha status.

The following compatibility dimensions remain independent and must not be
encoded as one shared number:

- SDK package SemVer (`pixiboardjs` and public `@pixi-board/core` are intended
  to move lockstep in 1.x).
- `schemaVersion` for persisted documents.
- `node typeVersion` for custom node payloads.
- Plugin API version (new SDK host starts at v3; no v2 adapter).
- Agent tool schema version.

Changesets keeps `pixiboardjs` and `@pixi-board/core` in a fixed version group.
Private workspace packages also use the current alpha train instead of `0.0.0`,
but they are bundled into the main package and are not registry dependencies.

`pnpm release:check` verifies the real packed manifest and only runs external
consumers when generated JavaScript, declarations and API reports exist. It does
not build or invent artifacts. Internal packages stay private unless an ADR
explicitly makes them public; the planned `@pixi-board/plugin-sdk` is not the
current private `@pixi-board/plugin-api-v3` package.
