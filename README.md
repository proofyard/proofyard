<p align="center">
  <img src=".github/brand/mark.svg" alt="Proofyard" width="96">
</p>

<h1 align="center">Proofyard</h1>

<p align="center">Test Next.js App Router apps with <code>bun test</code>. No browser, no Next.js server.</p>

<p align="center"><a href="README.ja.md">日本語</a></p>

Proofyard runs your routes through Next.js's own router, rendering, Flight,
Server Actions and caches, and puts the result in a DOM you can query with
Testing Library. It doesn't reimplement React or Next.js internals, and
anything it doesn't support fails loudly instead of silently passing.

## Speed

The same test (open `/`, check data loaded by an async Server Component, click
a Client Component button and wait for the update), 2 cores, 2026-10-24:

| | 1,000 tests | Per test | Peak memory |
| --- | --- | --- | --- |
| Proofyard (2 workers) | 41.8 s | 31 ms | 486 MB |
| vitest-plugin-rsc 0.4.0-alpha.0 (Browser Mode) | 341 s | 325 ms | 1,539 MB |
| Playwright (`next start`, 2 workers) | 615 s | 604 ms | 962 MB |

React Testing Library alone is faster (12–14 ms per test) but only renders
Client Components, without the server, Flight or routing.

## Requirements

- Bun 1.4
- Next.js 16.4.x (16.4.2 or later) and the React it bundles

Other versions fail at startup, because Proofyard uses Next.js internals
directly. Each new minor (16.5 and so on) needs a Proofyard release.

> Status: early development. Expect breaking changes before 1.0.

## Install

```sh
bun add -d proofyard
```

Your app needs `next` (16.4.2 or a later 16.4 patch), `react` and `react-dom`. Testing Library and
turbo-dom come with Proofyard.

`bunfig.toml`:

```toml
[test]
preload = ["proofyard/preload"]
```

`PROOFYARD_NEXT_APP` sets the app directory (default: the current directory).
`PROOFYARD_CACHE_DIR` sets where SWC output and similar files are cached
(default: `proofyard-cache` in the temp directory). Keep it between CI runs for
faster startup. When the app's files, config, env and dependencies are
unchanged, the next run reuses the previous bundles and prerender results.
That reuse does not see outside data that prerendering reads (for example a
database in `generateStaticParams`). Set `PROOFYARD_NO_CACHE=1` to rebuild
everything.

## Quick start

```tsx
import { expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";

test("adds a user", async () => {
  const app = await renderRoute("/users", { cookies: { session: "alice" } });
  await app.user.type(app.getByRole("textbox", { name: "new user" }), "Bob");
  await app.user.click(app.getByRole("button", { name: "Add" }));
  await app.findByText("Bob");

  await app.router.push("/users/Bob");
  expect(app.router.pathname).toBe("/users/Bob");
});

test("Route Handler and Proxy", async () => {
  const res = await requestRoute("/api/users/Alice", { cookies: { session: "Ann" } });
  expect(res.status).toBe(200);
});
```

Use Bun's `mock.module` to replace your app's modules. Mocks are restored after
the test (or after the file, when called at the top level).

## API

| API | What it does |
| --- | --- |
| `requestRoute(url, { method, headers, cookies, body })` | Handles the request like `next start` (Proxy, `next.config` redirects / rewrites / headers, Route Handlers, Server Actions) and returns a `Response`. |
| `renderRoute(url, { mode, streaming, headers, cookies })` | Renders the route's HTML into the DOM. `mode: "client"` (default) hydrates with Next.js's own client, so `app.router`, `Link` and Server Actions work. Calling it again in the same test is like a page reload. `app.actions.getCalls(nameOrAction)` returns this test's Server Action calls, and `app.cache.getInvalidatedTags()` the invalidated cache tags. |
| `prerenderRoute(url)` | The static shell (Partial Prerendering) of a `cacheComponents` app, the same as the `.html` from `next build`. For dynamic routes, pass the route path (`/products/[id]`) for the fallback shell, or a concrete URL for the shell `next start` sends first. |
| `renderRSC(element)` | Renders Server Components through Flight and returns the tree (Client Components don't run). |
| `render(element, { mode, hydrate })` | Component-level SSR, client rendering or hydration. |
| `createTestContext()`, `getInvalidatedTags()`, `flushAfter()` | Inspect caches, wait for `after()` to finish. |

The DOM, React roots, request context, app caches (`"use cache"`, tags), router
cache and `mock.module` are isolated per test. Tests running concurrently in the
same process (`test.concurrent`) can't be isolated, so they fail. Use
`bun test --parallel` instead.

## Differences from Next.js

- `requestRoute` and `renderRoute` render the whole page at request time, even
  for static routes (`next start` serves the HTML from build time). This lets
  per-test data and mocks take effect.
- For `Link` prefetches of static segments in `cacheComponents` apps (`/_tree`
  and so on), Next.js serves data made at build time. Proofyard makes the same
  data (a prerender of the static parts) the first time a test requests that
  page, and discards it after the test. So static parts like `"use cache"` run
  once per test.
- Your app code runs on Bun (for example, `Response.json()` adds
  `charset=utf-8` to `content-type`).
- The Pages Router (`pages/`) is not supported and fails at startup. Test it
  with Vitest and React Testing Library.
- Other unsupported features (Edge Runtime, CommonJS `"use server"` in
  `node_modules` and more) fail loudly instead of running differently.

## Development

```sh
bun run test           # all tests
bun run compat         # compare with a real next build / next start (slow)
bun run bench:api      # time per test and its breakdown
bun run bench:compare  # compare with RTL, vitest-plugin-rsc, Playwright and more
```

The spec is in [docs/spec.md](docs/spec.md) ([日本語](docs/spec.ja.md)).

## License

MIT ([LICENSE](./LICENSE))
