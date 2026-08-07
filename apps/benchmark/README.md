# PixiBoardJS benchmark harness

This package has two benchmark paths:

1. `benchmark:run` is the deterministic Node harness for core, spatial index,
   instrumented renderer lifecycle, and facade transactions.
2. `benchmark:browser` runs the workspace `PixiBoardRenderer` and Konva 9.3.22
   in real Chromium. Pixi must expose an actual WebGL context; Konva must
   expose Canvas2D. A renderer mismatch, console error, missing sample, or
   fairness mismatch fails the run.

The comparison is limited to a large, sparse rectangle-card infinite-canvas
workload. It does not establish that either renderer is universally faster.

## Browser modes

- `matched-visible`: both engines retain the complete flat current-only
  dataset in JavaScript, receive the identical visible-ID plan, instantiate
  the same visible population, and execute the same incremental
  create/update/delete payloads on every frame.
- `full-retained`: both engines instantiate and retain the equivalent complete
  renderer-object population. After each create/update/delete step, both have
  `dataset count + 1` active objects.

The canonical matrix is fixed at 10k, 50k, and 100k nodes; both modes; both
engines; seed 42; a 1920×1080 CSS-pixel viewport at DPR 1; 30 warmup frames;
and 120 measured frames. Formal evidence cannot be written from a reduced
matrix. `benchmark:browser:smoke` is explicitly marked non-publishable.

Frame-work latency starts at a `requestAnimationFrame` callback and includes
the incremental mutation plus completed rendering. Pixi calls `gl.finish()`;
Konva's `Layer.draw()` is synchronous. This is render-completion work, not a
RAF-to-RAF presentation interval. First-interactive includes engine setup,
population creation, the first completed render, and the next RAF; deterministic
dataset generation is excluded.

## Commands

```text
pnpm --filter pixiboardjs-benchmark test
pnpm --filter pixiboardjs-benchmark benchmark:browser:smoke
pnpm --filter pixiboardjs-benchmark benchmark:browser
```

The browser runner writes an ignored raw JSON report under
`apps/benchmark/results/`. Override it with
`PIXIBOARD_BROWSER_OUTPUT=/absolute/report.json`. A canonical run may also
write a summary evidence file with
`PIXIBOARD_BROWSER_EVIDENCE=/absolute/evidence.json`.

Reports include frame-work p50/p95/p99 and >33ms ratio, first interactive,
product-level viewport capture (`PixiBoardRenderer.capture(viewport)` versus
`Konva.Stage.toDataURL()`), active populations, renderer identity, and
instantaneous Chromium heap snapshots when available. Heap snapshots are not
peak/retained/leak measurements. GPU memory and equivalent draw-call counts
remain `notObserved`. Headless Chromium currently reports ANGLE SwiftShader,
so results must not be presented as hardware-GPU throughput.
