import { describe, expect, it } from "vitest";
import { BoardCore, NodeTypeRegistry, type JsonValue, type NodeTypeDefinition } from "@pixi-board/core";
import { CapabilityError, createBoardCapabilities, isCapabilityError, mapCoreError, type AssetImportService, type ImportedAsset } from "./index.ts";

const text: NodeTypeDefinition = { type: "text", version: 1, defaults: {}, validate: (value) => value ?? {}, getBounds: (node) => ({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height }) };
function core() { const registry = new NodeTypeRegistry(); registry.register(text); return new BoardCore({ nodeTypes: registry, idFactory: (() => { let n = 0; return () => `id-${++n}`; })(), now: () => 1 }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("core-backed capabilities", () => {
  it("batches nodes into one revision/change/history entry and undoes", () => {
    const board = core(); const caps = createBoardCapabilities(board); let events = 0; board.on("change", () => events++);
    const result = caps.nodes.create({ nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 10, height: 10 }, { id: "b", type: "text", x: 1, y: 1, width: 10, height: 10 }] }, { origin: "agent" });
    return result.then((write) => { expect(write.revision).toBe(1); expect(events).toBe(1); expect(board.history.canUndo()).toBe(true); const undo = caps.history.undo(); expect(undo?.origin).toBe("history"); expect(board.document.toJSON().nodes).toHaveLength(0); });
  });
  it("rolls back a failed batch and handles abort/headless availability", async () => {
    const board = core(); const caps = createBoardCapabilities(board); const before = board.document.toJSON();
    await expect(caps.nodes.create({ nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 1, height: 1 }, { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1 }] }, { origin: "agent" })).rejects.toMatchObject({ code: "DOCUMENT_VALIDATION" });
    expect(board.document.toJSON()).toEqual(before);
    const controller = new AbortController(); controller.abort(); await expect(caps.nodes.create({ nodes: [{ type: "text", x: 0, y: 0, width: 1, height: 1 }] }, { origin: "agent", signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" });
    expect(caps.availability.preview).toBe(false); await expect(caps.preview.get({ nodeId: "missing" })).rejects.toMatchObject({ code: "NODE_NOT_FOUND" }); await expect(caps.capture.capture({ target: "viewport" })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });
  it("returns changed false for no-op and exposes session/document/history contracts", async () => {
    const board = core(); const caps = createBoardCapabilities(board);
    await caps.nodes.create({ nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 1, height: 1 }] }, { origin: "api" });
    caps.history.clear(); const before = board.document.toJSON();
    const result = await caps.nodes.update({ nodes: [{ id: "a", patch: { x: 0 } }] }, { origin: "api" });
    expect(result.changed).toBe(false); expect(result.changeSet).toBeUndefined(); expect(result.revision).toBe(before.revision); expect(caps.history.canUndo()).toBe(false);
    expect((await caps.document.snapshot()).revision).toBe(before.revision);
    await caps.selection.set(["a"], { origin: "ui" }); expect(await caps.selection.get()).toEqual(["a"]);
    await caps.viewport.set({ scale: 2, offset: { x: 3, y: 4 } }, { origin: "ui" }); expect(await caps.viewport.get()).toEqual({ scale: 2, offset: { x: 3, y: 4 } });
  });
  it("imports media metadata and commits the asset plus intrinsic-sized node atomically", async () => {
    const board = core(); const calls: unknown[] = [];
    const importAsset: AssetImportService = (input) => {
      calls.push(input);
      return {
        asset: { id: "image-asset", kind: "image", metadata: { mimeType: "image/png" } },
        assetRefs: {
          primary: { assetId: "image-asset", variant: "original" },
          preview: { assetId: "image-asset", variant: "preview" },
        },
        width: 1200,
        height: 600,
        duration: 42,
        previewStatus: "ready",
      };
    };
    const caps = createBoardCapabilities(board, { import: importAsset });
    const result = await caps.nodes.create({ nodes: [{
      id: "imported", type: "text", fit: "cover",
      source: { type: "file", path: "/tmp/wide.png", rootPath: "/tmp", relativePath: "wide.png", mimeType: "image/png" },
    }] }, { origin: "agent" });
    expect(calls).toEqual([expect.objectContaining({
      nodeType: "text", mimeType: "image/png",
      source: expect.objectContaining({ type: "file", path: "/tmp/wide.png", rootPath: "/tmp", relativePath: "wide.png" }),
    })]);
    expect(result).toMatchObject({ revision: 1, changed: true });
    expect(result.nodes[0]).toMatchObject({
      width: 320, height: 160, fit: "cover",
      assetRefs: {
        primary: { assetId: "image-asset", variant: "original" },
        preview: { assetId: "image-asset", variant: "preview" },
      },
      props: { intrinsicWidth: 1200, intrinsicHeight: 600, duration: 42, previewStatus: "ready" },
    });
    expect(result.changeSet).toMatchObject({ addedNodeIds: ["imported"], assetChangedNodeIds: ["imported"] });
    expect(board.document.toJSON().assets).toEqual([expect.objectContaining({ id: "image-asset", kind: "image" })]);
  });
  it("merges concurrent user edits into a source import", async () => {
    const board = core();
    const imported = deferred<ImportedAsset>();
    const importAsset: AssetImportService = () => imported.promise;
    const caps = createBoardCapabilities(board, { import: importAsset });
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 100, height: 100, props: { label: "initial", count: 1 } }] }, { origin: "api" });

    const sourceUpdate = caps.nodes.update({ nodes: [{
      id: "media",
      source: { type: "file", path: "/tmp/import.png" },
      patch: { x: 10, fit: "cover", props: { tone: "warm" } },
    }] }, { origin: "agent" });
    await Promise.resolve();
    await caps.nodes.update({ nodes: [{ id: "media", patch: { x: 75, props: { label: "user edit", extra: true } } }] }, { origin: "ui" });

    imported.resolve({
      asset: { id: "imported-asset", kind: "image", metadata: { mimeType: "image/png" } },
      assetRefs: { primary: { assetId: "imported-asset", variant: "original" } },
      width: 1200,
      height: 600,
      props: { label: "imported", source: "import" },
      previewStatus: "ready",
    });
    const result = await sourceUpdate;
    expect(result.nodes[0]).toMatchObject({
      x: 75, fit: "cover",
      props: { label: "user edit", extra: true, tone: "warm", source: "import", intrinsicWidth: 1200, intrinsicHeight: 600, previewStatus: "ready" },
      assetRefs: { primary: { assetId: "imported-asset", variant: "original" } },
    });
  });
  it("replaces old source preview and media facts while preserving concurrent user edits", async () => {
    const board = core(); const pending = deferred<ImportedAsset>();
    const caps = createBoardCapabilities(board, { import: () => pending.promise });
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, assetRefs: { primary: { assetId: "old", variant: "original" } }, props: {
      label: "before", removed: true, previewStatus: "pending", previewError: "old error", previewRequestId: "old-request",
      previewSpec: { page: 2 }, previewKey: "old-key", pageCount: 4, previewWarnings: ["old"], previewQuality: "detail",
      previewJobId: "old-job", fileExtension: "pdf", intrinsicWidth: 100, intrinsicHeight: 50, duration: 10,
      mediaContentHash: "old-hash", mediaPreparationStatus: "pending", mediaPreparationError: "old error",
      mediaAutoSize: true, mediaAutoSizeBaseline: { width: 10 },
    } }] });
    const update = caps.nodes.update({ nodes: [{ id: "media", source: { type: "file", path: "new.png" }, patch: { props: {
      label: "requested", tone: "warm", previewStatus: "pending", previewError: "stale request", intrinsicHeight: 50,
    } } }] });
    board.nodes.update("media", { props: {
      label: "user edit", added: true, previewStatus: "failed", previewError: "old preview failed", previewRequestId: "old-request",
      previewSpec: { page: 2 }, previewKey: "old-key", pageCount: 4, previewWarnings: ["old"], previewQuality: "detail",
      previewJobId: "old-job", fileExtension: "pdf", intrinsicWidth: 120, intrinsicHeight: 50, duration: 10,
      mediaContentHash: "old-hash", mediaPreparationStatus: "failed", mediaPreparationError: "old error",
      mediaAutoSize: true, mediaAutoSizeBaseline: { width: 10 },
    } });
    pending.resolve({ asset: { id: "new", kind: "image", metadata: {} }, width: 800, previewStatus: "ready", props: {
      label: "imported", mediaContentHash: "new-hash", previewKey: "new-key",
    } });
    await update;
    expect(board.nodes.get("media")?.props).toEqual({
      label: "user edit", added: true, tone: "warm", intrinsicWidth: 800,
      previewStatus: "ready", mediaContentHash: "new-hash", previewKey: "new-key",
    });
    expect(board.nodes.get("media")?.assetRefs?.primary?.assetId).toBe("new");
  });
  it("clears old source-owned props when the new importer supplies none", async () => {
    const board = core(); const pending = deferred<ImportedAsset>();
    const caps = createBoardCapabilities(board, { import: () => pending.promise });
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, props: {
      label: "keep", previewStatus: "failed", previewError: "old", intrinsicWidth: 100, duration: 10,
    } }] });
    const update = caps.nodes.update({ nodes: [{ id: "media", source: { type: "file", path: "new.png" }, patch: {} }] });
    pending.resolve({ asset: { id: "new", kind: "image", metadata: {} } });
    await update;
    expect(board.nodes.get("media")?.props).toEqual({ label: "keep" });
  });
  it.each([{ initialProps: null }, { initialProps: ["old"] }] as Array<{ initialProps: JsonValue }>)("imports media facts when unchanged props are $initialProps", async ({ initialProps }) => {
    const board = core(); const pending = deferred<ImportedAsset>();
    board.nodeTypes.register({ ...text, type: "raw", validate: (value) => value as JsonValue });
    const caps = createBoardCapabilities(board, { import: () => pending.promise });
    await caps.nodes.create({ nodes: [{ id: "media", type: "raw", x: 0, y: 0, width: 10, height: 10 }] });
    board.nodes.update("media", { props: initialProps });
    expect(board.nodes.get("media")?.props).toEqual(initialProps);
    const update = caps.nodes.update({ nodes: [{ id: "media", source: { type: "file", path: "media.png" }, patch: { props: { provider: "requested", custom: true } } }] });
    pending.resolve({ asset: { id: "new-asset", kind: "image", metadata: {} }, width: 1200, height: 600, duration: 42, previewStatus: "ready", props: { provider: "imported", imported: true } });
    await update;
    expect(board.nodes.get("media")?.props).toEqual({
      provider: "requested", imported: true, custom: true,
      intrinsicWidth: 1200, intrinsicHeight: 600, duration: 42, previewStatus: "ready",
    });
  });
  it("preserves a concurrent non-object props replacement", async () => {
    const board = core(); const pending = deferred<ImportedAsset>();
    const caps = createBoardCapabilities(board, { import: () => pending.promise });
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, props: { label: "before" } }] });
    const update = caps.nodes.update({ nodes: [{ id: "media", source: { type: "file", path: "media.png" }, patch: { props: { label: "stale" } } }] });
    board.nodes.update("media", { props: ["new"] });
    pending.resolve({ asset: { id: "new-asset", kind: "image", metadata: {} } });
    await update;
    expect(board.nodes.get("media")?.props).toEqual(["new"]);
    expect(board.nodes.get("media")?.assetRefs?.primary?.assetId).toBe("new-asset");
  });
  it.each(["preview", "poster", "waveform", "_documentPreviewPage1", `preview-${"a".repeat(64)}`])("does not treat %s changes as a source change", async (role) => {
    const board = core(); const pending = deferred<ImportedAsset>();
    const caps = createBoardCapabilities(board, { import: () => pending.promise });
    await caps.assets.upsert({ assets: [
      { id: "source", kind: "image", source: { path: "source.png" } },
      { id: "old-preview", kind: "image", metadata: { version: 1 } },
    ] });
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, props: { label: "before" }, assetRefs: {
      primary: { assetId: "source", variant: "original" },
      [role]: { assetId: "old-preview", variant: "original" },
    } }] });
    const update = caps.nodes.update({ nodes: [{ id: "media", source: { type: "file", path: "new.png" }, patch: {} }] });
    await caps.assets.upsert({ assets: [{ id: "old-preview", kind: "image", metadata: { version: 2 } }] });
    board.nodes.update("media", { assetRefs: {
      primary: { assetId: "source", variant: "original" },
      [role]: { assetId: "other-preview", variant: "preview" },
    }, props: { label: "user edit" } });
    board.nodes.update("media", { assetRefs: { primary: { assetId: "source", variant: "original" } } });
    pending.resolve({ asset: { id: "new-source", kind: "image", metadata: {} }, assetRefs: {
      primary: { assetId: "new-source", variant: "original" },
      preview: { assetId: "new-source", variant: "preview" },
    }, width: 400, props: { label: "imported" } });
    await update;
    expect(board.nodes.get("media")).toMatchObject({ props: { label: "user edit", intrinsicWidth: 400 }, assetRefs: {
      primary: { assetId: "new-source", variant: "original" },
      preview: { assetId: "new-source", variant: "preview" },
    } });
    expect(board.nodes.get("media")?.assetRefs).toEqual({
      primary: { assetId: "new-source", variant: "original" },
      preview: { assetId: "new-source", variant: "preview" },
    });
  });
  it.each(["original", "source", "customSource"])("still rejects a change to the %s source role", async (role) => {
    const board = core(); const pending = deferred<ImportedAsset>();
    const caps = createBoardCapabilities(board, { import: () => pending.promise });
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, assetRefs: { [role]: { assetId: "source", variant: "original" } } }] });
    const update = caps.nodes.update({ nodes: [{ id: "media", source: { type: "file", path: "new.png" }, patch: {} }] });
    board.nodes.update("media", { assetRefs: { [role]: { assetId: "replacement", variant: "original" } } });
    const before = board.document.toJSON();
    pending.resolve({ asset: { id: "new-source", kind: "image", metadata: {} } });
    await expect(update).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });
    expect(board.document.toJSON()).toEqual(before);
    expect(board.assets.get("new-source")).toBeUndefined();
  });
  it("allows preview metadata and variant changes on the referenced source asset", async () => {
    const board = core(); const pending = deferred<ImportedAsset>();
    const caps = createBoardCapabilities(board, { import: () => pending.promise });
    const source = { id: "source", kind: "image", source: { path: "source.png" }, metadata: { mimeType: "image/png" }, binaries: { original: { hash: "original" } } };
    await caps.assets.upsert({ assets: [source] });
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, assetRefs: {
      primary: { assetId: "source", variant: "original" }, preview: { assetId: "source", variant: "preview" },
    }, props: { label: "before" } }] });
    const update = caps.nodes.update({ nodes: [{ id: "media", source: { type: "file", path: "new.png" }, patch: {} }] });
    await caps.assets.upsert({ assets: [{ ...source, previewStatus: "ready", metadata: {
      ...source.metadata, previewWidth: 200, poster: { path: "poster.png" }, variants: { preview: { width: 200 } },
    }, binaries: { ...source.binaries, preview: { hash: "preview" }, [`preview-${"a".repeat(64)}`]: { hash: "page" } }, variants: { waveform: { hash: "waveform" } } }] });
    board.nodes.update("media", { props: { label: "user edit" } });
    pending.resolve({ asset: { id: "new-source", kind: "image", metadata: {} }, width: 800 });
    await update;
    expect(board.nodes.get("media")).toMatchObject({ props: { label: "user edit", intrinsicWidth: 800 }, assetRefs: { primary: { assetId: "new-source" } } });
  });
  it("rejects changes to the original variant even alongside preview metadata", async () => {
    const board = core(); const pending = deferred<ImportedAsset>();
    const caps = createBoardCapabilities(board, { import: () => pending.promise });
    const source = { id: "source", kind: "image", source: { path: "source.png" }, binaries: { original: { hash: "first" } } };
    await caps.assets.upsert({ assets: [source] });
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, assetRefs: { primary: { assetId: "source", variant: "original" } } }] });
    const update = caps.nodes.update({ nodes: [{ id: "media", source: { type: "file", path: "new.png" }, patch: {} }] });
    await caps.assets.upsert({ assets: [{ ...source, binaries: { original: { hash: "second" }, preview: { hash: "preview" } } }] });
    const before = board.document.toJSON();
    pending.resolve({ asset: { id: "new-source", kind: "image", metadata: {} } });
    await expect(update).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });
    expect(board.document.toJSON()).toEqual(before);
    expect(board.assets.get("new-source")).toBeUndefined();
  });
  it("rejects a source import superseded by a newer source request", async () => {
    const board = core();
    const imports = new Map<string, { promise: Promise<ImportedAsset>; resolve: (value: ImportedAsset) => void }>();
    const importAsset: AssetImportService = ({ source }) => {
      const pending = deferred<ImportedAsset>();
      imports.set(source.type === "file" ? source.path : source.type === "url" ? source.url : source.fileName ?? "content", pending);
      return pending.promise;
    };
    const caps = createBoardCapabilities(board, { import: importAsset });
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 100, height: 100, props: { label: "initial" } }] }, { origin: "api" });

    const first = caps.nodes.update({ nodes: [{ id: "media", source: { type: "file", path: "first.png" }, patch: {} }] }, { origin: "agent" });
    await Promise.resolve();
    const second = caps.nodes.update({ nodes: [{ id: "media", source: { type: "file", path: "second.png" }, patch: {} }] }, { origin: "agent" });
    await Promise.resolve();
    imports.get("second.png")!.resolve({
      asset: { id: "second-asset", kind: "image", metadata: {} },
      props: { source: "second" },
    });
    await second;
    imports.get("first.png")!.resolve({
      asset: { id: "first-asset", kind: "image", metadata: {} },
      props: { source: "first" },
    });

    await expect(first).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });
    const media = board.nodes.get("media");
    expect(media).toMatchObject({
      assetRefs: { primary: { assetId: "second-asset", variant: "original" } },
      props: { label: "initial", source: "second" },
    });
    expect(board.assets.list().map((asset) => asset.id)).not.toContain("first-asset");
  });
  it("commits direct updates synchronously before callers compute their next props", async () => {
    const board = core(); const caps = createBoardCapabilities(board);
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, props: { first: 0, second: 0 } }] });
    const first = caps.nodes.update({ nodes: [{ id: "media", patch: { props: { first: 1, second: 0 } } }] });
    const current = board.nodes.get("media")!;
    const second = caps.nodes.update({ nodes: [{ id: "media", patch: { props: { ...(current.props as Record<string, number>), second: 2 } } }] });
    await Promise.all([first, second]);
    expect(board.nodes.get("media")?.props).toEqual({ first: 1, second: 2 });
  });
  it("commits direct creates synchronously before returning the promise", async () => {
    const board = core(); const caps = createBoardCapabilities(board);
    const created = caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10 }] });
    expect(board.nodes.get("media")).toMatchObject({ id: "media" });
    await created;
  });
  it("merges asset refs from the transaction draft after an earlier batch update", async () => {
    const board = core(); const caps = createBoardCapabilities(board);
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10 }] });
    await caps.nodes.update({ nodes: [
      { id: "media", patch: { assetRefs: { preview: { assetId: "preview", variant: "preview" } } } },
      { id: "media", patch: {}, asset: { id: "primary", kind: "image", metadata: {} } },
    ] });
    expect(board.nodes.get("media")?.assetRefs).toEqual({
      preview: { assetId: "preview", variant: "preview" },
      primary: { assetId: "primary", variant: "original" },
    });
  });
  it("rejects an import after the target is removed and recreated with the same id and type", async () => {
    const board = core(); const pending = deferred<ImportedAsset>();
    const caps = createBoardCapabilities(board, { import: () => pending.promise });
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, props: { label: "old" } }] });
    const update = caps.nodes.update({ nodes: [{ id: "media", source: { type: "file", path: "old.png" }, patch: {} }] });
    board.nodes.remove("media");
    board.nodes.create({ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, props: { label: "new" } });
    const before = board.document.toJSON();
    pending.resolve({ asset: { id: "old-import", kind: "image", metadata: {} }, width: 400 });
    await expect(update).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });
    expect(board.document.toJSON()).toEqual(before);
    expect(board.assets.get("old-import")).toBeUndefined();
  });
  it("rejects an old import after refs switch sources, even when they switch back", async () => {
    const board = core(); const pending = deferred<ImportedAsset>();
    const caps = createBoardCapabilities(board, { import: () => pending.promise });
    const original = { primary: { assetId: "original", variant: "original" as const } };
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, assetRefs: original, props: { label: "keep" } }] });
    const update = caps.nodes.update({ nodes: [{ id: "media", source: { type: "file", path: "old.png" }, patch: {} }] });
    board.nodes.update("media", { assetRefs: { primary: { assetId: "replacement", variant: "original" } }, props: { label: "new source" } });
    board.nodes.update("media", { assetRefs: original });
    const before = board.document.toJSON();
    pending.resolve({ asset: { id: "old-import", kind: "image", metadata: {} }, props: { label: "stale metadata" }, width: 123 });
    await expect(update).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });
    expect(board.document.toJSON()).toEqual(before);
    expect(board.assets.get("old-import")).toBeUndefined();
  });
  it("rolls back a batch when an earlier item changes the source refs of its import target", async () => {
    const board = core(); const pending = deferred<ImportedAsset>();
    const caps = createBoardCapabilities(board, { import: () => pending.promise });
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, props: { label: "original" } }] });
    const before = board.document.toJSON();
    const update = caps.nodes.update({ nodes: [
      { id: "media", patch: { assetRefs: { primary: { assetId: "new-source", variant: "original" } } } },
      { id: "media", patch: {}, source: { type: "file", path: "old.png" } },
    ] });
    pending.resolve({ asset: { id: "old-import", kind: "image", metadata: {} }, props: { label: "stale" } });
    await expect(update).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });
    expect(board.document.toJSON()).toEqual(before);
    expect(board.assets.get("old-import")).toBeUndefined();
  });
  it("allows an unrelated node edit while importing and uses latest direct-asset refs", async () => {
    const board = core(); const pending = deferred<ImportedAsset>();
    const caps = createBoardCapabilities(board, { import: () => pending.promise });
    await caps.nodes.create({ nodes: [
      { id: "media", type: "text", x: 0, y: 0, width: 10, height: 10 },
      { id: "other", type: "text", x: 0, y: 0, width: 10, height: 10 },
    ] });
    const update = caps.nodes.update({ nodes: [
      { id: "media", patch: {}, asset: { id: "primary", kind: "image", metadata: {} } },
      { id: "other", patch: {}, source: { type: "file", path: "other.png" } },
    ] });
    board.nodes.update("media", { assetRefs: { preview: { assetId: "preview", variant: "preview" } } });
    pending.resolve({ asset: { id: "other-asset", kind: "image", metadata: {} } });
    await update;
    expect(board.nodes.get("media")?.assetRefs).toEqual({
      preview: { assetId: "preview", variant: "preview" },
      primary: { assetId: "primary", variant: "original" },
    });
    expect(board.nodes.get("other")?.assetRefs?.primary?.assetId).toBe("other-asset");
  });
  it("rejects source asset replacement under the same asset id", async () => {
    const board = core(); const pending = deferred<ImportedAsset>();
    const caps = createBoardCapabilities(board, { import: () => pending.promise });
    await caps.assets.upsert({ assets: [{ id: "original", kind: "image", source: { path: "first.png" } }] });
    await caps.nodes.create({ nodes: [{ id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, assetRefs: { primary: { assetId: "original", variant: "original" } } }] });
    const update = caps.nodes.update({ nodes: [{ id: "media", source: { type: "file", path: "old.png" }, patch: {} }] });
    await caps.assets.upsert({ assets: [{ id: "original", kind: "image", source: { path: "second.png" } }] });
    const before = board.document.toJSON();
    pending.resolve({ asset: { id: "old-import", kind: "image", metadata: {} } });
    await expect(update).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });
    expect(board.document.toJSON()).toEqual(before);
  });
  it("documents that change sets hide same-transaction recreation of an identical node", async () => {
    const board = core(); const caps = createBoardCapabilities(board);
    await caps.nodes.create({ nodes: [
      { id: "other", type: "text", x: 0, y: 0, width: 10, height: 10 },
      { id: "media", type: "text", x: 0, y: 0, width: 10, height: 10, props: { label: "same" } },
    ] });
    const node = board.nodes.get("media")!;
    let observed: { addedNodeIds: string[]; removedNodeIds: string[]; updatedNodeIds: string[] } | undefined;
    const off = board.on("change", ({ changeSet }) => { observed = changeSet; });
    board.transaction("replace identical target", () => {
      board.nodes.remove("media");
      board.nodes.create(node);
      board.nodes.update("other", { x: 20 });
    });
    off();
    expect(observed).toBeDefined();
    expect(observed!.addedNodeIds).not.toContain("media");
    expect(observed!.removedNodeIds).not.toContain("media");
    expect(observed!.updatedNodeIds).not.toContain("media");
  });
  it("returns deletedAssetIds for asset removal", async () => {
    const board = core(); const caps = createBoardCapabilities(board);
    const created = await caps.assets.upsert({ assets: [{ id: "asset-1", kind: "text", source: { content: "hello" } }] }, { origin: "api" });
    expect(created.changed).toBe(true); caps.history.clear();
    const removed = await caps.assets.remove({ assetIds: ["asset-1"] }, { origin: "api" });
    expect(removed.deletedAssetIds).toEqual(["asset-1"]); expect(removed.deletedNodeIds).toBeUndefined(); expect(removed.changeSet).toMatchObject({ revision: 2 });
  });
  it("recognises a CapabilityError thrown by a duplicate copy of the class", () => {
    // pixiboardjs inlines capabilities into its bundle, so a board's error is
    // not an instance of the class a separately installed consumer imports.
    // Reproduce that by building an error the same way a second copy would.
    class DuplicateCapabilityError extends Error {
      readonly name = "CapabilityError";
      readonly brand = "@pixi-board/capabilities:CapabilityError";
      readonly code = "NODE_NOT_FOUND";
    }
    const fromOtherCopy = new DuplicateCapabilityError("Node missing");

    expect(fromOtherCopy instanceof CapabilityError).toBe(false);
    expect(isCapabilityError(fromOtherCopy)).toBe(true);
    // Preserves the original code instead of flattening it to INTERNAL_ERROR.
    expect(mapCoreError(fromOtherCopy)).toBe(fromOtherCopy);

    expect(isCapabilityError(new CapabilityError("ABORTED", "direct"))).toBe(true);
    expect(isCapabilityError(new Error("unrelated"))).toBe(false);
    expect(isCapabilityError({ brand: "@pixi-board/capabilities:CapabilityError" })).toBe(false);
  });
});
