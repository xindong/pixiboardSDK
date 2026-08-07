# @pixi-board/core

Headless document and transaction package for PixiBoardJS. It remains
independent of DOM, PixiJS, Tauri, plugins and the product UI.

Public snapshots stay detached and deeply immutable. Change events also carry
an immutable `BoardDocumentUpdate` containing only nodes named by the
`BoardChangeSet`, so runtime consumers can update caches without materializing
the complete flat `BoardDocument` after every commit.
