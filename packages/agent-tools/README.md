# @pixi-board/agent-tools

`canvas.read` / `canvas.write` over `@pixi-board/capabilities`, shaped for
language-model callers.

```ts
import { createPixiBoardAgentTools } from "@pixi-board/agent-tools";

const tools = createPixiBoardAgentTools(board.capabilities);

await tools.call("canvas.write", {
  type: "create",
  nodes: [{ type: "rect", x: 40, y: 40, width: 120, height: 80 }],
});
```

What this layer adds over calling capabilities directly:

- **JSON Schema** for both tools (`tools.schemas`, or the `./schemas` entry
  point), ready to hand to a model as a tool definition.
- **Runtime input validation** that rejects unknown fields, rather than trusting
  a model to respect a TypeScript type.
- **Compact node DTOs** with `fields` projection and pagination, so a large board
  does not arrive as one enormous JSON blob.
- **Serializable errors** — `{ ok: false, error }` instead of a thrown class,
  with `retryable` marked, so a result can cross a process or network boundary.
- **Unified import routing** — `content`, `path`, or a structured `source`
  object goes through the host's `AssetImportService`. The provider probes
  media, creates derivatives, and commits the asset and node together. Raw
  video/document bytes are never exposed as texture refs, and omitted node
  dimensions use the imported media's intrinsic ratio.

Writes default to `origin: "agent:canvas"` and are ordinary transactions: they
undo, they emit the same ChangeSet, and they are attributable.

**Transport is not included.** This package is a tool contract and nothing more.
Wire it to MCP, HTTP, a worker, or direct function calls in whatever shape your
own agent harness expects.
