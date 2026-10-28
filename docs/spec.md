# Proofyard

<p><a href="spec.ja.md">日本語</a></p>

## Bun Native RSC Testing Framework: Overall Design and Technical Specification v1.0

**Status: Design phase / technical validation not yet done**  
**Targets: React 19 and later, Next.js App Router, Bun**  
**Language: TypeScript**  
**DOM implementation: turbo-dom**  
**Planned license: MIT**

---

# 1. Project Overview

## 1.1 Purpose

Build a framework that **tests Next.js React Server Components (RSC) on Bun quickly and accurately, without starting a real browser or a Next.js server**.

Today, async Server Components in Next.js are hard to handle in typical unit test environments, so teams tend to rely on E2E tests.

E2E tests with tools like Playwright carry a lot of overhead: starting a browser, starting a Next.js server, HTTP traffic, page navigation, and so on.

This project removes that unneeded work and aims for a developer experience close to regular Bun unit tests.

Speed must not come from skipping important React or Next.js behavior.

In particular, we focus on the following:

- React Flight serialization constraints
- The execution boundary between Server Components and Client Components
- Suspense and Streaming
- Server Actions
- Context Provider
- Next.js App Router
- Cache Components
- Hydration
- Client Router
- Error propagation

The end goal is **a Bun-native, in-process integration testing framework for Next.js App Router**.

## 1.2 Core Concept

> Test React Server Components and Next.js App Router applications with Bun, without launching a browser or Next.js server.

The core design principles are:

1. Use Bun as the test runner.
2. Reuse React's official rendering machinery.
3. Do not skip React Flight serialization.
4. Do not use a real browser.
5. Do not start a Next.js server.
6. As a rule, do not require bundling the whole application with Webpack or Turbopack.
7. Use turbo-dom for the DOM.
8. Keep Next.js-specific features in a separate Adapter.
9. Strictly isolate state between tests.
10. Do not fake unsupported features with inaccurate mocks. Raise an explicit error instead.

## 1.3 Non-Goals

The following are not direct development targets of this project:

- Building our own test runner
- Implementing our own React Reconciler
- Building our own DOM engine
- Reproducing a browser layout engine
- Pixel-level verification of CSS layout
- Visual Regression Testing
- Reproducing real network conditions
- Fully reproducing real-browser-specific behavior
- Fully replacing a Next.js production build
- Fully reproducing the Edge Runtime

This framework also does not aim to make E2E tests with Playwright or similar tools completely unnecessary.

Some areas can only be verified with E2E tests.

---

# 2. Technology Stack

## 2.1 Chosen Technologies

| Category | Technology | Purpose |
|---|---|---|
| Runtime | Bun | JavaScript execution |
| Test Runner | `bun:test` | Test execution |
| Language | TypeScript | Framework implementation |
| React | React 19+ | Component execution |
| RSC | Official React RSC Renderer | Rendering Server Components |
| Serialization | React Flight | Generating and restoring the RSC Payload |
| Client Renderer | `react-dom/client` | Running Client Components |
| SSR | `react-dom/server` | HTML generation |
| Testing | React Testing Library | DOM assertions |
| DOM | turbo-dom | DOM emulation |
| Next.js | App Router Adapter | Next.js integration |

For React's RSC implementation, the candidate packages are:

- `react-server-dom-webpack`
- `react-server-dom-turbopack`

Using these packages does not by itself start a Webpack or Turbopack build.

Client Reference generation and module mapping are still needed separately.

React and the RSC packages have internal version dependencies, so manage compatible combinations strictly.

## 2.2 Choosing turbo-dom

We use the following for DOM emulation:

https://github.com/miaskiewicz/turbo-dom

Reasons:

- Uses an HTML parser written in Rust
- Designed to reduce calls between JavaScript and Rust
- Runs DOM operations on the JavaScript side
- Lazy DOM node creation
- Reuses HTML parse results
- Caches DOM query results
- Designed with React Testing Library integration in mind

We do not take the approach of implementing the whole DOM in Rust.

React's DOM operations produce a large number of small calls. Passing all of them to Rust over FFI could actually hurt performance.

We still need to check in practice that turbo-dom works correctly with Bun and React 19, and that it is faster than happy-dom.

**turbo-dom is fixed as the chosen technology, but we keep the internal DOM Adapter boundary in case compatibility constraints come up.**

---

# 3. Overall Architecture

The system is split into the following six Runtimes and the Testing API.

```text
                         bun test
                            │
                            ▼
                ┌──────────────────────┐
                │     Testing API      │
                │                      │
                │ renderRSC()          │
                │ render()             │
                │ renderRoute()        │
                │ requestRoute()       │
                │ prerenderRoute()     │
                │ createTestContext()  │
                └──────────┬───────────┘
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
          ▼                ▼                 ▼
   ┌────────────┐  ┌──────────────┐  ┌──────────────┐
   │ Module     │  │ Routing      │  │ Request      │
   │ Runtime    │  │ Runtime      │  │ Runtime      │
   │            │  │              │  │              │
   │ Compiler   │  │ App Router   │  │ Request      │
   │ Transform  │  │ Layouts      │  │ Context      │
   │ RSC Graph  │  │ Client Router│  │ Cookies      │
   │ Client     │  │ Router Cache │  │ Headers      │
   │ Graph      │  │ Navigation   │  │ Proxy        │
   └──────┬─────┘  └──────┬───────┘  │ Actions      │
          │               │          └──────┬───────┘
          └───────────────┼─────────────────┘
                          │
                          ▼
                ┌──────────────────────┐
                │  Rendering Runtime   │
                │                      │
                │ React RSC Renderer   │
                │ Flight Serializer    │
                │ Flight Decoder       │
                │ React DOM Server     │
                │ React DOM Client     │
                │ turbo-dom            │
                └──────────┬───────────┘
                           │
               ┌───────────┴────────────┐
               │                        │
               ▼                        ▼
       ┌──────────────┐         ┌──────────────┐
       │ Cache        │         │ Lifecycle    │
       │ Runtime      │         │ Runtime      │
       │              │         │              │
       │ React.cache  │         │ Suspense     │
       │ Cache        │         │ Streaming    │
       │ Components   │         │ Transitions  │
       │ Revalidation │         │ Hydration    │
       │ PPR          │         │ after()      │
       └──────────────┘         └──────────────┘
```

Each Runtime has its own responsibilities, so Next.js-specific logic does not leak directly into React core processing.

---

# 4. Execution Modes

We provide three rendering modes for different kinds of tests.

## 4.1 RSC Mode

The lightest mode.

```tsx
const result = await renderRSC(<Page />);

expect(result.getByText("Alice")).toBeDefined();
```

Execution flow:

```text
Server Components
       ↓
React RSC Renderer
       ↓
Flight Serialization
       ↓
Flight Deserialization
       ↓
React tree structure checks
```

Covers:

- Sync Server Components
- Async Server Components
- Nested Server Components
- Props
- Suspense
- Flight serialization
- Client References
- Server Function References
- Error propagation

Characteristics:

- Does not create a DOM
- Does not run Client Components
- Does not start React DOM Server
- Does not need a real browser

Client Components are treated as Client References.

Queries in this mode inspect the React structure. Their semantics differ from DOM Testing Library queries.

## 4.2 SSR Mode

Runs up to the initial render of Client Components.

```tsx
const result = await render(<Page />, {
  mode: "ssr",
});

expect(result.getByText("Alice")).toBeDefined();
```

Execution flow:

```text
RSC Renderer
      ↓
Flight
      ↓
Flight Decoder
      ↓
React DOM Server
      ↓
HTML
      ↓
Assertions
```

Supports:

- Server Components
- Initial HTML of Client Components
- Context Provider
- Initial state of `useState`
- Nested Layouts
- Streaming SSR
- Suspense Fallback
- HTML structure checks

`useEffect` does not run.

When inspecting the HTML as a DOM, use turbo-dom.

Simple HTML string checks can skip DOM initialization.

## 4.3 Client Mode

Runs through React's Client Runtime.

```tsx
const result = await render(<Page />, {
  mode: "client",
});

await result.findByText("Ready");
```

Execution flow:

```text
RSC Renderer
      ↓
Flight Serialization
      ↓
Flight Deserialization
      ↓
React DOM Client
      ↓
turbo-dom
      ↓
React Testing Library
      ↓
Assertions
```

Supports:

- `useEffect`
- `useLayoutEffect`
- `useState`
- `useReducer`
- `useContext`
- `useTransition`
- `useOptimistic`
- `useActionState`
- `useFormStatus`
- DOM events
- Context Provider
- Client Suspense
- Portals
- State updates

Client Mode further distinguishes between the following render strategies.

```typescript
type ClientRenderStrategy =
  | "mount"
  | "hydrate";
```

`mount` uses `createRoot()`.

`hydrate` generates SSR HTML first, then uses `hydrateRoot()`.

Verifying Hydration Mismatch requires the latter.

---

# 5. Module Runtime

## 5.1 Responsibilities

The Module Runtime handles the following:

- Loading TypeScript/TSX
- Identifying the Server/Client module boundary
- Handling `"use client"`
- Handling `"use server"`
- Handling `"use cache"`
- Building the module graph
- Registering Client References
- Registering Server Function References
- Module mocks
- Path alias resolution

## 5.2 Server/Client Module Graphs

Server Components and Client Components use different module resolution conditions.

So they must not be processed as a single module graph.

```text
Application Source
        │
        ▼
 Module Analysis
        │
        ├── Server Graph
        │      ├── Server Components
        │      ├── Server Functions
        │      └── Server Dependencies
        │
        └── Client Graph
               ├── Client Components
               ├── Client Dependencies
               └── Browser Dependencies
```

When the server side imports a Client Component, return a Client Reference instead of running the Client Component directly.

On the client side, resolve the Client Reference to the actual module implementation.

Applying the `react-server` condition, Bun's module cache, and loading the same module under different execution conditions are key items to verify.

If needed, consider isolating execution environments with processes, Workers, module loaders, or similar.

**Whether Bun's plugin API alone can do the needed module transforms and resolution is not yet verified. This is the top-priority technical validation item.**

## 5.3 Client Reference

When a Server Component references a Client Component, generate a Client Reference that Flight can recognize.

Required information:

- Module ID
- Export Name
- Client Module Mapping
- Reference Metadata

For the Reference format, compatibility with React's official implementation comes first.

Do not define a custom protocol.

## 5.4 Server Functions

Support both of the following.

**Module level**

```tsx
"use server";

export async function createUser(data: FormData) {
  // ...
}
```

**Function level**

```tsx
export default function Page() {
  async function submit() {
    "use server";
    // ...
  }

  return <form action={submit} />;
}
```

Function-level `"use server"` requires a closure transform.

Detecting the directive alone is not enough.

Verify compatibility with the Next.js compiler.

---

# 6. Rendering Runtime

## 6.1 Use React's Official Renderer

Do not evaluate React components with custom recursive logic.

For example,

```tsx
const element = await Page();
```

this approach is not a substitute for proper RSC rendering.

It cannot accurately reproduce Suspense, the Server/Client boundary, React's internal async handling, Flight, and so on.

Use React's official RSC Renderer.

## 6.2 Flight Is Required

Every RSC test goes through Flight serialization.

```text
RSC Render
    ↓
Flight Encode
    ↓
Serialization Validation
    ↓
Flight Decode
    ↓
Assertions
```

This verifies the following:

- Props passed to Client Components
- Serializable values
- Non-serializable values
- Client References
- Server Function References
- Async values
- Error information
- Suspense boundaries

Flight is not JSON, so do not substitute `JSON.stringify()`.

Flight serialization errors may also be reported on the stream, so use the renderer's error notifications as well to decide completion or failure.

## 6.3 Streaming

Make it possible to verify intermediate states, not just the final result of async work.

```tsx
const result = await renderRoute("/users", {
  mode: "client",
  streaming: true,
});

await result.waitForFallback();

expect(result.getByText("Loading..."))
  .toBeDefined();

await result.waitForComplete();

expect(result.getByText("Alice"))
  .toBeDefined();
```

However, RSC stream progress and what the DOM displays are not the same thing.

Internally, we distinguish the following:

- RSC Streaming
- SSR Streaming
- Client Commit
- Suspense Resolution

## 6.4 Async Control

Provide a way for tests to deliberately pause and resume async work.

```tsx
const task = deferred<User>();

mockGetUser.mockImplementation(() => task.promise);

const result = await renderRoute("/users", {
  mode: "client",
});

expect(result.getByText("Loading..."))
  .toBeDefined();

task.resolve({
  id: "1",
  name: "Alice",
});

await result.findByText("Alice");
```

This is a proposed API.

Avoid implementations that resolve all async work immediately.

---

# 7. Mixing Server Components and Client Components

Support structures like the following.

```text
Server Component
    │
    └── Client Component
            │
            └── Server Component
                    │
                    └── Client Component
```

Example:

```tsx
export default function Page() {
  return (
    <ClientProvider>
      <ServerContent />
    </ClientProvider>
  );
}
```

```tsx
"use client";

export function ClientProvider({ children }) {
  return (
    <ThemeProvider>
      {children}
    </ThemeProvider>
  );
}
```

```tsx
export default async function ServerContent() {
  const user = await getUser();

  return <ClientCard user={user} />;
}
```

Here, ServerContent is not run directly by ClientProvider.

ServerContent is evaluated on the server, and its rendered result is passed as ClientProvider's children.

Preserve this execution boundary.

Also, a Server Component wrapped in a Client Provider must not be able to read Client Context directly.

---

# 8. Server Actions Runtime

## 8.1 Scope

The following are supported.

- `"use server"`
- Server Function Reference
- Server Action ID
- Calling Actions from the client
- Argument serialization
- Return value serialization
- FormData
- Argument binding with `.bind()`
- Closures
- `useActionState`
- `useFormStatus`
- `useOptimistic`
- Redirect
- Cache invalidation
- RSC re-rendering
- Client UI updates

## 8.2 Execution Flow

```text
Client Component
       │
       ▼
User Interaction
       │
       ▼
Server Action Proxy
       │
       ├── Serialize Arguments
       ├── Resolve Action ID
       └── Create Action Context
                    │
                    ▼
              Server Runtime
                    │
                    ├── Execute Action
                    ├── Update Data
                    ├── Update Cookies
                    ├── Revalidate Cache
                    └── Redirect
                    │
                    ▼
              Action Response
                    │
                    ├── Deserialize Result
                    ├── Refresh RSC
                    └── Update Client UI
```

No HTTP server is started. Actions run in memory.

However, argument and return value serialization is not skipped.

HTTP Origin checks, CSRF protection, real network communication, and similar concerns are tested separately.

## 8.3 Action Request Context

Normal RSC rendering and Server Actions use separate execution contexts.

```typescript
type ExecutionContext =
  | "rsc-render"
  | "server-action"
  | "route-handler"
  | "prerender";
```

The actual internal design holds independent context information, not just a single enum.

The Next.js APIs available to a Server Action are controlled according to its execution context.

## 8.4 Test Example

```tsx
test("can create a user", async () => {
  const app = await renderRoute("/users/new", {
    mode: "client",
  });

  await app.user.type(
    app.getByRole("textbox"),
    "Alice",
  );

  await app.user.click(
    app.getByRole("button", { name: "Create" }),
  );

  await app.findByText("Created");

  expect(
    app.actions.getCalls("createUser"),
  ).toHaveLength(1);
});
```

This API is a proposal.

---

# 9. Next.js App Router Runtime

## 9.1 Route Resolution

Resolves the Next.js App Router directory structure.

Supported:

- `page.tsx`
- `layout.tsx`
- `template.tsx`
- `loading.tsx`
- `error.tsx`
- `global-error.tsx`
- `not-found.tsx`
- `default.tsx`
- Route Groups
- Dynamic Routes
- Catch-all Routes
- Optional Catch-all Routes
- Parallel Routes
- Intercepting Routes

For example, given

```text
app/
├── layout.tsx
└── dashboard/
    ├── layout.tsx
    ├── loading.tsx
    └── users/
        └── [id]/
            └── page.tsx
```

the call

```tsx
await renderRoute("/dashboard/users/123");
```

assembles the required Page, Layouts, and Providers.

## 9.2 Layout and Template

Layouts and Templates have different lifecycles.

A Layout may be reused across navigations.

A Template is recreated when its segment is navigated to. This affects re-initialization of Client State and Effects.

This goes beyond assembling React elements. Navigation State is managed as well.

## 9.3 Client Router

The following are supported.

- `router.push()`
- `router.replace()`
- `router.refresh()`
- `router.back()`
- `router.forward()`
- `router.prefetch()`
- `<Link>`
- `usePathname()`
- `useSearchParams()`
- `useParams()`
- `useSelectedLayoutSegment()`
- `useSelectedLayoutSegments()`

The Client Router is not implemented as a simple URL change.

It manages the following state.

- Router State
- Segment Tree
- Router Cache
- Layout State
- Navigation History
- Pending Navigation
- Prefetch State

Key test targets:

- Layout reuse
- Preserving Provider state
- Preserving Client State
- RSC updates after `router.refresh()`
- Transitions involving Suspense
- Parallel Routes
- Intercepting Routes

## 9.4 Parallel Routes

Manages the display state of multiple slots.

Verifies cases where soft navigation and direct access produce different rendering results.

## 9.5 Intercepting Routes

Verifies that the same URL can show a different UI depending on where the navigation came from.

Example:

- Navigating from `/feed` to `/photo/123` shows a modal
- Direct access to `/photo/123` shows the normal page

Navigation State must be preserved.

---

# 10. Next.js Request Runtime

## 10.1 Supported APIs

The following are covered.

```typescript
cookies()
headers()
draftMode()

redirect()
permanentRedirect()
notFound()
forbidden()
unauthorized()
```

Other request-related APIs are supported depending on the Next.js version.

## 10.2 Request Context

The following is held per request.

```typescript
interface TestRequestContext {
  url: URL;
  method: string;
  headers: Headers;
  cookies: Map<string, string>;
  params: Record<string, string | string[]>;
  searchParams: URLSearchParams;
}
```

This is a conceptual interface. The real implementation takes compatibility with the Next.js async Request APIs and internal contexts into account.

The Request Context is not shared between tests.

## 10.3 Proxy

Covers `proxy.ts` in Next.js 16 and later.

Covered:

- Matcher
- Redirect
- Rewrite
- Request Headers
- Response Cookies
- Authentication
- Integration with Route Resolution

Tests that go through the Proxy are distinct from the mode that tests only the Page.

## 10.4 Route Handlers

Supports `app/api/**/route.ts`.

```tsx
const response = await requestRoute("/api/users", {
  method: "POST",
  body: JSON.stringify({
    name: "Alice",
  }),
});

expect(response.status).toBe(201);
```

Supported:

- GET
- POST
- PUT
- PATCH
- DELETE
- OPTIONS
- HEAD
- Request / Response
- FormData
- Streaming Response
- Cookies
- Headers
- Dynamic Params

Web standard Request/Response are used wherever possible.

---

# 11. Cache Runtime

## 11.1 Supported Caches

The following are kept distinct.

1. React's `cache()`
2. Next.js Cache Components
3. Next.js Client Router Cache
4. Internal framework caches for speed

These four kinds must not be confused.

## 11.2 React.cache()

React's `cache()` is treated as per-request memoization.

Results are reused within the same request.

Caches are properly isolated between independent requests.

## 11.3 Cache Components

Supported:

```typescript
"use cache"
"use cache: private"
"use cache: remote"

cacheLife()
cacheTag()

revalidatePath()
revalidateTag()
updateTag()
```

Cache Components depend on Next.js compiler transforms.

Running `"use cache"` as-is with Bun's standard TSX loader does not reproduce production caching behavior.

Compatibility with the Next.js compiler is therefore required.

If the compilation cannot be reproduced correctly, do not declare Cache Components support as enabled.

## 11.4 Cache Scopes

```text
Shared Immutable Cache
    ├── Module Transform Cache
    └── HTML Parse Cache

Test Context
    ├── Cache Components
    ├── Cache Tags
    └── Cache Lifetime

Request Context
    └── React.cache()

Render Context
    ├── DOM State
    ├── React Root
    └── Provider State

Client Session
    └── Router Cache
```

Basic principles:

- Immutable transform results may be reused.
- Application caches are isolated between tests.
- Cache Components may be shared within the same test.
- React.cache keeps request scope.
- DOM changes are not shared between tests.
- The Router Cache is managed per Client Session.

## 11.5 Cache Verification API

```tsx
test("reuses the cache", async () => {
  const ctx = createTestContext({
    cache: "isolated",
  });

  await ctx.renderRoute("/users");
  await ctx.renderRoute("/users");

  expect(getUsers).toHaveBeenCalledTimes(1);
});
```

A verification API is also provided for cache invalidation.

```tsx
expect(
  ctx.cache.getInvalidatedTags(),
).toContain("users");
```

These are proposed APIs.

---

# 12. Partial Prerendering

Covers the integration of Cache Components and PPR.

The key point is to distinguish normal RSC rendering from Prerender.

```text
Prerender Phase
      │
      ├── Static Shell
      │
      └── Deferred Boundaries
                    │
                    ▼
             Request Phase
                    │
                    ▼
             Dynamic Content
```

Supported:

- Static shell generation
- Request-time Rendering
- Suspense boundaries
- Dynamic APIs
- `connection()`
- Constraints during Prerender
- Integration with Cache Components

Proposed API:

```tsx
const result = await prerenderRoute("/dashboard");

expect(result.shell).toContain("Dashboard");

expect(result.dynamicBoundaries)
  .toHaveLength(1);
```

Verify by comparing against Next.js production behavior.

---

# 13. React Concurrent Rendering

## 13.1 Supported

- Suspense
- `use()`
- `useTransition()`
- `startTransition()`
- `useDeferredValue()`
- `useOptimistic()`
- Async rendering
- Suspended rendering
- Rendering retries
- UI state during a Transition
- Integration with Error Boundaries

## 13.2 Controlling Async Work in Tests

A priority is letting tests control when async work resolves.

For example, a test can check that optimistic UI appears before a Server Action completes.

```tsx
const action = app.actions.defer("createPost");

await app.user.click(
  app.getByRole("button", { name: "Post" }),
);

expect(
  app.getByText("Sending"),
).toBeDefined();

action.reject(new Error("Failed"));

await app.findByText("Failed to post");
```

This API is a proposal.

The design does not reimplement the React Scheduler. Instead, tests observe and control React's existing processing.

---

# 14. Hydration

Hydration checks are offered as an option of Client Mode.

```tsx
const result = await render(<Page />, {
  mode: "client",
  hydration: true,
});
```

Execution flow:

```text
RSC Render
     ↓
Flight
     ↓
SSR
     ↓
HTML
     ↓
turbo-dom
     ↓
hydrateRoot()
     ↓
Client Effects
```

Verified:

- Hydration Mismatch
- `onRecoverableError`
- `useId()`
- Initial Provider state
- Consistency between SSR and client output
- Effect execution
- StrictMode
- Events before Hydration

However, there is no guarantee that Hydration in turbo-dom matches a real browser exactly.

The scope of what a test result guarantees is therefore stated explicitly.

---

# 15. Error Boundary

The following Next.js features are supported.

- `error.tsx`
- `global-error.tsx`
- `not-found.tsx`
- `redirect()`
- `notFound()`
- `forbidden()`
- `unauthorized()`

The interaction between React Error Boundaries and Suspense boundaries is also verified.

Key cases:

- Exceptions in Server Components
- Exceptions in Client Components
- Exceptions in Server Actions
- Exceptions during Suspense
- Recovery through Error Boundaries
- Behavior of `reset()`
- How Nested Layouts relate to Error Boundaries

Error screens are not injected directly. Tests verify that exceptions propagate through the real React rendering path.

---

# 16. Metadata and Special Features

## 16.1 Metadata API

Supported:

- `metadata`
- `generateMetadata()`
- `generateViewport()`
- `generateStaticParams()`
- `sitemap.ts`
- `robots.ts`

Proposed API:

```tsx
const result = await renderRoute("/products/123");

expect(result.metadata.title)
  .toBe("Product 123");
```

Async Metadata and Streaming are also supported.

## 16.2 after()

Supports Next.js `after()`.

Work that runs after rendering completes is managed as a separate lifecycle.

```tsx
const result = await renderRoute("/dashboard");

await result.lifecycle.flushAfter();

expect(logPageView).toHaveBeenCalled();
```

## 16.3 Other

The following are also included in compatibility testing.

- `next/dynamic`
- `next/image`
- `next/font`
- `server-only`
- `client-only`
- `useSyncExternalStore`
- Portals
- Zustand
- Redux
- TanStack Query
- Jotai
- Environment variables
- Node.js Runtime
- Detecting Edge Runtime incompatibilities

Not all of these need a custom implementation.

Proofyard provides a runtime environment in which existing libraries work, and runs the necessary compatibility tests.

---

# 17. Execution Context

Keep the Next.js execution phases clearly separate.

```typescript
type ExecutionPhase =
  | "prerender"
  | "request"
  | "rsc-render"
  | "ssr"
  | "hydration"
  | "client-navigation"
  | "server-action"
  | "revalidation"
  | "after-response";
```

In practice, though, several phases can run in parallel or nest.

So instead of relying only on a simple state machine, keep independent contexts.

```typescript
interface RuntimeContext {
  request: RequestContext;
  render: RenderContext;
  cache: CacheContext;
  lifecycle: LifecycleContext;
}
```

Manage the Client Session in a separate context.

```typescript
interface ClientSessionContext {
  router: RouterContext;
  document: Document;
  reactRoot: unknown;
}
```

For context management, consider AsyncLocalStorage or similar tools available on Bun.

Request contexts must not get mixed up across async operations.

---

# 18. Testing API

## 18.1 Public API

Limit the core API to the following.

```typescript
renderRSC()
render()
renderRoute()
requestRoute()
prerenderRoute()
createTestContext()
```

Reuse the React Testing Library API as much as possible.

## 18.2 Unit RSC Tests

```tsx
import { test, expect } from "bun:test";
import { renderRSC } from "proofyard";

import Page from "./page";

test("shows the user", async () => {
  const result = await renderRSC(<Page />);

  expect(result.getByText("Alice"))
    .toBeDefined();
});
```

## 18.3 Route Integration Tests

```tsx
import { renderRoute } from "proofyard";

test("shows the dashboard", async () => {
  const result = await renderRoute("/dashboard", {
    mode: "client",
  });

  await result.findByText("Dashboard");
});
```

## 18.4 Request Context

```tsx
const result = await renderRoute("/dashboard", {
  cookies: {
    session: "test-session",
  },
  headers: {
    "x-test-user": "123",
  },
});
```

## 18.5 Server Actions

```tsx
const app = await renderRoute("/users/new", {
  mode: "client",
});

await app.user.type(
  app.getByRole("textbox"),
  "Alice",
);

await app.user.click(
  app.getByRole("button", { name: "Create" }),
);

await app.findByText("Created");
```

## 18.6 Client Router

```tsx
const app = await renderRoute("/dashboard", {
  mode: "client",
});

await app.router.push("/dashboard/users");

expect(app.router.pathname)
  .toBe("/dashboard/users");
```

## 18.7 Mocks

Use Bun's built-in mock API.

```tsx
import { mock } from "bun:test";
```

As a rule, do not build a custom mock system.

However, we need a way to apply mocks before RSC module transformation.

Pay attention to Bun's module cache and the order in which mocks are applied.

---

# 19. Isolation Between Tests

Even when state is reused to speed up tests, application state must never leak between tests.

Safe to share:

- Immutable module transform results
- Immutable HTML parse results
- Safe static metadata

Must be isolated:

- DOM Document
- React Root
- Provider State
- Effect State
- Request Context
- React.cache()
- Test state for Cache Components
- Router Cache
- Mock State
- Server Action Context

In Client Mode, unmount the React Root and clean up Effects at the end of each test.

When reusing shared state, guarantee that it can be reset correctly.

---

# 20. Performance Design

## 20.1 Core Principle

**Cut only unnecessary work, without sacrificing correctness.**

Optimization targets:

- Test startup
- Module loading
- Module transformation
- Flight generation
- Flight decoding
- DOM initialization
- React rendering
- Cleanup between tests
- Memory usage

## 20.2 Lazy Initialization

RSC Mode does not load DOM libraries.

SSR Mode does not start the Client Runtime.

Only Client Mode initializes turbo-dom and React DOM Client.

```text
RSC Mode
  └── Flight

SSR Mode
  └── Flight + SSR

Client Mode
  └── Flight + React DOM + turbo-dom
```

## 20.3 Caching

Reuse module transform results.

Reuse turbo-dom's immutable HTML parse results.

Keep these separate from the Next.js application cache.

## 20.4 Parallel Execution

Use Bun's parallel test features.

However, the following state must not be shared between parallel tests.

- Global DOM
- Request Context
- Client Session
- React Root
- Application Cache

Also consider isolation per worker or per process.

If the DOM must be registered globally, make sure tests running at the same time do not collide.

## 20.5 Benchmarks

Compare against:

- Plain Bun unit tests
- React Testing Library + happy-dom
- React Testing Library + turbo-dom
- vitest-plugin-rsc
- Playwright E2E

Metrics:

- Cold Start
- Warm Start
- Time per test
- Time for 100 tests
- Time for 1,000 tests
- Memory usage
- DOM initialization time
- Flight processing time
- Server Action execution time
- Cleanup time between tests

We do not promise any speedup factor in advance.

Improve based on measured results.

---

# 21. Directory Structure

Start as a single package with separate internal modules.

```text
proofyard/
│
├── src/
│   │
│   ├── core/
│   │   ├── runtime.ts
│   │   ├── context.ts
│   │   └── lifecycle.ts
│   │
│   ├── module/
│   │   ├── loader.ts
│   │   ├── transformer.ts
│   │   ├── server-graph.ts
│   │   ├── client-graph.ts
│   │   ├── client-reference.ts
│   │   └── server-reference.ts
│   │
│   ├── rendering/
│   │   ├── rsc-renderer.ts
│   │   ├── flight-encoder.ts
│   │   ├── flight-decoder.ts
│   │   ├── ssr-renderer.ts
│   │   ├── client-renderer.ts
│   │   └── suspense.ts
│   │
│   ├── dom/
│   │   ├── turbo-dom.ts
│   │   ├── environment.ts
│   │   ├── hydration.ts
│   │   └── cleanup.ts
│   │
│   ├── actions/
│   │   ├── registry.ts
│   │   ├── proxy.ts
│   │   ├── executor.ts
│   │   ├── serialization.ts
│   │   └── context.ts
│   │
│   ├── next/
│   │   ├── adapter.ts
│   │   ├── router/
│   │   ├── layouts/
│   │   ├── request/
│   │   ├── cache/
│   │   ├── proxy/
│   │   ├── metadata/
│   │   └── compiler/
│   │
│   ├── testing/
│   │   ├── render.ts
│   │   ├── render-rsc.ts
│   │   ├── render-route.ts
│   │   ├── request-route.ts
│   │   ├── prerender-route.ts
│   │   └── assertions.ts
│   │
│   └── index.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── compatibility/
│   ├── fixtures/
│   └── benchmarks/
│
├── examples/
│   └── next-app/
│
├── package.json
├── tsconfig.json
├── bunfig.toml
└── README.md
```

Design it so it can later be split into the following packages.

```text
@proofyard/core
@proofyard/next
@proofyard/dom
```

Splitting into packages is not required during early development.

---

# 22. Technical Validation

Run the following technical validations before implementation.

## PoC 1: Bun + RSC Renderer

Goal:

Confirm that React's official RSC renderer runs on Bun.

Scope:

- Async Server Components
- Flight Serialization
- Flight Deserialization
- Suspense
- Serialization errors

Success criteria:

- Runs on Bun alone
- No browser needed
- No Next.js server needed
- Uses React's official rendering path

## PoC 2: Server/Client Boundary

Goal:

Treat `"use client"` modules as Client References.

Scope:

```text
SC → CC → SC → CC
```

Success criteria:

- The Server Graph never runs Client Component implementations directly
- Flight can serialize Client References
- The Client Runtime can resolve the references
- Props serialization errors are detected

**This PoC is the most important item. The project's viability depends on it.**

## PoC 3: turbo-dom

Goal:

Confirm that Bun + React 19 + turbo-dom work together.

Scope:

- `createRoot()`
- `hydrateRoot()`
- `useEffect()`
- `useLayoutEffect()`
- Context
- Suspense
- DOM Events
- Forms
- Portals
- React Testing Library
- user-event

Success criteria:

- Works correctly in Bun Test
- State can be isolated between tests
- Performance is compared with happy-dom

## PoC 4: Server Actions

Goal:

Confirm that a Client Component can run a Server Action.

Scope:

- `"use server"`
- Server Function Reference
- FormData
- `useActionState`
- Action Result
- RSC Refresh

Success criteria:

- No HTTP communication needed
- Serialization of arguments and return values is verified
- The Server Action runs
- The Client UI updates

## PoC 5: Next.js App Router

Goal:

Confirm that Pages and Layouts of an existing Next.js app can be tested without changes.

Scope:

- Nested Layouts
- Dynamic Routes
- Cookies
- Headers
- Redirect
- Error Boundary

Success criteria:

- Uses a real Next.js application
- No Next.js server needed
- Route Resolution is correct

## PoC 6: Cache Components

Goal:

Check whether Next.js `"use cache"` can run with the same semantics as in production.

Scope:

- Compiler transformation
- Cache keys
- `cacheLife`
- `cacheTag`
- Revalidation
- Isolation between tests

Success criteria:

- Comparison tests against Next.js itself pass
- No cache pollution occurs
- Unsupported cases are detected explicitly

---

# 23. Development Roadmap

## Phase 0: Technical Validation

Do this first.

- Bun + React RSC
- Flight
- Server/Client Module Graph
- turbo-dom
- React DOM Client
- Next.js Compiler compatibility

Start the full implementation only after confirming feasibility.

## Phase 1: Core RSC Testing

- `renderRSC()`
- Async Server Components
- Flight
- Server/Client boundary
- Suspense
- Serialization errors
- Inspection API for test results

This phase makes RSC unit testing practical.

## Phase 2: Client Integration

- turbo-dom
- React Testing Library
- `useEffect`
- Context
- Provider
- Events
- Forms
- SSR Mode
- Client Mode
- Hydration foundation

## Phase 3: Server Actions

- `"use server"`
- Action Registry
- Action Proxy
- FormData
- `useActionState`
- `useFormStatus`
- `useOptimistic`
- UI updates after an Action runs

## Phase 4: Next.js Integration

- App Router
- Nested Layouts
- Dynamic Routes
- Request Context
- Cookies
- Headers
- Redirect
- Error Boundary
- Route Handlers
- Proxy

## Phase 5: Client Navigation

- Client Router
- Router Cache
- Layout State
- Navigation History
- Parallel Routes
- Intercepting Routes
- `router.refresh()`
- Streaming Navigation

## Phase 6: Cache Components / PPR

- `"use cache"`
- Cache Components
- `cacheLife`
- `cacheTag`
- Revalidation
- PPR
- Prerender
- Static Shell
- Dynamic Boundaries

## Phase 7: Advanced Compatibility

- Metadata
- `after()`
- StrictMode
- Hydration Mismatch
- Edge Runtime differences
- Dynamic Imports
- React Concurrent Rendering

## Phase 8: Performance Optimization

- Module transform cache
- DOM initialization optimization
- Parallel tests
- Memory optimization
- Benchmarks
- Watch Mode

---

# 24. Quality Assurance

## 24.1 Comparison Tests Against Next.js

Use real Next.js to verify compatibility.

Run the same test fixtures in these two environments.

```text
Test Fixture
     │
     ├── Next.js Reference
     │       ├── RSC
     │       ├── Flight
     │       ├── SSR
     │       └── Client
     │
     └── Proofyard
             ├── RSC
             ├── Flight
             ├── SSR
             └── Client
```

What to compare:

- Rendering output
- Flight semantics
- HTML
- Errors
- Redirect
- Suspense
- Server Actions
- Cache Components
- Router State

The raw Flight bytes may depend on internal formats and generation order. So do not always require an exact match. Compare the semantics that matter.

## 24.2 Version Compatibility

Run tests for each React and Next.js version.

However, supporting every combination creates a large maintenance burden.

In the early stages, limit the target versions.

For React and RSC-related packages, support only combinations that have been confirmed compatible.

## 24.3 Fail Closed

Never let a test pass by running an unsupported feature as plain JavaScript.

For example, if compilation of `"use cache"` is not implemented, raise an explicit error.

```text
Unsupported Next.js feature:

Cache Components compilation is not supported
by the current runtime.
```

This is a key design principle of this project.

---

# 25. Acceptance Criteria

The acceptance criteria for the initial release are as follows.

### Required

- Runs with `bun test`.
- Does not launch a real browser.
- Does not start a Next.js server.
- Can test async Server Components.
- Can verify Flight serialization.
- Can detect serialization errors.
- Can handle SC → CC → SC structures.
- Can verify Suspense.
- Can render Client Components with turbo-dom.
- Can verify `useEffect`.
- Can handle Providers.
- Can test the basic execution path of Server Actions.
- DOM and Request Context do not leak between tests.
- Can detect unsupported Next.js features.

### After the Initial Release

- Full App Router Layout Resolution
- Client Router
- Router Cache
- Parallel Routes
- Intercepting Routes
- Cache Components
- PPR
- Advanced Server Actions
- Metadata
- Proxy
- Route Handlers
- Advanced Hydration verification

Here, "initial release" means a minimal, practical RSC test environment.

Support for every Next.js feature is not a requirement for the initial release.

---

# 26. Top Technical Risks

We consider the technical risks of this project to be, from largest to smallest, as follows.

### Risk 1: Module Resolution for Bun and React RSC

This is the most important problem.

React Server Components need different module resolution for Server and Client.

It has not been verified whether Bun's standard loader alone can do this correctly.

If Bun's loader is not enough, an extra transform layer or isolated execution contexts will be needed.

### Risk 2: Dependence on the Next.js Compiler

The following features are tightly coupled to the Next.js compiler.

- `"use client"`
- `"use server"`
- `"use cache"`
- Server Action Closure
- Cache Components

React's RSC Renderer alone cannot fully reproduce how Next.js behaves in production.

We need to investigate ways to reuse the Next.js compiler.

### Risk 3: Reproducing the Client Router

`router.refresh()` and soft navigation merge a new RSC Payload into the existing React tree.

A simple re-render cannot accurately reproduce how Client State is preserved.

How much of the Next.js Router implementation we can reuse is a key question.

### Risk 4: Cache Components

Cache Components depend on the compiler, Request Context, Prerender, cache storage, Revalidation, and more.

A custom implementation can easily drift from production semantics.

### Risk 5: turbo-dom

turbo-dom's Bun compatibility, React 19 compatibility, Hydration, and how faithfully it reproduces form events must be verified in practice.

We keep the decision to adopt it, and add tests that catch problems early.

---

# 27. Key Development Rules

Any other AI that implements this project must follow these rules.

**1. Clearly separate what is implemented from what is not.**

Do not treat features that the design plans to support as already implemented.

**2. Do not casually reimplement React internals.**

Prefer the existing React RSC Renderer, React DOM, and Flight implementations.

**3. Do not reproduce Next.js behavior by guessing.**

Refer to the Next.js implementation whenever possible, and add comparison tests.

**4. Do not skip Flight to gain speed.**

We need to detect serialization errors specific to RSC.

**5. Do not break the Server/Client boundary.**

Never run a Client Component directly as a Server Component.

**6. Respect cache scopes.**

Keep caches for test speed separate from application caches.

**7. Use turbo-dom as the standard DOM implementation.**

However, keep the DOM Adapter boundary in place to prepare for compatibility issues.

**8. Do not launch unnecessary browsers, servers, or bundlers.**

However, do not blindly remove transform steps that are actually needed.

**9. Put correctness ahead of performance.**

A fast but inaccurate test has no value.

**10. Start implementation with technical validation.**

In particular, do not move forward with large-scale implementation until you confirm that Bun + React RSC Renderer + Flight + Client Reference works.

---

# 28. Final Goal

The final goal is to be able to run tests like the following.

```tsx
import { test, expect } from "bun:test";
import { renderRoute } from "proofyard";

test("from creating a user to updating the list", async () => {
  const app = await renderRoute("/users", {
    mode: "client",
    cookies: {
      session: "test-session",
    },
  });

  await app.user.click(
    app.getByRole("button", {
      name: "Create new",
    }),
  );

  await app.user.type(
    app.getByRole("textbox", {
      name: "Name",
    }),
    "Alice",
  );

  await app.user.click(
    app.getByRole("button", {
      name: "Save",
    }),
  );

  await app.findByText("Alice");

  expect(
    app.actions.getCalls("createUser"),
  ).toHaveLength(1);

  expect(
    app.cache.getInvalidatedTags(),
  ).toContain("users");
});
```

This test is expected to run all of the following.

```text
Bun Test
   │
   ▼
Next.js Route Resolution
   │
   ▼
Nested Layouts
   │
   ▼
React Server Components
   │
   ▼
Flight Serialization
   │
   ▼
Flight Deserialization
   │
   ▼
React DOM Client
   │
   ▼
turbo-dom
   │
   ▼
User Interaction
   │
   ▼
Server Action
   │
   ▼
Cache Invalidation
   │
   ▼
RSC Re-render
   │
   ▼
Client UI Update
   │
   ▼
Assertions
```

All of this **runs inside the Bun process, without starting a Next.js server or a real browser**.

Note that the APIs in this code are a proposed spec showing the intended developer experience. They are not a verified, working implementation.

---

# 29. Final Policy

This project gives top priority to the following three points.

**Correctness:** Match the actual behavior of React RSC and Next.js as closely as possible.

**Speed:** Remove browsers, servers, and unnecessary bundling, and run fast on Bun.

**Maintainability:** Limit dependence on React and Next.js internals, and keep up with version changes through Adapters and compatibility tests.

The first technical problem to tackle is **separating the Server/Client module graphs on Bun and getting React's official RSC Renderer and Flight to work correctly**.

Once that works, extend step by step to the turbo-dom Client Runtime, Server Actions, the Next.js App Router, and Cache Components.

**This spec defines the final target. The feasibility of every feature has not been verified. The implementing AI must first confirm each technical assumption with a PoC and compatibility tests.**
