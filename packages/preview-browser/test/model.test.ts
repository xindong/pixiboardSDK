import { describe, expect, it } from "vitest";
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
