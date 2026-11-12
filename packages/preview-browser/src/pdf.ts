import type { PreviewRenderer, PreviewRenderInput } from '@pixi-board/core'
import type { BrowserPreviewContext } from './context'
import type { PreviewSpec } from '@pixi-board/core'

async function drawPdf(ctx: BrowserPreviewContext, workerSrc: string, file: File, spec?: Partial<PreviewSpec>): Promise<HTMLCanvasElement> {
  const { layoutWidth } = ctx
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, useSystemFonts: true }).promise
  try {
    const pageNumber = Math.min(Math.max(1, spec?.page ?? 1), pdf.numPages)
    const page = await pdf.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const scale = layoutWidth / base.width
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布上下文')
    await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise
    return canvas
  } finally {
    void pdf.destroy()
  }
}
/**
 * `workerSrc` is the URL of pdf.js's worker script. The host bundler decides how to
 * serve it (for Vite: `import url from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`).
 */
export function createPdfRenderer(options: { workerSrc: string }): PreviewRenderer<BrowserPreviewContext, File, Blob> {
  return {
    id: 'pdf',
    supports: s => s.extension === 'pdf' || s.mime === 'application/pdf',
    async render({ source, spec }: PreviewRenderInput<File>, ctx) {
      return ctx.finish(await drawPdf(ctx, options.workerSrc, source.data, spec), true)
    },
  }
}
