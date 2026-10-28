# Contributing to Proofyard

Thanks for your interest in contributing to Proofyard!

## Licensing

By contributing to Proofyard, you agree your contributions will be licensed under the [MIT License](./LICENSE).

## Prerequisites

- Bun 1.4.3
- Node.js 26 (for `bun run compat`, which runs a real `next build` / `next start`)

## Workflow

Please open an issue first for anything beyond a small fix, so we can agree on the approach.

1. Fork the repo and run `bun install`
2. Make your changes, and add tests for new behavior
3. Make sure these pass:
   - `bun run test`
   - `bun run compat` if you touched rendering, routing, Flight, Server Actions or caching (slow)
4. Push to your fork and open a pull request

## Design rules

- Use Next.js's own implementation (router, rendering, Flight, Server Actions, caches). Don't reimplement React or Next.js internals.
- Unsupported features must fail with a clear error (fail closed), never silently pass as plain JavaScript.
- Behavior that differs from real Next.js needs a compatibility test against `next build` / `next start`, or a note in the README.

How it works is described in [docs/spec.md](docs/spec.md) ([日本語](docs/spec.ja.md)).

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/). Releases are cut from them by
[release-please](https://github.com/googleapis/release-please), so the type decides the next version:

```
feat: support Sass            # new feature -> minor bump
fix: reuse the SWC cache      # bug fix -> patch bump
docs: / test: / ci: / chore: / refactor: / perf:   # no release on their own
```

Add `!` (`feat!:`) or a `BREAKING CHANGE:` footer for breaking changes (minor bump before 1.0, major after). Keep each commit focused on one change.

## Releases

release-please keeps a release PR open with the next version and CHANGELOG. Merging it tags the
release, runs CI and stages the package on npm; a maintainer then approves it on npm (2FA).
