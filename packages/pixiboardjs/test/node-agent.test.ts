import { expect, it, vi } from "vitest";
import { createNodeAgentController } from "../src/node-agent";
import type { PixiBoard } from "../src/types";

it.each(["resolveAsset", "buildPrompt"] as const)("rejects a live revision change during %s even before a change event is delivered", async hook => {
  let revision = 1;
  const node = { id: "n", type: "file", typeVersion: 1, x: 0, y: 0, width: 100, height: 80, rotation: 0, zIndex: 0, props: {}, assetRefs: { primary: { assetId: "asset", variant: "original" } } };
  const board = {
    signal: new AbortController().signal,
    nodes: { get: () => node },
    selection: { get: () => ["n"] },
    on: () => () => {}, // Persistence/render delivery is intentionally stalled.
    document: {
      getRevision: () => revision,
      getMetadata: () => ({}),
      toJSON: () => ({ schemaVersion: 1, revision, nodes: [node], assets: [{ id: "asset", kind: "file", metadata: {} }] }),
    },
  } as unknown as PixiBoard;
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const onSubmit = vi.fn();
  const controller = createNodeAgentController(board, {
    onSubmit,
    ...(hook === "resolveAsset" ? {
      resolveAsset: async () => { started(); await waiting; return { assetId: "asset" }; },
    } : {
      buildPrompt: async () => { started(); await waiting; return "prepared prompt"; },
    }),
  });
  const pending = controller.submit({ nodeId: "n" }, "Explain this node");
  await entered;
  revision++;
  release();
  await expect(pending).rejects.toThrow("Canvas changed");
  expect(onSubmit).not.toHaveBeenCalled();
  controller.destroy();
});
