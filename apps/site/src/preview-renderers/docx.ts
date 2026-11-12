import type { PreviewRenderer, PreviewRenderInput } from '@pixi-board/core'
import type { BrowserPreviewContext } from './context'

async function drawDocx(ctx: BrowserPreviewContext, file: File): Promise<HTMLCanvasElement> {
  const { rasterizeDom, sans } = ctx
  const { renderAsync } = await import('docx-preview')
  const buffer = await file.arrayBuffer()
  return rasterizeDom('20px 26px', async inner => {
    inner.style.background = '#ffffff'
    inner.style.font = '14px/1.6 ' + sans
    await renderAsync(buffer, inner, undefined, {
      inWrapper: false, ignoreWidth: true, ignoreHeight: true, breakPages: false,
      renderHeaders: false, renderFooters: false, renderFootnotes: false, renderEndnotes: false,
      useBase64URL: true, className: 'docx-thumb',
    })
  })
}
export const docxRenderer: PreviewRenderer<BrowserPreviewContext, File, Blob> = {
  id: 'docx',
  priority: 0,
  supports: (s => s.extension === 'docx'),
  async render({ source, spec }: PreviewRenderInput<File>, ctx) {
    try { return ctx.finish(await drawDocx(ctx, source.data), true) }
    catch { return ctx.textFallback(source.data, source.kind, 'Word 忠实渲染失败，已改用文本预览。') }
  },
}
