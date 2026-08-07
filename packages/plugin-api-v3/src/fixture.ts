import type { PluginDefinition } from "./index.ts";

export const taskCardPlugin: PluginDefinition = {
  manifest: {
    id: "example.task-card",
    name: "Task Card",
    version: "1.0.0",
    apiVersion: "3",
    permissions: ["canvas.read", "canvas.write", "events.subscribe", "panel.register", "tool.register"],
    contributions: { panels: ["task-card.panel"], tools: ["task-card.create"] },
  },
  async start(context) {
    context.panels.register("task-card.panel");
    context.tools.register("task-card.create");
  },
};
