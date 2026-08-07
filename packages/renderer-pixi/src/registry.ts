import type { BoardNode, JsonValue } from "@pixi-board/core";
import type { PixiNodeRenderer } from "./types";
export class NodeRendererRegistry {
  private readonly renderers = new Map<string, PixiNodeRenderer<any, any>>();
  register<Props extends JsonValue, State>(type: string, renderer: PixiNodeRenderer<Props, State>, options: { replace?: boolean } = {}): () => void { if (!type.trim()) throw new Error("Renderer type must be a non-empty string"); if (this.renderers.has(type) && !options.replace) throw new Error(`Renderer already registered: ${type}`); this.renderers.set(type, renderer as PixiNodeRenderer<any, any>); return () => { if (this.renderers.get(type) === renderer) this.renderers.delete(type); }; }
  get<Props = JsonValue, State = unknown>(type: string): PixiNodeRenderer<Props, State> | undefined { return this.renderers.get(type) as PixiNodeRenderer<Props, State> | undefined; }
  has(type: string): boolean { return this.renderers.has(type); }
  resolve<Props = JsonValue, State = unknown>(node: Readonly<BoardNode<Props>>): PixiNodeRenderer<Props, State> | undefined { return this.get<Props, State>(node.type); }
  list(): string[] { return [...this.renderers.keys()]; }
}
