# PixiBoardJS benchmark harness

This package contains two deliberately different benchmark paths:

1. The deterministic Node harness (`benchmark:run`) drives the real
   `BoardCore`, `GridSpatialIndex`, `PixiBoardRenderer` and `pixiboardjs`
   facade. Its Pixi application and display objects are instrumented adapters,
   so it measures document, spatial, culling, renderer lifecycle and core
   transaction work without claiming browser/WebGL frame results.
2. The optional Chromium smoke (`benchmark:browser`) creates real PixiJS and
   Konva scenes in the same headless Chromium page. It is a comparison smoke,
   not a release baseline: the page loads pinned CDN builds and runs with
   SwiftShader unless a caller changes the runner.

## Dataset and retention matrix

The deterministic release matrix keeps 10k, 50k and 100k nodes (the generator
also supports 1k for fast tests). Renderer culling is reported in both modes:

- `matched-visible`: Pixi retains exactly the selected visible set. Pixi and
  Konva browser comparisons must use the same visible count and viewport.
- `full-retained`: every document node is retained. This is an intentionally
  expensive baseline that shows the cost of disabling virtualization; it must
  not be compared with `matched-visible` as if they were the same workload.

The default logical viewport is **1920×1080 CSS pixels at DPR 1**. Node
instrumented results record this as a contract; they do not measure physical
pixels or GPU throughput. Browser capture/frame work must report the actual
viewport and device scale factor in its own output.

## Cold versus steady measurements

Core transaction observations are split into three explicit phases:

- `*-cold`: the first transaction immediately after constructing the core.
- `*-transition`: three measured transactions after cold, kept separate from
  steady-state statistics.
- the ordinary `core-single-node-update` and
  `core-batch-update-1000`: steady-state samples after the cold and transition
  phases. Their p95 is the value used for the core target evaluation.

Renderer `firstInteractiveMs` is also a cold mount measurement. Browser
`steadyFrameP50/P95/P99Ms` is measured only after the scene is mounted and
updated through a fixed 20-step pan path. The two families must not be mixed.

## Commands

```text
pnpm benchmark:test
pnpm benchmark:run
pnpm benchmark:browser -- --counts 10000 --modes matched-visible
```

`benchmark:run` can write a JSON report by setting
`PIXIBOARD_BENCHMARK_REPORT=/tmp/pixiboard-benchmark.json`. The browser runner
prints JSON to stdout and does not write `apps/benchmark/results/` or any other
generated artifact.

The browser smoke reports PixiJS WebGL and Konva Canvas2D cold/steady timings,
retention mode, viewport and active object count. It explicitly leaves GPU
memory, draw calls/batches, idle CPU/GPU and hardware-GPU throughput
unobserved; SwiftShader numbers are not hardware-GPU evidence. A failed CDN,
Chromium or WebGL setup is an unavailable smoke, not a fabricated result.
