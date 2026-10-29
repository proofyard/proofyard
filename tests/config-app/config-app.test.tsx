// basePath・trailingSlash・forbidden() / unauthorized()・global-error.tsx のアプリ（本物の Next.js との比較は tests/compatibility/config-app.test.ts）
import { expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";

// DOM を入れる前（最初の renderRoute の前）のリクエストの、レスポンスの後の処理（Proxy の after()）が、DOM を入れた後に動いても壊れない
test("DOM を入れる前の Proxy の after() と、直後の renderRoute", async () => {
  expect((await requestRoute("/base/tla-proxy/")).status).toBe(307);
  const app = await renderRoute("/base/tla/");
  await app.findByRole("heading", { name: "From top-level await" });
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test("basePath と trailingSlash: 末尾の / へのリダイレクトと、Link・usePathname", async () => {
  const res = await requestRoute("/base/about");
  expect(res.status).toBe(308);
  expect(res.headers.get("location")).toBe("/base/about/");
  const app = await renderRoute("/base/");
  const link = app.getByRole("link", { name: "About" });
  expect(link.getAttribute("href")).toBe("/base/about/");
  await app.user.click(link);
  await app.findByRole("heading", { name: "About" });
  expect(location.pathname).toBe("/base/about/");
  expect(app.getByText("Path /about/")).toBeTruthy();
});

test("basePath の外の URL は 404", async () => {
  expect((await requestRoute("/about/")).status).toBe(404);
});

test("forbidden() は 403 と forbidden.tsx", async () => {
  const app = await renderRoute("/base/admin/");
  expect(app.status).toBe(403);
  await app.findByRole("heading", { name: "Forbidden here" });
  const allowed = await renderRoute("/base/admin/", { cookies: { role: "admin" } });
  await allowed.findByRole("heading", { name: "Admin area" });
});

test("unauthorized() は 401 と unauthorized.tsx", async () => {
  const app = await renderRoute("/base/account/");
  expect(app.status).toBe(401);
  await app.findByRole("heading", { name: "Please sign in" });
});

test("error.tsx のない例外は global-error.tsx", async () => {
  const app = await renderRoute("/base/boom/");
  expect(app.status).toBe(500);
  await app.findByRole("heading", { name: "Global failure" });
  expect(app.getByRole("button", { name: "Retry" })).toBeTruthy();
});

test("Route Handler の request.url は basePath を除いたパス", async () => {
  expect(await (await requestRoute("/base/api/ping/")).json()).toEqual({ path: "/api/ping/" });
});

test("optimizePackageImports: バレルから使う export のファイルだけを読む（export * の先も）", async () => {
  const app = await renderRoute("/base/barrel/");
  await app.findByRole("heading", { name: "From a wildcard export" });
  expect(app.getByText("Used from the barrel")).toBeTruthy();
  expect((globalThis as { barrelUnusedLoaded?: boolean }).barrelUnusedLoaded).toBeUndefined();
  // Client Component（"use client" のないファイルも含む）からのバレルの import
  await app.findByRole("heading", { name: "Client: From a wildcard export" });
  await app.user.click(app.getByRole("button", { name: "Open form" }));
  expect(await app.findAllByText("Used from the barrel")).toHaveLength(2);
});

test("reactCompiler: ブラウザで動く Client Component はコンパイルされる（メモ化した子は描画し直されない）", async () => {
  const app = await renderRoute("/base/compiler/");
  const g = globalThis as { childRenders?: number };
  g.childRenders = 0;
  await app.user.click(app.getByRole("button", { name: "Count 0" }));
  await app.findByRole("button", { name: "Count 1" });
  expect(g.childRenders).toBe(0);
});

test("アプリの下の node_modules は、アプリのソースとして変換せずに読む", async () => {
  const app = await renderRoute("/base/cjs/");
  await app.findByRole("heading", { name: "From CJS" });
});

test("top-level await のある Client Component（推移的な依存を含む）を読み込める", async () => {
  const app = await renderRoute("/base/tla/");
  await app.findByRole("heading", { name: "From top-level await" });
  await app.user.click(app.getByRole("button", { name: "Clicked 0" }));
  await app.findByRole("button", { name: "Clicked 1" });
});

test("top-level await のあるモジュールに依存する Proxy・Server Component・Route Handler", async () => {
  const redirect = await requestRoute("/base/tla-proxy/");
  expect(redirect.status).toBe(307);
  expect(redirect.headers.get("location")).toContain("/base/tla/?from=From%20top-level%20await");
  const app = await renderRoute("/base/tla-server/");
  await app.findByRole("heading", { name: "Server: From top-level await" });
  expect(await (await requestRoute("/base/api/tla/")).json()).toEqual({ tlaValue: "From top-level await" });
});
