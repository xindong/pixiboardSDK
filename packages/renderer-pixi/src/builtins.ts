import { rotatedRectBounds, type BoardNode, type JsonValue } from "@pixi-board/core";
import type { NodeRendererRegistry } from "./registry";
import type { PixiNodeRenderer, PixiNodeView } from "./types";
const base = <State>(create: PixiNodeRenderer<any, State>["create"], update: PixiNodeRenderer<any, State>["update"]): PixiNodeRenderer<any, State> => ({ create, update, destroy(view) { view.displayObject.destroy?.({ children: true }); } });
export function registerBuiltinRenderers(registry: NodeRendererRegistry): void {
  if (!registry.has("rect")) registry.register("rect", base((node, ctx) => ({ displayObject: ctx.display.createRect?.(node.width, node.height, (node.props as any)?.fill ?? 0x7c8cf8) ?? ctx.display.createContainer(), state: {} }), (view, node) => applyTransform(view, node)));
  registerTextureNode(registry, "image", ["preview", "image", "primary", "source"]);
  registerTextureNode(registry, "video", ["preview", "poster", "video", "primary", "source"]);
  registerTextureNode(registry, "audio", ["waveform", "preview", "audio", "primary", "source"]);
  if (!registry.has("text")) registry.register("text", base(
    (node, ctx) => ({ displayObject: ctx.display.createText?.(textValue(node), textStyle(node)) ?? ctx.display.createContainer(), state: {} }),
    (view, node) => {
      applyTransform(view, node);
      view.displayObject.text = textValue(node);
      const style = textStyle(node);
      if (style) view.displayObject.style = style;
    },
  ));
  if (!registry.has("unknown-node")) registry.register("unknown-node", base((node, ctx) => ({ displayObject: ctx.display.createText?.(`${node.type}\n${node.id}`, { fill: 0x9ca3af }) ?? ctx.display.createContainer(), state: {} }), (view, node) => applyTransform(view, node)));
}
function registerTextureNode(registry: NodeRendererRegistry, type: string, refNames: string[]): void {
  if (registry.has(type)) return;
  registry.register(type, {
    async create(node, ctx) {
      const ref = refNames.map((name) => node.assetRefs?.[name]).find(Boolean);
      const lease = ref ? await ctx.assets.acquireTexture(ref, { kind: type }) : undefined;
      if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const displayObject = await ctx.display.createImage?.(ref, node) ?? ctx.display.createContainer();
      if (lease?.texture !== undefined) displayObject.texture = lease.texture;
      displayObject.mediaKind = type;
      return { displayObject, state: { lease, ref } };
    },
    update(view, node) { applyTransform(view, node); },
    destroy(view) { view.displayObject.destroy?.({ children: true }); },
  });
}
function textValue(node: Readonly<BoardNode<JsonValue>>): string {
  const props = node.props as Record<string, JsonValue>;
  const value = props.text ?? props.content ?? props.value ?? node.name ?? "";
  return typeof value === "string" ? value : JSON.stringify(value);
}
function textStyle(node: Readonly<BoardNode<JsonValue>>): Record<string, unknown> | undefined {
  const style = (node.props as Record<string, JsonValue>).style;
  return style && typeof style === "object" && !Array.isArray(style) ? style as Record<string, unknown> : undefined;
}
function applyTransform(view: PixiNodeView, node: Readonly<BoardNode<JsonValue>>): void { const d = view.displayObject; d.x = node.x; d.y = node.y; d.rotation = node.rotation; d.zIndex = node.zIndex; d.width = node.width; d.height = node.height; }
export function defaultBounds(node: BoardNode): ReturnType<typeof rotatedRectBounds> { return rotatedRectBounds(node); }
