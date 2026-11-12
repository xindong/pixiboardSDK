import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createBuiltinPreviewRegistry, renderPreview, type DocumentPreviewResult } from "@pixi-board/preview-browser";
import type { PreviewSpec } from "@pixi-board/core";

/** The site's registry. Add a format by registering one more PreviewRenderer here. */
export const previewRegistry = createBuiltinPreviewRegistry({ pdfWorkerSrc: pdfWorkerUrl });

export function renderDocumentPreview(file: File, kind: string, spec?: Partial<PreviewSpec>): Promise<DocumentPreviewResult> {
  return renderPreview(previewRegistry, file, kind, spec);
}
