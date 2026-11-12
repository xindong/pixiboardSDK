import { describe, expect, it, vi } from "vitest";
import { PreviewRendererRegistry } from "@pixi-board/core";
import { createModelRenderer, isModelExtension } from "../src";

const source = (name: string) => ({ data: new Blob(["x"]) as File, name, extension: name.split(".").pop()!.toLowerCase(), mime: "", kind: "file" });

describe("model renderer", () => {
  it("claims model formats only; ZIP is a plain file", async () => {
    const renderer = createModelRenderer();
    for (const name of ["a.fbx", "a.GLB", "a.obj"]) expect(await renderer.supports(source(name))).toBe(true);
    for (const name of ["pack.zip", "a.pdf", "noext"]) expect(await renderer.supports(source(name))).toBe(false);
    expect(isModelExtension("STL")).toBe(true);
  });
  it("registers like any other renderer", () => {
    const registry = new PreviewRendererRegistry();
    registry.register(createModelRenderer() as never);
    expect(registry.has("model")).toBe(true);
  });
});

describe("model renderer initialisation", () => {
  it("retries after a failed init instead of caching the failure", async () => {
    vi.resetModules();
    const render = vi.fn(async () => ({ blob: new Blob(["png"]), width: 4, height: 3 }));
    vi.doMock("mivo-model-viewer/core", () => ({ createThumbnailRenderer: () => ({ render, dispose() {} }) }));
    const { createModelRenderer: create } = await import("../src/model");
    let calls = 0;
    const renderer = create({ configure: () => { if (++calls === 1) throw new Error("temporary"); } });
    const input = { source: source("a.glb"), spec: undefined };
    await expect(renderer.render(input as never, {} as never)).rejects.toThrow("temporary");
    const result = await renderer.render(input as never, {} as never);
    expect(result).toMatchObject({ rendered: true, width: 4, height: 3 });
    expect(calls).toBe(2);
    vi.doUnmock("mivo-model-viewer/core");
  });
});
