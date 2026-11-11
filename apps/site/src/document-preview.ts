import type { PreviewSpec } from '@pixi-board/core'
import type MarkdownIt from 'markdown-it'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { MediaKind } from './media'

export type DocumentPreviewResult = { blob: Blob; rendered: boolean; note?: string; width: number; height: number }

// Mirror the plugin: render at a fixed layout width and capture the document's
// natural height (bounded to 5x width) so the whole document is visible and the
// node can auto-size to the content aspect. No decorative footer is added.
const LAYOUT_WIDTH = 640
const MAX_HEIGHT = LAYOUT_WIDTH * 5
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

/** Render DOM at the layout width and capture its full natural height. */
async function rasterizeDom(padding: string, render: (inner: HTMLElement) => Promise<void>): Promise<HTMLCanvasElement> {
  const { domToCanvas } = await import('modern-screenshot')
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + LAYOUT_WIDTH + 'px;background:#ffffff;z-index:-1;pointer-events:none;'
  const inner = document.createElement('div')
  inner.style.cssText = 'box-sizing:border-box;width:' + LAYOUT_WIDTH + 'px;background:#ffffff;padding:' + padding + ';'
  host.append(inner)
  document.body.append(host)
  try {
    await render(inner)
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
    const natural = Math.min(MAX_HEIGHT, Math.max(1, Math.ceil(inner.scrollHeight)))
    inner.style.height = natural + 'px'
    inner.style.overflow = 'hidden'
    return await domToCanvas(inner, {
      width: LAYOUT_WIDTH, height: natural, scale: 1, backgroundColor: '#ffffff', timeout: 12000,
      filter: node => !(node instanceof HTMLElement && (node.tagName === 'SCRIPT' || node.tagName === 'BUTTON')),
    })
  } finally {
    host.remove()
  }
}

const RICH_ELEMENT_CSS = 'h1{font-size:24px;font-weight:700;margin:0 0 12px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:8px}h2{font-size:20px;font-weight:700;margin:16px 0 10px;color:#0f172a}h3{font-size:17px;font-weight:600;margin:14px 0 8px;color:#1e293b}p{margin:0 0 10px}ul,ol{margin:0 0 10px;padding-left:24px}li{margin:3px 0}code{font:13px ' + MONO + ';background:#f1f5f9;padding:2px 5px;border-radius:4px;color:#be185d}pre{background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;overflow:hidden;margin:0 0 12px}pre code{background:transparent;color:inherit;padding:0}blockquote{border-left:4px solid #cbd5e1;margin:0 0 12px;padding:4px 14px;color:#475569;background:#f8fafc}a{color:#2563eb;text-decoration:none}table{border-collapse:collapse;margin:0 0 12px}th,td{border:1px solid #e2e8f0;padding:5px 9px}th{background:#f1f5f9}hr{border:0;border-top:1px solid #e2e8f0;margin:14px 0}strong{font-weight:700;color:#0f172a}img{max-width:100%}'

// DOM-based whitelist sanitization: parse inert, drop dangerous nodes and
// attributes, then adopt clean nodes. No regex filtering and no innerHTML sink.
const BLOCKED_ELEMENTS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'FRAME', 'FRAMESET', 'APPLET', 'NOSCRIPT', 'TEMPLATE'])
function appendSanitizedHtml(target: HTMLElement, html: string): void {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.body
  const blocked: Element[] = []
  const externalImages: Element[] = []
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  while (walker.nextNode()) {
    const el = walker.currentNode as Element
    if (BLOCKED_ELEMENTS.has(el.tagName)) { blocked.push(el); continue }
    if (el.tagName === 'IMG' && !(el.getAttribute('src') || '').startsWith('data:')) { externalImages.push(el); continue }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc') el.removeAttribute(attr.name)
      else if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*(javascript|vbscript):/i.test(attr.value)) el.removeAttribute(attr.name)
    }
  }
  for (const el of blocked) el.remove()
  for (const el of externalImages) {
    const span = doc.createElement('span')
    span.setAttribute('style', 'color:#94a3b8')
    span.textContent = '[图: ' + (el.getAttribute('alt') || '图片') + ']'
    el.replaceWith(span)
  }
  while (root.firstChild) {
    const child = root.firstChild
    root.removeChild(child)
    target.append(document.importNode(child, true))
  }
}

async function renderMarkdownContent(file: File): Promise<HTMLCanvasElement> {
  const text = await file.slice(0, 400000).text()
  const markdown = await getMarkdown()
  const html = markdown.render(text)
  return rasterizeDom('24px 28px', async inner => {
    inner.style.font = '15px/1.65 ' + SANS
    inner.style.color = '#1f2937'
    const style = document.createElement('style')
    style.textContent = RICH_ELEMENT_CSS
    inner.append(style)
    const body = document.createElement('div')
    appendSanitizedHtml(body, html)
    inner.append(body)
  })
}

async function renderHtmlContent(file: File): Promise<HTMLCanvasElement> {
  const text = await file.slice(0, 400000).text()
  const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const body = bodyMatch ? bodyMatch[1] : text.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<\/?(html|!DOCTYPE)[^>]*>/gi, '')
  return rasterizeDom('24px 28px', async inner => {
    inner.style.font = '15px/1.65 ' + SANS
    inner.style.color = '#1f2937'
    const style = document.createElement('style')
    style.textContent = RICH_ELEMENT_CSS
    inner.append(style)
    const container = document.createElement('div')
    appendSanitizedHtml(container, body)
    inner.append(container)
  })
}

async function renderDocxContent(file: File): Promise<HTMLCanvasElement> {
  const { renderAsync } = await import('docx-preview')
  const buffer = await file.arrayBuffer()
  return rasterizeDom('20px 26px', async inner => {
    inner.style.background = '#ffffff'
    inner.style.font = '14px/1.6 ' + SANS
    await renderAsync(buffer, inner, undefined, {
      inWrapper: false, ignoreWidth: true, ignoreHeight: true, breakPages: false,
      renderHeaders: false, renderFooters: false, renderFootnotes: false, renderEndnotes: false,
      useBase64URL: true, className: 'docx-thumb',
    })
  })
}

async function renderPptxContent(file: File): Promise<HTMLCanvasElement> {
  const { init } = await import('pptx-preview')
  const { domToCanvas } = await import('modern-screenshot')
  const buffer = await file.arrayBuffer()
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + LAYOUT_WIDTH + 'px;background:#ffffff;z-index:-1;pointer-events:none;'
  const inner = document.createElement('div')
  inner.style.cssText = 'width:' + LAYOUT_WIDTH + 'px;background:#ffffff;'
  host.append(inner)
  document.body.append(host)
  let previewer: { destroy: () => void } | undefined
  try {
    previewer = init(inner, { width: LAYOUT_WIDTH, mode: 'list' })
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
  while ((rowMatch = rowRe.exec(sheet)) !== null && grid.length < 200) {
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
      if (col < 12) cells[col] = text
    }
    grid.push(Array.from({ length: 12 }, (_, i) => cells[i] ?? ''))
  }
  return grid
}

async function renderXlsxContent(file: File): Promise<HTMLCanvasElement> {
  const grid = await extractXlsxGrid(file)
  const usedCols = grid.reduce((max, row) => Math.max(max, row.reduce((last, cell, i) => cell !== '' ? i + 1 : last, 0)), 0) || 1
  return rasterizeDom('18px 20px', async inner => {
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

async function renderTextContent(file: File, override?: string): Promise<HTMLCanvasElement> {
  const raw = override ?? await file.slice(0, 200000).text()
  const text = raw.replace(/\t/g, '    ').replace(/\u0000/g, '')
  const pad = 28
  const fontSize = 15
  const lineHeight = Math.round(fontSize * 1.6)
  const measure = makeCanvas(LAYOUT_WIDTH, 8).ctx
  measure.font = '400 ' + fontSize + 'px ' + MONO
  const maxLines = Math.max(1, Math.floor((MAX_HEIGHT - pad * 2) / lineHeight))
  const lines = wrapLines(measure, text.trim() || '（空文件）', LAYOUT_WIDTH - pad * 2, maxLines)
  const height = Math.min(MAX_HEIGHT, Math.max(120, lines.length * lineHeight + pad * 2))
  const { canvas, ctx } = makeCanvas(LAYOUT_WIDTH, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, LAYOUT_WIDTH, height)
  ctx.fillStyle = '#1f2937'
  ctx.font = '400 ' + fontSize + 'px ' + MONO
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  lines.forEach((line, index) => ctx.fillText(line, pad, pad + index * lineHeight))
  ctx.textBaseline = 'alphabetic'
  return canvas
}

async function renderPdfContent(file: File, spec?: Partial<PreviewSpec>): Promise<HTMLCanvasElement> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, useSystemFonts: true }).promise
  try {
    const pageNumber = Math.min(Math.max(1, spec?.page ?? 1), pdf.numPages)
    const page = await pdf.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const scale = LAYOUT_WIDTH / base.width
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

function xmlText(xml: string, paragraphBreak: RegExp): string {
  return decodeEntities(xml.replace(paragraphBreak, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

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

async function cardContent(file: File, theme: { accent: string; label: string }, note: string): Promise<HTMLCanvasElement> {
  const width = LAYOUT_WIDTH, height = Math.round(LAYOUT_WIDTH * 0.62)
  const { canvas, ctx } = makeCanvas(width, height)
  ctx.fillStyle = '#f7f8fb'
  ctx.fillRect(0, 0, width, height)
  const badge = Math.round(width * 0.16)
  const bx = (width - badge) / 2, by = Math.round(height * 0.18)
  ctx.fillStyle = theme.accent
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(bx, by, badge, badge, badge * 0.22); ctx.fill() }
  else ctx.fillRect(bx, by, badge, badge)
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 ' + Math.round(badge * 0.38) + 'px ' + SANS
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(theme.label.slice(0, 4), bx + badge / 2, by + badge / 2)
  ctx.fillStyle = '#334155'
  ctx.font = '600 ' + Math.round(width * 0.03) + 'px ' + SANS
  ctx.fillText(file.name || theme.label, width / 2, by + badge + Math.round(height * 0.12))
  ctx.fillStyle = '#64748b'
  ctx.font = '400 ' + Math.round(width * 0.026) + 'px ' + SANS
  ctx.fillText(formatBytes(file.size), width / 2, by + badge + Math.round(height * 0.2))
  const lines = wrapLines(ctx, note, width * 0.8, 2)
  lines.forEach((line, index) => ctx.fillText(line, width / 2, by + badge + Math.round(height * 0.3) + index * Math.round(width * 0.04)))
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  return canvas
}

export async function renderDocumentPreview(file: File, kind: MediaKind, spec?: Partial<PreviewSpec>): Promise<DocumentPreviewResult> {
  const ext = extensionOf(file)
  const theme = themeFor(ext, kind)
  const finish = async (canvas: HTMLCanvasElement, rendered: boolean, note?: string) => ({
    blob: await toBlob(canvas), rendered, note, width: canvas.width, height: canvas.height,
  })
  const textFallback = async (note?: string) => {
    let text = ''
    try { text = await extractOfficeText(file, ext) } catch { text = '' }
    if (text.trim()) return finish(await renderTextContent(file, text), true)
    return finish(await cardContent(file, theme, note ?? '未能提取到内容预览，原文件已保存。'), false, note)
  }
  try {
    if (ext === 'pdf' || file.type === 'application/pdf') return finish(await renderPdfContent(file, spec), true)
    if (ext === 'docx') {
      try { return finish(await renderDocxContent(file), true) }
      catch { return textFallback('Word 忠实渲染失败，已改用文本预览。') }
    }
    if (ext === 'pptx') {
      try { return finish(await renderPptxContent(file), true) }
      catch { return textFallback('幻灯片忠实渲染失败，已改用文本预览。') }
    }
    if (ext === 'xlsx') {
      try { return finish(await renderXlsxContent(file), true) }
      catch { return textFallback('表格渲染失败，已改用文本预览。') }
    }
    if (kind === 'markdown') {
      try { return finish(await renderMarkdownContent(file), true) }
      catch { return finish(await renderTextContent(file), true) }
    }
    if (kind === 'html') {
      try { return finish(await renderHtmlContent(file), true) }
      catch { return finish(await renderTextContent(file), true) }
    }
    if (kind === 'text-file' || (kind === 'file' && (TEXT_EXTENSIONS.has(ext) || file.type.startsWith('text/')))) {
      return finish(await renderTextContent(file), true)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return finish(await cardContent(file, theme, '预览生成失败：' + message), false, message)
  }
  return finish(await cardContent(file, theme, '此格式暂不支持内容预览，原文件已保存，可下载查看。'), false, '此格式暂不支持内容预览，原文件已保存。')
}
