/** Host-owned preview job state, stored in node props. */
export type PreviewStatus = "pending" | "queued" | "running" | "ready" | "error" | "failed" | "unsupported";
export type PreviewQuality = "thumbnail" | "detail";

/** Logical layout viewport; independent of board zoom and display pixel density. */
export type PreviewSpec = {
  width: number;
  height: number;
  page: number;
  mode: "viewport" | "fixed-viewport";
  quality: PreviewQuality;
};

export type PreviewState = {
  previewStatus?: PreviewStatus;
  previewSpec?: PreviewSpec;
  previewQuality?: PreviewQuality;
  previewRequestId?: string | null;
  previewJobId?: string | null;
  previewError?: string | null;
};

/** Structural input also accepts BoardNode without constraining its props schema. */
export type PreviewNode = {
  type?: string;
  name?: string;
  width: number;
  height: number;
  props?: unknown;
};

export type PreviewSpecOptions = {
  reason?: string;
  quality?: PreviewQuality;
  width?: number;
  height?: number;
  page?: number;
};

export function isDocumentPreviewType(type: string): boolean {
  return type === "html" || type === "markdown" || type === "text-file" || type === "file";
}

export function isPreviewNodeType(type: string): boolean {
  return isDocumentPreviewType(type) || type === "model";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value
    : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** Pure layout calculation: never changes node geometry, camera, or persisted state. */
export function createPreviewSpec(node: PreviewNode, options: PreviewSpecOptions = {}): PreviewSpec {
  const saved = record(record(node.props).previewSpec);
  const defaultHeight = node.type === "model" ? 768 : 704;
  let width = positiveNumber(saved.width, 1024);
  let height = positiveNumber(saved.height, defaultHeight);
  let mode: PreviewSpec["mode"] = saved.mode === "fixed-viewport" ? "fixed-viewport" : "viewport";
  let quality: PreviewQuality = options.quality === "detail" || options.quality === "thumbnail"
    ? options.quality : saved.quality === "detail" ? "detail" : "thumbnail";
  if (options.reason === "reset" || options.reason === "refresh") {
    const ratio = typeof node.width === "number" && Number.isFinite(node.width) && node.width > 0 &&
      typeof node.height === "number" && Number.isFinite(node.height) && node.height > 0
      ? node.height / node.width : defaultHeight / 1024;
    height = positiveNumber(width * ratio, defaultHeight);
    mode = "fixed-viewport";
    quality = options.quality === "thumbnail" ? "thumbnail" : "detail";
  }
  if (options.width !== undefined) width = positiveNumber(options.width, 1024);
  if (options.height !== undefined) height = positiveNumber(options.height, defaultHeight);

  // Bound each side first so area calculation cannot overflow for huge inputs.
  const sideScale = Math.min(1, 4096 / width, 4096 / height);
  width *= sideScale;
  height *= sideScale;
  const areaScale = Math.min(1, Math.sqrt(8_000_000 / (width * height)));
  // Rounding must not push the result over the pixel budget.
  width = Math.max(1, Math.min(4096, Math.round(width * areaScale)));
  height = Math.max(1, Math.min(4096, Math.round(height * areaScale)));
  if (width * height > 8_000_000) height = Math.max(1, Math.floor(8_000_000 / width));

  const pageValue = options.page === undefined ? saved.page : options.page;
  const page = Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.round(positiveNumber(pageValue, 1))));
  return { width, height, page, mode, quality };
}

/** Short Chinese type tag. Full error details belong in previewError, never here. */
export function previewStatusLabel(
  node: Pick<PreviewNode, "type" | "name" | "props">,
  typeLabel: string,
): string {
  const props = record(node.props);
  const name = typeof props.name === "string" ? props.name : node.name ?? "";
  const isZip = (typeof props.fileExtension === "string" && props.fileExtension.toLowerCase() === "zip") || /\.zip$/i.test(name);
  if (isZip && (node.type !== "model" ||
    (typeof props.previewError === "string" && /ZIP_NO_MODEL/.test(props.previewError)))) {
    typeLabel = "ZIP";
  }
  switch (props.previewStatus) {
    case "pending":
    case "queued":
    case "running":
      return `${typeLabel}:预览生成中`;
    case "error":
    case "failed":
    case "unsupported":
      return `${typeLabel}:暂无预览`;
    default:
      return typeLabel;
  }
}
