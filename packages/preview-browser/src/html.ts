import type { PreviewRenderer, PreviewRenderInput } from '@pixi-board/core'
import type { BrowserPreviewContext } from './context'

async function drawHtml(ctx: BrowserPreviewContext, file: File): Promise<HTMLCanvasElement> {
  const { rasterizeDom, sans, richCss, appendSanitizedHtml } = ctx
  const text = await file.slice(0, 400000).text()
  const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const body = bodyMatch ? bodyMatch[1] : text.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<\/?(html|!DOCTYPE)[^>]*>/gi, '')
  return rasterizeDom('24px 28px', async inner => {
    inner.style.font = '15px/1.65 ' + sans
    inner.style.color = '#1f2937'
    const style = document.createElement('style')
    style.textContent = richCss
    inner.append(style)
    const container = document.createElement('div')
    appendSanitizedHtml(container, body)
    inner.append(container)
  })
}
export const htmlRenderer: PreviewRenderer<BrowserPreviewContext, File, Blob> = {
  id: 'html',
  priority: 0,
  supports: (s => s.kind === 'html'),
  async render({ source, spec }: PreviewRenderInput<File>, ctx) {
    try { return ctx.finish(await drawHtml(ctx, source.data), true) }
    catch { return ctx.finish(await ctx.renderText(source.data), true) }
  },
}
