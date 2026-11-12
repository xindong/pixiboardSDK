import type { PreviewRenderer, PreviewRenderInput } from '@pixi-board/core'
import type { BrowserPreviewContext } from './context'

async function drawPptx(ctx: BrowserPreviewContext, file: File): Promise<HTMLCanvasElement> {
  const { layoutWidth } = ctx
  const { init } = await import('pptx-preview')
  const { domToCanvas } = await import('modern-screenshot')
  const buffer = await file.arrayBuffer()
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + layoutWidth + 'px;background:#ffffff;z-index:-1;pointer-events:none;'
  const inner = document.createElement('div')
  inner.style.cssText = 'width:' + layoutWidth + 'px;background:#ffffff;'
  host.append(inner)
  document.body.append(host)
  let previewer: { destroy: () => void } | undefined
  try {
    previewer = init(inner, { width: layoutWidth, mode: 'list' })
    await (previewer as unknown as { preview: (b: ArrayBuffer) => Promise<unknown> }).preview(buffer)
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
    const slide = inner.querySelector('.pptx-preview-slide-wrapper') || inner
    return await domToCanvas(slide, {
      scale: 1, backgroundColor: '#ffffff', timeout: 12000,
      filter: node => !(node instanceof HTMLElement && (node.tagName === 'SCRIPT' || node.tagName === 'BUTTON')),
    })
  } finally {
    previewer?.destroy()
    host.remove()
  }
}
export const pptxRenderer: PreviewRenderer<BrowserPreviewContext, File, Blob> = {
  id: 'pptx',
  priority: 0,
  supports: (s => s.extension === 'pptx'),
  async render({ source, spec }: PreviewRenderInput<File>, ctx) {
    try { return ctx.finish(await drawPptx(ctx, source.data), true) }
    catch { return ctx.textFallback(source.data, source.kind, '幻灯片忠实渲染失败，已改用文本预览。') }
  },
}
