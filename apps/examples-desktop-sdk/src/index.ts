import { createPixiBoardAgentTools, type AgentTools } from "@pixi-board/agent-tools";
import { PluginHost, type PluginContext, type PluginDefinition, type PluginEvent, type PluginEventSource } from "@pixi-board/plugin-api-v3";
import { createPixiBoard, type PixiBoard, type PixiBoardOptions } from "pixiboardjs";
import type { DesktopDocumentLease } from "./ports";

export * from "@pixi-board/plugin-api-v3";
export * from "./ports";
export * from "./project-session-controller";
export { createPixiBoard } from "pixiboardjs";
export type { PixiBoard, PixiBoardOptions } from "pixiboardjs";

export type DesktopBoardOptions = Omit<PixiBoardOptions, "persistence"> & {
  boardId: string;
  persistence: DesktopDocumentLease;
};

export type DesktopBoardHost = {
  readonly board: PixiBoard;
  readonly capabilities: PixiBoard["capabilities"];
  readonly agent: AgentTools;
  readonly plugins: PluginHost;
  readonly ready: Promise<void>;
  on(event: "change" | "selection:change" | "viewport:change", listener: (event: PluginEvent) => void): () => void;
  installPlugin(plugin: PluginDefinition): Promise<PluginContext>;
  destroy(): Promise<void>;
};

export async function createDesktopBoard(options: DesktopBoardOptions): Promise<DesktopBoardHost> {
  const { boardId, persistence, ...sdkOptions } = options;
  const board = await createPixiBoard({ ...sdkOptions, persistence });
  await board.ready;
  const events: PluginEventSource = {
    on(event, listener) {
      if (event === "change") return board.on("change", (value) => listener({ type: "change", ...value }));
      if (event === "selection:change") return board.on(event, (value) => listener({ type: event, ...value }));
      return board.on("viewport:change", (value) => listener({ type: "viewport:change", ...value }));
    },
  };
  const plugins = new PluginHost({ capabilities: board.capabilities, events });
  const agent = createPixiBoardAgentTools(board.capabilities);
  return {
    board,
    capabilities: board.capabilities,
    agent,
    plugins,
    ready: board.ready,
    on(event, listener) {
      return events.on(event, listener);
    },
    installPlugin(plugin) {
      return plugins.load(plugin);
    },
    async destroy() {
      const boardDestroy = board.destroy();
      await plugins.destroy();
      await boardDestroy;
    },
  };
}
