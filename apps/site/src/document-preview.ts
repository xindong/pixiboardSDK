import type { PreviewSpec } from '@pixi-board/core'
import type MarkdownIt from 'markdown-it'
import { unzipSync } from 'fflate'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { MediaKind } from './media'

export type DocumentPreviewResult = { blob: Blob; rendered: boolean; note?: string }

const NODE_RATIO = 220 / 320
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
// Heavy preview engines load on demand so the first paint never pays for them.
let markdownRenderer: Promise<MarkdownIt> | undefined
function getMarkdown(): Promise<MarkdownIt> {
  if (!markdownRenderer) markdownRenderer = import('markdown-it').then(module => new module.default({ html: false, xhtmlOut: true, linkify: true, typographer: true }))
  return markdownRenderer
}

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

function themeFor(ext: string, kind: MediaKind) {
  return FORMAT[ext] ?? KIND_FORMAT[kind] ?? KIND_FORMAT.file
}
function extensionOf(file: File): string {
  return file.name.toLowerCase().split('.').pop() ?? ''
}
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
      } else {
        current = trial
      }
    }
    if (lines.length < maxLines && current !== '') lines.push(current)
  }
  return lines.slice(0, maxLines)
}
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return }
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Paper-like frame with a colored accent header; returns the content region. */
function drawFrame(ctx: CanvasRenderingContext2D, width: number, height: number, theme: { accent: string; label: string }, title: string, subtitle: string) {
  ctx.fillStyle = '#eef1f6'
  ctx.fillRect(0, 0, width, height)
  const pad = Math.round(width * 0.045)
  const pageX = pad, pageY = pad, pageW = width - pad * 2, pageH = height - pad * 2
  ctx.save()
  ctx.shadowColor = 'rgba(15, 23, 42, 0.16)'
  ctx.shadowBlur = width * 0.03
  ctx.shadowOffsetY = width * 0.008
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(pageX, pageY, pageW, pageH)
  ctx.restore()
  const headerH = Math.round(height * 0.16)
  ctx.fillStyle = theme.accent
  ctx.fillRect(pageX, pageY, pageW, headerH)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = '700 ' + Math.round(headerH * 0.42) + 'px ' + SANS
  const labelW = ctx.measureText(theme.label).width
  ctx.fillText(theme.label, pageX + headerH * 0.5, pageY + headerH * 0.5)
  const titleX = pageX + headerH * 0.5 + labelW + headerH * 0.4
  const titleMax = pageX + pageW - titleX - headerH * 0.4
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 ' + Math.round(headerH * 0.34) + 'px ' + SANS
  ctx.fillText(clampText(ctx, title, titleMax), titleX, pageY + headerH * 0.42)
  ctx.fillStyle = 'rgba(255,255,255,0.78)'
  ctx.font = '400 ' + Math.round(headerH * 0.26) + 'px ' + SANS
  ctx.fillText(clampText(ctx, subtitle, titleMax), titleX, pageY + headerH * 0.74)
  ctx.textBaseline = 'alphabetic'
  return { x: pageX + Math.round(width * 0.05), y: pageY + headerH + Math.round(height * 0.06), width: pageW - Math.round(width * 0.1), height: pageH - headerH - Math.round(height * 0.1) }
}

function drawTextBlock(ctx: CanvasRenderingContext2D, text: string, region: { x: number; y: number; width: number; height: number }, font: string, color: string) {
  ctx.fillStyle = color
  ctx.font = font
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const lineHeight = Math.round(parseInt(font, 10) * 1.55)
  const maxLines = Math.max(1, Math.floor(region.height / lineHeight))
  const lines = wrapLines(ctx, text, region.width, maxLines)
  lines.forEach((line, index) => ctx.fillText(line, region.x, region.y + index * lineHeight))
  ctx.textBaseline = 'alphabetic'
}

async function renderText(file: File, width: number, height: number, theme: { accent: string; label: string }, override?: string): Promise<DocumentPreviewResult> {
  const raw = override ?? await file.slice(0, 200000).text()
  const text = raw.replace(/\t/g, '    ').replace(/\u0000/g, '')
  const { canvas, ctx } = makeCanvas(width, height)
  const region = drawFrame(ctx, width, height, theme, file.name, formatBytes(file.size) + (override ? ' · 提取文本' : ''))
  const fontSize = Math.round(width * 0.026)
  drawTextBlock(ctx, text.trim() || '（空文件）', region, '400 ' + fontSize + 'px ' + MONO, '#1f2937')
  return { blob: await toBlob(canvas), rendered: true }
}

const RICH_CSS = 'box-sizing:border-box;width:100%;height:100%;overflow:hidden;margin:0;padding:26px 30px;background:#ffffff;color:#1f2937;font:15px/1.65 ' + SANS + ';word-wrap:break-word;'
const RICH_ELEMENT_CSS = 'h1{font-size:24px;font-weight:700;margin:0 0 12px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:8px}h2{font-size:20px;font-weight:700;margin:16px 0 10px;color:#0f172a}h3{font-size:17px;font-weight:600;margin:14px 0 8px;color:#1e293b}p{margin:0 0 10px}ul,ol{margin:0 0 10px;padding-left:24px}li{margin:3px 0}code{font:13px ' + MONO + ';background:#f1f5f9;padding:2px 5px;border-radius:4px;color:#be185d}pre{background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;overflow:hidden;margin:0 0 12px}pre code{background:transparent;color:inherit;padding:0}blockquote{border-left:4px solid #cbd5e1;margin:0 0 12px;padding:4px 14px;color:#475569;background:#f8fafc}a{color:#2563eb;text-decoration:none}table{border-collapse:collapse;margin:0 0 12px}th,td{border:1px solid #e2e8f0;padding:5px 9px}th{background:#f1f5f9}hr{border:0;border-top:1px solid #e2e8f0;margin:14px 0}strong{font-weight:700;color:#0f172a}'

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

async function richHtmlToCanvas(html: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const style = '<style>' + RICH_ELEMENT_CSS + '</style>'
  const div = '<div xmlns="http://www.w3.org/1999/xhtml" style="' + RICH_CSS + '">' + style + sanitizeHtml(html) + '</div>'
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><foreignObject width="100%" height="100%">' + div + '</foreignObject></svg>'
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    img.width = width
    img.height = height
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('SVG 渲染失败'))
      img.src = url
    })
    const { canvas, ctx } = makeCanvas(width, height)
    ctx.drawImage(img, 0, 0, width, height)
    ctx.getImageData(0, 0, 1, 1)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function renderMarkdown(file: File, width: number, height: number, theme: { accent: string; label: string }): Promise<DocumentPreviewResult> {
  const text = await file.slice(0, 400000).text()
  const markdown = await getMarkdown()
  const html = markdown.render(text)
  const { canvas, ctx } = makeCanvas(width, height)
  const region = drawFrame(ctx, width, height, theme, file.name, formatBytes(file.size) + ' · Markdown')
  try {
    const rich = await richHtmlToCanvas(html, region.width, region.height)
    ctx.drawImage(rich, region.x, region.y)
    return { blob: await toBlob(canvas), rendered: true }
  } catch {
    const plain = text.replace(/[#>*_\x60~\[\]!]/g, '').replace(/\n{3,}/g, '\n\n')
    drawTextBlock(ctx, plain.trim(), region, '400 ' + Math.round(width * 0.026) + 'px ' + SANS, '#1f2937')
    return { blob: await toBlob(canvas), rendered: true }
  }
}

async function renderHtml(file: File, width: number, height: number, theme: { accent: string; label: string }): Promise<DocumentPreviewResult> {
  const text = await file.slice(0, 400000).text()
  const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const body = bodyMatch ? bodyMatch[1] : text.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<\/?(html|!DOCTYPE)[^>]*>/gi, '')
  const { canvas, ctx } = makeCanvas(width, height)
  const region = drawFrame(ctx, width, height, theme, file.name, formatBytes(file.size) + ' · HTML')
  try {
    const rich = await richHtmlToCanvas(body, region.width, region.height)
    ctx.drawImage(rich, region.x, region.y)
    return { blob: await toBlob(canvas), rendered: true }
  } catch {
    const plain = decodeEntities(body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim()
    drawTextBlock(ctx, plain || text.slice(0, 2000), region, '400 ' + Math.round(width * 0.026) + 'px ' + MONO, '#1f2937')
    return { blob: await toBlob(canvas), rendered: true }
  }
}

async function renderPdf(file: File, width: number, height: number, theme: { accent: string; label: string }, spec?: Partial<PreviewSpec>): Promise<DocumentPreviewResult> {
  const data = await file.arrayBuffer()
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise
  try {
    const pageNumber = Math.min(Math.max(1, spec?.page ?? 1), pdf.numPages)
    const page = await pdf.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const innerW = width * 0.86, innerH = height * 0.8
    const fit = Math.min(innerW / base.width, innerH / base.height)
    const viewport = page.getViewport({ scale: fit * 2 })
    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = Math.ceil(viewport.width)
    pageCanvas.height = Math.ceil(viewport.height)
    const pageCtx = pageCanvas.getContext('2d')
    if (!pageCtx) throw new Error('无法创建画布上下文')
    await page.render({ canvasContext: pageCtx, viewport }).promise
    const { canvas, ctx } = makeCanvas(width, height)
    ctx.fillStyle = '#e9edf3'
    ctx.fillRect(0, 0, width, height)
    const drawW = viewport.width / 2, drawH = viewport.height / 2
    const offsetX = (width - drawW) / 2, offsetY = (height - drawH) / 2 - height * 0.02
    ctx.save()
    ctx.shadowColor = 'rgba(15,23,42,0.28)'
    ctx.shadowBlur = width * 0.03
    ctx.shadowOffsetY = width * 0.01
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(offsetX, offsetY, drawW, drawH)
    ctx.restore()
    ctx.drawImage(pageCanvas, offsetX, offsetY, drawW, drawH)
    ctx.strokeStyle = 'rgba(15,23,42,0.12)'
    ctx.lineWidth = 1
    ctx.strokeRect(offsetX, offsetY, drawW, drawH)
    const footerH = Math.round(height * 0.09)
    ctx.fillStyle = theme.accent
    ctx.fillRect(0, height - footerH, width, footerH)
    ctx.fillStyle = '#ffffff'
    ctx.font = '600 ' + Math.round(height * 0.045) + 'px ' + SANS
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(clampText(ctx, file.name, width * 0.6), width * 0.04, height - footerH / 2)
    ctx.textAlign = 'right'
    ctx.fillText('第 ' + pageNumber + ' / ' + pdf.numPages + ' 页', width * 0.96, height - footerH / 2)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    return { blob: await toBlob(canvas), rendered: true }
  } finally {
    void pdf.destroy()
  }
}

function xmlText(xml: string, paragraphBreak: RegExp): string {
  const withBreaks = xml.replace(paragraphBreak, '\n')
  const stripped = withBreaks.replace(/<[^>]+>/g, '')
  return decodeEntities(stripped).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

async function renderOffice(file: File, ext: string, width: number, height: number, theme: { accent: string; label: string }): Promise<DocumentPreviewResult> {
  if (file.size > 40 * 1024 * 1024) return card(file, theme, width, height, '文件过大，暂不生成内容预览，原文件已保存。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const entries = unzipSync(bytes)
  const decoder = new TextDecoder('utf-8')
  const read = (name: string) => entries[name] ? decoder.decode(entries[name]) : ''
  let text = ''
  if (ext === 'docx') {
    text = xmlText(read('word/document.xml'), /<\/w:p>/g)
  } else if (ext === 'pptx') {
    const slides = Object.keys(entries).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1]))
    text = slides.slice(0, 4).map((name, index) => '〔幻灯片 ' + (index + 1) + '〕\n' + xmlText(read(name), /<\/a:p>/g)).join('\n\n')
  } else if (ext === 'xlsx') {
    const shared = read('xl/sharedStrings.xml')
    const strings: string[] = []
    let match: RegExpExecArray | null
    const re = /<t[^>]*>([\s\S]*?)<\/t>/g
    while ((match = re.exec(shared)) !== null) strings.push(decodeEntities(match[1]))
    const sheet = read('xl/worksheets/sheet1.xml')
    const rows: string[] = []
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g
    let rowMatch: RegExpExecArray | null
    while ((rowMatch = rowRe.exec(sheet)) !== null && rows.length < 40) {
      const cells: string[] = []
      const cellRe = /<c[^>]*?(?:\st="(\w+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>|<is><t[^>]*>([\s\S]*?)<\/t><\/is>)?<\/c>/g
      let cellMatch: RegExpExecArray | null
      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        const type = cellMatch[1], value = cellMatch[2], inline = cellMatch[3]
        if (inline !== undefined) cells.push(decodeEntities(inline))
        else if (type === 's' && value !== undefined) cells.push(strings[Number(value)] ?? '')
        else if (value !== undefined) cells.push(decodeEntities(value))
      }
      if (cells.length) rows.push(cells.join('  |  '))
    }
    text = rows.join('\n') || strings.join('\n')
  }
  if (!text.trim()) return card(file, theme, width, height, '未能从该 Office 文件提取到文本预览。')
  return renderText(file, width, height, theme, text)
}

async function card(file: File, theme: { accent: string; label: string }, width: number, height: number, note?: string): Promise<DocumentPreviewResult> {
  const { canvas, ctx } = makeCanvas(width, height)
  const region = drawFrame(ctx, width, height, theme, file.name, formatBytes(file.size))
  const badge = Math.round(width * 0.16)
  const bx = region.x, by = region.y + Math.round(height * 0.02)
  ctx.fillStyle = theme.accent
  roundedRect(ctx, bx, by, badge, badge, badge * 0.22)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 ' + Math.round(badge * 0.4) + 'px ' + SANS
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(theme.label.slice(0, 4), bx + badge / 2, by + badge / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#475569'
  ctx.font = '400 ' + Math.round(width * 0.027) + 'px ' + SANS
  const lines = wrapLines(ctx, note ?? '此格式暂不支持内容预览，原文件已保存，可下载查看。', region.width, 4)
  lines.forEach((line, index) => ctx.fillText(line, region.x, by + badge + Math.round(height * 0.08) + index * Math.round(width * 0.042)))
  return { blob: await toBlob(canvas), rendered: false, note }
}

export async function renderDocumentPreview(file: File, kind: MediaKind, spec?: Partial<PreviewSpec>): Promise<DocumentPreviewResult> {
  const { width, height } = targetSize(spec)
  const ext = extensionOf(file)
  const theme = themeFor(ext, kind)
  try {
    if (ext === 'pdf' || file.type === 'application/pdf') return await renderPdf(file, width, height, theme, spec)
    if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx') return await renderOffice(file, ext, width, height, theme)
    if (kind === 'markdown') return await renderMarkdown(file, width, height, theme)
    if (kind === 'html') return await renderHtml(file, width, height, theme)
    if (kind === 'text-file') return await renderText(file, width, height, theme)
    if (kind === 'file' && (TEXT_EXTENSIONS.has(ext) || file.type.startsWith('text/'))) return await renderText(file, width, height, theme)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return card(file, theme, width, height, '预览生成失败：' + message + ' 原文件已保存。')
  }
  return card(file, theme, width, height, '此格式暂不支持内容预览，原文件已保存，可下载查看。')
}
