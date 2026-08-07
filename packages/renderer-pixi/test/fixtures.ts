import type { BoardNode } from "@pixi-board/core";
import type { NodeRendererRegistry } from "../src/registry";

export type TaskCardProps = { title: string; status: "todo" | "doing" | "done" };

export function taskCardNode(id: string, title = "Inbox", x = 0): BoardNode<TaskCardProps> {
  return { id, type: "acme.task-card", typeVersion: 1, x, y: 0, width: 160, height: 80, rotation: 0, zIndex: 0, props: { title, status: "todo" } };
}

export function registerTaskCardRenderer(registry: NodeRendererRegistry, display: { createContainer(): any }): void {
  registry.register("acme.task-card", {
    create(node) { const displayObject = display.createContainer(); return { displayObject, state: { title: node.props.title, status: node.props.status } }; },
    update(view, node) { view.state.title = node.props.title; view.state.status = node.props.status; view.displayObject.taskCard = { title: node.props.title, status: node.props.status }; },
    destroy(view) { view.displayObject.destroy?.({ children: true }); },
    hitTest(node, point) { return point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height; },
  } as any);
}
