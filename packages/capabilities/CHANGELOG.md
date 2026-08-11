# Changelog

All notable changes to `@pixi-board/capabilities` will be documented here.

## Unreleased

- Published for the public beta so a host can drive a board from its own agent,
  plugin or automation layer without depending on the renderer.
- Added `isCapabilityError()`, which recognises a `CapabilityError` across
  duplicate copies of the class. `pixiboardjs` inlines this package into its own
  bundle, so `instanceof` alone does not hold at that boundary.
