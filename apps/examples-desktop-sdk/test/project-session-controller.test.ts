import { NodeTypeRegistry, type BoardDocument } from "@pixi-board/core";
import { TauriAdapterHost } from "@pixi-board/adapter-tauri";
import { describe, expect, it } from "vitest";
import { DesktopProjectSessionController } from "../src/project-session-controller";

const text = {
  type: "text",
  version: 1,
  defaults: {},
  validate: (value: unknown) => value ?? {},
  getBounds: (node: { x: number; y: number; width: number; height: number }) => ({
    minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height,
  }),
};

describe("DesktopProjectSessionController", () => {
  it("destroys the previous formal facade before switching its project lease", async () => {
    const documents = new Map<string, BoardDocument>();
    const leases = new Set<string>();
    const invoke = async <Result>(command: string, args: Record<string, unknown> = {}): Promise<Result> => {
      if (command === "pixiboard_sdk_project_acquire") { leases.add(String(args.leaseId)); return undefined as Result; }
      if (command === "pixiboard_sdk_project_release") { leases.delete(String(args.leaseId)); return undefined as Result; }
      const context = args.context as { projectRoot: string; leaseId: string } | undefined;
      if (!context || !leases.has(context.leaseId)) throw { code: "STALE_LEASE", message: "stale" };
      if (command === "pixiboard_sdk_document_load") return (documents.get(context.projectRoot) ?? null) as Result;
      if (command === "pixiboard_sdk_document_save") { documents.set(context.projectRoot, structuredClone(args.document as BoardDocument)); return undefined as Result; }
      if (command === "pixiboard_sdk_operation_cancel") return undefined as Result;
      throw { code: "UNAVAILABLE", message: command };
    };
    const nodeTypes = new NodeTypeRegistry();
    nodeTypes.register(text);
    const tauri = new TauriAdapterHost({ invoke, idFactory: (() => { let id = 0; return () => `lease-${++id}`; })() });
    const controller = new DesktopProjectSessionController({
      tauri,
      board: { headless: true, core: { nodeTypes, idFactory: () => "node-1", now: () => 1 } },
    });
    const first = await controller.open({ boardId: "board", projectRoot: "project-a" });
    await first.host.board.nodes.create({ id: "a", type: "text", x: 0, y: 0, width: 10, height: 10 });
    const second = await controller.switchProject({ boardId: "board", projectRoot: "project-b" });
    expect(first.host.board.state).toBe("destroyed");
    expect(second.host.board.state).toBe("ready");
    expect(controller.current?.project.projectRoot).toBe("project-b");
    await controller.destroy();
    expect(leases).toHaveLength(0);
  });
});
