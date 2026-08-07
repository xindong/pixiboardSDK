import { describe, expect, it } from "vitest";
import { runCustomTaskCardFixture } from "../src/fixture";

describe("custom task-card executable fixture", () => {
  it("registers, creates, culls, recreates, saves and reloads from JSON data", async () => {
    const result = await runCustomTaskCardFixture();
    expect(result.destroyedOffscreen).toBe(true);
    expect(result.recreatedTitle).toBe("Persist me");
    expect(result.recreatedStatus).toBe("doing");
    expect(result.creates).toBeGreaterThanOrEqual(3);
    expect(result.destroys).toBeGreaterThanOrEqual(3);
    expect(result.saved.nodes).toEqual([
      expect.objectContaining({
        id: "task-1",
        type: "acme.task-card",
        typeVersion: 1,
        props: { title: "Persist me", status: "doing" },
      }),
    ]);
  });
});
