import { rotatedRectBounds, type BoardNode, type JsonValue } from "@pixi-board/core";
import type { NodeRendererRegistry } from "./registry";
import type { PixiNodeRenderer, PixiNodeView } from "./types";
const base = <State>(create: PixiNodeRenderer<any, State>["create"], update: PixiNodeRenderer<any, State>["update"]): PixiNodeRenderer<any, State> => ({ create, update, destroy(view) { view.displayObject.destroy?.({ children: true }); } });
export function registerBuiltinRenderers(registry: NodeRendererRegistry): void {
  if (!registry.has("rect")) registry.register("rect", base((node, ctx) => ({ displayObject: ctx.display.createRect?.(node.width, node.height, (node.props as any)?.fill ?? 0x7c8cf8) ?? ctx.display.createContainer(), state: {} }), (view, node) => applyTransform(view, node)));
  if (!registry.has("image")) registry.register("image", {
    async create(node, ctx) {
      const ref = node.assetRefs?.image ?? node.assetRefs?.source;
      const lease = ref ? await ctx.assets.acquireTexture(ref) : undefined;
      if (ctx.signal.aborted) { lease?.release?.(); throw new DOMException("Aborted", "AbortError"); }
      const displayObject = await ctx.display.createImage?.(ref, node) ?? ctx.display.createContainer();
      if (lease?.texture !== undefined) displayObject.texture = lease.texture;
      return { displayObject, state: { lease } };
    },
    update(view, node) { applyTransform(view, node); },
    destroy(view) { (view.state as { lease?: { release?: () => void } }).lease?.release?.(); view.displayObject.destroy?.({ children: true }); },
  });
  if (!registry.has("unknown-node")) registry.register("unknown-node", base((node, ctx) => ({ displayObject: ctx.display.createText?.(`${node.type}\n${node.id}`, { fill: 0x9ca3af }) ?? ctx.display.createContainer(), state: {} }), (view, node) => applyTransform(view, node)));
}
function applyTransform(view: PixiNodeView, node: Readonly<BoardNode<JsonValue>>): void { const d = view.displayObject; d.x = node.x; d.y = node.y; d.rotation = node.rotation; d.zIndex = node.zIndex; }
export function defaultBounds(node: BoardNode): ReturnType<typeof rotatedRectBounds> { return rotatedRectBounds(node); }
