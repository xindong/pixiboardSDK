## Summary

<!-- What does this PR change, and why? Link the related issue if there is one. -->

## Test plan

<!-- How did you verify this works? Check what applies and add specifics (which suites, what you saw). -->

- [ ] `pnpm docs:check` / `pnpm packages:check`
- [ ] Relevant test suite(s): `pnpm test:core` / `pnpm test:contracts` / `pnpm test:adapters` / `pnpm test:browser`
- [ ] Demo site still builds/runs: `pnpm --filter pixiboardjs-site build` (or `dev` + manual check)
- [ ] Benchmarks unaffected or intentionally updated: `pnpm benchmark:run` / `pnpm benchmark:check`
- [ ] Added/updated a [changeset](https://github.com/changesets/changesets) if this touches a published package's public API (`pnpm exec changeset`)

## Notes for reviewers

<!-- Anything that needs extra attention: architectural tradeoffs, follow-up work, things you're unsure about. -->
