import { getPromptSettingsPayload } from './ui/prompt-settings.ts'

// Read the committed browser settings for every preparation. An unsaved
// settings draft never changes a request, and other browser windows take
// effect too because each read reloads localStorage.
export async function fetchPromptSettings(signal?: AbortSignal) {
  const payload = await getPromptSettingsPayload()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!payload.settings || typeof payload.defaults?.nodeTemplate !== 'string' || typeof payload.defaults.nodeGuidance !== 'string') throw new Error('提示词配置格式无效。')
  // Node message structure is maintained by the site, including for old saved configurations.
  return { ...payload.settings, nodeTemplate: payload.defaults.nodeTemplate, nodeGuidance: payload.defaults.nodeGuidance }
}

// Fields that only describe the stored file and never help an agent act.
const DROPPED_PROPS = new Set(['size', 'intrinsicWidth', 'intrinsicHeight'])
const DEFAULT_STATE = { rotation: 0, zIndex: 0, locked: false, visible: true }
const MAX_STRING = 600

/** Drops empty values and caps long strings so the prompt stays small. */
function compact(value) {
  if (typeof value === 'string') {
    if (!value) return undefined
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…（共 ${value.length} 字，完整内容用 canvas_read 读取）` : value
  }
  if (value === null || value === undefined) return undefined
  if (Array.isArray(value)) {
    const items = value.map(compact).filter(item => item !== undefined)
    return items.length ? items : undefined
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => [key, compact(item)]).filter(([, item]) => item !== undefined)
    return entries.length ? Object.fromEntries(entries) : undefined
  }
  return value
}

export function renderNodePrompt({ instruction, context, resources }, settings) {
  const projectNode = node => {
    const result = { id: node.id, type: node.type, name: node.name }
    if (settings.includeGeometry) {
      for (const field of ['x', 'y', 'width', 'height']) result[field] = node[field]
      for (const [field, fallback] of Object.entries(DEFAULT_STATE)) {
        if (node[field] !== undefined && node[field] !== fallback) result[field] = node[field]
      }
    }
    if (settings.includeNodeContent && node.props) {
      result.props = Object.fromEntries(Object.entries(node.props).filter(([key]) => !DROPPED_PROPS.has(key)))
    }
    if (settings.includeAssets) result.assetRefs = node.assetRefs
    return result
  }
  const nodes = context.nodes.map(projectNode)
  const data = compact({
    board_id: context.boardId,
    // Each node already carries its id; name the primary one only when several are attached.
    ...(nodes.length > 1 ? { node_id: context.node.id } : {}),
    revision: context.revision, nodes,
    ...(settings.includeAssets ? { assets: context.assets, resources } : {}),
    ...(settings.includeConnections ? { connections: context.connections } : {}),
    truncated: context.truncated,
  })
  const variables = { instruction: instruction.trim(), guidance: settings.nodeGuidance, context: JSON.stringify(data) }
  // A single replacement pass leaves any {{...}} inside instructions or data
  // untouched. Templates are text, never executable JavaScript.
  const message = settings.nodeTemplate.replace(/\{\{([^{}]*)\}\}/g, (_, raw) => {
    const key = raw.trim()
    if (!Object.hasOwn(variables, key)) throw new Error(`不支持的提示词变量：${raw}`)
    return variables[key]
  })
  const preferences = settings.nodePreferences?.trim()
  // The template ends with the request block, so preferences continue it directly.
  return preferences ? `${message}\n${preferences}` : message
}
