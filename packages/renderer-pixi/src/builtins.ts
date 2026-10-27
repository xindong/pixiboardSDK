import {
  fitMediaRect,
  readIntrinsicSize,
  resolveTextureAssetRef,
  rotatedRectBounds,
  type AssetRef,
  type BoardNode,
  type ContentFit,
  type JsonValue,
} from "@pixi-board/core";
import type { NodeRendererRegistry } from "./registry";
import type { PixiDisplayObject, PixiNodeRenderer, PixiNodeView, TextureLease } from "./types";

type TextureState = {
  surface?: PixiDisplayObject;
  content: PixiDisplayObject;
  image: PixiDisplayObject;
  clip?: PixiDisplayObject;
  lease?: TextureLease;
  ref?: AssetRef;
  naturalWidth?: number;
  naturalHeight?: number;
  retryAttempt?: number;
  retryAt?: number;
  retry?: Promise<void>;
};

const TEXTURE_RETRY_BASE_MS = 1_000;
const TEXTURE_RETRY_MAX_MS = 30_000;

const base = <State>(create: PixiNodeRenderer<any, State>["create"], update: PixiNodeRenderer<any, State>["update"]): PixiNodeRenderer<any, State> => ({ create, update, destroy(view) { view.displayObject.destroy?.({ children: true }); } });
export function registerBuiltinRenderers(registry: NodeRendererRegistry): void {
  if (!registry.has("rect")) registry.register("rect", base((node, ctx) => ({ displayObject: ctx.display.createRect?.(node.width, node.height, (node.props as any)?.fill ?? 0x7c8cf8) ?? ctx.display.createContainer(), state: {} }), (view, node) => applyTransform(view, node)));
  // Texture roles live in core so importers and renderers cannot drift back
  // toward decoding original video, audio, model, or document bytes.
  for (const type of ["image", "video", "audio", "model", "html", "markdown", "text-file", "file"] as const) registerTextureNode(registry, type);
  if (!registry.has("text")) registry.register("text", {
    create(node, ctx) {
      const displayObject = ctx.display.createContainer();
      const text = ctx.display.createText?.(textValue(node), textStyle(node, node.width));
      if (text) displayObject.addChild?.(text);
      return { displayObject, state: { text } };
    },
    update(view, node) {
      applyPlacement(view, node);
      const text = view.state.text;
      if (!text) return;
      text.text = textValue(node);
      const style = textStyle(node, node.width);
      if (style) text.style = style;
    },
    destroy(view) { view.displayObject.destroy?.({ children: true }); },
  });
  if (!registry.has("unknown-node")) registry.register("unknown-node", base((node, ctx) => ({ displayObject: ctx.display.createText?.(`${node.type}\n${node.id}`, { fill: 0x9ca3af }) ?? ctx.display.createContainer(), state: {} }), (view, node) => applyTransform(view, node)));
}
function registerTextureNode(registry: NodeRendererRegistry, type: string): void {
  if (registry.has(type)) return;
  registry.register(type, {
    async create(node, ctx) {
      const ref = resolveTextureAssetRef(node, type);
      // No suitable role means there is nothing image-decodable to acquire. A
      // decoder failure is also non-fatal: keep a stable empty media view so a
      // later preview-ready asset change can recover without breaking rebuild.
      let retryAt: number | undefined;
      const lease = ref
        ? await ctx.assets.acquireTexture(ref, { kind: type }).catch((error) => {
          if (ctx.signal.aborted) throw error;
          // Allow the next same-ref update to retry immediately; only repeated
          // failures enter the backoff window.
          retryAt = 0;
          return undefined;
        })
        : undefined;
      if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const displayObject = ctx.display.createContainer();
      // A fixed backing surface gives every built-in a stable node-sized target
      // for hit testing, capture and future child masking without changing the
      // content's independent aspect ratio.
      const surface = ctx.display.createRect?.(node.width, node.height, 0x000000);
      if (surface) {
        surface.alpha = 0;
        displayObject.addChild?.(surface);
      }
      const content = ctx.display.createContainer();
      const image = await ctx.display.createImage?.(ref, node) ?? ctx.display.createContainer();
      if (lease?.texture !== undefined) image.texture = lease.texture;
      // Keep the lease visible on the root view for callers that inspect the
      // active texture. The root is also the stable placement/culling object.
      if (lease?.texture !== undefined) displayObject.texture = lease.texture;
      content.addChild?.(image);
      displayObject.addChild?.(content);
      displayObject.mediaKind = type;
      const dimensions = textureDimensions(image, lease);
      const clip = ctx.display.createRect?.(1, 1, 0xffffff);
      if (clip) {
        // Pixi skips invisible objects while building a stencil mask. The clip
        // is hidden again for non-cover fits by applyMediaGeometry.
        clip.visible = true;
        content.addChild?.(clip);
      }
      const state: TextureState = {
        surface,
        content,
        image,
        clip,
        lease,
        ref,
        naturalWidth: dimensions.width,
        naturalHeight: dimensions.height,
        retryAt,
      };
      applyMediaGeometry(displayObject, state, node);
      return { displayObject, state };
    },
    async update(view, node, ctx) {
      const state = view.state as TextureState;
      applyMediaGeometry(view.displayObject, state, node);

      // A failed initial acquisition leaves the same view active. The renderer
      // sends same-ref changes through update(), so retry here; without a
      // cooldown every document update could start another decode.
      if (!state.ref || state.lease || state.retryAt === undefined || Date.now() < state.retryAt || ctx.signal.aborted) return;
      if (state.retry) await state.retry;
      if (ctx.signal.aborted || state.lease || state.retryAt === undefined || Date.now() < state.retryAt) return;
      const retry = (async () => {
        try {
          const lease = await ctx.assets.acquireTexture(state.ref!, { kind: type });
          if (ctx.signal.aborted) {
            lease.release?.();
            return;
          }
          state.lease = lease;
          state.retryAt = undefined;
          state.retryAttempt = undefined;
          if (lease.texture !== undefined) {
            state.image.texture = lease.texture;
            view.displayObject.texture = lease.texture;
          }
          const dimensions = textureDimensions(state.image, lease);
          state.naturalWidth = dimensions.width;
          state.naturalHeight = dimensions.height;
          applyMediaGeometry(view.displayObject, state, node);
        } catch {
          if (!ctx.signal.aborted) scheduleTextureRetry(state);
        }
      })();
      state.retry = retry;
      try {
        await retry;
      } finally {
        state.retry = undefined;
      }
    },
    destroy(view) { view.displayObject.destroy?.({ children: true }); },
  });
}
function textValue(node: Readonly<BoardNode<JsonValue>>): string {
  const props = node.props as Record<string, JsonValue>;
  const value = props.text ?? props.content ?? props.value ?? node.name ?? "";
  return typeof value === "string" ? value : JSON.stringify(value);
}
function textStyle(node: Readonly<BoardNode<JsonValue>>, width: number): Record<string, unknown> | undefined {
  const style = (node.props as Record<string, JsonValue>).style;
  const resolved = style && typeof style === "object" && !Array.isArray(style)
    ? { ...(style as Record<string, unknown>) }
    : {};
  // Text nodes use their document width as a wrapping box, never as a scale
  // target. Assigning width/height directly to Pixi.Text changes its scale and
  // stretches glyphs whenever the node rectangle is not its natural size.
  if (resolved.wordWrap !== false && Number.isFinite(width) && width > 0) {
    resolved.wordWrap = true;
    resolved.wordWrapWidth = width;
    if (resolved.breakWords === undefined) resolved.breakWords = true;
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}
function applyPlacement(view: PixiNodeView, node: Readonly<BoardNode<JsonValue>>): void { const d = view.displayObject; d.x = node.x; d.y = node.y; d.rotation = node.rotation; d.zIndex = node.zIndex; }
function applyTransform(view: PixiNodeView, node: Readonly<BoardNode<JsonValue>>): void { applyPlacement(view, node); const d = view.displayObject; d.width = node.width; d.height = node.height; }

function applyMediaGeometry(displayObject: PixiDisplayObject, state: TextureState, node: Readonly<BoardNode<JsonValue>>): void {
  displayObject.x = node.x;
  displayObject.y = node.y;
  displayObject.rotation = node.rotation;
  displayObject.zIndex = node.zIndex;

  const boxWidth = positiveDimension(node.width);
  const boxHeight = positiveDimension(node.height);
  const fit = mediaFit(node);
  const intrinsic = readIntrinsicSize(node.props) ?? (state.naturalWidth && state.naturalHeight
    ? { width: state.naturalWidth, height: state.naturalHeight }
    : undefined);
  const naturalWidth = positiveDimension(intrinsic?.width);
  const naturalHeight = positiveDimension(intrinsic?.height);
  const layout = mediaLayout(fit, boxWidth, boxHeight, naturalWidth, naturalHeight);
  const surface = state.surface;
  if (surface) {
    surface.x = 0;
    surface.y = 0;
    surface.width = boxWidth;
    surface.height = boxHeight;
  }
  state.image.visible = Boolean(state.ref) && boxWidth > 0 && boxHeight > 0;
  state.image.x = layout.x;
  state.image.y = layout.y;
  state.image.width = layout.width;
  state.image.height = layout.height;

  if (layout.clip) {
    if (state.clip) {
      // A cover image must not paint outside the node rectangle. The mask is a
      // child of the content container and moves/rotates with the outer view.
      // Non-cover fits hide it entirely.
      state.clip.width = boxWidth;
      state.clip.height = boxHeight;
      state.clip.visible = true;
      state.content.mask = state.clip;
    }
  } else if (state.clip) {
    state.clip.visible = false;
    state.content.mask = undefined;
  }
}

function mediaFit(node: Readonly<BoardNode<JsonValue>>): ContentFit {
  const props = node.props as Record<string, JsonValue>;
  const value = node.fit ?? props.fit ?? props.mediaFit;
  return value === "cover" || value === "stretch" || value === "contain" ? value : "contain";
}

function mediaLayout(
  fit: ContentFit,
  boxWidth: number,
  boxHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number; width: number; height: number; clip: boolean } {
  if (boxWidth <= 0 || boxHeight <= 0) return { x: 0, y: 0, width: 0, height: 0, clip: false };
  const rect = fitMediaRect(
    { width: boxWidth, height: boxHeight },
    naturalWidth > 0 && naturalHeight > 0
      ? { width: naturalWidth, height: naturalHeight }
      : undefined,
    fit,
  );
  return { ...rect, clip: fit === "cover" && naturalWidth > 0 && naturalHeight > 0 };
}

function textureDimensions(image: PixiDisplayObject, lease?: TextureLease): { width?: number; height?: number } {
  const texture = image.texture as any;
  const source = texture?.source;
  const width = [lease?.width, texture?.width, source?.width, image.width].find(isPositiveNumber);
  const height = [lease?.height, texture?.height, source?.height, image.height].find(isPositiveNumber);
  return typeof width === "number" && typeof height === "number" ? { width, height } : {};
}

function scheduleTextureRetry(state: TextureState): void {
  const attempt = (state.retryAttempt ?? 0) + 1;
  state.retryAttempt = attempt;
  state.retryAt = Date.now() + Math.min(TEXTURE_RETRY_BASE_MS * 2 ** Math.min(attempt - 1, 5), TEXTURE_RETRY_MAX_MS);
}

function positiveDimension(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0; }
function isPositiveNumber(value: unknown): value is number { return positiveDimension(value) > 0; }
export function defaultBounds(node: BoardNode): ReturnType<typeof rotatedRectBounds> { return rotatedRectBounds(node); }
