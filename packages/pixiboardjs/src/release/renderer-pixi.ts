import type { BoardChangeSet, BoardDocument } from "@pixi-board/core";

/** Public, host-agnostic renderer configuration. Internal renderer ports remain bundled implementation details. */
export type PixiBoardRendererOptions = Readonly<Record<string, unknown>>;

/** Declaration-only shape used while bundling the public pixiboardjs API. */
export declare class PixiBoardRenderer {
  constructor(options: PixiBoardRendererOptions);
  init(): Promise<void>;
  rebuild(snapshot: Readonly<BoardDocument>): Promise<void>;
  apply(snapshot: Readonly<BoardDocument>, changeSet?: BoardChangeSet): Promise<void>;
  destroy(): Promise<void>;
}
