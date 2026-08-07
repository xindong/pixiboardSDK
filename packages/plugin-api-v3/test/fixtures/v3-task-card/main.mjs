export default {
  async start(context) {
    let observedChanges = 0;
    context.panels.register("task-card.panel");
    context.events.subscribe("change", () => { observedChanges += 1; });
    context.tools.register("task-card.create", async (input) => {
      const result = await context.canvas.create({ nodes: input.nodes }, { label: "Create nodes", origin: "ui" });
      return { ...result, observedChanges };
    });
    await context.processes.start("task-card.worker", {
      command: "fixture-task-card-worker",
      args: ["--deterministic"],
    });
  },
};
