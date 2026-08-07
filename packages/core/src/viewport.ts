import { assertWorldBounds } from "./geometry";
import type { Point, Size, ViewportSnapshot, WorldBounds } from "./types";

export type ViewportChangeEvent = {
  viewport: ViewportSnapshot;
  previousViewport: ViewportSnapshot;
};

export type FitBoundsOptions = {
  padding?: number;
  maxScale?: number;
  screen?: Size;
};

export class ViewportController {
  private state: ViewportSnapshot;
  private screen: Size;
  private readonly listeners = new Set<(event: ViewportChangeEvent) => void>();

  constructor(
    initial: ViewportSnapshot = { scale: 1, offset: { x: 0, y: 0 } },
    screen: Size = { width: 1, height: 1 },
    private readonly beforeMutation: () => void = () => {},
  ) {
    assertViewport(initial);
    assertSize(screen);
    this.state = cloneViewport(initial);
    this.screen = { ...screen };
  }

  get(): ViewportSnapshot {
    return cloneViewport(this.state);
  }

  set(viewport: ViewportSnapshot): void {
    this.beforeMutation();
    assertViewport(viewport);
    this.commit(viewport);
  }

  setScreenSize(screen: Size): void {
    this.beforeMutation();
    assertSize(screen);
    this.screen = { ...screen };
  }

  panBy(deltaX: number, deltaY: number): void {
    this.beforeMutation();
    assertFinite(deltaX, "deltaX");
    assertFinite(deltaY, "deltaY");
    this.commit({
      scale: this.state.scale,
      offset: {
        x: this.state.offset.x + deltaX,
        y: this.state.offset.y + deltaY,
      },
    });
  }

  zoomAt(screenPoint: Point, factor: number): void {
    this.beforeMutation();
    assertPoint(screenPoint, "screenPoint");
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new RangeError("zoom factor must be finite and greater than zero");
    }
    const worldPoint = this.toWorld(screenPoint);
    const scale = this.state.scale * factor;
    this.commit({
      scale,
      offset: {
        x: screenPoint.x - worldPoint.x * scale,
        y: screenPoint.y - worldPoint.y * scale,
      },
    });
  }

  fitBounds(bounds: WorldBounds, options: FitBoundsOptions = {}): void {
    this.beforeMutation();
    assertWorldBounds(bounds);
    const screen = options.screen ?? this.screen;
    assertSize(screen);
    const padding = options.padding ?? 72;
    const maxScale = options.maxScale ?? 1;
    if (!Number.isFinite(padding) || padding < 0) {
      throw new RangeError("fit padding must be finite and non-negative");
    }
    if (!Number.isFinite(maxScale) || maxScale <= 0) {
      throw new RangeError("fit maxScale must be finite and greater than zero");
    }

    const boundsWidth = Math.max(bounds.maxX - bounds.minX, 1);
    const boundsHeight = Math.max(bounds.maxY - bounds.minY, 1);
    const availableWidth = Math.max(screen.width - padding * 2, 1);
    const availableHeight = Math.max(screen.height - padding * 2, 1);
    const scale = Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight, maxScale);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    this.commit({
      scale,
      offset: {
        x: screen.width / 2 - centerX * scale,
        y: screen.height / 2 - centerY * scale,
      },
    });
  }

  toWorld(screenPoint: Point): Point {
    assertPoint(screenPoint, "screenPoint");
    return {
      x: (screenPoint.x - this.state.offset.x) / this.state.scale,
      y: (screenPoint.y - this.state.offset.y) / this.state.scale,
    };
  }

  toScreen(worldPoint: Point): Point {
    assertPoint(worldPoint, "worldPoint");
    return {
      x: worldPoint.x * this.state.scale + this.state.offset.x,
      y: worldPoint.y * this.state.scale + this.state.offset.y,
    };
  }

  onChange(listener: (event: ViewportChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(viewport: ViewportSnapshot): void {
    assertViewport(viewport);
    const previousViewport = this.get();
    if (
      previousViewport.scale === viewport.scale &&
      previousViewport.offset.x === viewport.offset.x &&
      previousViewport.offset.y === viewport.offset.y
    ) {
      return;
    }
    this.state = cloneViewport(viewport);
    const event = { viewport: this.get(), previousViewport };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Session listeners cannot roll back or corrupt viewport state.
      }
    }
  }
}

function assertViewport(viewport: ViewportSnapshot): void {
  if (!Number.isFinite(viewport.scale) || viewport.scale <= 0) {
    throw new RangeError("viewport scale must be finite and greater than zero");
  }
  assertPoint(viewport.offset, "viewport offset");
}

function assertPoint(point: Point, label: string): void {
  assertFinite(point.x, `${label}.x`);
  assertFinite(point.y, `${label}.y`);
}

function assertSize(size: Size): void {
  if (!Number.isFinite(size.width) || size.width <= 0 || !Number.isFinite(size.height) || size.height <= 0) {
    throw new RangeError("screen size must be finite and greater than zero");
  }
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

function cloneViewport(viewport: ViewportSnapshot): ViewportSnapshot {
  return { scale: viewport.scale, offset: { ...viewport.offset } };
}
