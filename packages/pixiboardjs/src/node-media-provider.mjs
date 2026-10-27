/** Node-only media I/O. The host injects sharp; ffmpeg/ffprobe remain optional executables. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const MEDIA_PIPELINE_VERSION = 1
const INPUT_LIMIT = 64 * 1024 * 1024
const OUTPUT_LIMIT = 16 * 1024 * 1024

export function createNodeMediaProvider({ sharp, ffmpegPath, ffprobePath, timeoutMs = 30_000 } = {}) {
  const ffmpeg = executable(ffmpegPath || process.env.FFMPEG_PATH, 'ffmpeg')
  const ffprobe = executable(ffprobePath || process.env.FFPROBE_PATH, 'ffprobe')
  const resolveSharp = async () => {
    const module = typeof sharp === 'function' ? sharp : await import('sharp')
    return module.default || module
  }
  async function probe({ kind, data, signal }) {
    assertInput(data, signal)
    if (kind === 'image') {
      const factory = await resolveSharp()
      const info = await factory(data, { limitInputPixels: 100_000_000 }).metadata()
      const swap = [5, 6, 7, 8].includes(info.orientation)
      const width = info.autoOrient?.width || (swap ? info.height : info.width)
      const height = info.autoOrient?.height || (swap ? info.width : info.height)
      signal?.throwIfAborted()
      return compact({ width, height, displayWidth: width, displayHeight: height, orientation: info.orientation })
    }
    return withInput(data, signal, async file => {
      const bytes = await command(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { signal, timeoutMs })
      const info = JSON.parse(bytes.toString('utf8'))
      const video = info.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
      const audio = info.streams?.find(stream => stream.codec_type === 'audio')
      const duration = positive(info.format?.duration) || positive(video?.duration) || positive(audio?.duration)
      const rotation = finite(video?.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? video?.tags?.rotate) || 0
      const sar = ratio(video?.sample_aspect_ratio) || 1
      const rawWidth = positive(video?.width), rawHeight = positive(video?.height)
      const swap = Math.abs(Math.round(rotation / 90)) % 2 === 1
      const width = rawWidth && rawHeight ? Math.round(swap ? rawHeight : rawWidth * sar) : undefined
      const height = rawWidth && rawHeight ? Math.round(swap ? rawWidth * sar : rawHeight) : undefined
      return compact({ width, height, displayWidth: width, displayHeight: height, duration, rotation, sampleAspectRatio: sar })
    })
  }
  async function prepare(input) {
    assertInput(input.data, input.signal)
    let facts = {}
    const warnings = []
    try { facts = await probe(input) } catch (error) {
      input.signal?.throwIfAborted()
      warnings.push(error.message || String(error))
    }
    try {
      let data, mimeType, role
      if (input.kind === 'image') {
        const factory = await resolveSharp()
        const result = await factory(input.data, { limitInputPixels: 100_000_000 }).rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 84 }).toBuffer({ resolveWithObject: true })
        data = result.data; mimeType = 'image/webp'; role = 'preview'
        // Probe failure must not discard valid dimensions learned while decoding.
        if (!facts.width || !facts.height) Object.assign(facts, { width: result.info.width, height: result.info.height, displayWidth: result.info.width, displayHeight: result.info.height })
      } else {
        data = await withInput(input.data, input.signal, async file => {
          if (input.kind === 'audio') return command(ffmpeg, ['-v', 'error', '-nostdin', '-i', file,
            '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=960x160:colors=0x7c8cf8:scale=sqrt',
            '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], { signal: input.signal, timeoutMs })
          const output = offset => command(ffmpeg, ['-v', 'error', '-nostdin', '-ss', String(offset), '-i', file,
            '-an', '-frames:v', '1', '-vf', 'scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=1600:1600:force_original_aspect_ratio=decrease',
            '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { signal: input.signal, timeoutMs })
          const first = await output(Math.min((facts.duration || 0) * 0.1, 1)).catch(() => null)
          input.signal?.throwIfAborted()
          return first?.length ? first : output(0)
        })
        mimeType = input.kind === 'audio' ? 'image/png' : 'image/jpeg'
        role = input.kind === 'audio' ? 'waveform' : 'poster'
      }
      input.signal?.throwIfAborted()
      if (!data?.length) throw new Error('媒体工具未输出预览图')
      if (input.kind !== 'image' && !facts.duration) warnings.push('预览图已生成，但未能读取媒体时长')
      return { media: { ...facts, version: 1, pipelineVersion: MEDIA_PIPELINE_VERSION,
        status: 'ready', ...(warnings.length ? { warnings } : {}) }, derivatives: { [role]: { data, mimeType } } }
    } catch (error) {
      input.signal?.throwIfAborted()
      return { media: { ...facts, version: 1, pipelineVersion: MEDIA_PIPELINE_VERSION, status: 'error',
        error: error.code === 'ENOENT' ? '缺少 ffmpeg/ffprobe，无法生成媒体预览' : String(error.message || error).slice(0, 400),
        ...(warnings.length ? { warnings } : {}) }, derivatives: {} }
    }
  }
  return { probe, prepare }
}

function assertInput(data, signal) {
  signal?.throwIfAborted()
  if (!data?.length || data.length > INPUT_LIMIT) throw new TypeError('媒体文件为空或超过 64 MiB')
}
function executable(configured, name) {
  if (configured) return configured
  return [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`].find(path => existsSync(path)) || name
}
async function withInput(data, signal, work) {
  signal?.throwIfAborted()
  const directory = await mkdtemp(join(tmpdir(), 'pixiboard-media-'))
  try {
    const file = join(directory, 'source')
    await writeFile(file, data, { signal })
    return await work(file)
  } finally { await rm(directory, { recursive: true, force: true }) }
}
function command(binary, args, { signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const chunks = [], diagnostics = []
    let bytes = 0, errorBytes = 0, settled = false
    const finish = (error, data) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (error) { child.kill('SIGKILL'); reject(error) } else resolve(data)
    }
    const abort = () => finish(signal.reason || new Error('媒体任务已取消'))
    const timer = setTimeout(() => finish(new Error('媒体处理超时，请重试或缩短源文件')), timeoutMs)
    timer.unref?.()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.stdout.on('data', chunk => {
      bytes += chunk.length
      if (bytes > OUTPUT_LIMIT) finish(new Error('媒体工具输出超过限制'))
      else chunks.push(chunk)
    })
    child.stderr.on('data', chunk => { if (errorBytes < 64 * 1024) { diagnostics.push(chunk); errorBytes += chunk.length } })
    child.once('error', error => finish(error))
    child.once('close', code => finish(code === 0 ? null : new Error(Buffer.concat(diagnostics).toString('utf8').slice(-400) || `媒体工具退出码 ${code}`), Buffer.concat(chunks)))
  })
}
function positive(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : undefined }
function finite(value) { if (value === undefined || value === null || value === '') return undefined; const number = Number(value); return Number.isFinite(number) ? number : undefined }
function ratio(value) { const [a, b] = String(value || '').split(':').map(Number); return a > 0 && b > 0 ? a / b : undefined }
function compact(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) }
