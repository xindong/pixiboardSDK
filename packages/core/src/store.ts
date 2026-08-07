import { DocumentValidationError, NodeNotFoundError } from "./errors";
import { cloneValue, immutableClone } from "./json";
import type { AssetRecord, BoardDocument, BoardNode } from "./types";

export class RuntimeDocumentStore {
  private document: BoardDocument;
  private nodesById = new Map<string, BoardNode>();
  private nodeOrder = new Map<string, number>();
  private assetsById = new Map<string, AssetRecord>();
  private assetOrder = new Map<string, number>();
  private nodeOverrides = new Map<string, BoardNode>();
  private assetOverrides = new Map<string, AssetRecord>();
  private nodeOverridesShared = false;
  private assetOverridesShared = false;
  private nodesShared = false;
  private assetsShared = false;

  constructor(document: BoardDocument) {
    this.document = cloneValue(document);
    this.rebuildIndexes();
  }

  clone(): RuntimeDocumentStore {
    const clone = Object.create(RuntimeDocumentStore.prototype) as RuntimeDocumentStore;
    clone.document = { ...this.document, nodes: this.document.nodes, assets: this.document.assets };
    clone.nodesById = this.nodesById;
    clone.nodeOrder = this.nodeOrder;
    clone.assetsById = this.assetsById;
    clone.assetOrder = this.assetOrder;
    clone.nodeOverrides = this.nodeOverrides;
    clone.assetOverrides = this.assetOverrides;
    clone.nodeOverridesShared = true;
    clone.assetOverridesShared = true;
    clone.nodesShared = true;
    clone.assetsShared = true;
    return clone;
  }

  snapshot(): Readonly<BoardDocument> {
    return immutableClone(this.materializedDocument());
  }

  mutableSnapshot(): BoardDocument {
    return cloneValue(this.materializedDocument());
  }

  get revision(): number {
    return this.document.revision;
  }

  set revision(value: number) {
    this.document.revision = value;
  }

  getNode(id: string): BoardNode | undefined {
    const node = this.getNodeReference(id);
    return node ? cloneValue(node) : undefined;
  }

  getNodeReference(id: string): BoardNode | undefined {
    return this.nodeOverrides.get(id) ?? this.nodesById.get(id);
  }

  requireNode(id: string): BoardNode {
    const node = this.getNodeReference(id);
    if (!node) throw new NodeNotFoundError(id);
    return cloneValue(node);
  }

  getNodeIndex(id: string): number | undefined {
    return this.nodeOrder.get(id);
  }

  listNodes(): BoardNode[] {
    return cloneValue(this.materializedNodes());
  }

  nodeCount(): number {
    return this.document.nodes.length;
  }

  forEachNodeReference(callback: (node: BoardNode) => void): void {
    for (const node of this.document.nodes) callback(this.nodeOverrides.get(node.id) ?? node);
  }

  insertNode(index: number, node: BoardNode): void {
    if (this.getNodeReference(node.id)) {
      throw new DocumentValidationError(`Duplicate node id: ${node.id}`);
    }
    if (!Number.isInteger(index) || index < 0 || index > this.document.nodes.length) {
      throw new RangeError(`Invalid node insertion index: ${index}`);
    }
    this.materializeNodesInPlace();
    this.document.nodes.splice(index, 0, cloneValue(node));
    this.rebuildNodeIndex();
  }

  replaceNode(node: BoardNode): void {
    const index = this.nodeOrder.get(node.id);
    if (index === undefined) throw new NodeNotFoundError(node.id);
    this.ensureNodeOverridesMutable();
    this.nodeOverrides.set(node.id, cloneValue(node));
  }

  removeNode(id: string): BoardNode {
    const index = this.getNodeIndex(id);
    if (index === undefined) throw new NodeNotFoundError(id);
    this.materializeNodesInPlace();
    const [removed] = this.document.nodes.splice(index, 1);
    this.rebuildNodeIndex();
    return cloneValue(removed);
  }

  getAsset(id: string): AssetRecord | undefined {
    const asset = this.getAssetReference(id);
    return asset ? cloneValue(asset) : undefined;
  }

  getAssetReference(id: string): AssetRecord | undefined {
    return this.assetOverrides.get(id) ?? this.assetsById.get(id);
  }

  getAssetIndex(id: string): number | undefined {
    return this.assetOrder.get(id);
  }

  listAssets(): AssetRecord[] {
    return cloneValue(this.materializedAssets());
  }

  assetCount(): number {
    return this.document.assets.length;
  }

  insertAsset(index: number, asset: AssetRecord): void {
    if (this.getAssetReference(asset.id)) {
      throw new DocumentValidationError(`Duplicate asset id: ${asset.id}`);
    }
    if (!Number.isInteger(index) || index < 0 || index > this.document.assets.length) {
      throw new RangeError(`Invalid asset insertion index: ${index}`);
    }
    this.materializeAssetsInPlace();
    this.document.assets.splice(index, 0, cloneValue(asset));
    this.rebuildAssetIndex();
  }

  replaceAsset(asset: AssetRecord): void {
    const index = this.assetOrder.get(asset.id);
    if (index === undefined) {
      throw new DocumentValidationError(`Asset not found: ${asset.id}`);
    }
    this.ensureAssetOverridesMutable();
    this.assetOverrides.set(asset.id, cloneValue(asset));
  }

  removeAsset(id: string): AssetRecord {
    const index = this.getAssetIndex(id);
    if (index === undefined) {
      throw new DocumentValidationError(`Asset not found: ${id}`);
    }
    this.materializeAssetsInPlace();
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

  private ensureNodeOverridesMutable(): void {
    if (!this.nodeOverridesShared) return;
    this.nodeOverrides = new Map(this.nodeOverrides);
    this.nodeOverridesShared = false;
  }

  private ensureAssetOverridesMutable(): void {
    if (!this.assetOverridesShared) return;
    this.assetOverrides = new Map(this.assetOverrides);
    this.assetOverridesShared = false;
  }

  private materializeNodesInPlace(): void {
    if (this.nodeOverrides.size === 0 && !this.nodesShared) return;
    this.document = { ...this.document, nodes: this.materializedNodes().slice() };
    this.nodeOverrides = new Map();
    this.nodeOverridesShared = false;
    this.nodesShared = false;
    this.rebuildNodeIndex();
  }

  private materializeAssetsInPlace(): void {
    if (this.assetOverrides.size === 0 && !this.assetsShared) return;
    this.document = { ...this.document, assets: this.materializedAssets().slice() };
    this.assetOverrides = new Map();
    this.assetOverridesShared = false;
    this.assetsShared = false;
    this.rebuildAssetIndex();
  }

  private materializedNodes(): BoardNode[] {
    if (this.nodeOverrides.size === 0) return this.document.nodes;
    return this.document.nodes.map((node) => this.nodeOverrides.get(node.id) ?? node);
  }

  private materializedAssets(): AssetRecord[] {
    if (this.assetOverrides.size === 0) return this.document.assets;
    return this.document.assets.map((asset) => this.assetOverrides.get(asset.id) ?? asset);
  }

  private materializedDocument(): BoardDocument {
    return {
      ...this.document,
      nodes: this.materializedNodes(),
      assets: this.materializedAssets(),
    };
  }
}
