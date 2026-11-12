import { PreviewRendererRegistry, type PreviewSpec } from '@pixi-board/core'
import { createBrowserPreviewContext, type BrowserPreviewContext } from './context'
import { cardRenderer } from './card'
import { docxRenderer } from './docx'
import { htmlRenderer } from './html'
import { markdownRenderer } from './markdown'
import { createPdfRenderer } from './pdf'
import { createModelRenderer, type ModelRendererOptions } from './model'
import { pptxRenderer } from './pptx'
import { textRenderer } from './text'
import { xlsxRenderer } from './xlsx'

export { extractOfficeText } from './office'
export { createModelRenderer, isModelExtension, MODEL_EXTENSIONS, type ModelRendererOptions } from './model'
export { createPdfRenderer } from './pdf'
export { createBrowserPreviewContext } from './context'
export { cardRenderer, docxRenderer, htmlRenderer, markdownRenderer, pptxRenderer, textRenderer, xlsxRenderer }
export type { BrowserPreviewContext } from './context'
export type DocumentPreviewResult = { blob: Blob; rendered: boolean; note?: string; width: number; height: number }

export type BuiltinPreviewOptions = { pdfWorkerSrc: string; model?: ModelRendererOptions }
export type BrowserPreviewRegistry = PreviewRendererRegistry<BrowserPreviewContext, File, Blob>

/**
 * Registers the built-in renderers. They use the same `register()` call a
 * third-party renderer would; add your own to the returned registry.
 */
export function createBuiltinPreviewRegistry(options: BuiltinPreviewOptions): BrowserPreviewRegistry {
  const registry: BrowserPreviewRegistry = new PreviewRendererRegistry<BrowserPreviewContext, File, Blob>()
  for (const renderer of [
    createPdfRenderer({ workerSrc: options.pdfWorkerSrc }), docxRenderer, pptxRenderer, xlsxRenderer,
    createModelRenderer(options.model), markdownRenderer, htmlRenderer, textRenderer, cardRenderer,
  ]) registry.register(renderer)
  return registry
}

const context = createBrowserPreviewContext()

/** Resolve a renderer, run it, and degrade to a placeholder card if it throws. */
export async function renderPreview(registry: BrowserPreviewRegistry, file: File, kind: string, spec?: Partial<PreviewSpec>): Promise<DocumentPreviewResult> {
  const source = { data: file, name: file.name, extension: context.extensionOf(file), mime: file.type, kind }
  const renderer = await registry.resolve(source)
  if (!renderer) throw new Error('没有可用的预览渲染器，原文件已保存。')
  try {
    return await renderer.render({ source, spec }, context)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return context.finish(await context.card(file, context.themeFor(source.extension, kind), '预览生成失败：' + message), false, message)
  }
}
