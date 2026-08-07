import type { BoardNode, Point, WorldBounds } from "./types";

export function rotatedRectBounds(node: BoardNode): WorldBounds {
  const cos = Math.cos(node.rotation);
  const sin = Math.sin(node.rotation);
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: node.width, y: 0 },
    { x: node.width, y: node.height },
    { x: 0, y: node.height },
  ].map((point) => ({
    x: node.x + point.x * cos - point.y * sin,
    y: node.y + point.x * sin + point.y * cos,
  }));

  return {
    minX: Math.min(...corners.map(({ x }) => x)),
    minY: Math.min(...corners.map(({ y }) => y)),
    maxX: Math.max(...corners.map(({ x }) => x)),
    maxY: Math.max(...corners.map(({ y }) => y)),
  };
}

export function mergeBounds(bounds: WorldBounds[]): WorldBounds | undefined {
  if (bounds.length === 0) return undefined;
  return {
    minX: Math.min(...bounds.map(({ minX }) => minX)),
    minY: Math.min(...bounds.map(({ minY }) => minY)),
    maxX: Math.max(...bounds.map(({ maxX }) => maxX)),
    maxY: Math.max(...bounds.map(({ maxY }) => maxY)),
  };
}

export function assertWorldBounds(bounds: WorldBounds, label = "bounds"): void {
  const values = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
  if (!values.every(Number.isFinite) || bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) {
    throw new RangeError(`${label} must be finite and normalized`);
  }
}
