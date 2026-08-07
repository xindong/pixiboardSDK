import type { AssetRecord, BoardNode } from "./types";
import type { RuntimeDocumentStore } from "./store";

export type DataPatch =
  | { op: "node:insert"; index: number; node: BoardNode }
  | { op: "node:replace"; node: BoardNode }
  | { op: "node:remove"; nodeId: string }
  | { op: "asset:insert"; index: number; asset: AssetRecord }
  | { op: "asset:replace"; asset: AssetRecord }
  | { op: "asset:remove"; assetId: string };

export function applyDataPatches(store: RuntimeDocumentStore, patches: DataPatch[]): void {
  for (const patch of patches) {
    switch (patch.op) {
      case "node:insert":
        store.insertNode(patch.index, patch.node);
        break;
      case "node:replace":
        store.replaceNode(patch.node);
        break;
      case "node:remove":
        store.removeNode(patch.nodeId);
        break;
      case "asset:insert":
        store.insertAsset(patch.index, patch.asset);
        break;
      case "asset:replace":
        store.replaceAsset(patch.asset);
        break;
      case "asset:remove":
        store.removeAsset(patch.assetId);
        break;
    }
  }
}
