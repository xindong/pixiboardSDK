import type { PreviewSpec } from "./asset-previews";

/** Minimal Blob-like input so core stays free of DOM typings. */
export type PreviewBlobLike = {
  readonly size: number;
  readonly type: string;
  slice(start?: number, end?: number): PreviewBlobLike;
  arrayBuffer(): Promise<ArrayBuffer>;
};

/**
 * What a renderer is asked about. Core never interprets `kind`; it is the
 * host's own classification (for example a media kind) passed through as-is.
 */
export type PreviewSource<Data extends PreviewBlobLike = PreviewBlobLike> = {
  data: Data;
  name: string;
  /** Lower-case, without the dot. Empty when the file has no extension. */
  extension: string;
  mime: string;
  kind: string;
};

export type PreviewRenderInput<Data extends PreviewBlobLike = PreviewBlobLike> = {
  source: PreviewSource<Data>;
  spec?: Partial<PreviewSpec>;
};

/** `blob` carries pixels; core does not decode them. */
export type PreviewRenderResult<Out = unknown> = {
  blob: Out;
  width: number;
  height: number;
  /** false = only a placeholder was produced; the content itself is not shown. */
  rendered: boolean;
  /** Short user-facing explanation for a degraded result. */
  note?: string;
};

/**
 * One format = one renderer. Built-in and third-party renderers implement this
 * same interface and register through the same registry; the SDK core ships none.
 *
 * `Context` is whatever capabilities the host passes to `render` (DOM
 * rasterizing, workers, ...). Core treats it as opaque.
 */
export interface PreviewRenderer<Context = unknown, Data extends PreviewBlobLike = PreviewBlobLike, Out = unknown> {
  readonly id: string;
  /** Higher wins. Default 0. Use a very low value for catch-all fallbacks. */
  readonly priority?: number;
  /** Decide whether this renderer handles the source. May read a file header. */
  supports(source: PreviewSource<Data>): boolean | Promise<boolean>;
  render(input: PreviewRenderInput<Data>, context: Context): Promise<PreviewRenderResult<Out>>;
}
