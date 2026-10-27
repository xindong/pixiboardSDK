import { describe, expect, it } from "vitest";
import {
  BoardCore,
  DocumentValidationError,
  NodeTypeRegistry,
  createMediaAssetRefs,
  createPreviewSpec,
  fitMediaRect,
  isAssetVariant,
  previewStatusLabel,
  resolveTextureAssetRef,
  rotatedRectBounds,
} from "../src";

const digest = "0123456789abcdef".repeat(4);
const variant = `preview-${digest}`;

describe("asset variant contracts", () => {
  it("accepts content-addressed previews and preserves legacy variant names", () => {
    for (const value of [variant, "original", "preview", "waveform"]) {
      expect(isAssetVariant(value), value).toBe(true);
    }
  });

  it("rejects incomplete digests, uppercase, path injection and non-string values", () => {
    for (const value of [
      "preview-",
      `preview-${digest.slice(1)}`,
      `preview-${digest}0`,
      `preview-${digest.toUpperCase()}`,
      `preview-${"../" + "a".repeat(61)}`,
      `preview-${"..\\" + "a".repeat(61)}`,
      `${variant}\n`,
      null,
      42,
      { variant },
    ]) {
      expect(isAssetVariant(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe("media rendering contracts", () => {
  it("resolves only pixel-producing roles and excludes original media or documents", () => {
    expect(resolveTextureAssetRef({ type: "video", assetRefs: { poster: { assetId: "poster" } } })).toEqual({ assetId: "poster" });
    expect(resolveTextureAssetRef({ type: "video", assetRefs: { primary: { assetId: "video" } } })).toBeUndefined();
    expect(resolveTextureAssetRef({ type: "video", assetRefs: { source: { assetId: "video-source" } } })).toBeUndefined();
    expect(resolveTextureAssetRef({ type: "audio", assetRefs: { primary: { assetId: "audio" } } })).toBeUndefined();
    expect(resolveTextureAssetRef({ type: "markdown", assetRefs: { markdown: { assetId: "source" }, primary: { assetId: "source" } } })).toBeUndefined();
    expect(resolveTextureAssetRef({ type: "markdown", assetRefs: { [variant]: { assetId: "document", variant } } })).toEqual({ assetId: "document", variant });
    expect(resolveTextureAssetRef({ type: "image", assetRefs: { primary: { assetId: "image" } } })).toEqual({ assetId: "image" });
    expect(resolveTextureAssetRef({ type: "image", assetRefs: { source: { assetId: "legacy-image" } } })).toEqual({ assetId: "legacy-image" });
    expect(resolveTextureAssetRef({ type: "image", assetRefs: { [variant]: { assetId: "image", variant } } })).toEqual({ assetId: "image", variant });
    expect(createMediaAssetRefs("video", "video", { poster: true })).toEqual({
      primary: { assetId: "video", variant: "original" },
      poster: { assetId: "video", variant: "preview" },
    });
  });

  it("centers contained content, crops covered content, and keeps stretch as an explicit fill", () => {
    expect(fitMediaRect({ width: 100, height: 100 }, { width: 200, height: 100 })).toEqual({
      x: 0, y: 25, width: 100, height: 50,
    });
    expect(fitMediaRect({ width: 100, height: 100 }, { width: 200, height: 100 }, "cover")).toEqual({
      x: -50, y: 0, width: 200, height: 100,
    });
    expect(fitMediaRect({ width: 100, height: 100 }, { width: 200, height: 100 }, "stretch")).toEqual({
      x: 0, y: 0, width: 100, height: 100,
    });
  });

  it("persists canonical fit through node creation and rejects invalid values", () => {
    const nodeTypes = new NodeTypeRegistry();
    nodeTypes.register({ type: "card", version: 1, validate: value => value as { title: string }, getBounds: rotatedRectBounds });
    const core = new BoardCore({ schemaVersion: 1, nodeTypes });
    const created = core.nodes.create({ type: "card", x: 0, y: 0, width: 100, height: 100, fit: "cover", props: { title: "Card" } });
    expect(created.fit).toBe("cover");
    expect(core.document.toJSON().nodes[0].fit).toBe("cover");
    expect(() => core.nodes.create({ type: "card", x: 0, y: 0, width: 100, height: 100, fit: "fill", props: {} } as any))
      .toThrow(DocumentValidationError);
  });
});

describe("preview layout contracts", () => {
  it("uses a stable default viewport independent of card geometry, with a taller model viewport", () => {
    const expected = { width: 1024, height: 704, page: 1, mode: "viewport", quality: "thumbnail" };
    expect(createPreviewSpec({ width: 300, height: 100 })).toEqual(expected);
    expect(createPreviewSpec({ type: "file", width: 80, height: 900 })).toEqual(expected);
    expect(createPreviewSpec({ type: "model", width: 300, height: 100 })).toEqual({
      ...expected, height: 768,
    });
  });

  it("resets or refreshes to the card ratio at the saved logical width without mutating inputs", () => {
    const saved = Object.freeze({ width: 1200, height: 700, page: 3, mode: "viewport", quality: "thumbnail" });
    const node = Object.freeze({
      type: "file", width: 300, height: 150,
      props: Object.freeze({ previewSpec: saved }),
    });
    const before = structuredClone(node);
    expect(createPreviewSpec(node)).toEqual(saved);
    for (const reason of ["reset", "refresh"]) {
      const options = Object.freeze({ reason });
      const result = createPreviewSpec(node, options);
      expect(result).toEqual({ width: 1200, height: 600, page: 3, mode: "fixed-viewport", quality: "detail" });
      expect(result).not.toBe(saved);
      expect(options).toEqual({ reason });
    }
    expect(node).toEqual(before);
    expect(createPreviewSpec({ width: 300, height: 150 }, { reason: "reset" })).toMatchObject({
      width: 1024, height: 512, mode: "fixed-viewport",
    });
  });

  it("retains saved detail quality and allows explicit thumbnail or detail requests", () => {
    const node = {
      width: 200, height: 100,
      props: { previewSpec: { width: 900, height: 600, quality: "detail", page: 2, mode: "fixed-viewport" } },
    };
    expect(createPreviewSpec(node)).toEqual(node.props.previewSpec);
    expect(createPreviewSpec(node, { quality: "thumbnail" }).quality).toBe("thumbnail");
    expect(createPreviewSpec({ width: 200, height: 100 }, { quality: "detail" }).quality).toBe("detail");
    expect(createPreviewSpec(node, { reason: "reset", quality: "thumbnail" })).toMatchObject({
      width: 900, height: 450, quality: "thumbnail",
    });
    expect(createPreviewSpec(node, { width: 640, height: 480, page: 4 })).toMatchObject({
      width: 640, height: 480, page: 4,
    });
  });

  it("bounds both sides and area, including rounding and extremely large finite inputs", () => {
    const node = { width: 200, height: 100 };
    expect(createPreviewSpec(node, { width: 12_000, height: 3000 })).toMatchObject({
      width: 4096, height: 1024,
    });
    expect(createPreviewSpec(node, { width: 4000, height: 2000 })).toMatchObject({
      width: 4000, height: 2000,
    });
    for (const size of [
      { width: 4096, height: 4096 },
      // Scaling this ratio can round back above 8 Mpx unless the final result is bounded.
      { width: 4096, height: 1954 },
      { width: Number.MAX_VALUE, height: Number.MAX_VALUE },
    ]) {
      const result = createPreviewSpec(node, size);
      expect(Number.isInteger(result.width)).toBe(true);
      expect(Number.isInteger(result.height)).toBe(true);
      expect(result.width).toBeGreaterThanOrEqual(1);
      expect(result.height).toBeGreaterThanOrEqual(1);
      expect(result.width).toBeLessThanOrEqual(4096);
      expect(result.height).toBeLessThanOrEqual(4096);
      expect(result.width * result.height).toBeLessThanOrEqual(8_000_000);
      expect(result.width * result.height).toBeGreaterThan(7_990_000);
      expect(result.width / result.height).toBeCloseTo(size.width / size.height, 2);
    }
  });

  it("normalizes invalid dimensions and pages while accepting legacy numeric strings", () => {
    const node = { width: NaN, height: 0 };
    for (const invalid of [NaN, Infinity, -1, 0]) {
      expect(createPreviewSpec(node, { width: invalid, height: invalid, page: invalid })).toMatchObject({
        width: 1024, height: 704, page: 1,
      });
    }
    expect(createPreviewSpec({ ...node, type: "model" }, { reason: "reset" })).toMatchObject({
      width: 1024, height: 768, mode: "fixed-viewport",
    });
    expect(createPreviewSpec({
      ...node, props: { previewSpec: { width: "800", height: "600", page: "2.6" } },
    })).toMatchObject({ width: 800, height: 600, page: 3 });
    expect(createPreviewSpec({
      ...node, props: { previewSpec: { width: "bad", height: "", page: "bad" } },
    })).toMatchObject({ width: 1024, height: 704, page: 1 });
    expect(createPreviewSpec(node, { page: 2.6 }).page).toBe(3);
    expect(createPreviewSpec(node, { page: Number.MAX_VALUE }).page).toBe(Number.MAX_SAFE_INTEGER);
    expect(createPreviewSpec({ ...node, props: { previewSpec: { page: 8 } } }, { page: NaN }).page).toBe(1);
  });
});

describe("preview status labels", () => {
  it("groups active and unavailable states and keeps ready or unknown states short", () => {
    for (const previewStatus of ["pending", "queued", "running"]) {
      expect(previewStatusLabel({ props: { previewStatus } }, "PDF")).toBe("PDF:预览生成中");
    }
    for (const previewStatus of ["error", "failed", "unsupported"]) {
      expect(previewStatusLabel({ props: { previewStatus, previewError: "private error details" } }, "PDF"))
        .toBe("PDF:暂无预览");
    }
    for (const previewStatus of ["ready", "unknown", undefined]) {
      expect(previewStatusLabel({ props: { previewStatus } }, "PDF")).toBe("PDF");
    }
    expect(previewStatusLabel({}, "PDF")).toBe("PDF");
  });

  it("labels ZIP_NO_MODEL as ZIP while retaining the model label for ordinary model archives", () => {
    const model = { type: "model", name: "scene.ZIP", props: { previewStatus: "failed" } };
    expect(previewStatusLabel(model, "3D")).toBe("3D:暂无预览");
    expect(previewStatusLabel({
      ...model, props: { ...model.props, previewError: "ZIP_NO_MODEL: no supported model found" },
    }, "3D")).toBe("ZIP:暂无预览");
    expect(previewStatusLabel({ type: "file", props: { fileExtension: "ZiP", previewStatus: "queued" } }, "文件"))
      .toBe("ZIP:预览生成中");
    expect(previewStatusLabel({ type: "file", name: "archive.ZIP" }, "文件")).toBe("ZIP");
    expect(previewStatusLabel({ type: "file", name: "old.zip", props: { name: "renamed.pdf" } }, "PDF"))
      .toBe("PDF");
  });
});

describe("document preview references", () => {
  it("loads content-addressed and legacy references and rejects invalid variants atomically", () => {
    const core = new BoardCore({ schemaVersion: 1 });
    const document = {
      schemaVersion: 1, revision: 0,
      nodes: [{
        id: "card", type: "file", typeVersion: 1,
        x: 0, y: 0, width: 300, height: 200, rotation: 0, zIndex: 0, props: {},
        assetRefs: {
          source: { assetId: "asset" },
          original: { assetId: "asset", variant: "original" },
          legacy: { assetId: "asset", variant: "preview" },
          waveform: { assetId: "asset", variant: "waveform" },
          thumbnail: { assetId: "asset", variant },
        },
      }],
      assets: [{ id: "asset", kind: "file" }],
    };
    core.document.load(JSON.stringify(document));
    expect(core.document.toJSON().nodes[0].assetRefs).toEqual(document.nodes[0].assetRefs);
    const loaded = core.document.toJSON();
    for (const invalid of [`preview-${digest.slice(1)}`, `preview-${digest.toUpperCase()}`, `../${variant}`]) {
      const rejected = structuredClone(document);
      rejected.nodes[0].assetRefs.thumbnail.variant = invalid;
      expect(() => core.document.load(rejected)).toThrow(DocumentValidationError);
      expect(core.document.toJSON()).toEqual(loaded);
    }
  });
});

describe("background document updates", () => {
  it("can emit a change without creating an undo entry", () => {
    const nodeTypes = new NodeTypeRegistry();
    nodeTypes.register({ type: "custom", version: 1, validate: value => value as { previewStatus?: string }, getBounds: rotatedRectBounds });
    const core = new BoardCore({
      nodeTypes,
      document: {
        schemaVersion: 1,
        revision: 0,
        nodes: [{
          id: "node", type: "custom", typeVersion: 1,
          x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 0, props: {},
        }],
        assets: [],
      },
    });
    core.transaction("Apply server preview", () => {
      core.nodes.update("node", { props: { previewStatus: "ready" } });
    }, { origin: "preview", recordHistory: false });
    expect(core.document.snapshot().nodes[0].props).toEqual({ previewStatus: "ready" });
    expect(core.history.canUndo()).toBe(false);
  });
});
