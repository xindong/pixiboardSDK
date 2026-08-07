import { describe, expect, it } from "vitest";
import { BoardCore, type BoardDocument, type BoardNode } from "../src";

function largeDocument(size: number): BoardDocument {
  const nodes: BoardNode[] = [];
  for (let index = 0; index < size; index += 1) {
    nodes.push({
      id: `node-${index}`,
      type: "perf.node",
      typeVersion: 1,
      x: index,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      zIndex: index,
      props: { value: index },
    });
  }
  return { schemaVersion: 1, revision: 0, nodes, assets: [] };
}

function p95(samples: number[]): number {
  return [...samples].sort((left, right) => left - right)[Math.ceil(samples.length * 0.95) - 1];
}

describe("core performance and structural sharing", () => {
  it("keeps a 100k document snapshot immutable across a single-node update", () => {
    const core = new BoardCore({ document: largeDocument(100_000) });
    const before = core.document.snapshot();
    const start = performance.now();
    core.nodes.update("node-99999", { x: 42 });
    const elapsed = performance.now() - start;

    expect(before.nodes).toHaveLength(100_000);
    expect(before.nodes[99_999].x).toBe(99_999);
    expect(core.nodes.get("node-99999")?.x).toBe(42);
    expect(Object.isFrozen(before)).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(0);
    console.info(`core 100k single update: ${elapsed.toFixed(2)}ms`);
  });

  it("updates 1000 nodes in one transaction without changing document shape", () => {
    const core = new BoardCore({ document: largeDocument(100_000) });
    const start = performance.now();
    core.transaction("1000-node batch", () => {
      for (let index = 0; index < 1_000; index += 1) {
        core.nodes.update(`node-${index}`, { x: index + 1 });
      }
    });
    const elapsed = performance.now() - start;

    expect(core.document.snapshot().nodes).toHaveLength(100_000);
    expect(core.nodes.get("node-0")?.x).toBe(1);
    expect(core.nodes.get("node-999")?.x).toBe(1_000);
    expect(core.document.snapshot().revision).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(0);
    console.info(`core 100k / 1000-node batch: ${elapsed.toFixed(2)}ms`);
  });

  it("reports p95 timings for repeated 1000-node batches", () => {
    const core = new BoardCore({ document: largeDocument(100_000) });
    const samples: number[] = [];
    for (let batch = 0; batch < 10; batch += 1) {
      const start = performance.now();
      core.transaction("1000-node batch", () => {
        for (let index = 0; index < 1_000; index += 1) {
          core.nodes.update(`node-${index}`, { x: batch + index });
        }
      });
      samples.push(performance.now() - start);
    }
    const value = p95(samples);
    expect(value).toBeGreaterThanOrEqual(0);
    console.info(`core 100k / 1000-node batch p95 (${samples.length}): ${value.toFixed(2)}ms`);
  });

  it("reports p95 timings for repeated 100k single-node updates", () => {
    const core = new BoardCore({ document: largeDocument(100_000) });
    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const start = performance.now();
      core.nodes.update("node-50000", { x: index });
      samples.push(performance.now() - start);
    }
    const value = p95(samples);
    expect(value).toBeGreaterThanOrEqual(0);
    console.info(`core 100k single update p95 (${samples.length}): ${value.toFixed(2)}ms`);
  });
});
