import {
  createPreviewSpec,
  previewStatusLabel,
  type AssetVariant,
  type BoardNode,
  type JsonValue,
  type PreviewQuality,
  type PreviewSpec,
  type PreviewState,
} from "@pixi-board/core";
import type { PixiBoard } from "pixiboardjs/browser";
import type { MediaKind } from "./media";
import { previewRegistry } from "./preview-registry";

export type PreviewImportState = Partial<PreviewState> & {
  fileExtension?: string;
  previewKey?: string | null;
  pageCount?: number | null;
  previewWarnings?: string[] | null;
};
export type SitePreviewOptions = {
  reason?: string;
  quality?: PreviewQuality;
  width?: number;
  height?: number;
  page?: number;
};
export type SitePreviewHost = {
  requestPreview?(board: PixiBoard, nodeId: string, options: SitePreviewOptions): void | Promise<void>;
  classifyFile?(file: File, kind: MediaKind | undefined): MediaKind | Promise<MediaKind>;
  importState?(file: File, kind: MediaKind): PreviewImportState;
  getTextureEpoch?(assetId: string): number;
  onTextureReady?(assetId: string, variant: AssetVariant): void;
};

let currentHost: SitePreviewHost | undefined;
/** Configure before loading main, or replace the host while the site is running. */
export function configureSitePreviewHost(host: SitePreviewHost | undefined): void {
  currentHost = host;
}
export function hasSitePreviewHost(): boolean { return currentHost !== undefined; }
export function hasSitePreviewRenderer(): boolean { return currentHost?.requestPreview !== undefined; }

const PREVIEW_FIELDS = [
  "previewStatus", "previewQuality", "fileExtension", "previewRequestId", "previewJobId",
  "previewKey", "previewSpec", "pageCount", "previewWarnings", "previewError",
] as const;
/** Preserve supplied state, including null/falsey values, without inventing it. */
export function previewProperties(value: object): PreviewImportState {
  const source = value as Record<string, unknown>;
  return Object.fromEntries(PREVIEW_FIELDS.filter((key) => key === "previewSpec"
    ? source[key] !== null && typeof source[key] === "object" && !Array.isArray(source[key])
    : source[key] !== undefined).map((key) => [key, source[key]])) as PreviewImportState;
}

// This host's own node kinds that carry a preview. The SDK core has no such list.
const DOCUMENT_NODE_TYPES: ReadonlySet<string> = new Set(["html", "markdown", "text-file", "file"]);
function isPreviewNodeType(type: string): boolean { return DOCUMENT_NODE_TYPES.has(type) || type === "model"; }
export function isDocumentNode(node: Readonly<BoardNode> | undefined): boolean {
  return node !== undefined && DOCUMENT_NODE_TYPES.has(node.type);
}
export function isPreviewNode(node: Readonly<BoardNode> | undefined): boolean {
  return node !== undefined && isPreviewNodeType(node.type);
}
export function previewTypeLabel(node: Readonly<BoardNode>, typeLabel: string): string | undefined {
  const label = previewStatusLabel(node, typeLabel);
  return label === typeLabel ? undefined : label;
}

const localEpochs = new Map<string, number>();
export function getPreviewTextureEpoch(assetId: string): number {
  return currentHost?.getTextureEpoch?.(assetId) ?? localEpochs.get(assetId) ?? 0;
}
export function reportPreviewTextureReady(assetId: string, variant: AssetVariant = "preview"): void {
  currentHost?.onTextureReady?.(assetId, variant);
}

export async function classifyPreviewFile(file: File, kind: MediaKind | undefined): Promise<MediaKind> {
  if (currentHost?.classifyFile) return currentHost.classifyFile(file, kind);
  return kind ?? "file";
}

export async function documentPreviewImport(file: File, kind: MediaKind): Promise<PreviewImportState> {
  if (currentHost?.importState) return currentHost.importState(file, kind);
  if (!isPreviewNodeType(kind)) return {};
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  // Capability comes from the renderer registry, not from a format list.
  const supported = (await previewRegistry.resolve({ data: file, name: file.name, extension, mime: file.type, kind })) !== undefined;
  const pending = hasSitePreviewRenderer() && supported;
  return {
    fileExtension: extension,
    previewSpec: createPreviewSpec({ type: kind, width: 320, height: kind === "model" ? 240 : 220 }, { defaultHeight: kind === "model" ? 768 : 704 }),
    previewStatus: pending ? "pending" : "unsupported",
    ...(!pending ? { previewError: "此格式暂未提供内容预览，原文件已保存。" } : {}),
  };
}

type LocalRenderer = (board: PixiBoard, node: Readonly<BoardNode>, spec: PreviewSpec) => Promise<{ rendered: boolean; note?: string } | void>;
let localRenderer: LocalRenderer | undefined;
export function configureLocalPreviewRenderer(renderer: LocalRenderer): void { localRenderer = renderer; }

/** Changes preview state only: card geometry and viewport are deliberately untouched. */
export async function requestDocumentPreview(board: PixiBoard, nodeId: string, options: SitePreviewOptions = {}): Promise<void> {
  const node = board.nodes.get(nodeId);
  if (!node || !isPreviewNode(node)) return;
  // Explicit reset always uses a stable 1024 CSS-pixel layout viewport.
  const reset = options.reason === "reset" || options.reason === "refresh";
  const requestOptions = reset ? {
    ...options,
    width: options.width ?? 1024,
    height: options.height ?? 1024 * (Number.isFinite(node.width) && node.width > 0 && Number.isFinite(node.height) && node.height > 0
      ? node.height / node.width : node.type === "model" ? 768 / 1024 : 704 / 1024),
  } : options;
  if (currentHost?.requestPreview) return currentHost.requestPreview(board, nodeId, requestOptions);
  const spec = createPreviewSpec(node, { ...requestOptions, defaultHeight: node.type === "model" ? 768 : 704 });
  const requestId = crypto.randomUUID();
  const assetId = node.assetRefs?.primary?.assetId ?? node.assetRefs?.preview?.assetId;
  if (assetId) localEpochs.set(assetId, (localEpochs.get(assetId) ?? 0) + 1);
  board.nodes.update(nodeId, { props: { ...(node.props as Record<string, JsonValue>), previewSpec: spec, previewStatus: "pending", previewRequestId: requestId, previewJobId: null, previewError: null } });
  let error: string | undefined;
  let outcome: { rendered: boolean; note?: string } | void;
  try {
    if (!localRenderer) throw new Error("本地预览尚未就绪，原文件已保存。");
    outcome = await localRenderer(board, node, spec);
  } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  const current = board.nodes.get(nodeId);
  if (!current || (current.props as Record<string, unknown>).previewRequestId !== requestId) return;
  const rendered = outcome?.rendered ?? node.type === "model";
  board.nodes.update(nodeId, { props: { ...(current.props as Record<string, JsonValue>),
    previewStatus: error ? "error" : rendered ? "ready" : "unsupported",
    previewQuality: spec.quality,
    previewError: error ?? outcome?.note ?? (rendered ? null : "此格式暂未提供内容预览，原文件已保存。"),
  } });
}
