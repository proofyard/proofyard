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

How it works is described in [docs/handoff.md](docs/handoff.md) and [docs/spec.md](docs/spec.md) (Japanese).

## Commits

Write commit messages in English, in the imperative mood ("Support Sass", "Fix ..."). Keep each commit focused on one change.
