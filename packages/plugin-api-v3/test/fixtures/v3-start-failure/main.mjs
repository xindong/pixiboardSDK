export default {
  async start(context) {
    context.panels.register("failure.panel");
    context.tools.register("failure.tool", () => ({ ok: true }));
    await context.processes.start("failure.worker", { command: "fixture-failure-worker" });
    throw new Error("fixture start failed");
  },
};
