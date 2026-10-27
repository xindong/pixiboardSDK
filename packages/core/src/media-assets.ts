import type {
  AssetRef,
  BoardNode,
  ContentFit,
  JsonValue,
  MediaMetadata,
  Size,
} from "./types";

export type RenderAssetKind =
  | "image"
  | "video"
  | "audio"
  | "model"
  | "html"
  | "markdown"
  | "text-file"
  | "file";

/**
 * Texture slots in priority order. Primary/original bytes are intentionally
 * excluded for video and documents: attaching an MP4 or HTML payload to a Pixi
 * texture produces a misleading placeholder rather than a usable preview.
 */
export const TEXTURE_REF_ROLES: Readonly<Record<RenderAssetKind, readonly string[]>> = {
  image: ["preview", "image", "primary", "original", "source"],
  video: ["poster", "preview"],
  audio: ["waveform", "preview"],
  model: ["preview"],
  html: ["preview"],
  markdown: ["preview"],
  "text-file": ["preview"],
  file: ["preview"],
};

export function isRenderAssetKind(value: string): value is RenderAssetKind {
  return Object.hasOwn(TEXTURE_REF_ROLES, value);
}

/** Resolve only renderable pixels; never returns an original video/document. */
export function resolveTextureAssetRef(
  node: Pick<BoardNode, "type" | "assetRefs">,
  kind: string = node.type,
): AssetRef | undefined {
  if (!isRenderAssetKind(kind)) return undefined;
  for (const role of TEXTURE_REF_ROLES[kind]) {
    const ref = node.assetRefs?.[role];
    if (ref) return ref;
  }
  // Content-addressed derivatives are intentionally identified by their key,
  // so they remain discoverable even when a host does not also duplicate the
  // ref under `preview`. Only explicit preview-* keys qualify; arbitrary named
  // slots may still contain an original source and must not be decoded.
  return Object.entries(node.assetRefs ?? {})
    .find(([role]) => /^preview-[a-f0-9]{64}$/.test(role))?.[1];
}

/** Canonical first import. Optional variants remain separate named slots. */
export function createMediaAssetRefs(
  kind: string,
  assetId: string,
  available: Partial<Record<"preview" | "poster" | "waveform", boolean>> = {},
): Record<string, AssetRef> {
  const refs: Record<string, AssetRef> = {
    primary: { assetId, variant: "original" },
  };
  if (kind === "image" && available.preview) {
    refs.preview = { assetId, variant: "preview" };
  }
  if (kind === "video" && available.poster) {
    refs.poster = { assetId, variant: "preview" };
  }
  if (kind === "audio" && available.waveform) {
    refs.waveform = { assetId, variant: "waveform" };
  }
  if (["model", "html", "markdown", "text-file", "file"].includes(kind) && available.preview) {
    refs.preview = { assetId, variant: "preview" };
  }
  return refs;
}

/** Read intrinsic media size from supported node props and explicit overrides. */
export function readIntrinsicSize(
  value: unknown,
  fallback?: Partial<Size>,
): Size | undefined {
  const source = record(value);
  const width = positiveFinite(
    source.intrinsicWidth ?? source.naturalWidth ??
    source.mediaWidth ?? source.textureWidth ?? fallback?.width,
  );
  const height = positiveFinite(
    source.intrinsicHeight ?? source.naturalHeight ??
    source.mediaHeight ?? source.textureHeight ?? fallback?.height,
  );
  return width !== undefined && height !== undefined ? { width, height } : undefined;
}

export type MediaLayoutRect = Size & { x: number; y: number };

/**
 * Calculate a finite content rectangle inside a frame. Unknown intrinsic
 * dimensions fall back to the frame itself, so a late metadata update can
 * improve the layout without ever producing NaN/Infinity geometry.
 */
export function fitMediaRect(
  frame: Size,
  intrinsic: Size | undefined,
  fit: ContentFit = "contain",
): MediaLayoutRect {
  const width = positiveFinite(frame.width) ?? 0;
  const height = positiveFinite(frame.height) ?? 0;
  const sourceWidth = positiveFinite(intrinsic?.width);
  const sourceHeight = positiveFinite(intrinsic?.height);
  if (width === 0 || height === 0) return { x: 0, y: 0, width, height };
  if (!sourceWidth || !sourceHeight || fit === "stretch") {
    return { x: 0, y: 0, width, height };
  }

  const scale = fit === "cover"
    ? Math.max(width / sourceWidth, height / sourceHeight)
    : Math.min(width / sourceWidth, height / sourceHeight);
  const fittedWidth = sourceWidth * scale;
  const fittedHeight = sourceHeight * scale;
  return {
    x: (width - fittedWidth) / 2,
    y: (height - fittedHeight) / 2,
    width: fittedWidth,
    height: fittedHeight,
  };
}

/** Initial node footprint: the intrinsic ratio clamped without upscaling. */
export function preferredMediaNodeSize(
  intrinsic: Size | undefined,
  maxWidth = 320,
  maxHeight = 320,
): Size {
  const width = positiveFinite(intrinsic?.width) ?? maxWidth;
  const height = positiveFinite(intrinsic?.height) ?? maxHeight;
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Export a compact, JSON-safe media metadata object with valid facts only. */
export function createMediaMetadata(input: MediaMetadata): MediaMetadata {
  const output: MediaMetadata = { version: 1 };
  for (const key of ["contentHash", "mimeType", "relativePath", "rootId", "baseUrl"] as const) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) output[key] = value;
  }
  for (const key of ["width", "height", "duration", "orientation"] as const) {
    const value = positiveFinite(input[key]);
    if (value !== undefined) output[key] = value;
  }
  return output;
}

export function isContentFit(value: unknown): value is ContentFit {
  return value === "contain" || value === "cover" || value === "stretch";
}

function record(value: unknown): Record<string, unknown> {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return recordProps(candidate);
}

function recordProps(value: Record<string, unknown>): Record<string, unknown> {
  return value.props && typeof value.props === "object" && !Array.isArray(value.props)
    ? value.props as Record<string, unknown>
    : value;
}

function positiveFinite(value: unknown): number | undefined {
  const number = typeof value === "number" ? value
    : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** Keep the public helper usable with JSON values without importing DOM types. */
export type MediaNodeValue = Readonly<BoardNode<JsonValue>>;
