# Vanilla consumer fixture

This is a small Vite app kept as a repository-outside consumer template. Its
production entry path imports only the public `pixiboardjs` package root.

The in-repository Playwright gate also loads `src/browser-contract.js`. That
test-only module is loaded only with `?browser-contract=1` and exercises the browser adapter and renderer package directly
for native IndexedDB CAS/quota and real Chromium WebGL recovery. Production
example code remains on the public `pixiboardjs` import path.

To exercise it as the release gate described in the roadmap, copy this
directory outside the repository, install a packed `pixiboardjs` tarball (or a
published version), then run `pnpm install` and `pnpm dev` from the copy. The
in-repository fixture uses `workspace:*`; the release gate replaces it with the
real tarball only after publishable JavaScript/types and dependency versions
exist.
