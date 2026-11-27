# Versioning policy

`pixiboardjs` follows normal SemVer. Until the first stable release, prerelease
identifiers (for example `0.1.0-alpha.0`) communicate internal-alpha status.

The following compatibility dimensions remain independent and must not be
encoded as one shared number:

- SDK package SemVer (`pixiboardjs` is the only published package; core,
  capabilities, agent-tools and plugin ship as its subpaths).
- `schemaVersion` for persisted documents.
- `node typeVersion` for custom node payloads.
- Plugin API version (new SDK host starts at v3; no v2 adapter).
- Agent tool schema version.

Changesets keeps the former public packages in a fixed version group with
`pixiboardjs` so their internal versions follow it, but they are private and
never published. All workspace packages are bundled into the main package and
are not registry dependencies (ADR 0016).

`pnpm release:check` verifies the real packed manifest and only runs external
consumers when generated JavaScript, declarations and API reports exist. It does
not build or invent artifacts. Internal packages stay private unless an ADR
explicitly makes them public; `pixiboardjs/plugin` (the private
`@pixi-board/plugin-sdk` package) is not the private
`@pixi-board/plugin-api-v3` host package.
