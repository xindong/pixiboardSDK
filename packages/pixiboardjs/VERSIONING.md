# Versioning placeholder

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

When publishing begins, Changesets/API reports and an external `npm pack`
consumer check become release gates. Internal packages stay private unless a
future ADR explicitly makes them public.
