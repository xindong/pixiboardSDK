import type { PreviewRenderer, PreviewRenderInput } from '@pixi-board/core'
import type { BrowserPreviewContext } from './context'
import { extractXlsxGrid } from './office'

async function drawXlsx(ctx: BrowserPreviewContext, file: File): Promise<HTMLCanvasElement> {
  const { rasterizeDom, sans } = ctx
  const { grid, overLimit } = await extractXlsxGrid(file)
  if (overLimit) throw new Error('XLSX_OVER_LIMIT')
  if (!grid.length) throw new Error('XLSX_EMPTY')
  const usedCols = grid.reduce((max, row) => Math.max(max, row.reduce((last, cell, i) => cell !== '' ? i + 1 : last, 0)), 0) || 1
  return rasterizeDom('18px 20px', async inner => {
    const table = document.createElement('table')
    table.style.cssText = 'border-collapse:collapse;width:100%;font:13px/1.5 ' + sans + ';color:#1f2937;table-layout:fixed;'
    grid.forEach((row, rowIndex) => {
      const tr = document.createElement('tr')
      for (let c = 0; c < usedCols; c++) {
        const cell = document.createElement(rowIndex === 0 ? 'th' : 'td')
        cell.style.cssText = 'border:1px solid #d7dde6;padding:6px 9px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (rowIndex === 0 ? 'background:#217346;color:#fff;font-weight:600;' : (rowIndex % 2 === 0 ? 'background:#f4f7f5;' : 'background:#fff;'))
        cell.textContent = row[c] ?? ''
        tr.append(cell)
      }
      table.append(tr)
    })
    inner.append(table)
  })
}
export const xlsxRenderer: PreviewRenderer<BrowserPreviewContext, File, Blob> = {
  id: 'xlsx',
  priority: 0,
  supports: (s => s.extension === 'xlsx'),
  async render({ source, spec }: PreviewRenderInput<File>, ctx) {
    try { return ctx.finish(await drawXlsx(ctx, source.data), true) }
    catch (error) {
      if (error instanceof Error && error.message === 'XLSX_OVER_LIMIT') {
        const theme = ctx.themeFor('xlsx', source.kind)
        return ctx.finish(await ctx.card(source.data, theme, '表格过大，暂不生成内容预览，原文件已保存。'), false, '表格过大，暂不生成内容预览。')
      }
      return ctx.textFallback(source.data, source.kind, '表格渲染失败，已改用文本预览。')
    }
  },
}
