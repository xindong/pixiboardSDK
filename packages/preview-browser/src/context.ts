import type MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { extractOfficeText } from './office'

/** Everything a browser preview renderer may use. Built-in and third-party renderers get the same object. */
export type BrowserPreviewContext = ReturnType<typeof createBrowserPreviewContext>
export type BrowserPreviewTheme = { accent: string; label: string }

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
  zip: { accent: '#475569', label: 'ZIP' },
  css: { accent: '#264de4', label: 'CSS' }, sql: { accent: '#e38c00', label: 'SQL' },
}

const KIND_FORMAT: Record<string, { accent: string; label: string }> = {
  markdown: FORMAT.md, html: FORMAT.html, 'text-file': FORMAT.txt, file: { accent: '#475569', label: 'FILE' },
  model: { accent: '#8b5cf6', label: '3D' }, image: { accent: '#4f7cff', label: 'IMG' },
  video: { accent: '#f05272', label: 'VID' }, audio: { accent: '#1aa36f', label: 'AUD' },
}

export const TEXT_EXTENSIONS = new Set(['txt', 'log', 'csv', 'json', 'xml', 'yaml', 'yml', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'sh', 'sql', 'ini', 'toml', 'md', 'markdown', 'html', 'htm', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'rb', 'php'])

function themeFor(ext: string, kind: string) { return FORMAT[ext] ?? KIND_FORMAT[kind] ?? KIND_FORMAT.file }

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

/** Render DOM at the layout width and capture its full natural height. */
async function rasterizeDom(padding: string, render: (inner: HTMLElement) => Promise<void>): Promise<HTMLCanvasElement> {
  const { domToCanvas } = await import('modern-screenshot')
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + LAYOUT_WIDTH + 'px;background:#ffffff;z-index:-1;pointer-events:none;'
  const inner = document.createElement('div')
  inner.style.cssText = 'box-sizing:border-box;width:' + LAYOUT_WIDTH + 'px;background:#ffffff;padding:' + padding + ';'
  inner.classList.add('px-preview')
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

// Scope preview typography to the offscreen container so it never leaks into
// the live canvas page while the preview is attached to document.body.
const SCOPED_RICH_CSS = RICH_ELEMENT_CSS.replace(/(^|})\s*([^{}]+)\{/g, (_m, brace: string, sel: string) => brace + sel.split(',').map(s => '.px-preview ' + s.trim()).join(', ') + '{')

// DOMPurify is a recognized sanitizer barrier: it returns an inert, clean
// fragment (no script/iframe/on* /javascript:), so adopting it is safe and no
// raw text is ever reinterpreted as HTML.
const FORBID_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'frame', 'frameset', 'applet', 'noscript', 'template']

function appendSanitizedHtml(target: HTMLElement, html: string): void {
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, FORBID_TAGS, FORBID_ATTR: ['srcdoc'] })
  for (const img of Array.from(fragment.querySelectorAll('img'))) {
    if ((img.getAttribute('src') || '').startsWith('data:')) continue
    const span = document.createElement('span')
    span.setAttribute('style', 'color:#94a3b8')
    span.textContent = '[图: ' + (img.getAttribute('alt') || '图片') + ']'
    img.replaceWith(span)
  }
  target.append(fragment)
}

async function renderTextContent(file: Blob, override?: string): Promise<HTMLCanvasElement> {
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

async function cardContent(file: Blob & { name?: string }, theme: { accent: string; label: string }, note: string): Promise<HTMLCanvasElement> {
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
  ctx.fillText((file as File).name || theme.label, width / 2, by + badge + Math.round(height * 0.12))
  ctx.fillStyle = '#64748b'
  ctx.font = '400 ' + Math.round(width * 0.026) + 'px ' + SANS
  ctx.fillText(formatBytes(file.size), width / 2, by + badge + Math.round(height * 0.2))
  const lines = wrapLines(ctx, note, width * 0.8, 2)
  lines.forEach((line, index) => ctx.fillText(line, width / 2, by + badge + Math.round(height * 0.3) + index * Math.round(width * 0.04)))
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  return canvas
}

let markdownRenderer: Promise<MarkdownIt> | undefined
function getMarkdown(): Promise<MarkdownIt> {
  if (!markdownRenderer) markdownRenderer = import('markdown-it').then(module => new module.default({ html: false, xhtmlOut: true, linkify: true, typographer: true }))
  return markdownRenderer
}

type MediaKindLike = string
function finish(canvas: HTMLCanvasElement, rendered: boolean, note?: string) {
  return toBlob(canvas).then(blob => ({ blob, rendered, note, width: canvas.width, height: canvas.height }))
}

export function createBrowserPreviewContext() {
  return {
    layoutWidth: LAYOUT_WIDTH, maxHeight: MAX_HEIGHT, sans: SANS, mono: MONO, richCss: SCOPED_RICH_CSS,
    textExtensions: TEXT_EXTENSIONS,
    extensionOf, themeFor,
    makeCanvas, formatBytes, wrapLines, rasterizeDom, appendSanitizedHtml, getMarkdown,
    renderText: renderTextContent,
    card: cardContent,
    finish,
    /** Degrade to extracted text, else a placeholder card. */
    async textFallback(file: File, kind: MediaKindLike, note?: string) {
      const ext = extensionOf(file)
      let text = ''
      try { text = await extractOfficeText(file, ext) } catch { text = '' }
      if (text.trim()) return finish(await renderTextContent(file, text), true)
      return finish(await cardContent(file, themeFor(ext, kind), note ?? '未能提取到内容预览，原文件已保存。'), false, note)
    },
  }
}
