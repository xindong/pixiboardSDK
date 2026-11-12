import type { PreviewRenderer, PreviewRenderInput } from '@pixi-board/core'
import type { BrowserPreviewContext } from './context'

async function drawMarkdown(ctx: BrowserPreviewContext, file: File): Promise<HTMLCanvasElement> {
  const { getMarkdown, rasterizeDom, sans, richCss, appendSanitizedHtml } = ctx
  const text = await file.slice(0, 400000).text()
  const markdown = await getMarkdown()
  const html = markdown.render(text)
  return rasterizeDom('24px 28px', async inner => {
    inner.style.font = '15px/1.65 ' + sans
    inner.style.color = '#1f2937'
    const style = document.createElement('style')
    style.textContent = richCss
    inner.append(style)
    const body = document.createElement('div')
    appendSanitizedHtml(body, html)
    inner.append(body)
  })
}
export const markdownRenderer: PreviewRenderer<BrowserPreviewContext, File, Blob> = {
  id: 'markdown',
  priority: 0,
  supports: (s => s.kind === 'markdown'),
  async render({ source, spec }: PreviewRenderInput<File>, ctx) {
    try { return ctx.finish(await drawMarkdown(ctx, source.data), true) }
    catch { return ctx.finish(await ctx.renderText(source.data), true) }
  },
}
