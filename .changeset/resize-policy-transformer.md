---
"pixiboardjs": minor
"@pixi-board/core": minor
---

Implement selection resize end to end and connect the previously inert `ResizePolicy`.

- core: `resolveResize()` / `resolveResizeSize()` turn one handle drag into a patch through the node type's policy (`free`, `aspect-ratio`, `fixed`, `custom`), resolving the delta in a rotated node's own frame and anchoring the edges the handle does not own. `nodes.resize()` commits it; a refused resize produces no revision. Policies are now validated at registration instead of failing silently at runtime.
- core: `TransactionOptions.coalesceKey` merges a per-frame pointer gesture into one history entry, compacting the repeated replace patches so a long drag does not leave thousands of them on a single undo step.
- pixiboardjs: `board.transform` drives resize gestures for the current selection — handle placement with rotation-aware cursors, single-node and group bounds, and `begin`/`update`/`commit`/`cancel` sessions. Group resize scales the selection as one unit while each node's size still passes through its own policy.
- pixiboardjs/browser: `attachDomTransformer()` renders the eight control points as real, grabbable DOM elements and drives the gesture from their pointer events.
