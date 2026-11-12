import type { PreviewRenderer, PreviewRenderInput } from '@pixi-board/core'
import type { BrowserPreviewContext } from './context'
import { TEXT_EXTENSIONS } from './context'


export const textRenderer: PreviewRenderer<BrowserPreviewContext, File, Blob> = {
  id: 'text',
  priority: 0,
  supports: (s => s.kind === 'text-file' || (s.kind === 'file' && (TEXT_EXTENSIONS.has(s.extension) || s.mime.startsWith('text/')))),
  async render({ source, spec }: PreviewRenderInput<File>, ctx) {
    return ctx.finish(await ctx.renderText(source.data), true)
  },
}
