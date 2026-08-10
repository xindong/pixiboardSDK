import {
  BrowserPersistenceAdapter,
  NativeIndexedDbPort,
  NativeObjectUrlPort,
  NativeOpfsPort,
} from "@pixi-board/adapter-browser";
import type { AssetRecord, BoardDocument } from "@pixi-board/core";

export type MediaKind = "image" | "video" | "audio";

/** Storage variants this demo writes; mirrors the core `AssetRef["variant"]`. */
export type AssetVariant = "original" | "preview" | "waveform";

export type MediaImport = {
  assetId: string;
  kind: MediaKind;
  name: string;
  mimeType: string;
  size: number;
  /** Intrinsic media size, already clamped to a sane on-canvas footprint. */
  width: number;
  height: number;
};

/** Longest edge a freshly imported node is allowed to occupy in world units. */
const MAX_NODE_EDGE = 320;
const AUDIO_NODE_WIDTH = 320;
const AUDIO_NODE_HEIGHT = 96;
const WAVEFORM_BARS = 96;

export class UnsupportedMediaError extends Error {
  constructor(readonly fileName: string, readonly mimeType: string) {
    super(`不支持的文件类型: ${fileName || mimeType || "unknown"}`);
    this.name = "UnsupportedMediaError";
  }
}

export function classifyMedia(file: File): MediaKind | undefined {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  // Some platforms hand over an empty MIME type; fall back to the extension so
  // a plainly-named file is not rejected for a browser quirk.
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"].includes(extension)) return "image";
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(extension)) return "video";
  if (["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac"].includes(extension)) return "audio";
  return undefined;
}

/**
 * Owns every browser-side media concern for the demo: durable storage of the
 * uploaded bytes, generation of the derived artwork that the canvas actually
 * draws (video poster frame, audio waveform), and the object-URL leases the
 * renderer needs to turn an asset reference into a texture.
 */
export class MediaLibrary {
  private readonly adapter: BrowserPersistenceAdapter;
  /** Object URLs are revoked wholesale on dispose, so leases are tracked here. */
  private readonly leases = new Map<string, { url: string; revoke: () => void }>();
  private readonly opfsSupported: boolean;

  constructor() {
    this.opfsSupported = typeof navigator?.storage?.getDirectory === "function";
    this.adapter = new BrowserPersistenceAdapter({
      indexedDb: new NativeIndexedDbPort({ databaseName: "pixiboardjs-demo" }),
      // OPFS is optional: without it every binary simply falls back to
      // IndexedDB, which the adapter already handles.
      ...(this.opfsSupported ? { opfs: new NativeOpfsPort({ directoryName: "pixiboardjs-demo-assets" }) } : {}),
      objectUrls: new NativeObjectUrlPort(),
    });
  }

  async loadDocument(): Promise<BoardDocument | undefined> {
    const record = await this.adapter.loadDocument();
    return record?.snapshot;
  }

  async saveDocument(snapshot: BoardDocument): Promise<void> {
    await this.adapter.saveDocument({ snapshot });
  }

  /**
   * Stores the original bytes plus, for video and audio, a derived still image
   * that the canvas can render as a texture. Derivation happens before the
   * caller creates a node so a node is never left pointing at a missing
   * variant.
   */
  async importFile(file: File): Promise<MediaImport> {
    const kind = classifyMedia(file);
    if (!kind) throw new UnsupportedMediaError(file.name, file.type);

    const assetId = `asset-${crypto.randomUUID()}`;
    const record: AssetRecord = {
      id: assetId,
      kind,
      metadata: {
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      },
    };

    await this.adapter.putAsset(record, file);

    if (kind === "image") {
      const size = await imageSize(file);
      return { assetId, kind, name: file.name, mimeType: file.type, size: file.size, ...fitNode(size.width, size.height) };
    }

    if (kind === "video") {
      const poster = await videoPoster(file);
      await this.adapter.putDerivative(assetId, "preview", poster.blob);
      return { assetId, kind, name: file.name, mimeType: file.type, size: file.size, ...fitNode(poster.width, poster.height) };
    }

    const waveform = await audioWaveform(file);
    await this.adapter.putDerivative(assetId, "waveform", waveform);
    return {
      assetId,
      kind,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      width: AUDIO_NODE_WIDTH,
      height: AUDIO_NODE_HEIGHT,
    };
  }

  /**
   * Leases a URL for one stored variant. The variant is taken from the asset
   * reference itself rather than inferred from the owning node, so this stays
   * correct during the very first render pass, before the board is reachable.
   */
  async objectUrl(assetId: string, variant: AssetVariant = "original"): Promise<string | undefined> {
    const cacheKey = `${assetId}:${variant}`;
    const cached = this.leases.get(cacheKey);
    if (cached) return cached.url;

    try {
      const lease = await this.adapter.leaseObjectUrl(assetId, { variant });
      this.leases.set(cacheKey, { url: lease.url, revoke: () => lease.revoke() });
      return lease.url;
    } catch {
      // A missing asset must not take down the whole render pass; the node
      // simply stays a placeholder.
      return undefined;
    }
  }

  async clear(): Promise<void> {
    for (const lease of this.leases.values()) lease.revoke();
    this.leases.clear();
    const entries = await this.adapter.listAssets();
    for (const entry of entries) await this.adapter.deleteAsset(entry.id);
    await this.adapter.saveDocument({
      snapshot: { schemaVersion: 1, revision: 0, nodes: [], assets: [] },
    });
  }

  async dispose(): Promise<void> {
    for (const lease of this.leases.values()) lease.revoke();
    this.leases.clear();
    await this.adapter.destroy();
  }
}

/** Scales intrinsic media dimensions down to a reasonable canvas footprint. */
function fitNode(width: number, height: number): { width: number; height: number } {
  const safeWidth = width > 0 ? width : MAX_NODE_EDGE;
  const safeHeight = height > 0 ? height : MAX_NODE_EDGE;
  const scale = Math.min(MAX_NODE_EDGE / safeWidth, MAX_NODE_EDGE / safeHeight, 1);
  return { width: Math.round(safeWidth * scale), height: Math.round(safeHeight * scale) };
}

async function imageSize(file: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return size;
    } catch {
      // SVG and a few exotic encodings reject bitmap decoding; fall through.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("图片解码失败"));
      image.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Seeks a hidden video element just past the start and copies that frame into a
 * canvas. Seeking off zero avoids the black leader frame some encoders emit.
 */
async function videoPoster(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("视频解码失败"));
      }),
      8000,
      "视频加载超时",
    );
    const seekTarget = Number.isFinite(video.duration) && video.duration > 0.1 ? Math.min(0.1, video.duration / 2) : 0;
    await withTimeout(
      new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        try {
          video.currentTime = seekTarget;
        } catch {
          resolve();
        }
      }),
      4000,
      "视频取帧超时",
    ).catch(() => undefined);

    const width = video.videoWidth || 320;
    const height = video.videoHeight || 180;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建画布上下文");
    context.drawImage(video, 0, 0, width, height);
    const blob = await canvasBlob(canvas);
    return { blob, width, height };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Decodes the real samples and renders a symmetric peak-per-bucket waveform, so
 * the drawing reflects the actual audio rather than a decorative placeholder.
 */
async function audioWaveform(file: Blob): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = AUDIO_NODE_WIDTH * 2;
  canvas.height = AUDIO_NODE_HEIGHT * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建画布上下文");

  context.fillStyle = "#161c25";
  context.fillRect(0, 0, canvas.width, canvas.height);

  let peaks: number[] = [];
  const AudioContextCtor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AudioContextCtor) {
    const audioContext = new AudioContextCtor();
    try {
      const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
      const samples = decoded.getChannelData(0);
      const bucket = Math.max(1, Math.floor(samples.length / WAVEFORM_BARS));
      for (let index = 0; index < WAVEFORM_BARS; index += 1) {
        let peak = 0;
        const start = index * bucket;
        for (let offset = 0; offset < bucket && start + offset < samples.length; offset += 1) {
          peak = Math.max(peak, Math.abs(samples[start + offset]));
        }
        peaks.push(peak);
      }
    } catch {
      peaks = [];
    } finally {
      await audioContext.close().catch(() => undefined);
    }
  }

  const midY = canvas.height / 2;
  if (peaks.length === 0) {
    // Undecodable audio still gets a node, marked by a flat baseline.
    context.strokeStyle = "#667487";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(0, midY);
    context.lineTo(canvas.width, midY);
    context.stroke();
  } else {
    const barWidth = canvas.width / peaks.length;
    context.fillStyle = "#52d68e";
    for (const [index, peak] of peaks.entries()) {
      const barHeight = Math.max(2, peak * (canvas.height - 12));
      context.fillRect(index * barWidth + barWidth * 0.2, midY - barHeight / 2, barWidth * 0.6, barHeight);
    }
  }
  return canvasBlob(canvas);
}

async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("无法生成预览图");
  return blob;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
