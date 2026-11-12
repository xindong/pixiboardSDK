import { PreviewRendererRegistry, type PreviewSpec } from '@pixi-board/core'
import { createBrowserPreviewContext, type BrowserPreviewContext } from './context'
import { cardRenderer } from './card'
import { docxRenderer } from './docx'
import { htmlRenderer } from './html'
import { markdownRenderer } from './markdown'
import { pdfRenderer } from './pdf'
import { pptxRenderer } from './pptx'
import { textRenderer } from './text'
import { xlsxRenderer } from './xlsx'

export { extractOfficeText } from './office'
export type { BrowserPreviewContext } from './context'
export type DocumentPreviewResult = { blob: Blob; rendered: boolean; note?: string; width: number; height: number }

/**
 * The site's registry. Built-ins go through the same register() call a
 * third-party renderer would use; nothing here is privileged.
 */
export const previewRegistry = new PreviewRendererRegistry<BrowserPreviewContext, File, Blob>()
for (const renderer of [pdfRenderer, docxRenderer, pptxRenderer, xlsxRenderer, markdownRenderer, htmlRenderer, textRenderer, cardRenderer]) {
  previewRegistry.register(renderer)
}

const context = createBrowserPreviewContext()

export async function renderDocumentPreview(file: File, kind: string, spec?: Partial<PreviewSpec>): Promise<DocumentPreviewResult> {
  const source = { data: file, name: file.name, extension: context.extensionOf(file), mime: file.type, kind }
  const renderer = await previewRegistry.resolve(source)
  if (!renderer) throw new Error('没有可用的预览渲染器，原文件已保存。')
  try {
    return await renderer.render({ source, spec }, context)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return context.finish(await context.card(file, context.themeFor(source.extension, kind), '预览生成失败：' + message), false, message)
  }
}
