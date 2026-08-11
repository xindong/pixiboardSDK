import { describe, expect, it } from "vitest";
import { NodeTypeRegistry, rotatedRectBounds, type NodeTypeDefinition, type ResizePolicy } from "@pixi-board/core";
import { createPixiBoard, type PixiBoard } from "../src/index";

type BoxProps = { label: string };

function boxDefinition(type: string, resize?: ResizePolicy<BoxProps>): NodeTypeDefinition<BoxProps> {
  return {
    type,
    version: 1,
    defaults: { label: "" },
    validate: (value) => ({ label: typeof (value as BoxProps)?.label === "string" ? (value as BoxProps).label : "" }),
    getBounds: rotatedRectBounds,
    ...(resize ? { resize } : {}),
  };
}

async function board(): Promise<PixiBoard> {
  const nodeTypes = new NodeTypeRegistry();
  nodeTypes.register(boxDefinition("free.box"));
  nodeTypes.register(boxDefinition("fixed.box", { mode: "fixed" }));
  nodeTypes.register(boxDefinition("ratio.box", { mode: "aspect-ratio", ratio: 2 }));
  let id = 0;
  const instance = await createPixiBoard({
    headless: true,
    core: { nodeTypes, idFactory: () => `id-${++id}`, now: () => 1 },
  });
  await instance.ready;
  return instance;
}

function add(instance: PixiBoard, id: string, type: string, geometry: { x: number; y: number; width: number; height: number }) {
  return instance.nodes.create<BoxProps>({ id, type, ...geometry, props: { label: id } });
}

describe("board.transform", () => {
  it("reports no bounds or handles without a selection", async () => {
    const instance = await board();
    expect(instance.transform.bounds()).toBeUndefined();
    expect(instance.transform.handles()).toEqual([]);
    expect(instance.transform.begin("se")).toBeUndefined();
    await instance.destroy();
  });

  it("places eight handles around a single selected node", async () => {
    const instance = await board();
    await add(instance, "a", "free.box", { x: 100, y: 100, width: 200, height: 100 });
    instance.selection.set(["a"]);

    const handles = instance.transform.handles();
    expect(handles.map((placement) => placement.handle)).toEqual(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
    expect(handles.find((placement) => placement.handle === "nw")!.world).toEqual({ x: 100, y: 100 });
    expect(handles.find((placement) => placement.handle === "se")!.world).toEqual({ x: 300, y: 200 });
    expect(handles.find((placement) => placement.handle === "n")!.world).toEqual({ x: 200, y: 100 });
    expect(handles.find((placement) => placement.handle === "w")!.cursor).toBe("ew-resize");
    await instance.destroy();
  });

  it("drives a gesture from absolute deltas and collapses it into one undo step", async () => {
    const instance = await board();
    await add(instance, "a", "free.box", { x: 100, y: 100, width: 200, height: 100 });
    instance.selection.set(["a"]);

    const session = instance.transform.begin("se")!;
    expect(instance.transform.active()).toBe(true);
    session.update({ x: 10, y: 5 });
    session.update({ x: 60, y: 30 });
    session.commit();

    expect(instance.transform.active()).toBe(false);
    expect(instance.nodes.get("a")).toMatchObject({ x: 100, y: 100, width: 260, height: 130 });
    instance.history.undo();
    expect(instance.nodes.get("a")).toMatchObject({ width: 200, height: 100 });
    await instance.destroy();
  });

  it("cancel() restores the geometry captured at begin()", async () => {
    const instance = await board();
    await add(instance, "a", "free.box", { x: 100, y: 100, width: 200, height: 100 });
    instance.selection.set(["a"]);

    const session = instance.transform.begin("nw")!;
    session.update({ x: -50, y: -50 });
    expect(instance.nodes.get("a")).toMatchObject({ x: 50, y: 50, width: 250, height: 150 });
    session.cancel();

    expect(instance.nodes.get("a")).toMatchObject({ x: 100, y: 100, width: 200, height: 100 });
    // The whole aborted gesture is still a single undoable step.
    instance.history.undo();
    expect(instance.nodes.get("a")).toMatchObject({ x: 100, y: 100, width: 200, height: 100 });
    await instance.destroy();
  });

  it("ignores updates after the session ends", async () => {
    const instance = await board();
    await add(instance, "a", "free.box", { x: 0, y: 0, width: 100, height: 100 });
    instance.selection.set(["a"]);
    const session = instance.transform.begin("se")!;
    session.commit();
    session.update({ x: 500, y: 500 });
    expect(instance.nodes.get("a")).toMatchObject({ width: 100, height: 100 });
    await instance.destroy();
  });

  it("routes each node's size through its own policy during a gesture", async () => {
    const instance = await board();
    await add(instance, "ratio", "ratio.box", { x: 0, y: 0, width: 200, height: 100 });
    instance.selection.set(["ratio"]);
    const session = instance.transform.begin("e")!;
    session.update({ x: 100, y: 0 });
    session.commit();
    expect(instance.nodes.get("ratio")).toMatchObject({ width: 300, height: 150 });
    await instance.destroy();
  });

  it("refuses to move a fixed node", async () => {
    const instance = await board();
    await add(instance, "fixed", "fixed.box", { x: 0, y: 0, width: 200, height: 100 });
    instance.selection.set(["fixed"]);
    const session = instance.transform.begin("se")!;
    session.update({ x: 100, y: 100 });
    session.commit();
    expect(instance.nodes.get("fixed")).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    await instance.destroy();
  });

  describe("multi-node selection", () => {
    it("spans the axis-aligned hull of every selected node", async () => {
      const instance = await board();
      await add(instance, "a", "free.box", { x: 0, y: 0, width: 100, height: 100 });
      await add(instance, "b", "free.box", { x: 200, y: 50, width: 100, height: 200 });
      instance.selection.set(["a", "b"]);

      expect(instance.transform.bounds()).toMatchObject({ x: 0, y: 0, width: 300, height: 250, rotation: 0 });
      await instance.destroy();
    });

    it("scales the group as one unit, keeping relative placement", async () => {
      const instance = await board();
      await add(instance, "a", "free.box", { x: 0, y: 0, width: 100, height: 100 });
      await add(instance, "b", "free.box", { x: 100, y: 100, width: 100, height: 100 });
      instance.selection.set(["a", "b"]);

      // Group box is 200x200; dragging se by +200,+200 doubles it.
      const session = instance.transform.begin("se")!;
      session.update({ x: 200, y: 200 });
      session.commit();

      expect(instance.nodes.get("a")).toMatchObject({ x: 0, y: 0, width: 200, height: 200 });
      expect(instance.nodes.get("b")).toMatchObject({ x: 200, y: 200, width: 200, height: 200 });
      await instance.destroy();
    });

    it("anchors the opposite corner when dragging north-west", async () => {
      const instance = await board();
      await add(instance, "a", "free.box", { x: 100, y: 100, width: 100, height: 100 });
      await add(instance, "b", "free.box", { x: 200, y: 200, width: 100, height: 100 });
      instance.selection.set(["a", "b"]);

      const session = instance.transform.begin("nw")!;
      session.update({ x: -200, y: -200 });
      session.commit();

      // The group's south-east corner (300,300) must not move.
      const bounds = instance.transform.bounds()!;
      expect(bounds.x + bounds.width).toBeCloseTo(300);
      expect(bounds.y + bounds.height).toBeCloseTo(300);
      await instance.destroy();
    });

    it("leaves a fixed node's size alone while its neighbours scale", async () => {
      const instance = await board();
      await add(instance, "free", "free.box", { x: 0, y: 0, width: 100, height: 100 });
      await add(instance, "fixed", "fixed.box", { x: 100, y: 0, width: 100, height: 100 });
      instance.selection.set(["free", "fixed"]);

      const session = instance.transform.begin("e")!;
      session.update({ x: 200, y: 0 });
      session.commit();

      expect(instance.nodes.get("free")).toMatchObject({ width: 200 });
      expect(instance.nodes.get("fixed")).toMatchObject({ x: 100, width: 100 });
      await instance.destroy();
    });

    it("collapses a whole group gesture into one undo step", async () => {
      const instance = await board();
      await add(instance, "a", "free.box", { x: 0, y: 0, width: 100, height: 100 });
      await add(instance, "b", "free.box", { x: 100, y: 100, width: 100, height: 100 });
      instance.selection.set(["a", "b"]);

      const session = instance.transform.begin("se")!;
      for (const step of [50, 100, 150, 200]) session.update({ x: step, y: step });
      session.commit();

      instance.history.undo();
      expect(instance.nodes.get("a")).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
      expect(instance.nodes.get("b")).toMatchObject({ x: 100, y: 100, width: 100, height: 100 });
      await instance.destroy();
    });
  });

  it("ends a stale gesture when a new one begins", async () => {
    const instance = await board();
    await add(instance, "a", "free.box", { x: 0, y: 0, width: 100, height: 100 });
    instance.selection.set(["a"]);

    const first = instance.transform.begin("se")!;
    first.update({ x: 50, y: 50 });
    const second = instance.transform.begin("se")!;
    // The stale session no longer writes; only the new one does.
    first.update({ x: 500, y: 500 });
    expect(instance.nodes.get("a")).toMatchObject({ width: 150, height: 150 });
    second.update({ x: 10, y: 10 });
    expect(instance.nodes.get("a")).toMatchObject({ width: 160, height: 160 });
    second.commit();
    await instance.destroy();
  });

  it("rejects transform access after destroy", async () => {
    const instance = await board();
    await instance.destroy();
    expect(() => instance.transform.handles()).toThrow();
  });
});
