# Vanilla consumer fixture

This is a small Vite app kept as a repository-outside consumer template. It
imports only the public `pixiboardjs` package root; it does not import `core`,
`renderer-pixi` or any source file from this repository.

To exercise it as the release gate described in the roadmap, copy this
directory outside the repository, install a packed `pixiboardjs` tarball (or a
published version), then run `pnpm install` and `pnpm dev` from the copy. The
planning worktree intentionally has no `dist/` implementation artifacts yet.
