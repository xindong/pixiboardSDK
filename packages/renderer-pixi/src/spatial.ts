import type { Point, SpatialIndex, SpatialIndexItem, WorldBounds } from "./types";

/** A deterministic uniform grid. Queries only inspect intersecting buckets. */
export class GridSpatialIndex implements SpatialIndex {
  private readonly cells = new Map<string, Map<string, SpatialIndexItem>>();
  private readonly items = new Map<string, SpatialIndexItem>();
  private readonly cellSize: number;

  constructor(cellSize = 256) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError("cellSize must be positive");
    this.cellSize = cellSize;
  }

  rebuild(items: readonly SpatialIndexItem[]): void {
    this.cells.clear();
    this.items.clear();
    for (const item of items) this.insert(item);
  }

  insert(item: SpatialIndexItem): void {
    this.remove(item.id);
    const copy = { ...item };
    this.items.set(copy.id, copy);
    for (const key of this.keys(copy)) {
      let bucket = this.cells.get(key);
      if (!bucket) this.cells.set(key, (bucket = new Map()));
      bucket.set(copy.id, copy);
    }
  }

  update(item: SpatialIndexItem): void { this.insert(item); }

  remove(id: string): void {
    const previous = this.items.get(id);
    if (!previous) return;
    this.items.delete(id);
    for (const key of this.keys(previous)) {
      const bucket = this.cells.get(key);
      bucket?.delete(id);
      if (bucket?.size === 0) this.cells.delete(key);
    }
  }

  query(bounds: WorldBounds): Iterable<string> {
    const result = new Set<string>();
    for (const key of this.keys(bounds)) {
      for (const item of this.cells.get(key)?.values() ?? []) if (intersects(item, bounds)) result.add(item.id);
    }
    return result;
  }

  queryPoint(point: Point): Iterable<string> {
    const key = this.key(Math.floor(point.x / this.cellSize), Math.floor(point.y / this.cellSize));
    const result = new Set<string>();
    for (const item of this.cells.get(key)?.values() ?? []) if (contains(item, point)) result.add(item.id);
    return result;
  }

  private *keys(bounds: WorldBounds): Iterable<string> {
    const minX = Math.floor(bounds.minX / this.cellSize);
    const maxX = Math.floor(bounds.maxX / this.cellSize);
    const minY = Math.floor(bounds.minY / this.cellSize);
    const maxY = Math.floor(bounds.maxY / this.cellSize);
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) yield this.key(x, y);
  }

  private key(x: number, y: number): string { return `${x}:${y}`; }
}

function intersects(a: WorldBounds, b: WorldBounds): boolean { return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY; }
function contains(a: WorldBounds, p: Point): boolean { return p.x >= a.minX && p.x <= a.maxX && p.y >= a.minY && p.y <= a.maxY; }
