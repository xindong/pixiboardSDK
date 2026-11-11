import type { PreviewSpec } from '@pixi-board/core'
import type MarkdownIt from 'markdown-it'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { MediaKind } from './media'

export type DocumentPreviewResult = { blob: Blob; rendered: boolean; note?: string }

const NODE_RATIO = 220 / 320
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

const FORMAT: Record<string, { accent: string; label: string }> = {
  pdf: { accent: '#e5484d', label: 'PDF' },
  doc: { accent: '#2b579a', label: 'DOC' }, docx: { accent: '#2b579a', label: 'DOCX' },
  xls: { accent: '#217346', label: 'XLS' }, xlsx: { accent: '#217346', label: 'XLSX' },
  ppt: { accent: '#d24726', label: 'PPT' }, pptx: { accent: '#d24726', label: 'PPTX' },
  md: { accent: '#2563eb', label: 'MD' }, markdown: { accent: '#2563eb', label: 'MD' },
  html: { accent: '#f97316', label: 'HTML' }, htm: { accent: '#f97316', label: 'HTML' },
  txt: { accent: '#64748b', label: 'TXT' }, log: { accent: '#64748b', label: 'LOG' },
  csv: { accent: '#217346', label: 'CSV' }, json: { accent: '#f59e0b', label: 'JSON' },
  xml: { accent: '#f97316', label: 'XML' }, yaml: { accent: '#cb171e', label: 'YAML' }, yml: { accent: '#cb171e', label: 'YML' },
  js: { accent: '#f7df1e', label: 'JS' }, ts: { accent: '#3178c6', label: 'TS' },
  py: { accent: '#3776ab', label: 'PY' }, sh: { accent: '#4eaa25', label: 'SH' },
  css: { accent: '#264de4', label: 'CSS' }, sql: { accent: '#e38c00', label: 'SQL' },
}
const KIND_FORMAT: Record<string, { accent: string; label: string }> = {
  markdown: FORMAT.md, html: FORMAT.html, 'text-file': FORMAT.txt, file: { accent: '#475569', label: 'FILE' },
  model: { accent: '#8b5cf6', label: '3D' }, image: { accent: '#4f7cff', label: 'IMG' },
  video: { accent: '#f05272', label: 'VID' }, audio: { accent: '#1aa36f', label: 'AUD' },
}
const TEXT_EXTENSIONS = new Set(['txt', 'log', 'csv', 'json', 'xml', 'yaml', 'yml', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'sh', 'sql', 'ini', 'toml', 'md', 'markdown', 'html', 'htm', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'rb', 'php'])

function themeFor(ext: string, kind: MediaKind) { return FORMAT[ext] ?? KIND_FORMAT[kind] ?? KIND_FORMAT.file }
function extensionOf(file: File): string { return file.name.toLowerCase().split('.').pop() ?? '' }
function targetSize(spec?: Partial<PreviewSpec>) {
  const width = Math.min(1024, Math.max(640, Math.round((spec?.width ?? 320) * 2)))
  return { width, height: Math.round(width * NODE_RATIO) }
}
function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布上下文')
  return { canvas, ctx }
}
function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('预览编码失败')), 'image/png'))
}
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}
function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const power = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)))
  return (size / 1024 ** power).toFixed(power === 0 ? 0 : 1) + ' ' + units[power]
}
function clampText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let clipped = text
  while (clipped.length > 1 && ctx.measureText(clipped + '…').width > maxWidth) clipped = clipped.slice(0, -1)
  return clipped + '…'
}
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    if (lines.length >= maxLines) break
    if (paragraph === '') { lines.push(''); continue }
    let current = ''
    for (const char of paragraph) {
      const trial = current + char
      if (ctx.measureText(trial).width > maxWidth && current !== '') {
        lines.push(current)
        current = char.trimStart()
        if (lines.length >= maxLines) break
      } else current = trial
    }
    if (lines.length < maxLines && current !== '') lines.push(current)
  }
  return lines.slice(0, maxLines)
}

let markdownRenderer: Promise<MarkdownIt> | undefined
function getMarkdown(): Promise<MarkdownIt> {
  if (!markdownRenderer) markdownRenderer = import('markdown-it').then(module => new module.default({ html: false, xhtmlOut: true, linkify: true, typographer: true }))
  return markdownRenderer
}

/** Compose a document thumbnail: rendered content on top, a format footer below. */
function composeThumbnail(content: HTMLCanvasElement | null, width: number, height: number, theme: { accent: string; label: string }, name: string, subtitle: string): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  const footerH = Math.max(34, Math.round(height * 0.1))
  const contentH = height - footerH
  if (content) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, width, contentH)
    ctx.clip()
    const scale = width / content.width
    ctx.drawImage(content, 0, 0, width, content.height * scale)
    ctx.restore()
  }
  ctx.fillStyle = theme.accent
  ctx.fillRect(0, contentH, width, footerH)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255,255,255,0.96)'
  ctx.font = '700 ' + Math.round(footerH * 0.4) + 'px ' + SANS
  const labelW = ctx.measureText(theme.label).width
  ctx.fillText(theme.label, width * 0.035, contentH + footerH / 2 + 1)
  const nameX = width * 0.035 + labelW + footerH * 0.45
  ctx.font = '600 ' + Math.round(footerH * 0.34) + 'px ' + SANS
  ctx.fillText(clampText(ctx, name, width * 0.66 - nameX), nameX, contentH + footerH / 2 + 1)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255,255,255,0.82)'
  ctx.font = '400 ' + Math.round(footerH * 0.3) + 'px ' + SANS
  ctx.fillText(clampText(ctx, subtitle, width * 0.28), width * 0.965, contentH + footerH / 2 + 1)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  return canvas
}

/** Render DOM content offscreen and rasterize it with a robust screenshot engine. */
async function rasterizeDom(width: number, contentH: number, padding: string, render: (inner: HTMLElement) => Promise<void>): Promise<HTMLCanvasElement> {
  const { domToCanvas } = await import('modern-screenshot')
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + width + 'px;background:#ffffff;z-index:-1;pointer-events:none;'
  const inner = document.createElement('div')
  inner.style.cssText = 'box-sizing:border-box;width:' + width + 'px;height:' + contentH + 'px;overflow:hidden;background:#ffffff;padding:' + padding + ';'
  host.append(inner)
  document.body.append(host)
  try {
    await render(inner)
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
    return await domToCanvas(inner, {
      width, height: contentH, scale: 2, backgroundColor: '#ffffff', timeout: 12000,
      filter: node => !(node instanceof HTMLElement && (node.tagName === 'SCRIPT' || node.tagName === 'BUTTON')),
    })
  } finally {
    host.remove()
  }
}

const RICH_ELEMENT_CSS = 'h1{font-size:24px;font-weight:700;margin:0 0 12px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:8px}h2{font-size:20px;font-weight:700;margin:16px 0 10px;color:#0f172a}h3{font-size:17px;font-weight:600;margin:14px 0 8px;color:#1e293b}p{margin:0 0 10px}ul,ol{margin:0 0 10px;padding-left:24px}li{margin:3px 0}code{font:13px ' + MONO + ';background:#f1f5f9;padding:2px 5px;border-radius:4px;color:#be185d}pre{background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;overflow:hidden;margin:0 0 12px}pre code{background:transparent;color:inherit;padding:0}blockquote{border-left:4px solid #cbd5e1;margin:0 0 12px;padding:4px 14px;color:#475569;background:#f8fafc}a{color:#2563eb;text-decoration:none}table{border-collapse:collapse;margin:0 0 12px}th,td{border:1px solid #e2e8f0;padding:5px 9px}th{background:#f1f5f9}hr{border:0;border-top:1px solid #e2e8f0;margin:14px 0}strong{font-weight:700;color:#0f172a}img{max-width:100%}'

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(link|iframe|object|embed|form|input|button|meta)[^>]*>/gi, '')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*\/?>/gi, '<span style="color:#94a3b8">[图: $1]</span>')
    .replace(/<img[^>]*\/?>/gi, '<span style="color:#94a3b8">[图片]</span>')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
}

async function renderMarkdownContent(file: File, width: number, contentH: number): Promise<HTMLCanvasElement> {
  const text = await file.slice(0, 400000).text()
  const markdown = await getMarkdown()
  const html = sanitizeHtml(markdown.render(text))
  return rasterizeDom(width, contentH, '24px 28px', async inner => {
    inner.style.font = '15px/1.65 ' + SANS
    inner.style.color = '#1f2937'
    const style = document.createElement('style')
    style.textContent = RICH_ELEMENT_CSS
    inner.append(style)
    const body = document.createElement('div')
    body.innerHTML = html
    inner.append(body)
  })
}

async function renderHtmlContent(file: File, width: number, contentH: number): Promise<HTMLCanvasElement> {
  const text = await file.slice(0, 400000).text()
  const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const body = bodyMatch ? bodyMatch[1] : text.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<\/?(html|!DOCTYPE)[^>]*>/gi, '')
  return rasterizeDom(width, contentH, '24px 28px', async inner => {
    inner.style.font = '15px/1.65 ' + SANS
    inner.style.color = '#1f2937'
    const style = document.createElement('style')
    style.textContent = RICH_ELEMENT_CSS
    inner.append(style)
    const container = document.createElement('div')
    container.innerHTML = sanitizeHtml(body)
    inner.append(container)
  })
}

async function renderDocxContent(file: File, width: number, contentH: number): Promise<HTMLCanvasElement> {
  const { renderAsync } = await import('docx-preview')
  const buffer = await file.arrayBuffer()
  return rasterizeDom(width, contentH, '0', async inner => {
    inner.style.background = '#ffffff'
    await renderAsync(buffer, inner, undefined, {
      inWrapper: false, ignoreWidth: true, ignoreHeight: true, breakPages: false,
      renderHeaders: false, renderFooters: false, renderFootnotes: false, renderEndnotes: false,
      useBase64URL: true, className: 'docx-thumb',
    })
    inner.style.padding = '20px 26px'
    inner.style.font = '14px/1.6 ' + SANS
  })
}

async function renderPptxContent(file: File, width: number, contentH: number): Promise<HTMLCanvasElement> {
  const { init } = await import('pptx-preview')
  const { domToCanvas } = await import('modern-screenshot')
  const buffer = await file.arrayBuffer()
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + width + 'px;background:#ffffff;z-index:-1;pointer-events:none;'
  const inner = document.createElement('div')
  inner.style.cssText = 'width:' + width + 'px;background:#ffffff;'
  host.append(inner)
  document.body.append(host)
  let previewer: { destroy: () => void } | undefined
  try {
    previewer = init(inner, { width, mode: 'list' })
    await (previewer as unknown as { preview: (b: ArrayBuffer) => Promise<unknown> }).preview(buffer)
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
    const slide = inner.querySelector('.pptx-preview-slide-wrapper') || inner
    const slideCanvas = await domToCanvas(slide, {
      scale: 2, backgroundColor: '#ffffff', timeout: 12000,
      filter: node => !(node instanceof HTMLElement && (node.tagName === 'SCRIPT' || node.tagName === 'BUTTON')),
    })
    const { canvas, ctx } = makeCanvas(width, contentH)
    ctx.fillStyle = '#f1f5f9'
    ctx.fillRect(0, 0, width, contentH)
    const scale = Math.min(width / slideCanvas.width, contentH / slideCanvas.height)
    const drawW = slideCanvas.width * scale, drawH = slideCanvas.height * scale
    ctx.drawImage(slideCanvas, (width - drawW) / 2, (contentH - drawH) / 2, drawW, drawH)
    return canvas
  } finally {
    previewer?.destroy()
    host.remove()
  }
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, '')
  let index = 0
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64)
  return index - 1
}

async function extractXlsxGrid(file: File): Promise<string[][]> {
  const { unzipSync } = await import('fflate')
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const decoder = new TextDecoder('utf-8')
  const read = (name: string) => entries[name] ? decoder.decode(entries[name]) : ''
  const shared = read('xl/sharedStrings.xml')
  const strings: string[] = []
  let match: RegExpExecArray | null
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g
  while ((match = re.exec(shared)) !== null) strings.push(decodeEntities(match[1]))
  const sheet = read('xl/worksheets/sheet1.xml')
  const grid: string[][] = []
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(sheet)) !== null && grid.length < 14) {
    const cells: string[] = []
    const cellRe = /<c\s+r="([A-Z]+)[0-9]+"[^>]*?(?:\st="(\w+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>|<is><t[^>]*>([\s\S]*?)<\/t><\/is>)?<\/c>/g
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const col = columnIndex(cellMatch[1])
      const type = cellMatch[2], value = cellMatch[3], inline = cellMatch[4]
      let text = ''
      if (inline !== undefined) text = decodeEntities(inline)
      else if (type === 's' && value !== undefined) text = strings[Number(value)] ?? ''
      else if (value !== undefined) text = decodeEntities(value)
      if (col < 10) cells[col] = text
    }
    grid.push(Array.from({ length: 10 }, (_, i) => cells[i] ?? ''))
  }
  return grid
}

async function renderXlsxContent(file: File, width: number, contentH: number): Promise<HTMLCanvasElement> {
  const grid = await extractXlsxGrid(file)
  const usedCols = grid.reduce((max, row) => Math.max(max, row.reduce((last, cell, i) => cell !== '' ? i + 1 : last, 0)), 0) || 1
  return rasterizeDom(width, contentH, '18px 20px', async inner => {
    const table = document.createElement('table')
    table.style.cssText = 'border-collapse:collapse;width:100%;font:13px/1.5 ' + SANS + ';color:#1f2937;table-layout:fixed;'
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

async function renderTextContent(file: File, width: number, contentH: number, override?: string): Promise<HTMLCanvasElement> {
  const raw = override ?? await file.slice(0, 200000).text()
  const text = raw.replace(/\t/g, '    ').replace(/\u0000/g, '')
  const { canvas, ctx } = makeCanvas(width, contentH)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, contentH)
  const pad = Math.round(width * 0.05)
  const fontSize = Math.round(width * 0.026)
  ctx.fillStyle = '#1f2937'
  ctx.font = '400 ' + fontSize + 'px ' + MONO
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const lineHeight = Math.round(fontSize * 1.6)
  const maxLines = Math.max(1, Math.floor((contentH - pad * 2) / lineHeight))
  const lines = wrapLines(ctx, text.trim() || '（空文件）', width - pad * 2, maxLines)
  lines.forEach((line, index) => ctx.fillText(line, pad, pad + index * lineHeight))
  ctx.textBaseline = 'alphabetic'
  return canvas
}

async function renderPdfContent(file: File, width: number, contentH: number, spec?: Partial<PreviewSpec>): Promise<HTMLCanvasElement> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, useSystemFonts: true }).promise
  try {
    const pageNumber = Math.min(Math.max(1, spec?.page ?? 1), pdf.numPages)
    const page = await pdf.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const fit = Math.min((width * 0.92) / base.width, (contentH * 0.94) / base.height)
    const viewport = page.getViewport({ scale: fit * 2 })
    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = Math.ceil(viewport.width)
    pageCanvas.height = Math.ceil(viewport.height)
    const pageCtx = pageCanvas.getContext('2d')
    if (!pageCtx) throw new Error('无法创建画布上下文')
    await page.render({ canvasContext: pageCtx, viewport }).promise
    const { canvas, ctx } = makeCanvas(width, contentH)
    ctx.fillStyle = '#e9edf3'
    ctx.fillRect(0, 0, width, contentH)
    const drawW = viewport.width / 2, drawH = viewport.height / 2
    const offsetX = (width - drawW) / 2, offsetY = (contentH - drawH) / 2
    ctx.save()
    ctx.shadowColor = 'rgba(15,23,42,0.25)'
    ctx.shadowBlur = width * 0.025
    ctx.shadowOffsetY = width * 0.008
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(offsetX, offsetY, drawW, drawH)
    ctx.restore()
    ctx.drawImage(pageCanvas, offsetX, offsetY, drawW, drawH)
    ctx.strokeStyle = 'rgba(15,23,42,0.12)'
    ctx.lineWidth = 1
    ctx.strokeRect(offsetX, offsetY, drawW, drawH)
    return canvas
  } finally {
    void pdf.destroy()
  }
}

function xmlText(xml: string, paragraphBreak: RegExp): string {
  return decodeEntities(xml.replace(paragraphBreak, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Readable text fallback for Office packages when faithful rendering fails. */
export async function extractOfficeText(file: File, ext: string): Promise<string> {
  const { unzipSync } = await import('fflate')
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const decoder = new TextDecoder('utf-8')
  const read = (name: string) => entries[name] ? decoder.decode(entries[name]) : ''
  if (ext === 'docx') return xmlText(read('word/document.xml'), /<\/w:p>/g)
  if (ext === 'pptx') {
    const slides = Object.keys(entries).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1]))
    return slides.slice(0, 100).map((name, index) => '〔幻灯片 ' + (index + 1) + '〕\n' + xmlText(read(name), /<\/a:p>/g)).join('\n\n')
  }
  if (ext === 'xlsx') {
    const grid = await extractXlsxGrid(file)
    return grid.map(row => row.filter(Boolean).join('  |  ')).filter(Boolean).join('\n')
  }
  return ''
}

async function cardContent(file: File, width: number, contentH: number, theme: { accent: string; label: string }, note: string): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = makeCanvas(width, contentH)
  ctx.fillStyle = '#f7f8fb'
  ctx.fillRect(0, 0, width, contentH)
  const badge = Math.round(width * 0.18)
  const bx = (width - badge) / 2, by = Math.round(contentH * 0.2)
  ctx.fillStyle = theme.accent
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(bx, by, badge, badge, badge * 0.22); ctx.fill() }
  else ctx.fillRect(bx, by, badge, badge)
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 ' + Math.round(badge * 0.38) + 'px ' + SANS
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(theme.label.slice(0, 4), bx + badge / 2, by + badge / 2)
  ctx.fillStyle = '#475569'
  ctx.font = '400 ' + Math.round(width * 0.028) + 'px ' + SANS
  const lines = wrapLines(ctx, note, width * 0.8, 3)
  lines.forEach((line, index) => ctx.fillText(line, width / 2, by + badge + Math.round(contentH * 0.12) + index * Math.round(width * 0.045)))
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  return canvas
}

export async function renderDocumentPreview(file: File, kind: MediaKind, spec?: Partial<PreviewSpec>): Promise<DocumentPreviewResult> {
  const { width, height } = targetSize(spec)
  const footerH = Math.max(34, Math.round(height * 0.1))
  const contentH = height - footerH
  const ext = extensionOf(file)
  const theme = themeFor(ext, kind)
  const name = file.name || theme.label
  const finish = async (content: HTMLCanvasElement | null, rendered: boolean, note?: string) => ({
    blob: await toBlob(composeThumbnail(content, width, height, theme, name, formatBytes(file.size))),
    rendered, note,
  })
  const textFallback = async (note?: string) => {
    let text = ''
    try { text = await extractOfficeText(file, ext) } catch { text = '' }
    if (text.trim()) return finish(await renderTextContent(file, width, contentH, text), true)
    return finish(await cardContent(file, width, contentH, theme, note ?? '未能提取到内容预览，原文件已保存。'), false, note)
  }
  try {
    if (ext === 'pdf' || file.type === 'application/pdf') {
      return finish(await renderPdfContent(file, width, contentH, spec), true)
    }
    if (ext === 'docx') {
      try { return finish(await renderDocxContent(file, width, contentH), true) }
      catch { return textFallback('Word 忠实渲染失败，已改用文本预览。') }
    }
    if (ext === 'pptx') {
      try { return finish(await renderPptxContent(file, width, contentH), true) }
      catch { return textFallback('幻灯片忠实渲染失败，已改用文本预览。') }
    }
    if (ext === 'xlsx') {
      try { return finish(await renderXlsxContent(file, width, contentH), true) }
      catch { return textFallback('表格渲染失败，已改用文本预览。') }
    }
    if (kind === 'markdown') {
      try { return finish(await renderMarkdownContent(file, width, contentH), true) }
      catch { return finish(await renderTextContent(file, width, contentH), true) }
    }
    if (kind === 'html') {
      try { return finish(await renderHtmlContent(file, width, contentH), true) }
      catch { return finish(await renderTextContent(file, width, contentH), true) }
    }
    if (kind === 'text-file' || (kind === 'file' && (TEXT_EXTENSIONS.has(ext) || file.type.startsWith('text/')))) {
      return finish(await renderTextContent(file, width, contentH), true)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return finish(await cardContent(file, width, contentH, theme, '预览生成失败：' + message), false, message)
  }
  return finish(await cardContent(file, width, contentH, theme, '此格式暂不支持内容预览，原文件已保存，可下载查看。'), false, '此格式暂不支持内容预览，原文件已保存。')
}
