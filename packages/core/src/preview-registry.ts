import { NodeValidationError } from "./errors";
import type { PreviewBlobLike, PreviewRenderer, PreviewSource } from "./preview-renderer";

export type RegisterPreviewRendererOptions = { replace?: boolean };
export type PreviewRendererRegistryOptions = { development?: boolean };

/**
 * Ordered set of preview renderers. Resolution is by descending priority, then
 * registration order, and asks each renderer's `supports()` in turn, so adding
 * a format never requires editing a central format list.
 */
export class PreviewRendererRegistry<Context = unknown, Data extends PreviewBlobLike = PreviewBlobLike, Out = unknown> {
  private readonly renderers = new Map<string, { renderer: PreviewRenderer<Context, Data, Out>; order: number }>();
  private readonly development: boolean;
  private counter = 0;

  constructor(options: PreviewRendererRegistryOptions = {}) {
    this.development = options.development ?? false;
  }

  register(renderer: PreviewRenderer<Context, Data, Out>, options: RegisterPreviewRendererOptions = {}): () => void {
    if (typeof renderer.id !== "string" || renderer.id === "") {
      throw new NodeValidationError("Preview renderer id must be a non-empty string");
    }
    if (typeof renderer.supports !== "function" || typeof renderer.render !== "function") {
      throw new NodeValidationError(`Preview renderer must implement supports() and render(): ${renderer.id}`);
    }
    const existing = this.renderers.get(renderer.id);
    if (existing && !options.replace) {
      throw new NodeValidationError(`Preview renderer is already registered: ${renderer.id}`);
    }
    if (existing && !this.development) {
      throw new NodeValidationError(`Replacing preview renderers is only allowed in development: ${renderer.id}`);
    }
    const entry = { renderer, order: existing?.order ?? this.counter++ };
    this.renderers.set(renderer.id, entry);
    return () => {
      if (this.renderers.get(renderer.id) === entry) this.renderers.delete(renderer.id);
    };
  }

  has(id: string): boolean {
    return this.renderers.has(id);
  }

  /** In resolution order. */
  list(): ReadonlyArray<PreviewRenderer<Context, Data, Out>> {
    return [...this.renderers.values()]
      .sort((a, b) => (b.renderer.priority ?? 0) - (a.renderer.priority ?? 0) || a.order - b.order)
      .map((entry) => entry.renderer);
  }

  /** First renderer whose `supports()` accepts the source; a throwing probe counts as "no". */
  async resolve(source: PreviewSource<Data>): Promise<PreviewRenderer<Context, Data, Out> | undefined> {
    for (const renderer of this.list()) {
      try {
        if (await renderer.supports(source)) return renderer;
      } catch {
        // A faulty probe must not hide lower-priority renderers.
      }
    }
    return undefined;
  }
}
