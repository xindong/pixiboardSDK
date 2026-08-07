export default {
  start(context) {
    let invalidToolRejected = false;
    try {
      context.tools.register("invalid.tool", "not-a-function");
    } catch (error) {
      if (error?.code !== "INVALID_INPUT") throw error;
      invalidToolRejected = true;
    }
    if (!invalidToolRejected) throw new Error("invalid tool handler was accepted");
    context.events.subscribe("host-internal-event", () => undefined);
  },
};
