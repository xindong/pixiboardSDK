---
"pixiboardjs": patch
---

Fix lost variant index entries during concurrent BrowserPersistenceAdapter writes by serializing writes for the same asset.

Merge NativeIndexedDB variant updates within a transaction so concurrent writes preserve all variant index entries.
