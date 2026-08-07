import { describe, expect, it, vi } from "vitest";
import {
  BoardCore,
  DocumentMigrationRegistry,
  NodeTypeNotRegisteredError,
  NodeTypeRegistry,
  NodeValidationError,
  rotatedRectBounds,
  type BoardChangeSet,
  type BoardDocument,
  type BoardNode,
  type JsonValue,
  type NodeTypeDefinition,
} from "../src";

type TaskProps = {
  title: string;
  status: "todo" | "done";
};

function taskDefinition(version = 1): NodeTypeDefinition<TaskProps> {
  return {
    type: "acme.task-card",
    version,
    defaults: { status: "todo" },
    validate(value): TaskProps {
      if (
        value === null ||
        typeof value !== "object" ||
        typeof (value as Partial<TaskProps>).title !== "string" ||
        !["todo", "done"].includes((value as Partial<TaskProps>).status ?? "")
      ) {
        throw new Error("invalid task props");
      }
      return value as TaskProps;
    },
    getBounds: rotatedRectBounds,
  };
}

function createCore(options: ConstructorParameters<typeof BoardCore>[0] = {}): BoardCore {
  let id = 0;
  let now = 1000;
  return new BoardCore({
    schemaVersion: 1,
    idFactory: () => `id-${++id}`,
    now: () => ++now,
    viewportSize: { width: 1000, height: 800 },
    ...options,
  });
}

function registerTasks(core: BoardCore): void {
  core.nodeTypes.register(taskDefinition());
}

function createTask(core: BoardCore, id: string, title = id): Readonly<BoardNode<TaskProps>> {
  return core.nodes.create<TaskProps>({
    id,
    type: "acme.task-card",
    x: 10,
    y: 20,
    width: 200,
    height: 100,
    zIndex: 1,
    props: { title, status: "todo" },
  });
}

describe("BoardCore document store and node registry", () => {
  it("applies defaults, validates props, and preserves array order as the zIndex tie-breaker", () => {
    const registry = new NodeTypeRegistry();
    registry.register(taskDefinition());
    const core = createCore({ nodeTypes: registry });

    core.nodes.create<TaskProps>({
      id: "b",
      type: "acme.task-card",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      zIndex: 2,
      props: { title: "B", status: "todo" },
    });
    core.nodes.create<TaskProps>({
      id: "a",
      type: "acme.task-card",
      x: 20,
      y: 0,
      width: 10,
      height: 10,
      zIndex: 2,
      props: { title: "A" } as TaskProps,
    });
    core.nodes.update<TaskProps>("b", { props: { title: "B2", status: "done" } });

    expect(core.nodes.get<TaskProps>("a")?.props).toEqual({ status: "todo", title: "A" });
    expect(core.document.toJSON().nodes.map(({ id }) => id)).toEqual(["b", "a"]);
    expect(() => registry.register(taskDefinition())).toThrow(NodeValidationError);
    expect(() =>
      core.nodes.create<TaskProps>({
        id: "bad",
        type: "acme.task-card",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        props: { title: "bad", status: "broken" } as unknown as TaskProps,
      }),
    ).toThrow(NodeValidationError);
    expect(core.nodes.get("bad")).toBeUndefined();
  });

  it("returns detached immutable snapshots", () => {
    const core = createCore();
    registerTasks(core);
    createTask(core, "a");
    const snapshot = core.document.snapshot();
    const json = core.document.toJSON();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nodes[0])).toBe(true);
    expect(() => ((snapshot.nodes[0] as BoardNode).x = 999)).toThrow();
    json.nodes[0].x = 777;
    expect(core.nodes.get("a")?.x).toBe(10);
  });
});

describe("transactions and ChangeSet", () => {
  it("commits a batch as one revision, one history entry, and one ChangeSet", () => {
    const core = createCore();
    registerTasks(core);
    createTask(core, "a");
    createTask(core, "b");
    core.history.clear();
    const changes: BoardChangeSet[] = [];
    core.on("change", ({ changeSet }) => changes.push(changeSet));
    const revision = core.document.snapshot().revision;

    core.transaction(
      "Arrange tasks",
      () => {
        core.nodes.update("a", { x: 100 });
        core.nodes.update("b", {
          assetRefs: { primary: { assetId: "asset-1", variant: "preview" } },
        });
        createTask(core, "c");
      },
      { origin: "api" },
    );

    expect(core.document.snapshot().revision).toBe(revision + 1);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      label: "Arrange tasks",
      origin: "api",
      revision: revision + 1,
      addedNodeIds: ["c"],
      updatedNodeIds: ["a", "b"],
      assetChangedNodeIds: ["b"],
      removedNodeIds: [],
      selectionChanged: false,
      viewportChanged: false,
    });
    expect(core.history.canUndo()).toBe(true);
  });

  it("rolls back every staged write when later validation fails", () => {
    const core = createCore();
    registerTasks(core);
    createTask(core, "a");
    createTask(core, "b");
    core.history.clear();
    const before = core.document.toJSON();
    const listener = vi.fn();
    core.on("change", listener);

    expect(() =>
      core.transaction("Invalid batch", () => {
        core.nodes.update("a", { x: 400 });
        core.nodes.update<TaskProps>("b", {
          props: { title: "B", status: "invalid" } as unknown as TaskProps,
        });
      }),
    ).toThrow(NodeValidationError);

    expect(core.document.toJSON()).toEqual(before);
    expect(core.history.canUndo()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects async transaction callbacks and prevents their delayed writes", async () => {
    const core = createCore();
    registerTasks(core);
    createTask(core, "a");
    core.history.clear();
    const before = core.document.toJSON();
    let continueCallback!: () => void;
    const gate = new Promise<void>((resolve) => {
      continueCallback = resolve;
    });

    expect(() =>
      core.transaction("Async invalid batch", async () => {
        core.nodes.update("a", { x: 900 });
        await gate;
        core.nodes.update("a", { x: 901 });
      }),
    ).toThrow("Transaction callbacks must be synchronous");

    expect(core.document.toJSON()).toEqual(before);
    expect(core.history.canUndo()).toBe(false);
    continueCallback();
    await Promise.resolve();
    await Promise.resolve();
    expect(core.document.toJSON()).toEqual(before);
  });

  it("isolates listener failures from committed document and history state", () => {
    const core = createCore();
    registerTasks(core);
    createTask(core, "a");
    core.history.clear();
    core.on("change", () => {
      throw new Error("consumer failure");
    });
    core.history.onChange(() => {
      throw new Error("history consumer failure");
    });

    expect(() => core.nodes.update("a", { x: 123 })).not.toThrow();
    expect(core.nodes.get("a")?.x).toBe(123);
    expect(() => core.history.undo()).not.toThrow();
    expect(core.nodes.get("a")?.x).toBe(10);
  });
});

describe("data patch history", () => {
  it("undoes and redoes deletion at the exact serialized position", () => {
    const core = createCore();
    registerTasks(core);
    createTask(core, "a");
    createTask(core, "b");
    createTask(core, "c");
    core.history.clear();

    core.nodes.remove("b");
    expect(core.document.toJSON().nodes.map(({ id }) => id)).toEqual(["a", "c"]);
    core.history.undo();
    expect(core.document.toJSON().nodes.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(core.nodes.get("b")?.props).toEqual({ title: "b", status: "todo" });
    core.history.redo();
    expect(core.document.toJSON().nodes.map(({ id }) => id)).toEqual(["a", "c"]);
  });

  it("clears the redo branch after a new commit", () => {
    const core = createCore();
    registerTasks(core);
    createTask(core, "a");
    core.nodes.update("a", { x: 20 });
    core.history.undo();
    expect(core.history.canRedo()).toBe(true);
    core.nodes.update("a", { y: 30 });
    expect(core.history.canRedo()).toBe(false);
    expect(core.nodes.get("a")).toMatchObject({ x: 10, y: 30 });
  });

  it("indexes assets and reports nodes affected by asset record changes", () => {
    const core = createCore();
    registerTasks(core);
    createTask(core, "a");
    core.nodes.update("a", { assetRefs: { primary: { assetId: "asset-1" } } });
    core.history.clear();
    const changes: BoardChangeSet[] = [];
    core.on("change", ({ changeSet }) => changes.push(changeSet));

    core.assets.upsert({ id: "asset-1", kind: "image", width: 640, height: 360 });
    expect(core.assets.get("asset-1")).toMatchObject({ kind: "image", width: 640 });
    expect(changes.at(-1)?.assetChangedNodeIds).toEqual(["a"]);
    core.history.undo();
    expect(core.assets.get("asset-1")).toBeUndefined();
    core.history.redo();
    expect(core.assets.get("asset-1")?.height).toBe(360);
  });

  it("reports a stable-order change when a node moves within the serialized array", () => {
    const core = createCore();
    registerTasks(core);
    createTask(core, "a");
    createTask(core, "b");
    const changes: BoardChangeSet[] = [];
    core.on("change", ({ changeSet }) => changes.push(changeSet));

    core.transaction("Move a to end", () => {
      const node = core.nodes.remove("a") as BoardNode<TaskProps>;
      core.nodes.create<TaskProps>({
        id: node.id,
        type: node.type,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rotation: node.rotation,
        zIndex: node.zIndex,
        props: node.props,
      });
    });

    expect(core.document.toJSON().nodes.map(({ id }) => id)).toEqual(["b", "a"]);
    expect(changes.at(-1)?.updatedNodeIds).toEqual(["b", "a"]);
  });
});

describe("unknown nodes and JSON round-trip", () => {
  it("rejects future document schemas unless the supported version is explicit", () => {
    const future = {
      schemaVersion: 999,
      revision: 0,
      nodes: [],
      assets: [],
    };
    expect(() => new BoardCore({ document: future })).toThrow(
      "Document schema 999 is newer than supported schema 1",
    );
  });

  it("preserves unknown JSON, permits geometry edits, and blocks props edits", () => {
    const core = createCore();
    const missing = vi.fn();
    core.on("node-type:missing", missing);
    const document: BoardDocument = {
      schemaVersion: 1,
      revision: 7,
      nodes: [
        {
          id: "unknown-1",
          type: "vendor.future.node",
          typeVersion: 9,
          x: 1,
          y: 2,
          width: 3,
          height: 4,
          rotation: 0,
          zIndex: 5,
          assetRefs: { poster: { assetId: "asset-1", variant: "preview" } },
          props: { nested: { untouched: true } },
        },
      ],
      assets: [{ id: "asset-1", kind: "image", custom: { keep: true } }],
      metadata: { project: "round-trip" },
    };

    core.document.load(JSON.stringify(document));
    expect(missing).toHaveBeenCalledWith({ type: "vendor.future.node", nodeIds: ["unknown-1"] });
    core.nodes.update("unknown-1", { x: 100 });
    expect(() => core.nodes.update("unknown-1", { props: { changed: true } })).toThrow(
      NodeTypeNotRegisteredError,
    );
    const json = core.document.toJSON();
    expect(json.nodes[0]).toMatchObject({
      id: "unknown-1",
      x: 100,
      typeVersion: 9,
      props: { nested: { untouched: true } },
    });
    expect(json.assets[0]).toMatchObject({ custom: { keep: true } });

    const reloaded = createCore({ document: json });
    expect(reloaded.document.toJSON()).toEqual(json);
  });

  it("runs document and node migrations before validation", () => {
    const migrations = new DocumentMigrationRegistry();
    migrations.register({
      from: 1,
      to: 2,
      migrate(input) {
        const document = input as Record<string, JsonValue>;
        return { ...document, schemaVersion: 2, revision: document.revision ?? 0 };
      },
    });
    const registry = new NodeTypeRegistry();
    registry.register<TaskProps>({
      ...taskDefinition(2),
      migrate({ fromVersion, props }) {
        expect(fromVersion).toBe(1);
        return {
          version: 2,
          props: { title: String((props as { text: string }).text), status: "todo" },
        };
      },
    });
    const core = createCore({ schemaVersion: 2, migrations, nodeTypes: registry });
    const legacy = {
      schemaVersion: 1,
      revision: 0,
      nodes: [
        {
          id: "legacy",
          type: "acme.task-card",
          typeVersion: 1,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          rotation: 0,
          zIndex: 0,
          props: { text: "Migrated" },
        },
      ],
      assets: [],
    };

    core.document.load(legacy, { migrate: true });
    expect(core.document.toJSON()).toMatchObject({
      schemaVersion: 2,
      nodes: [{ id: "legacy", typeVersion: 2, props: { title: "Migrated", status: "todo" } }],
    });
  });

  it("rejects non-JSON object instances and circular values", () => {
    const core = createCore();
    const withDate = {
      schemaVersion: 1,
      revision: 0,
      nodes: [],
      assets: [],
      metadata: { createdAt: new Date() },
    };
    expect(() => core.document.validate(withDate)).toThrow("plain JSON object");

    const circular: Record<string, unknown> = {
      schemaVersion: 1,
      revision: 0,
      nodes: [],
      assets: [],
    };
    circular.self = circular;
    expect(() => core.document.validate(circular)).toThrow("circular references");
  });

  it("rejects retaining history when loading an unrelated document", () => {
    const core = createCore();
    registerTasks(core);
    createTask(core, "a");
    expect(() =>
      core.document.load(
        { schemaVersion: 1, revision: 0, nodes: [], assets: [] },
        { replaceHistory: false },
      ),
    ).toThrow("replaceHistory:false is not supported");
    expect(core.nodes.get("a")).toBeDefined();
    expect(core.history.canUndo()).toBe(true);
  });
});

describe("selection and viewport session state", () => {
  it("keeps selection out of document revision/history and prunes deleted nodes", () => {
    const core = createCore();
    registerTasks(core);
    createTask(core, "a");
    createTask(core, "b");
    core.history.clear();
    const before = core.document.toJSON();
    const events = vi.fn();
    core.selection.onChange(events);

    core.selection.set(["a", "missing", "b"]);
    core.selection.toggle("b");
    expect(core.selection.get()).toEqual(["a"]);
    expect(core.document.toJSON()).toEqual(before);
    expect(core.history.canUndo()).toBe(false);
    core.nodes.remove("a");
    expect(core.selection.get()).toEqual([]);
    expect(events).toHaveBeenCalledTimes(3);
  });

  it("converts coordinates, keeps a zoom anchor fixed, and fits registry bounds headlessly", () => {
    const core = createCore();
    registerTasks(core);
    createTask(core, "a");
    const documentBeforeViewportChange = core.document.toJSON();
    core.viewport.set({ scale: 2, offset: { x: 100, y: -40 } });
    const world = { x: 12, y: 20 };
    expect(core.viewport.toWorld(core.viewport.toScreen(world))).toEqual(world);
    const anchor = { x: 400, y: 300 };
    const anchoredWorld = core.viewport.toWorld(anchor);
    core.viewport.zoomAt(anchor, 1.2);
    expect(core.viewport.toWorld(anchor).x).toBeCloseTo(anchoredWorld.x);
    expect(core.viewport.toWorld(anchor).y).toBeCloseTo(anchoredWorld.y);
    const revision = core.document.snapshot().revision;
    core.viewport.fitNodes(["a"], { padding: 20 });
    expect(core.document.snapshot().revision).toBe(revision);
    expect(core.document.toJSON()).toEqual(documentBeforeViewportChange);
    expect(() => core.viewport.set({ scale: 0, offset: { x: 0, y: 0 } })).toThrow(RangeError);
  });
});
