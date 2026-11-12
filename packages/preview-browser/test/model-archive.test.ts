import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { PreviewRendererRegistry } from "@pixi-board/core";
import { createModelRenderer, isModelExtension, probeArchiveForModel } from "../src";

const zip = (names: string[]) => new Blob([zipSync(Object.fromEntries(names.map((n) => [n, strToU8("x")])))]);

describe("probeArchiveForModel", () => {
  it("finds a model entry anywhere in the package", async () => {
    expect((await probeArchiveForModel(zip(["a/b/scene.GLB", "readme.txt"]))).hasModel).toBe(true);
  });
  it("ignores macOS resource forks and archives without a model", async () => {
    expect((await probeArchiveForModel(zip(["__MACOSX/scene.glb", "a/._m.fbx", "t.png"]))).hasModel).toBe(false);
  });
  it("reports an unreadable directory instead of throwing", async () => {
    const probe = await probeArchiveForModel(new Blob(["not a zip"]));
    expect(probe).toMatchObject({ hasModel: false, error: expect.stringContaining("ZIP") });
  });
  it("caches the probe per blob", async () => {
    const blob = zip(["m.obj"]);
    expect(probeArchiveForModel(blob)).toBe(probeArchiveForModel(blob));
  });
});

describe("model renderer", () => {
  const source = (name: string, data: Blob) => ({ data: data as File, name, extension: name.split(".").pop()!.toLowerCase(), mime: "", kind: "file" });
  it("claims model files and zips that contain one, and nothing else", async () => {
    const renderer = createModelRenderer();
    expect(await renderer.supports(source("a.fbx", new Blob(["x"])))).toBe(true);
    expect(await renderer.supports(source("p.zip", zip(["m.glb"])))).toBe(true);
    expect(await renderer.supports(source("p.zip", zip(["a.txt"])))).toBe(false);
    expect(await renderer.supports(source("a.pdf", new Blob(["x"])))).toBe(false);
    expect(isModelExtension("STL")).toBe(true);
  });
  it("registers like any other renderer", () => {
    const registry = new PreviewRendererRegistry();
    registry.register(createModelRenderer() as never);
    expect(registry.has("model")).toBe(true);
  });
});
