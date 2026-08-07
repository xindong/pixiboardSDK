import { describe, expect, it } from "vitest";
import { BrowserPersistenceAdapter, runBrowserAdapterContract } from "../src";
import {
  MemoryBrowserStorage,
  MemoryDownloadContractPort,
  MemoryIndexedDbContractPort,
  MemoryObjectUrlContractPort,
  MemoryOpfsContractPort,
} from "./memory-test-port";

describe("reusable browser adapter contract suite", () => {
  it("runs the complete contract on the memory test port", async () => {
    const storage = new MemoryBrowserStorage();
    let generation = 0;
    const evidence = await runBrowserAdapterContract({
      createAdapter: () => new BrowserPersistenceAdapter({
        indexedDb: new MemoryIndexedDbContractPort(storage),
        opfs: new MemoryOpfsContractPort(storage),
        objectUrls: new MemoryObjectUrlContractPort(),
        download: new MemoryDownloadContractPort(storage),
        storageKeyFactory: (id, variant) => `${id}-${variant}-${++generation}`,
      }),
    });

    expect(evidence).toMatchObject({
      transactionRevisions: [1, 2, 3, 4],
      derivativeText: "preview",
      objectUrlRevoked: true,
      export: { fileName: "clip.mp4", mimeType: "video/mp4", text: "video" },
      download: true,
      recreated: true,
      capabilities: { desktopFileSystem: false, blobFallback: true },
    });
    expect(evidence.imports.map(({ sourceType, kind }) => [sourceType, kind])).toEqual([
      ["file", "image"],
      ["blob", "video"],
      ["text", "text"],
      ["url", "audio"],
    ]);
    expect(storage.downloads).toHaveLength(1);
    expect(storage.downloads[0]).toMatchObject({ fileName: "clip.mp4", mimeType: "video/mp4" });
  });
});
