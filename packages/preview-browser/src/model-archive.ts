import { unzipSync } from 'fflate'

/**
 * Light-weight (no three.js) model detection so the host can classify and route
 * files without loading the viewer SDK. Rendering itself is done by mivo-model-viewer.
 */
export const MODEL_EXTENSIONS: ReadonlySet<string> = new Set(['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'dae', '3mf', '3ds', 'wrl', 'vrml', 'step', 'stp'])
export const ARCHIVE_MAX_BYTES = 64 * 1024 * 1024

export type ArchiveModelProbe = { hasModel: boolean; error?: string }

export function isModelExtension(extension: string): boolean {
  return MODEL_EXTENSIONS.has(extension.toLowerCase())
}

const probes = new WeakMap<Blob, Promise<ArchiveModelProbe>>()

/** Reads only the zip directory (the filter never inflates an entry) and looks for a model file. */
export function probeArchiveForModel(file: Blob): Promise<ArchiveModelProbe> {
  let probe = probes.get(file)
  if (!probe) { probe = run(file); probes.set(file, probe) }
  return probe
}

async function run(file: Blob): Promise<ArchiveModelProbe> {
  if (file.size > ARCHIVE_MAX_BYTES) return { hasModel: false, error: '文件超过预览大小限制，按 ZIP 文件处理。' }
  try {
    let hasModel = false
    unzipSync(new Uint8Array(await file.arrayBuffer()), { filter(entry) {
      const parts = entry.name.replaceAll('\\', '/').split('/')
      const name = parts.at(-1) ?? ''
      if (isModelExtension(name.split('.').pop() ?? '') && !parts.some(part => part === '__MACOSX' || part.startsWith('._'))) hasModel = true
      return false
    } })
    return { hasModel }
  } catch {
    return { hasModel: false, error: '无法读取 ZIP 目录，原文件已保存。' }
  }
}
