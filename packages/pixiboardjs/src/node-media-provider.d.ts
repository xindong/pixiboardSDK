/**
 * Minimal abort-signal contract used by the Node media provider.
 *
 * A standard `AbortSignal` satisfies this interface. It is declared locally so
 * consumers do not need `@types/node` or a DOM library to use this entry.
 */
export interface NodeMediaAbortSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  throwIfAborted(): void;
  addEventListener(
    type: "abort",
    listener: (event: unknown) => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: (event: unknown) => void): void;
}

/** Media kinds handled by the Node pipeline. */
export type NodeMediaKind = "image" | "video" | "audio";

/** Original media bytes and optional cancellation signal. */
export interface NodeMediaInput<Kind extends NodeMediaKind = NodeMediaKind> {
  kind: Kind;
  /** Original file bytes. Node `Buffer` values are accepted as `Uint8Array`s. */
  data: Uint8Array;
  signal?: NodeMediaAbortSignal;
}

/** Facts learned while probing an image, video, or audio file. */
export interface NodeMediaFacts {
  /** Encoded or display width in pixels, when available. */
  width?: number;
  /** Encoded or display height in pixels, when available. */
  height?: number;
  /** Width after orientation is applied, when available. */
  displayWidth?: number;
  /** Height after orientation is applied, when available. */
  displayHeight?: number;
  /** EXIF orientation reported for images. */
  orientation?: number;
  /** Media duration in seconds. */
  duration?: number;
  /** Video rotation in degrees. */
  rotation?: number;
  /** Video sample aspect ratio. */
  sampleAspectRatio?: number;
}

/** MIME types emitted by the media pipeline. */
export type NodeMediaMimeType = "image/webp" | "image/jpeg" | "image/png";

/** A prepared derivative, such as an image preview or video poster. */
export interface NodeMediaDerivative<MimeType extends NodeMediaMimeType = NodeMediaMimeType> {
  /** Raw derivative bytes. The runtime normally returns a Node `Buffer`. */
  data: Uint8Array;
  mimeType: MimeType;
}

/** Metadata returned by sharp for the decoded preview. */
export interface NodeMediaSharpOutputInfo {
  width: number;
  height: number;
}

/** Image metadata fields read by the provider. */
export interface NodeMediaSharpMetadata {
  width?: number;
  height?: number;
  orientation?: number;
  autoOrient?: {
    width?: number;
    height?: number;
  };
}

/** Sharp pipeline operations used by the provider. */
export interface NodeMediaSharpImage {
  metadata(): Promise<NodeMediaSharpMetadata>;
  rotate(): NodeMediaSharpImage;
  resize(options: {
    width: number;
    height: number;
    fit: "inside";
    withoutEnlargement: boolean;
  }): NodeMediaSharpImage;
  webp(options: { quality: number }): NodeMediaSharpImage;
  toBuffer(options: { resolveWithObject: true }): Promise<{
    data: Uint8Array;
    info: NodeMediaSharpOutputInfo;
  }>;
}

/**
 * Structural subset of the sharp default export.
 *
 * Passing the callable default export keeps sharp and its type declarations
 * optional for consumers of this package entry.
 */
export interface NodeMediaSharpFactory {
  (
    input: Uint8Array,
    options?: { limitInputPixels?: number },
  ): NodeMediaSharpImage;
}

/** Options for creating a Node media provider. */
export interface NodeMediaProviderOptions {
  /**
   * The callable sharp default export. When omitted, the provider dynamically
   * imports `sharp` from the host application.
   */
  sharp?: NodeMediaSharpFactory;
  /** Explicit ffmpeg executable path, or fall back to `FFMPEG_PATH` / PATH. */
  ffmpegPath?: string;
  /** Explicit ffprobe executable path, or fall back to `FFPROBE_PATH` / PATH. */
  ffprobePath?: string;
  /** Timeout for each ffmpeg/ffprobe process. Defaults to 30 seconds. */
  timeoutMs?: number;
}

/** Media metadata included in a successful preparation result. */
export interface NodeMediaReadyMedia extends NodeMediaFacts {
  version: 1;
  pipelineVersion: typeof MEDIA_PIPELINE_VERSION;
  status: "ready";
  /** Non-fatal probe or preview warnings. */
  warnings?: string[];
}

/** Media metadata included when preview generation fails. */
export interface NodeMediaErrorMedia extends NodeMediaFacts {
  version: 1;
  pipelineVersion: typeof MEDIA_PIPELINE_VERSION;
  status: "error";
  /** A bounded, user-facing description of the failure. */
  error: string;
  /** Non-fatal probe warnings collected before the failure. */
  warnings?: string[];
}

/** Derivatives produced for each supported media kind. */
export type NodeMediaDerivatives<Kind extends NodeMediaKind> =
  Kind extends "image"
    ? { preview: NodeMediaDerivative<"image/webp"> }
    : Kind extends "video"
      ? { poster: NodeMediaDerivative<"image/jpeg"> }
      : Kind extends "audio"
        ? { waveform: NodeMediaDerivative<"image/png"> }
        : never;

/** A successful or failed media preparation result. */
export type NodeMediaPrepared<Kind extends NodeMediaKind = NodeMediaKind> =
  | {
      media: NodeMediaReadyMedia;
      derivatives: NodeMediaDerivatives<Kind>;
    }
  | {
      media: NodeMediaErrorMedia;
      derivatives: Record<string, never>;
    };

/** Node-only media probing and preview preparation interface. */
export interface NodeMediaProvider {
  /**
   * Probe original bytes without generating a derivative.
   *
   * Rejects for invalid input, tool failures, or cancellation. Cancellation is
   * rethrown from the supplied signal instead of being converted to metadata.
   */
  probe(input: NodeMediaInput): Promise<NodeMediaFacts>;

  /**
   * Probe media and generate a preview derivative.
   *
   * Probe and preview failures are returned as `{ media.status: "error" }`
   * unless the supplied signal is aborted, in which case the abort is rethrown.
   */
  prepare<Kind extends NodeMediaKind>(
    input: NodeMediaInput<Kind>,
  ): Promise<NodeMediaPrepared<Kind>>;
}

/** Version of the media metadata/derivative pipeline. */
export const MEDIA_PIPELINE_VERSION: 1;

/**
 * Create a Node-only media provider.
 *
 * The host injects sharp. ffmpeg/ffprobe remain executable dependencies used
 * for audio/video probing and preview generation.
 */
export function createNodeMediaProvider(
  options?: NodeMediaProviderOptions,
): NodeMediaProvider;
