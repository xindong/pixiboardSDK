// Bounded OOXML readers shared by the Office renderers.
// Only decompress the two parts we render, and bound both per-entry and total
// expanded size so a high-ratio workbook cannot stall the main thread.
const OFFICE_MAX_UNZIP = 32 * 1024 * 1024

function columnIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, '')
  let index = 0
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64)
  return index - 1
}

// Decompress only accepted entries, bounding per-entry and total expanded size
// so a high-ratio archive cannot stall the main thread. overLimit reports when
// needed content was skipped so callers degrade to a card instead of a blank.
async function unzipLimited(bytes: Uint8Array, accept: (name: string) => boolean): Promise<{ entries: Record<string, Uint8Array>; overLimit: boolean }> {
  const { unzipSync } = await import('fflate')
  let total = 0
  let overLimit = false
  const entries = unzipSync(bytes, {
    filter: entry => {
      if (!accept(entry.name)) return false
      const size = entry.originalSize ?? entry.size ?? 0
      if (size > OFFICE_MAX_UNZIP) { overLimit = true; return false }
      total += size
      if (total > OFFICE_MAX_UNZIP) { overLimit = true; return false }
      return true
    },
  })
  return { entries, overLimit }
}

export async function extractXlsxGrid(file: File): Promise<{ grid: string[][]; overLimit: boolean }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { entries, overLimit } = await unzipLimited(bytes, name => name === 'xl/sharedStrings.xml' || name === 'xl/worksheets/sheet1.xml')
  if (overLimit) return { grid: [], overLimit: true }
  const decoder = new TextDecoder('utf-8')
  const read = (name: string) => entries[name] ? decoder.decode(entries[name]) : ''
  const parser = new DOMParser()
  const strings: string[] = []
  const sharedXml = read('xl/sharedStrings.xml')
  if (sharedXml) {
    const sharedDoc = parser.parseFromString(sharedXml, 'text/xml')
    for (const si of Array.from(sharedDoc.getElementsByTagName('si'))) {
      strings.push(Array.from(si.getElementsByTagName('t')).map(t => t.textContent || '').join(''))
    }
  }
  const grid: string[][] = []
  const sheetXml = read('xl/worksheets/sheet1.xml')
  if (sheetXml) {
    const sheetDoc = parser.parseFromString(sheetXml, 'text/xml')
    for (const row of Array.from(sheetDoc.getElementsByTagName('row'))) {
      if (grid.length >= 200) break
      const cells: string[] = []
      for (const cell of Array.from(row.getElementsByTagName('c'))) {
        const col = columnIndex(cell.getAttribute('r') || '')
        if (col < 0 || col >= 12) continue
        const type = cell.getAttribute('t')
        const v = cell.getElementsByTagName('v')[0]
        const is = cell.getElementsByTagName('is')[0]
        let text = ''
        if (type === 's' && v) text = strings[Number(v.textContent)] ?? ''
        else if (type === 'inlineStr' && is) text = Array.from(is.getElementsByTagName('t')).map(t => t.textContent || '').join('')
        else if (v) text = v.textContent || ''
        cells[col] = text
      }
      grid.push(Array.from({ length: 12 }, (_, i) => cells[i] ?? ''))
    }
  }
  return { grid, overLimit: false }
}

function xmlText(xml: string, paragraphTag: string): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const lines: string[] = []
  for (const paragraph of Array.from(doc.getElementsByTagName(paragraphTag))) lines.push(paragraph.textContent || '')
  return lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function extractOfficeText(file: File, ext: string): Promise<string> {
  // XLSX uses the bounded grid reader; never full-unzip the workbook here.
  if (ext === 'xlsx') {
    const { grid, overLimit } = await extractXlsxGrid(file)
    if (overLimit) return ''
    return grid.map(row => row.filter(Boolean).join('  |  ')).filter(Boolean).join('\n')
  }
  const accept = ext === 'docx' ? (n: string) => n === 'word/document.xml'
    : ext === 'pptx' ? (n: string) => /^ppt\/slides\/slide\d+\.xml$/.test(n)
    : () => false
  const { entries, overLimit } = await unzipLimited(new Uint8Array(await file.arrayBuffer()), accept)
  if (overLimit) return ''
  const decoder = new TextDecoder('utf-8')
  const read = (name: string) => entries[name] ? decoder.decode(entries[name]) : ''
  if (ext === 'docx') return xmlText(read('word/document.xml'), 'w:p')
  if (ext === 'pptx') {
    const slides = Object.keys(entries).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1]))
    return slides.slice(0, 100).map((name, index) => '〔幻灯片 ' + (index + 1) + '〕\n' + xmlText(read(name), 'a:p')).join('\n\n')
  }
  return ''
}
