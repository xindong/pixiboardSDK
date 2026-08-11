# Contributing to PixiBoardJS

Thanks for your interest in contributing! This document covers the local setup, test layout, and PR workflow. For architectural context, start with [docs/README.md](docs/README.md) and the [ADRs](docs/adr).

## Getting started

```bash
git clone https://github.com/xindong/pixiboardSDK.git
cd pixiboardSDK
pnpm install
```

Requires Node.js >=20 and pnpm (the pinned version is in `packageManager` in [`package.json`](package.json); `pnpm install` will use it automatically via Corepack).

## Running checks locally

```bash
# static boundary and doc checks
pnpm docs:check
pnpm packages:check

# layered test suites
pnpm test:core          # @pixi-board/core
pnpm test:contracts     # capabilities / agent-tools contracts
pnpm test:adapters      # adapter-browser / adapter-tauri / contract test suite
pnpm test:browser       # Chromium renderer contract (requires Playwright browsers: pnpm exec playwright install --with-deps chromium)

# demo site
pnpm --filter pixiboardjs-site dev     # local dev server
pnpm --filter pixiboardjs-site build   # production build (same as CI/Pages)

# performance benchmarks
pnpm benchmark:run       # local headless benchmark
pnpm benchmark:check     # compare against historical baseline
```

CI runs the same checks on every push/PR — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Project structure

This is a pnpm workspace. `pixiboardjs` is the only package published for external consumers; everything under `@pixi-board/*` is an internal implementation package (some are still published for dependency-direction reasons — see the [package boundaries doc](docs/03-package-boundaries.md) for what's actually meant to be consumed directly).

- `packages/core` — the document/store/transaction/history engine. No DOM, no Pixi, no platform assumptions.
- `packages/renderer-pixi` — the PixiJS rendering layer (disposable viewport cache, not a source of truth).
- `packages/pixiboardjs` — the public facade that wires everything together.
- `apps/site` — the interactive demo deployed to GitHub Pages.
- `apps/examples-*` — smaller, focused consumer examples (vanilla JS, custom nodes, Tauri desktop).

## Making changes

1. Before writing code for anything non-trivial, check the [docs](docs/) and [ADRs](docs/adr) for existing architectural decisions — the flat-document model and package boundaries are intentional and load-bearing; changes that cut across them need an ADR, not just code.
2. Keep changes scoped to what the issue/PR describes. Avoid unrelated refactors in the same PR.
3. Add or update tests alongside behavior changes — every package has its own `test/` (or colocated `*.test.ts`) run via `vitest`.
4. If your change affects a published package's public API, add a [changeset](https://github.com/changesets/changesets):
   ```bash
   pnpm exec changeset
   ```
   Describe the change and select the affected package(s); this drives changelog generation and version bumps on release.
5. Run the relevant test suites locally before opening a PR (see above). CI will re-run everything, but catching failures locally saves round-trips.

## Commit and PR conventions

- Prefer small, reviewable PRs over large multi-concern ones.
- Write commit messages that explain *why*, not just *what* — the diff already shows what changed.
- Link the PR to any relevant issue.
- Fill out the PR template's test plan — untested changes to the renderer or persistence layers are especially risky given how much of this SDK's contract is about performance and data integrity.

## Reporting bugs / requesting features

Use the [issue templates](.github/ISSUE_TEMPLATE) — they ask for the information that's actually needed to reproduce or evaluate a request (SDK version, minimal repro, expected vs. actual behavior).

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
