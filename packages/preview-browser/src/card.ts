import type { PreviewRenderer, PreviewRenderInput } from '@pixi-board/core'
import type { BrowserPreviewContext } from './context'


export const cardRenderer: PreviewRenderer<BrowserPreviewContext, File, Blob> = {
  id: 'card',
  priority: -1000,
  supports: (() => true),
  async render({ source, spec }: PreviewRenderInput<File>, ctx) {
    const theme = ctx.themeFor(source.extension, source.kind)
    const note = '此格式暂不支持内容预览，原文件已保存，可下载查看。'
    return ctx.finish(await ctx.card(source.data, theme, note), false, '此格式暂不支持内容预览，原文件已保存。')
  },
}
