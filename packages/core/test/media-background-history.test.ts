import { describe, expect, it } from "vitest";
import {
  BoardCore,
  NodeTypeRegistry,
  rotatedRectBounds,
  type BoardNode,
  type BoardChangeSet,
} from "../src";

type Props = {
  previewStatus?: string;
  title: string;
};

function createCore(): BoardCore {
  const nodeTypes = new NodeTypeRegistry();
  nodeTypes.register({
    type: "media",
    version: 1,
    validate: (value) => value as Props,
    getBounds: rotatedRectBounds,
  });
  let id = 0;
  const core = new BoardCore({
    nodeTypes,
    idFactory: () => `id-${++id}`,
    now: () => 1,
  });
  core.nodes.create<Props>({
    id: "media",
    type: "media",
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    assetRefs: {
      primary: { assetId: "video", variant: "original" },
    },
    props: { title: "Original" },
  });
  core.history.clear();
  return core;
}

function node(core: BoardCore): Readonly<BoardNode<Props>> {
  return core.nodes.get<Props>("media")!;
}

function applyBackgroundPreview(core: BoardCore): void {
  const current = node(core);
  core.transaction("Apply preview", () => {
    core.nodes.update<Props>("media", {
      assetRefs: {
        ...(current.assetRefs ?? {}),
        poster: { assetId: current.assetRefs?.primary?.assetId ?? "video", variant: "preview" },
      },
      props: {
        ...current.props,
        previewStatus: "ready",
      },
    });
  }, { origin: "preview", recordHistory: false });
}

describe("background media history rebasing", () => {
  it("keeps preview writes across undo and redo of an earlier move", () => {
    const core = createCore();
    core.nodes.update<Props>("media", { x: 40 });
    applyBackgroundPreview(core);

    core.history.undo();
    expect(node(core)).toMatchObject({
      x: 10,
      props: {
        title: "Original",
        previewStatus: "ready",
      },
      assetRefs: {
        primary: { assetId: "video", variant: "original" },
        poster: { assetId: "video", variant: "preview" },
      },
    });

    core.history.redo();
    expect(node(core)).toMatchObject({
      x: 40,
      props: { previewStatus: "ready" },
      assetRefs: { poster: { assetId: "video", variant: "preview" } },
    });
  });

  it("does not use a background write to preserve unrelated props or refs", () => {
    const core = createCore();
    core.nodes.update<Props>("media", { props: { title: "User title" } });
    core.transaction("Apply preview", () => {
      core.nodes.update<Props>("media", {
        assetRefs: {
          ...(node(core).assetRefs ?? {}),
          poster: { assetId: "video", variant: "preview" },
          custom: { assetId: "user-ref" },
        },
        props: {
          title: "User title",
          previewStatus: "ready",
        } as Props,
      });
    }, { origin: "preview", recordHistory: false });
    core.nodes.update<Props>("media", { props: { title: "Edited after preview" } });

    // Undo the user's post-preview edit normally: its own snapshot legitimately
    // contains both the background-written ref and the preview.
    core.history.undo();
    expect(node(core).props.title).toBe("User title");
    expect(node(core).assetRefs?.custom).toEqual({ assetId: "user-ref" });
    expect(node(core).assetRefs?.poster).toEqual({ assetId: "video", variant: "preview" });

    // The older entry is rebased only for media fields, so it does not smuggle
    // the background-written custom ref into the pre-background state.
    core.history.undo();
    expect(node(core).props.title).toBe("Original");
    expect(node(core).assetRefs?.custom).toBeUndefined();
    expect(node(core).assetRefs?.poster).toEqual({ assetId: "video", variant: "preview" });
  });

  it("does not inject preview data into an older delete/recreate lineage", () => {
    const core = createCore();
    core.nodes.remove("media");
    core.nodes.create<Props>({
      id: "media",
      type: "media",
      x: 50,
      y: 60,
      width: 100,
      height: 80,
      assetRefs: { primary: { assetId: "new-media" } },
      props: { title: "Recreated" },
    });
    applyBackgroundPreview(core);
    // Remove the current node and undo the removal: the restored node belongs
    // to the current lineage. Earlier history must still refer to the old one.
    core.nodes.remove("media");
    core.history.undo();
    expect(node(core).assetRefs?.poster).toEqual({ assetId: "new-media", variant: "preview" });
    while (core.history.canUndo()) core.history.undo();
    expect(node(core)).toMatchObject({ x: 10, props: { title: "Original" } });
    expect(node(core).assetRefs).toEqual({
      primary: { assetId: "video", variant: "original" },
    });
  });

  it("projects preview material only onto the matching source version", () => {
    const core = createCore();
    core.nodes.update<Props>("media", {
      name: "new-video.mp4",
      assetRefs: { primary: { assetId: "new-video", variant: "original" } },
    });
    applyBackgroundPreview(core);

    core.history.undo();
    expect(node(core)).toMatchObject({
      props: { title: "Original" },
      assetRefs: { primary: { assetId: "video", variant: "original" } },
    });
    expect(node(core).name).toBeUndefined();
    expect(node(core).props.previewStatus).toBeUndefined();
    expect(node(core).assetRefs?.poster).toBeUndefined();

    core.history.redo();
    expect(node(core)).toMatchObject({
      props: { previewStatus: "ready" },
      assetRefs: {
        primary: { assetId: "new-video", variant: "original" },
        poster: { assetId: "new-video", variant: "preview" },
      },
    });
  });

  it("retains a background update recorded while the active entry is pending redo", () => {
    const core = createCore();
    core.nodes.update<Props>("media", { x: 40 });
    core.history.undo();
    applyBackgroundPreview(core);
    core.history.redo();
    expect(node(core)).toMatchObject({
      x: 40,
      props: { previewStatus: "ready" },
      assetRefs: { poster: { assetId: "video", variant: "preview" } },
    });
    core.history.undo();
    expect(node(core)).toMatchObject({
      x: 10,
      props: { previewStatus: "ready" },
      assetRefs: { poster: { assetId: "video", variant: "preview" } },
    });
  });

  it("keeps only the latest background value in coalesced history", () => {
    const core = createCore();
    const key = "move";
    for (const x of [20, 30, 40]) {
      core.transaction("Move", () => core.nodes.update<Props>("media", { x }), {
        origin: "ui",
        coalesceKey: key,
      });
    }
    applyBackgroundPreview(core);
    core.transaction("Apply newer preview", () => {
      core.nodes.update<Props>("media", {
        props: {
          title: "Original",
          previewStatus: "queued",
        } as Props,
      });
    }, { origin: "preview", recordHistory: false });
    core.history.undo();
    expect(node(core)).toMatchObject({ x: 10, props: { previewStatus: "queued" } });
    core.history.redo();
    expect(node(core)).toMatchObject({ x: 40, props: { previewStatus: "queued" } });
  });

  it("stores generation changes only for nodes whose lineage changes", () => {
    const core = createCore();
    core.transaction("Create nodes", () => {
      for (let index = 0; index < 200; index++) {
        core.nodes.create<Props>({
          id: `node-${index}`,
          type: "media",
          x: 0, y: 0, width: 10, height: 10,
          props: { title: "Node" },
        });
      }
    });
    for (let x = 1; x <= 20; x++) core.nodes.update("node-0", { x });

    const history = core.history as unknown as {
      undoStack: object[];
      entryGenerations: WeakMap<object, Map<string, unknown>>;
    };
    const sizes = history.undoStack.map(entry => history.entryGenerations.get(entry)!.size);
    expect(sizes).toEqual([200, ...Array(20).fill(0)]);

    for (let index = 0; index < 20; index++) core.history.undo();
    expect(core.nodes.get("node-0")?.x).toBe(0);
    for (let index = 0; index < 20; index++) core.history.redo();
    expect(core.nodes.get("node-0")?.x).toBe(20);
  });

  it("preserves independent node generations through undo and redo", () => {
    const core = createCore();
    core.nodes.create<Props>({
      id: "other", type: "media", x: 0, y: 0, width: 10, height: 10,
      assetRefs: { primary: { assetId: "other-video" } },
      props: { title: "Other" },
    });
    core.nodes.update("media", { x: 40 });
    core.nodes.update("other", { x: 30 });
    core.history.undo();
    core.history.undo();
    applyBackgroundPreview(core);
    core.history.redo();
    core.history.redo();
    expect(node(core)).toMatchObject({ x: 40, props: { previewStatus: "ready" } });
    expect(core.nodes.get("other")?.x).toBe(30);
    core.history.undo();
    core.history.undo();
    expect(node(core)).toMatchObject({ x: 10, props: { previewStatus: "ready" } });
  });

  it("keeps same-source generations separate across coalesced deletion and recreation", () => {
    const core = createCore();
    core.transaction("Remove", () => core.nodes.remove("media"), { coalesceKey: "replace" });
    core.transaction("Recreate", () => core.nodes.create<Props>({
      id: "media", type: "media", x: 50, y: 60, width: 100, height: 80,
      assetRefs: { primary: { assetId: "video", variant: "original" } },
      props: { title: "Recreated" },
    }), { coalesceKey: "replace" });
    applyBackgroundPreview(core);

    core.history.undo();
    expect(node(core)).toMatchObject({ x: 10, props: { title: "Original" } });
    expect(node(core).assetRefs?.poster).toBeUndefined();
    core.history.redo();
    expect(node(core)).toMatchObject({
      x: 50, props: { title: "Recreated", previewStatus: "ready" },
      assetRefs: { poster: { assetId: "video", variant: "preview" } },
    });
  });

  it("preserves an absent baseline across coalesced create, delete and recreate", () => {
    const core = createCore();
    core.transaction("Create", () => core.nodes.create<Props>({
      id: "new", type: "media", x: 0, y: 0, width: 10, height: 10,
      props: { title: "New" },
    }), { coalesceKey: "create" });
    core.transaction("Delete", () => core.nodes.remove("new"), { coalesceKey: "create" });
    core.transaction("Recreate", () => core.nodes.create<Props>({
      id: "new", type: "media", x: 0, y: 0, width: 10, height: 10,
      props: { title: "New again" },
    }), { coalesceKey: "create" });
    core.transaction("Move", () => core.nodes.update("new", { x: 20 }), { coalesceKey: "create" });
    const history = core.history as unknown as {
      undoStack: object[];
      entryGenerations: WeakMap<object, Map<string, { before: number | undefined; after: number | undefined }>>;
    };
    const delta = history.entryGenerations.get(history.undoStack.at(-1)!)!.get("new")!;
    expect(delta.before).toBeUndefined();
    expect(delta.after).toBeDefined();
    core.history.undo();
    expect(core.nodes.get("new")).toBeUndefined();
    core.history.redo();
    expect(core.nodes.get("new")?.x).toBe(20);
    core.history.undo();
    expect(core.nodes.get("new")).toBeUndefined();
  });

  it("does not create history for background writes", () => {
    const core = createCore();
    const changes: BoardChangeSet[] = [];
    const off = core.on("change", ({ changeSet }) => changes.push(changeSet));
    applyBackgroundPreview(core);
    off();
    expect(changes).toHaveLength(1);
    expect(core.history.canUndo()).toBe(false);
  });
});
