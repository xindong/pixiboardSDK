import { DocumentValidationError, NodeNotFoundError } from "./errors";
import { cloneValue, immutableClone } from "./json";
import type { AssetRecord, BoardDocument, BoardNode } from "./types";

export class RuntimeDocumentStore {
  private document: BoardDocument;
  private nodesById = new Map<string, BoardNode>();
  private nodeOrder = new Map<string, number>();
  private assetsById = new Map<string, AssetRecord>();
  private assetOrder = new Map<string, number>();

  constructor(document: BoardDocument) {
    this.document = cloneValue(document);
    this.rebuildIndexes();
  }

  clone(): RuntimeDocumentStore {
    return new RuntimeDocumentStore(this.document);
  }

  replaceWith(store: RuntimeDocumentStore): void {
    this.document = cloneValue(store.document);
    this.rebuildIndexes();
  }

  snapshot(): Readonly<BoardDocument> {
    return immutableClone(this.document);
  }

  mutableSnapshot(): BoardDocument {
    return cloneValue(this.document);
  }

  get revision(): number {
    return this.document.revision;
  }

  set revision(value: number) {
    this.document.revision = value;
  }

  getNode(id: string): BoardNode | undefined {
    const node = this.nodesById.get(id);
    return node ? cloneValue(node) : undefined;
  }

  requireNode(id: string): BoardNode {
    const node = this.nodesById.get(id);
    if (!node) throw new NodeNotFoundError(id);
    return cloneValue(node);
  }

  getNodeIndex(id: string): number | undefined {
    return this.nodeOrder.get(id);
  }

  listNodes(): BoardNode[] {
    return cloneValue(this.document.nodes);
  }

  insertNode(index: number, node: BoardNode): void {
    if (this.nodesById.has(node.id)) {
      throw new DocumentValidationError(`Duplicate node id: ${node.id}`);
    }
    if (!Number.isInteger(index) || index < 0 || index > this.document.nodes.length) {
      throw new RangeError(`Invalid node insertion index: ${index}`);
    }
    this.document.nodes.splice(index, 0, cloneValue(node));
    this.rebuildNodeIndex();
  }

  replaceNode(node: BoardNode): void {
    const index = this.nodeOrder.get(node.id);
    if (index === undefined) throw new NodeNotFoundError(node.id);
    this.document.nodes[index] = cloneValue(node);
    this.nodesById.set(node.id, this.document.nodes[index]);
  }

  removeNode(id: string): BoardNode {
    const index = this.nodeOrder.get(id);
    if (index === undefined) throw new NodeNotFoundError(id);
    const [removed] = this.document.nodes.splice(index, 1);
    this.rebuildNodeIndex();
    return cloneValue(removed);
  }

  getAsset(id: string): AssetRecord | undefined {
    const asset = this.assetsById.get(id);
    return asset ? cloneValue(asset) : undefined;
  }

  getAssetIndex(id: string): number | undefined {
    return this.assetOrder.get(id);
  }

  listAssets(): AssetRecord[] {
    return cloneValue(this.document.assets);
  }

  insertAsset(index: number, asset: AssetRecord): void {
    if (this.assetsById.has(asset.id)) {
      throw new DocumentValidationError(`Duplicate asset id: ${asset.id}`);
    }
    if (!Number.isInteger(index) || index < 0 || index > this.document.assets.length) {
      throw new RangeError(`Invalid asset insertion index: ${index}`);
    }
    this.document.assets.splice(index, 0, cloneValue(asset));
    this.rebuildAssetIndex();
  }

  replaceAsset(asset: AssetRecord): void {
    const index = this.assetOrder.get(asset.id);
    if (index === undefined) {
      throw new DocumentValidationError(`Asset not found: ${asset.id}`);
    }
    this.document.assets[index] = cloneValue(asset);
    this.assetsById.set(asset.id, this.document.assets[index]);
  }

  removeAsset(id: string): AssetRecord {
    const index = this.assetOrder.get(id);
    if (index === undefined) {
      throw new DocumentValidationError(`Asset not found: ${id}`);
    }
    const [removed] = this.document.assets.splice(index, 1);
    this.rebuildAssetIndex();
    return cloneValue(removed);
  }

  private rebuildIndexes(): void {
    this.rebuildNodeIndex();
    this.rebuildAssetIndex();
  }

  private rebuildNodeIndex(): void {
    this.nodesById = new Map();
    this.nodeOrder = new Map();
    this.document.nodes.forEach((node, index) => {
      if (this.nodesById.has(node.id)) {
        throw new DocumentValidationError(`Duplicate node id: ${node.id}`);
      }
      this.nodesById.set(node.id, node);
      this.nodeOrder.set(node.id, index);
    });
  }

  private rebuildAssetIndex(): void {
    this.assetsById = new Map();
    this.assetOrder = new Map();
    this.document.assets.forEach((asset, index) => {
      if (this.assetsById.has(asset.id)) {
        throw new DocumentValidationError(`Duplicate asset id: ${asset.id}`);
      }
      this.assetsById.set(asset.id, asset);
      this.assetOrder.set(asset.id, index);
    });
  }
}
