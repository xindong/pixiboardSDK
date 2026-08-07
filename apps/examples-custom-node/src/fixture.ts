import {
  createPixiBoard,
  type BoardDocument,
  type CustomNodeDefinition,
  type RuntimeRenderer,
} from "pixiboardjs";
import {
  NodeRendererRegistry,
  PixiBoardRenderer,
  type PixiDisplayObject,
  type PixiViewFactory,
} from "@pixi-board/renderer-pixi";

export type TaskCardProps = {
  title: string;
  status: "todo" | "doing" | "done";
};

export const taskCardLifecycle = { creates: 0, destroys: 0 };

export const taskCardDefinition: CustomNodeDefinition<TaskCardProps, { title: string; status: TaskCardProps["status"] }> = {
  type: "acme.task-card",
  version: 1,
  defaults: { title: "Inbox", status: "todo" },
  validate(value): TaskCardProps {
    if (!value || typeof value !== "object") throw new Error("Task card props must be an object");
    const candidate = value as Partial<TaskCardProps>;
    if (typeof candidate.title !== "string" || !["todo", "doing", "done"].includes(candidate.status as string)) {
      throw new Error("Task card props are invalid");
    }
    return { title: candidate.title, status: candidate.status as TaskCardProps["status"] };
  },
  getBounds(node) {
    return { minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height };
  },
  renderer: {
    create(node, context) {
      taskCardLifecycle.creates += 1;
      const displayObject = context.display.createContainer();
      return { displayObject, state: { title: node.props.title, status: node.props.status } };
    },
    update(view, node) {
      view.state.title = node.props.title;
      view.state.status = node.props.status;
      view.displayObject.taskCard = { ...node.props };
    },
    destroy(view) {
      taskCardLifecycle.destroys += 1;
      view.displayObject.destroy?.({ children: true });
    },
  },
};

function fakeRendererFactory(): {
  renderer: RuntimeRenderer & {
    activeViews: Map<string, unknown>;
    setVisibleBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number } | undefined): Promise<void>;
  };
  registry: NodeRendererRegistry;
} {
  const stage: PixiDisplayObject = {
    children: [],
    addChild(child) { (this.children as PixiDisplayObject[]).push(child); },
    removeChild(child) { this.children = (this.children as PixiDisplayObject[]).filter((item) => item !== child); },
  };
  const app = { stage, init: async () => undefined, destroy: () => undefined };
  const viewFactory: PixiViewFactory = {
    createContainer: () => ({
      children: [],
      addChild(child) { (this.children as PixiDisplayObject[]).push(child); },
      removeChild(child) { this.children = (this.children as PixiDisplayObject[]).filter((item) => item !== child); },
      destroy() { this.children = []; },
    }),
  };
  const registry = new NodeRendererRegistry();
  const renderer = new PixiBoardRenderer({
    applicationFactory: () => app,
    viewFactory,
    registry,
  }) as RuntimeRenderer & {
    activeViews: Map<string, unknown>;
    setVisibleBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number } | undefined): Promise<void>;
  };
  return { renderer, registry };
}

export async function runCustomTaskCardFixture(): Promise<{
  saved: BoardDocument;
  recreatedTitle: string;
  recreatedStatus: TaskCardProps["status"];
  destroyedOffscreen: boolean;
  creates: number;
  destroys: number;
}> {
  taskCardLifecycle.creates = 0;
  taskCardLifecycle.destroys = 0;
  const store: { document: BoardDocument | null } = { document: null };
  const firstRuntime = fakeRendererFactory();
  const first = await createPixiBoard({
    headless: false,
    container: {} as Element,
    rendererFactory: () => firstRuntime.renderer,
    renderer: { registry: firstRuntime.registry },
    persistence: {
      save: async (document) => { store.document = jsonRoundTrip(document); },
      load: async () => store.document ? jsonRoundTrip(store.document) : null,
    },
  });
  await first.ready;
  await first.nodeTypes.register(taskCardDefinition);
  const task = await first.nodes.create<TaskCardProps>({
    id: "task-1",
    type: "acme.task-card",
    x: 10,
    y: 20,
    width: 180,
    height: 90,
    props: { title: "Persist me", status: "doing" },
  });
  await flush();
  const saved = store.document!;
  await firstRuntime.renderer.setVisibleBounds({ minX: 1000, minY: 1000, maxX: 1100, maxY: 1100 });
  const destroyedOffscreen = firstRuntime.renderer.activeViews.size === 0;
  await firstRuntime.renderer.setVisibleBounds(undefined);
  const onScreenAgain = firstRuntime.renderer.activeViews.get("task-1") as {
    state: { title: string; status: TaskCardProps["status"] };
  } | undefined;
  if (!onScreenAgain || onScreenAgain.state.title !== "Persist me" || onScreenAgain.state.status !== "doing") {
    throw new Error("Task-card view did not rebuild from document props");
  }
  await first.destroy();

  const secondRuntime = fakeRendererFactory();
  const second = await createPixiBoard({
    headless: false,
    container: {} as Element,
    rendererFactory: () => secondRuntime.renderer,
    renderer: { registry: secondRuntime.registry },
    persistence: { load: async () => store.document ? jsonRoundTrip(store.document) : null },
  });
  await second.ready;
  const activeBeforeRegistration = [...secondRuntime.renderer.activeViews.keys()];
  await second.nodeTypes.register(taskCardDefinition);
  const recreated = second.findOne("#task-1")!;
  const recreatedView = secondRuntime.renderer.activeViews.get("task-1") as {
    state: { title: string; status: TaskCardProps["status"] };
  };
  if (!recreatedView) throw new Error(`Task-card view was not rebuilt (before=${activeBeforeRegistration.join(",")})`);
  const recreatedTitle = recreatedView.state.title;
  const recreatedStatus = recreatedView.state.status;
  expectNode(task, recreated);
  await second.destroy();
  return {
    saved,
    recreatedTitle,
    recreatedStatus,
    destroyedOffscreen,
    creates: taskCardLifecycle.creates,
    destroys: taskCardLifecycle.destroys,
  };
}

function jsonRoundTrip(document: BoardDocument): BoardDocument {
  return JSON.parse(JSON.stringify(document)) as BoardDocument;
}

function expectNode(first: { id: string }, second: { id: string }): void {
  if (first.id !== second.id) throw new Error("Task card id changed during persistence round-trip");
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
