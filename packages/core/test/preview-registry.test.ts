import { describe, expect, it } from "vitest";
import { PreviewRendererRegistry, type PreviewRenderer, type PreviewSource } from "../src";

const blob = { size: 0, type: "", slice() { return blob; }, arrayBuffer: async () => new ArrayBuffer(0) };
const source = (extension: string, kind = "file"): PreviewSource => ({ data: blob, name: `a.${extension}`, extension, mime: "", kind });
const renderer = (id: string, supports: PreviewRenderer["supports"], priority?: number): PreviewRenderer => ({
  id, priority, supports, render: async () => ({ blob: id, width: 1, height: 1, rendered: true }),
});

describe("PreviewRendererRegistry", () => {
  it("resolves by priority, then registration order", async () => {
    const registry = new PreviewRendererRegistry();
    registry.register(renderer("fallback", () => true, -1000));
    registry.register(renderer("a", (s) => s.extension === "x"));
    registry.register(renderer("b", () => true));
    expect((await registry.resolve(source("x")))?.id).toBe("a");
    expect((await registry.resolve(source("y")))?.id).toBe("b");
    expect(registry.list().map((r) => r.id)).toEqual(["a", "b", "fallback"]);
  });

  it("supports async probes and treats a throwing probe as a miss", async () => {
    const registry = new PreviewRendererRegistry();
    registry.register(renderer("bad", () => { throw new Error("x"); }, 5));
    registry.register(renderer("slow", async (s) => s.extension === "z"));
    expect((await registry.resolve(source("z")))?.id).toBe("slow");
    expect(await registry.resolve(source("q"))).toBeUndefined();
  });

  it("rejects duplicates, and replace only in development", () => {
    const strict = new PreviewRendererRegistry();
    strict.register(renderer("a", () => true));
    expect(() => strict.register(renderer("a", () => true))).toThrow(/already registered/);
    expect(() => strict.register(renderer("a", () => true), { replace: true })).toThrow(/development/);
    const dev = new PreviewRendererRegistry({ development: true });
    dev.register(renderer("a", () => false));
    dev.register(renderer("a", () => true), { replace: true });
    expect(dev.list()).toHaveLength(1);
  });

  it("unregister removes only its own registration", async () => {
    const registry = new PreviewRendererRegistry();
    const off = registry.register(renderer("a", () => true));
    off();
    expect(registry.has("a")).toBe(false);
    expect(await registry.resolve(source("x"))).toBeUndefined();
  });

  it("rejects malformed renderers", () => {
    const registry = new PreviewRendererRegistry();
    expect(() => registry.register({ id: "", supports: () => true, render: async () => { throw 0; } })).toThrow();
    expect(() => registry.register({ id: "x" } as unknown as PreviewRenderer)).toThrow();
  });
});
