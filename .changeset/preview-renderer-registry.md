---
"@pixi-board/core": minor
---

Add `PreviewRenderer` and `PreviewRendererRegistry`: previews are produced by registered renderers, one per format, with no built-in renderers in core. Remove the format-specific `isDocumentPreviewType`, `isPreviewNodeType` and the ZIP special case in `previewStatusLabel`; add `defaultHeight` to `PreviewSpecOptions` in place of the hard-coded model height.
