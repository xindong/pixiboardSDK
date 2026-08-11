import { CapabilityError, isCapabilityError, type BoardCapabilities } from "@pixi-board/capabilities";
import { canvasReadSchema, canvasWriteSchema } from "./schemas.ts";
import type { AgentCallOptions, AgentTools, CanvasOutput, CanvasReadInput, CanvasWriteInput, CompactAsset, CompactNode } from "./types.ts";
import type { AssetRecord, BoardNode, JsonValue } from "@pixi-board/capabilities";
export * from "./types.ts";
export * from "./schemas.ts";

export function createPixiBoardAgentTools(capabilities: BoardCapabilities): AgentTools {
  return { schemas: { "canvas.read": canvasReadSchema, "canvas.write": canvasWriteSchema }, async call(name, raw, options = {}) {
    const requestId = options.requestId;
    try {
      if (name === "canvas.read") return { ok: true, data: await read(capabilities, validateRead(raw), options) };
      if (name === "canvas.write") return { ok: true, data: await write(capabilities, validateWrite(raw), options) };
      throw new CapabilityError("INVALID_INPUT", `Unknown tool: ${name}`);
    } catch (error) { const e = isCapabilityError(error) ? error : new CapabilityError("INTERNAL_ERROR", error instanceof Error ? error.message : String(error)); return { ok: false, error: { code: e.code, name: e.name, message: e.message, retryable: e.code === "ABORTED" || e.code === "TRANSACTION_CONFLICT", requestId, details: e.details ? { ...e.details } : undefined } }; }
  } };
}
async function read(c: BoardCapabilities, input: CanvasReadInput, options: AgentCallOptions): Promise<CanvasOutput> {
  if (input.type === "nodes") { const r = await c.nodes.read({ filter: { ids: input.ids, types: input.types }, limit: input.limit, cursor: input.cursor }, options); return { type: "nodes", nodes: r.nodes.map((n) => compact(n, input.fields)), page: r.page, revision: r.revision, requestId: options.requestId }; }
  if (input.type === "assets") { const r = await c.assets.read({ ids: input.ids, kinds: input.kinds, limit: input.limit, cursor: input.cursor }, options); return { type: "assets", assets: r.assets.map((a) => project(a, input.fields)), page: r.page, revision: r.revision, requestId: options.requestId }; }
  const r = await c.preview.get({ nodeId: input.id, maxWidth: input.maxWidth, maxHeight: input.maxHeight, frameNumber: input.frameNumber, fps: input.fps }, options); return { type: "preview", preview: r, content: [{ type: "image", dataUrl: r.dataUrl, mimeType: r.mimeType }], revision: r.revision, requestId: options.requestId };
}
async function write(c: BoardCapabilities, input: CanvasWriteInput, options: AgentCallOptions): Promise<CanvasOutput> {
  const writeOptions = { ...options, origin: options.origin ?? "agent:canvas" };
  if (input.type === "delete") { const r = await c.nodes.delete({ nodeIds: input.nodeIds }, writeOptions); return { type: "delete", deletedNodeIds: [...(r.deletedNodeIds ?? [])], revision: r.revision, changeSet: r.changeSet, requestId: options.requestId }; }
  if (input.type === "create") {
    const nodes = input.nodes.map((node, index) => {
      const { content, path, ...rest } = node;
      const sourceValue = sourceOf(content, path);
      const source = sourceValue && { id: `agent-asset:${node.id ?? index}`, kind: "source", source: sourceValue };
      return { x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0, ...rest, ...(source ? { asset: source } : {}) };
    });
    const r = await c.nodes.create({ nodes }, writeOptions); return { type: "create", nodes: r.nodes.map((node) => compact(node)), revision: r.revision, changed: r.changed, changeSet: r.changeSet, requestId: options.requestId };
  }
  const current = await c.nodes.read({ filter: { ids: input.nodes.map((node) => node.id) } }, options);
  const byId = new Map(current.nodes.map((node) => [node.id, node]));
  const updates = input.nodes.map(({ id, content, path, ...patch }) => {
    if (content === undefined && path === undefined) return { id, patch };
    const node = byId.get(id);
    const assetId = node?.assetRefs?.primary?.assetId;
    if (!assetId) throw new CapabilityError("INVALID_INPUT", `nodes[${id}] source update requires a primary asset`);
    const asset = { id: assetId, kind: "source", source: sourceOf(content, path)! };
    return { id, patch: { ...patch, assetRefs: { ...(node.assetRefs ?? {}), primary: { assetId, variant: "original" as const } }, }, asset };
  });
  const r = await c.nodes.update({ nodes: updates }, writeOptions); return { type: "update", nodes: r.nodes.map((node) => compact(node)), revision: r.revision, changed: r.changed, changeSet: r.changeSet, requestId: options.requestId };
}
/** A node's inline source, as a JSON record rather than a union of two shapes. */
function sourceOf(content: string | undefined, path: string | undefined): Record<string, JsonValue> | undefined {
  if (content !== undefined) return { content };
  if (path !== undefined) return { path };
  return undefined;
}
function compact(node: BoardNode, fields?: string[]): CompactNode { const out: CompactNode = { id: node.id, type: node.type, ...(node.name === undefined ? {} : { name: node.name }) }; if (!fields?.length || fields.includes("position")) out.position = { x: node.x, y: node.y }; if (!fields?.length || fields.includes("size")) out.size = { width: node.width, height: node.height }; if (!fields?.length || fields.includes("rotation")) out.rotation = node.rotation; if (!fields?.length || fields.includes("zIndex")) out.zIndex = node.zIndex; if (!fields?.length || fields.includes("props")) out.props = node.props; return out; }
function project(value: AssetRecord, fields?: string[]): CompactAsset { if (!fields?.length) return { ...value }; const out: CompactAsset = { id: value.id, kind: value.kind }; for (const field of fields) if (field in value) out[field] = value[field] as JsonValue | undefined; return out; }
function validateRead(value: unknown): CanvasReadInput { if (!value || typeof value !== "object" || Array.isArray(value)) throw new CapabilityError("INVALID_INPUT", "canvas.read input must be an object"); const v = value as Record<string, unknown>; if (!["nodes", "assets", "preview"].includes(v.type as string)) throw new CapabilityError("INVALID_INPUT", "canvas.read.type is invalid"); const allowed = v.type === "nodes" ? ["type","ids","types","limit","cursor","fields"] : v.type === "assets" ? ["type","ids","kinds","limit","cursor","fields"] : ["type","id","maxWidth","maxHeight","frameNumber","fps"]; rejectUnknown(v, allowed); if (v.type === "preview" && typeof v.id !== "string") throw new CapabilityError("INVALID_INPUT", "canvas.read preview requires id"); if (v.limit !== undefined && (!Number.isInteger(v.limit) || Number(v.limit) < 1 || Number(v.limit) > 200)) throw new CapabilityError("INVALID_INPUT", "limit must be between 1 and 200"); return v as unknown as CanvasReadInput; }
function validateWrite(value: unknown): CanvasWriteInput { if (!value || typeof value !== "object" || Array.isArray(value)) throw new CapabilityError("INVALID_INPUT", "canvas.write input must be an object"); const v = value as Record<string, unknown>; if (!["create", "update", "delete"].includes(v.type as string)) throw new CapabilityError("INVALID_INPUT", "canvas.write.type is invalid"); rejectUnknown(v, v.type === "delete" ? ["type","nodeIds"] : ["type","nodes"]); if (v.type === "delete" ? !Array.isArray(v.nodeIds) || !v.nodeIds.length : !Array.isArray(v.nodes) || !v.nodes.length) throw new CapabilityError("INVALID_INPUT", "write payload must contain a non-empty batch"); return v as unknown as CanvasWriteInput; }
function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[]): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new CapabilityError("INVALID_INPUT", `Unsupported field: ${key}`); }
