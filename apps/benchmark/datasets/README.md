# Synthetic Card dataset contract

`synthetic-card` is a deterministic, renderer-neutral data source for core,
spatial-index, culling, pan/zoom and selection benchmarks. Each generated
dataset has fixed card dimensions, seeded world coordinates and a small set of
shared image assets. No Pixi `DisplayObject` is created by generation.

Use `generateSyntheticCards({ count: 10_000, seed: 42 })` from
`src/synthetic-card.mjs`. Supported counts are `1_000`, `10_000`, `50_000` and
`100_000`; generated JSON files are intentionally not committed.
