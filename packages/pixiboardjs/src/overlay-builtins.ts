import type { BoardNode, JsonValue } from "@pixi-board/core";
import { attachOverlayLayer, type OverlayLayer } from "./overlay-layer";
import { resolveOverlayBounds, type OverlayAnchor, type OverlayDeclutter, type OverlayScaleMode } from "./overlay-projection";
import type { PixiBoard } from "./types";

export type SelectionOverlayOptions = {
  /** Where outlines are appended. Should sit above the canvas and below handles. */
  container: HTMLElement;
  /** Prefix for the generated class names. Defaults to `pixiboard`. */
  classPrefix?: string;
  /**
   * Also draws a single box around the union of a multi-node selection.
   * Defaults to true.
   */
  groupBox?: boolean;
  /** Padding in CSS pixels between the group box and the selection. */
  groupBoxPadding?: number;
  schedule?(callback: () => void): () => void;
};

/**
 * Draws an outline around every selected node, plus an optional box around a
 * multi-node selection.
 *
 * Outlines are sized in *screen* pixels from the projected corners rather than
 * scaled with `transform`, so the border stays exactly as thick at any zoom —
 * a scaled outline would thin out to invisibility when zoomed out and turn
 * into a slab when zoomed in.
 */
export function attachSelectionOverlay(board: PixiBoard, options: SelectionOverlayOptions): OverlayLayer {
  const prefix = options.classPrefix ?? "pixiboard";
  const padding = options.groupBoxPadding ?? 6;
  const groupBox = options.groupBox ?? true;
  const outlineClass = `${prefix}-selection-outline`;
  const groupClass = `${prefix}-selection-bbox`;

  let groupElement: HTMLElement | undefined;

  const drawGroupBox = (): void => {
    if (!groupBox) return;
    const nodes = board.selection.get()
      .map((id) => board.nodes.get(id))
      .filter(Boolean) as Array<Readonly<BoardNode<JsonValue>>>;
    if (nodes.length < 2) {
      groupElement?.remove();
      groupElement = undefined;
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      // Both corners come from the same resolved bounds the outlines use. A
      // rotated node's bounds do not start at node.x/node.y, so taking the
      // origin from one frame and the extent from another would leave the box
      // displaced from the outlines it is meant to enclose.
      const bounds = resolveOverlayBounds(node, board.nodeTypes);
      const topLeft = board.viewport.toScreen({ x: bounds.minX, y: bounds.minY });
      const bottomRight = board.viewport.toScreen({ x: bounds.maxX, y: bounds.maxY });
      minX = Math.min(minX, topLeft.x);
      minY = Math.min(minY, topLeft.y);
      maxX = Math.max(maxX, bottomRight.x);
      maxY = Math.max(maxY, bottomRight.y);
    }
    if (!groupElement) {
      groupElement = document.createElement("div");
      groupElement.className = groupClass;
      groupElement.style.position = "absolute";
      groupElement.style.top = "0";
      groupElement.style.left = "0";
      groupElement.style.transformOrigin = "0 0";
      options.container.appendChild(groupElement);
    }
    groupElement.style.transform = `translate3d(${minX - padding}px, ${minY - padding}px, 0)`;
    groupElement.style.width = `${maxX - minX + padding * 2}px`;
    groupElement.style.height = `${maxY - minY + padding * 2}px`;
  };

  const layer = attachOverlayLayer(board, {
    container: options.container,
    itemClassName: outlineClass,
    schedule: options.schedule,
    // Selection outlines follow the selection, not the viewport: a selected
    // node scrolled just off screen must keep its outline, so this
    // deliberately opts out of visible-set culling.
    candidates: () => board.selection.get(),
    item: () => ({ anchor: "top-left" }),
    render: ({ element, node }) => {
      const size = screenSize(board, node);
      element.style.width = `${size.width}px`;
      element.style.height = `${size.height}px`;
    },
    // Runs inside the same batched frame as the outlines, so the group box can
    // never be drawn against a stale selection.
    onFlush: drawGroupBox,
  });

  return {
    refresh: layer.refresh,
    flush: layer.flush,
    size: () => layer.size() + (groupElement ? 1 : 0),
    destroy() {
      layer.destroy();
      groupElement?.remove();
      groupElement = undefined;
    },
  };
}

export type LabelOverlayOptions = {
  container: HTMLElement;
  /**
   * The text for a node, or undefined for "no label here". Defaults to the
   * node's `name`, falling back to its type.
   */
  text?(node: Readonly<BoardNode<JsonValue>>): string | undefined;
  /** An optional icon or prefix element content, rendered before the text. */
  icon?(node: Readonly<BoardNode<JsonValue>>): string | undefined;
  classPrefix?: string;
  /** Defaults to `bottom-left`, i.e. hanging under the node. */
  anchor?: OverlayAnchor;
  /** Screen-pixel offset from the anchor. Defaults to 6px below. */
  offset?: { x: number; y: number };
  /** Defaults to `screen`: a label describes content without being content. */
  scale?: OverlayScaleMode;
  /** Defaults to hiding below 0.25 and collapsing below 0.5. */
  declutter?: OverlayDeclutter;
  schedule?(callback: () => void): () => void;
};

const DEFAULT_LABEL_DECLUTTER: OverlayDeclutter = { minScale: 0.25, collapseBelowScale: 0.5 };

/**
 * Labels nodes with a name and optional icon.
 *
 * Unlike selection outlines this *does* follow the visible set: labels are
 * pure decoration for what is on screen, and a document with 100k media nodes
 * must not put 100k elements in the DOM.
 */
export function attachLabelOverlay(board: PixiBoard, options: LabelOverlayOptions): OverlayLayer {
  const prefix = options.classPrefix ?? "pixiboard";
  const text = options.text ?? ((node) => node.name ?? node.type);
  const offset = options.offset ?? { x: 0, y: 6 };

  return attachOverlayLayer(board, {
    container: options.container,
    itemClassName: `${prefix}-label`,
    collapsedClassName: `${prefix}-label-collapsed`,
    schedule: options.schedule,
    item: (node) => {
      const value = text(node);
      if (value === undefined) return undefined;
      return {
        anchor: options.anchor ?? "bottom-left",
        offset,
        scale: options.scale ?? "screen",
        declutter: options.declutter ?? DEFAULT_LABEL_DECLUTTER,
        data: value,
      };
    },
    render: ({ element, placement, node }) => {
      const icon = options.icon?.(node);
      // Collapsed labels keep their element (so the pool and the DOM order
      // stay stable) but drop the text, which is what makes a dense zoomed-out
      // board readable instead of a wall of overlapping names.
      if (placement.collapsed) {
        element.textContent = icon ?? "";
        return;
      }
      element.textContent = "";
      if (icon !== undefined) {
        const iconElement = document.createElement("span");
        iconElement.className = `${prefix}-label-icon`;
        iconElement.textContent = icon;
        element.appendChild(iconElement);
      }
      const textElement = document.createElement("span");
      textElement.className = `${prefix}-label-text`;
      textElement.textContent = String(placement.data);
      element.appendChild(textElement);
    },
  });
}

/** A node's on-screen size, derived from the same bounds the renderer culls with. */
function screenSize(board: PixiBoard, node: Readonly<BoardNode<JsonValue>>): { width: number; height: number } {
  const bounds = resolveOverlayBounds(node, board.nodeTypes);
  const scale = board.viewport.get().scale;
  return {
    width: (bounds.maxX - bounds.minX) * scale,
    height: (bounds.maxY - bounds.minY) * scale,
  };
}
