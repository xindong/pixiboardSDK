import { Container, Graphics } from "pixi.js";
import { GridSpatialIndex } from "./spatial";
import type { Point, WorldBounds } from "@pixi-board/core";

import type { ConnectionCurve, ConnectionStyle } from "@pixi-board/core";
export type { ConnectionCurve, ConnectionStyle } from "@pixi-board/core";

export const defaultConnectionStyle: ConnectionStyle = {
  startColor: "#6366f1",
  endColor: "#06b6d4",
  startOpacity: 1,
  endOpacity: 1,
  width: 2,
  lineType: "solid",
};

const PREVIEW_ID = "__connection_preview__";
const GRADIENT_STEP = 6;
const SELECTION_PADDING = 2;

type PathSample = Point & { distance: number };
type ConnectionEntry = { view: Graphics; points: PathSample[]; length: number; keys: string[] };
type ConnectionSegment = { id: string; a: Point; b: Point };

/** One world-space layer: pan/zoom use the parent's matrix, never regenerate paths. */
export class ConnectionRenderLayer {
  readonly container = new Container();
  private readonly entries = new Map<string, ConnectionEntry>();
  private readonly index = new GridSpatialIndex();
  private readonly segments = new Map<string, ConnectionSegment>();
  private visibleIds = new Set<string>();
  private visible = true;
  private selected?: string;
  private style: ConnectionStyle = { ...defaultConnectionStyle };
  private bounds?: WorldBounds;
  private destroyed = false;

  constructor(private invalidate: () => void, private detach: () => void) {
    this.container.zIndex = -1_000_000;
    this.container.eventMode = "none";
  }

  setStyle(style: Partial<ConnectionStyle>): void {
    if (this.destroyed) return;
    this.style = normalizeConnectionStyle({ ...this.style, ...style });
    for (const [id, entry] of this.entries) this.draw(entry, id === this.selected);
    this.setVisibleBounds(this.bounds);
    this.invalidate();
  }

  setSelected(id?: string): void {
    if (this.destroyed) return;
    const next = id === PREVIEW_ID ? undefined : id;
    if (this.selected === next) return;
    const previous = this.selected;
    this.selected = next;
    for (const key of [previous, next]) {
      const entry = key === undefined ? undefined : this.entries.get(key);
      if (entry) this.draw(entry, key === next);
    }
    this.invalidate();
  }

  setEnabled(enabled: boolean): void {
    if (this.destroyed) return;
    this.visible = enabled;
    this.container.visible = enabled;
    this.invalidate();
  }

  setVisibleBounds(bounds?: WorldBounds): void {
    if (this.destroyed) return;
    this.bounds = bounds ? { ...bounds } : undefined;
    const next = new Set<string>();
    if (this.bounds) {
      for (const key of this.index.query(this.paddedBounds(this.bounds))) {
        const segment = this.segments.get(key);
        if (segment) next.add(segment.id);
      }
    } else {
      for (const id of this.entries.keys()) next.add(id);
    }
    // Panning touches only views that were or will be visible, never every entry.
    for (const id of new Set([...this.visibleIds, ...next])) {
      const entry = this.entries.get(id);
      if (entry) entry.view.visible = next.has(id);
    }
    this.visibleIds = next;
  }

  upsert(curve: ConnectionCurve): void {
    if (this.destroyed) return;
    this.disposeEntry(curve.id);
    const points = sampleCurve(curve);
    const view = new Graphics();
    const keys: string[] = [];
    const bounds = this.bounds ? this.paddedBounds(this.bounds) : undefined;
    let visible = !bounds;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const key = JSON.stringify([curve.id, i]);
      const segmentBounds = {
        minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y),
      };
      keys.push(key);
      this.segments.set(key, { id: curve.id, a, b });
      this.index.insert({ id: key, ...segmentBounds });
      if (bounds && intersects(segmentBounds, bounds)) visible = true;
    }
    const entry = { view, points, length: points[points.length - 1]!.distance, keys };
    this.entries.set(curve.id, entry);
    this.container.addChild(view);
    view.visible = visible;
    if (visible) this.visibleIds.add(curve.id);
    this.draw(entry, curve.id === this.selected);
    this.invalidate();
  }

  remove(id: string): void {
    if (this.destroyed || !this.entries.has(id)) return;
    this.disposeEntry(id);
    this.invalidate();
  }

  hitTest(point: Point, tolerance: number): string | undefined {
    if (this.destroyed || !this.visible || !Number.isFinite(tolerance) || tolerance < 0) return;
    let nearest: string | undefined;
    let nearestDistance = tolerance;
    const bounds = {
      minX: point.x - tolerance, minY: point.y - tolerance,
      maxX: point.x + tolerance, maxY: point.y + tolerance,
    };
    for (const key of this.index.query(bounds)) {
      const segment = this.segments.get(key);
      if (!segment || segment.id === PREVIEW_ID || !this.visibleIds.has(segment.id)) continue;
      const { a, b } = segment;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1,
        ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ));
      const distance = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
      if (distance <= nearestDistance) {
        nearest = segment.id;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const id of this.entries.keys()) this.disposeEntry(id);
    this.detach();
    this.container.destroy({ children: true });
    this.invalidate();
  }

  private disposeEntry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    for (const key of entry.keys) {
      this.index.remove(key);
      this.segments.delete(key);
    }
    this.visibleIds.delete(id);
    this.entries.delete(id);
    entry.view.destroy();
  }

  private paddedBounds(bounds: WorldBounds): WorldBounds {
    const padding = this.style.width / 2 + SELECTION_PADDING;
    return {
      minX: bounds.minX - padding, minY: bounds.minY - padding,
      maxX: bounds.maxX + padding, maxY: bounds.maxY + padding,
    };
  }

  private draw(entry: ConnectionEntry, selected: boolean): void {
    const { view, points, length } = entry;
    const style = this.style;
    view.clear();
    if (length === 0) return;
    const startColor = parseInt(style.startColor.slice(1), 16);
    const endColor = parseInt(style.endColor.slice(1), 16);
    const colorAt = (distance: number) => {
      const t = distance / length;
      const channel = (shift: number) => Math.round(
        ((startColor >> shift) & 255) * (1 - t) + ((endColor >> shift) & 255) * t,
      );
      return (channel(16) << 16) | (channel(8) << 8) | channel(0);
    };
    const alphaAt = (distance: number) => {
      const t = distance / length;
      return style.startOpacity * (1 - t) + style.endOpacity * t;
    };

    // Draw the entire highlight first so subsequent gradient pieces cannot cover it.
    for (const highlight of selected ? [true, false] : [false]) {
      const width = style.width + (highlight ? SELECTION_PADDING * 2 : 0);
      const color = (distance: number) => highlight ? 0xffffff : colorAt(distance);
      const alpha = (distance: number) => highlight ? 0.85 : alphaAt(distance);
      if (style.lineType === "dotted") {
        // Dots have fixed arc-length centers, independent of Bezier sampling density.
        const spacing = Math.max(8, style.width * 2);
        let cursor = 1;
        for (let distance = 0; distance <= length; distance += spacing) {
          while (cursor < points.length - 1 && points[cursor]!.distance < distance) cursor++;
          const point = pointAtDistance(points[cursor - 1]!, points[cursor]!, distance);
          view.circle(point.x, point.y, width / 2).fill({ color: color(distance), alpha: alpha(distance) });
        }
        continue;
      }

      // Split at both pattern boundaries and gradient intervals, never skip samples.
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        let distance = a.distance;
        while (distance < b.distance) {
          const period = Math.floor(distance / 24);
          const dashEnd = period * 24 + 15;
          const painted = style.lineType === "solid" || distance < dashEnd;
          const patternEnd = style.lineType === "solid" ? b.distance
            : painted ? dashEnd : (period + 1) * 24;
          const end = Math.min(b.distance, patternEnd, distance + GRADIENT_STEP);
          if (painted) {
            const p = pointAtDistance(a, b, distance);
            const q = pointAtDistance(a, b, end);
            const middle = (distance + end) / 2;
            view.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({
              width, color: color(middle), alpha: alpha(middle), cap: "butt",
            });
          }
          distance = end;
        }
      }
    }
  }
}

function sampleCurve(curve: ConnectionCurve): PathSample[] {
  const distance = Math.max(48, Math.min(400, Math.abs(curve.end.x - curve.start.x) * 0.5));
  const a = curve.start;
  const d = curve.end;
  const b = {
    x: a.x + (curve.startDirection?.x ?? 1) * distance,
    y: a.y + (curve.startDirection?.y ?? 0) * distance,
  };
  const c = {
    x: d.x - (curve.endDirection?.x ?? 1) * distance,
    y: d.y - (curve.endDirection?.y ?? 0) * distance,
  };
  const estimate = Math.hypot(b.x - a.x, b.y - a.y)
    + Math.hypot(c.x - b.x, c.y - b.y) + Math.hypot(d.x - c.x, d.y - c.y);
  const count = Math.max(24, Math.min(192, Math.ceil(estimate / 12)));
  const points: PathSample[] = [];
  let length = 0;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const u = 1 - t;
    const point = {
      x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
      y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
    };
    const previous = points[points.length - 1];
    if (previous) length += Math.hypot(point.x - previous.x, point.y - previous.y);
    points.push({ ...point, distance: length });
  }
  return points;
}

function pointAtDistance(a: PathSample, b: PathSample, distance: number): Point {
  const t = b.distance === a.distance ? 0 : (distance - a.distance) / (b.distance - a.distance);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function intersects(a: WorldBounds, b: WorldBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function normalizeConnectionStyle(value: ConnectionStyle): ConnectionStyle {
  const color = (v: string, fallback: string) => /^#[\da-f]{6}$/i.test(v) ? v : fallback;
  const finite = (v: number, fallback: number) => Number.isFinite(v) ? v : fallback;
  return {
    startColor: color(value.startColor, defaultConnectionStyle.startColor),
    endColor: color(value.endColor, defaultConnectionStyle.endColor),
    startOpacity: Math.min(1, Math.max(0, finite(value.startOpacity, 1))),
    endOpacity: Math.min(1, Math.max(0, finite(value.endOpacity, 1))),
    width: Math.min(32, Math.max(0.5, finite(value.width, 2))),
    lineType: ["solid", "dashed", "dotted"].includes(value.lineType) ? value.lineType : "solid",
  };
}
