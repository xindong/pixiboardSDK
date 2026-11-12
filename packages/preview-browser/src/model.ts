import type { PreviewRenderer, PreviewRenderInput } from '@pixi-board/core'
import type { BrowserPreviewContext } from './context'

export type ModelRendererOptions = {
  /** Output background; default a light grey that reads on both light and dark boards. */
  background?: string
  /** Hard stop for a single render. Default 20s. */
  timeoutMs?: number
  /** Called once before the first render, e.g. to call the SDK's setDracoDecoderPath. */
  configure?: (sdk: typeof import('mivo-model-viewer/core')) => void | Promise<void>
}

type Thumbs = ReturnType<typeof import('mivo-model-viewer/core')['createThumbnailRenderer']>

/** 3D formats handled by this renderer. Kept here so `supports()` never has to load the SDK. ZIP is deliberately not one of them. */
export const MODEL_EXTENSIONS: ReadonlySet<string> = new Set(['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'dae', '3mf', '3ds', 'wrl', 'vrml', 'step', 'stp'])
export function isModelExtension(extension: string): boolean { return MODEL_EXTENSIONS.has(extension.toLowerCase()) }

/** Renders 3D model files using the mivo-model-viewer SDK. */
export function createModelRenderer(options: ModelRendererOptions = {}): PreviewRenderer<BrowserPreviewContext, File, Blob> & { dispose(): void } {
  let thumbs: Promise<Thumbs> | undefined
  const get = () => thumbs ??= import('mivo-model-viewer/core').then(async sdk => {
    await options.configure?.(sdk)
    return sdk.createThumbnailRenderer({ idleMs: 30_000 })
  })
  return {
    id: 'model',
    supports: source => isModelExtension(source.extension),
    async render({ source, spec }: PreviewRenderInput<File>) {
      const renderer = await get()
      const width = Math.round(spec?.width ?? 1024)
      const height = Math.round(spec?.height ?? 768)
      const image = await renderer.render({
        model: source.data, fileName: source.name, width, height, format: 'png',
        background: options.background ?? '#e8edf3', presetView: 'angled', padding: 1.2,
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      })
      return { blob: image.blob, width: image.width, height: image.height, rendered: true }
    },
    dispose() { void thumbs?.then(t => t.dispose()); thumbs = undefined },
  }
}
