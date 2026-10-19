import { describe, expect, it } from "vitest";
import { BoardCore, NodeTypeRegistry, rotatedRectBounds } from "../src";

function fixture() {
  const nodeTypes = new NodeTypeRegistry();
  for (const type of ["placeholder", "result"]) nodeTypes.register({
    type, version: 1, validate: value => value as { text: string }, getBounds: rotatedRectBounds,
  });
  return new BoardCore({ nodeTypes });
}

describe("metadata transactions and node conversion", () => {
  it("restores node and relationships together on undo/redo", () => {
    const core = fixture();
    core.nodes.create({ id: "a", type: "placeholder", x: 0, y: 0, width: 100, height: 80, props: { text: "a" } });
    core.nodes.create({ id: "b", type: "result", x: 0, y: 0, width: 100, height: 80, props: { text: "b" } });
    const connections = [{ id: "ab", source: "a", target: "b" }];
    core.document.patchMetadata({ connections });
    core.nodes.remove("a");
    expect(core.document.getMetadata()?.connections).toEqual([]);
    core.history.undo();
    expect(core.nodes.get("a")).toBeDefined();
    expect(core.document.getMetadata()?.connections).toEqual(connections);
    core.history.redo();
    expect(core.nodes.get("a")).toBeUndefined();
    expect(core.document.getMetadata()?.connections).toEqual([]);
  });

  it("keeps identity and geometry while replacing content and preserving connections", () => {
    const core = fixture();
    core.nodes.create({ id: "a", type: "placeholder", x: 40, y: 0, width: 320, height: 80, props: { text: "old" } });
    core.document.patchMetadata({ connections: [] });
    core.nodes.convert("a", { type: "result", props: { text: "new" } });
    expect(core.nodes.get("a")).toMatchObject({ id: "a", type: "result", x: 40, width: 320, props: { text: "new" } });
    core.history.undo();
    expect(core.nodes.get("a")).toMatchObject({ type: "placeholder", x: 40, y: 0, width: 320, height: 80, props: { text: "old" } });
    core.history.redo();
    expect(core.nodes.get("a")?.type).toBe("result");
  });
});
