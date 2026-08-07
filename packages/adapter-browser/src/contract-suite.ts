import type { BoardDocument } from "@pixi-board/core";
import type { BrowserPersistenceAdapter } from "./browser-persistence-adapter";

export type BrowserAdapterContractHarness = {
  createAdapter(): BrowserPersistenceAdapter | Promise<BrowserPersistenceAdapter>;
  inspectObjectUrl?(url: string): Promise<{ type: string; text: string }>;
};

export type BrowserAdapterContractEvidence = {
  imports: Array<{ sourceType: string; kind: string; revision: number; storage: string }>;
  transactionRevisions: number[];
  derivativeText: string;
  objectUrlRevoked: boolean;
  export: { fileName: string; mimeType: string; text: string };
  download: boolean;
  restored: { revision: number; assetIds: string[]; nodeTypes: string[] };
  gc: { quarantined: string[]; deleted: string[] };
  recreated: boolean;
  capabilities: Awaited<ReturnType<BrowserPersistenceAdapter["capabilities"]>>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Browser adapter contract failed: ${message}`);
}

function emptyDocument(): BoardDocument {
  return { schemaVersion: 1, revision: 0, assets: [], nodes: [] };
}

export async function runBrowserAdapterContract(
  harness: BrowserAdapterContractHarness,
): Promise<BrowserAdapterContractEvidence> {
  let adapter = await harness.createAdapter();
  const capabilities = await adapter.capabilities();
  assert(capabilities.desktopFileSystem === false, "desktop filesystem must be negotiated off");
  assert(capabilities.import.join(",") === "file,blob,text,url", "all browser import sources must be available");
  await adapter.saveDocument({ snapshot: emptyDocument(), expectedRevision: null });

  const imports = [] as BrowserAdapterContractEvidence["imports"];
  const revisions: number[] = [];
  let document = emptyDocument();
  const image = await adapter.importFile(
    new File(["image"], "hero.png", { type: "image/png" }),
    {
      document,
      expectedRevision: 0,
      assetId: "contract-image",
      nodeId: "contract-image-node",
      preferOpfs: true,
    },
  );
  document = image.document;
  imports.push({
    sourceType: image.sourceType,
    kind: image.asset.kind,
    revision: document.revision,
    storage: image.entry.binaries.original.storage.kind,
  });
  revisions.push(document.revision);

  const video = await adapter.importBlob(
    new Blob(["video"], { type: "video/mp4" }),
    {
      document,
      expectedRevision: 1,
      assetId: "contract-video",
      nodeId: "contract-video-node",
      name: "clip.mp4",
      preferOpfs: false,
    },
  );
  document = video.document;
  imports.push({
    sourceType: video.sourceType,
    kind: video.asset.kind,
    revision: document.revision,
    storage: video.entry.binaries.original.storage.kind,
  });
  revisions.push(document.revision);

  const text = await adapter.importText("text asset", {
    document,
    expectedRevision: 2,
    assetId: "contract-text",
    nodeId: "contract-text-node",
    name: "note.txt",
    preferOpfs: false,
  });
  document = text.document;
  imports.push({
    sourceType: text.sourceType,
    kind: text.asset.kind,
    revision: document.revision,
    storage: text.entry.binaries.original.storage.kind,
  });
  revisions.push(document.revision);

  const audio = await adapter.importUrl("data:audio/mpeg;base64,YXVkaW8=", {
    document,
    expectedRevision: 3,
    assetId: "contract-audio",
    nodeId: "contract-audio-node",
    name: "sound.mp3",
    preferOpfs: true,
  });
  document = audio.document;
  imports.push({
    sourceType: audio.sourceType,
    kind: audio.asset.kind,
    revision: document.revision,
    storage: audio.entry.binaries.original.storage.kind,
  });
  revisions.push(document.revision);

  assert(imports.map(({ kind }) => kind).join(",") === "image,video,text,audio", "asset kinds");
  assert(revisions.join(",") === "1,2,3,4", "each asset+node commit must advance one revision");
  assert(document.assets.length === 4 && document.nodes.length === 4, "asset+node pairs must commit together");
  assert(document.nodes.every((node) => node.assetRefs?.primary?.assetId), "every imported node must reference its asset");

  await adapter.putDerivative(
    "contract-image",
    "preview",
    new Blob(["preview"], { type: "image/webp" }),
    { preferOpfs: false },
  );
  const derivative = await adapter.getAsset("contract-image", { variant: "preview" });
  assert(derivative !== null, "preview derivative must resolve");
  const derivativeText = await derivative.blob.text();
  assert(derivativeText === "preview", "preview derivative body");

  const lease = await adapter.leaseObjectUrl("contract-image");
  if (harness.inspectObjectUrl) {
    const inspected = await harness.inspectObjectUrl(lease.url);
    assert(inspected.text === "image", "object URL body");
    assert(image.entry.binaries.original.mimeType === "image/png", "object URL MIME metadata");
  }
  lease.revoke();
  assert(lease.revoked, "explicit object URL revoke");

  const exported = await adapter.exportAsset("contract-video");
  const exportText = await exported.blob.text();
  assert(exported.fileName === "clip.mp4", "export filename");
  assert(exported.mimeType === "video/mp4" && exportText === "video", "export body");
  if (capabilities.download) await adapter.downloadAsset("contract-video");

  await adapter.destroy();
  adapter = await harness.createAdapter();
  const restored = await adapter.loadDocument();
  assert(restored?.snapshot.revision === 4, "document must recover after adapter recreation");
  assert((await adapter.getAsset("contract-image")) !== null, "OPFS image must recover");
  assert((await adapter.getAsset("contract-video")) !== null, "IndexedDB Blob video must recover");
  assert(await (await adapter.getAsset("contract-text"))?.blob.text() === "text asset", "text must recover");
  assert(await (await adapter.getAsset("contract-audio"))?.blob.text() === "audio", "URL audio must recover");
  assert(await (await adapter.getAsset("contract-image", { variant: "preview" }))?.blob.text() === "preview", "derivative must recover");

  const withoutAudio = structuredClone(restored.snapshot);
  withoutAudio.revision += 1;
  withoutAudio.nodes = withoutAudio.nodes.filter(({ id }) => id !== "contract-audio-node");
  withoutAudio.assets = withoutAudio.assets.filter(({ id }) => id !== "contract-audio");
  await adapter.saveDocument({ snapshot: withoutAudio, expectedRevision: 4 });
  const quarantined = await adapter.collectAssetGarbage({ now: 100, quarantineMs: 0 });
  const deleted = await adapter.collectAssetGarbage({ now: 101, quarantineMs: 0 });
  assert(quarantined.quarantined.includes("contract-audio"), "unreferenced audio must quarantine");
  assert(deleted.deleted.includes("contract-audio"), "quarantined audio must prune");
  assert(await adapter.getAsset("contract-audio") === null, "pruned audio must be absent");

  await adapter.destroy();
  adapter = await harness.createAdapter();
  const final = await adapter.loadDocument();
  assert(final?.snapshot.revision === 5, "post-GC document must recover after recreation");
  assert(await adapter.getAsset("contract-audio") === null, "GC deletion must persist");
  await adapter.destroy();

  return {
    imports,
    transactionRevisions: revisions,
    derivativeText,
    objectUrlRevoked: lease.revoked,
    export: { fileName: exported.fileName, mimeType: exported.mimeType, text: exportText },
    download: capabilities.download,
    restored: {
      revision: restored.snapshot.revision,
      assetIds: restored.snapshot.assets.map(({ id }) => id).sort(),
      nodeTypes: restored.snapshot.nodes.map(({ type }) => type).sort(),
    },
    gc: { quarantined: quarantined.quarantined, deleted: deleted.deleted },
    recreated: final !== null,
    capabilities,
  };
}
