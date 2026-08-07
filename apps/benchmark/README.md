# Benchmark skeleton

This package defines deterministic synthetic-card fixtures, metrics shape and
scenario names for the P7 performance work. It does **not** run PixiJS,
WebGL, Konva or a real renderer, and it never reports fabricated measurements.

The future harness will consume these contracts in fixed browser/device
environments. Initial targets in `src/targets.mjs` are goals, not observed
results. A scenario currently returns `status: "not-implemented"` until a
renderer-backed harness is added.

Dataset sizes covered by the generator are 1k, 10k, 50k and 100k cards. The
release acceptance path focuses on 10k/50k/100k sparse-card data.
