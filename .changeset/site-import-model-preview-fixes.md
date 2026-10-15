---
"pixiboardjs": patch
---

Fix the official site generic host import dispatch so imported assets are routed through the configured host preview flow.

Keep local model content-addressed variants in isolated copies so preview variant updates do not mutate shared asset data.
