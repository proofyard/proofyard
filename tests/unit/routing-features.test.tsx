// ルーティングとキャッシュ、next/* のコンポーネントの機能（どれも Next.js 本体の処理をそのまま通す。tests/compatibility で next start と比べている）
import { beforeEach, expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";
import { db } from "../fixtures/next-app/components/users/db";

beforeEach(() => {
  db.users = ["Alice"];
  db.gate = null;
  db.cacheCalls = 0;
  db.tagged = 0;
});

test("catch-all [...slug] と optional catch-all [[...path]]", async () => {
  const doc = await renderRoute("/docs/a/b/c", { mode: "ssr" });
  expect(doc.getByText("Doc a / b / c (3)")).toBeDefined();
  const top = await renderRoute("/shop", { mode: "ssr" });
  expect(top.getByText("Shop top")).toBeDefined();
  const nested = await renderRoute("/shop/x/y", { mode: "ssr" });
  expect(nested.getByText("Shop x / y")).toBeDefined();
});

test("Route Groups: (group) は URL に入らず、layout は効く", async () => {
  const app = await renderRoute("/grouped", { mode: "ssr" });
  expect(app.getByText("Grouped page").closest("[data-group]")?.getAttribute("data-group")).toBe("marketing");
  expect((await requestRoute("/group/grouped")).status).toBe(404);
});

test("permanentRedirect() は 308", async () => {
  const res = await requestRoute("/moved");
  expect(res.status).toBe(308);
  expect(res.headers.get("location")).toBe("/users/Alice");
  await renderRoute("/moved", { mode: "ssr" });
  expect(location.pathname).toBe("/users/Alice");
});

test("unstable_rethrow(): try / catch の中の notFound() を投げ直す", async () => {
  expect(await (await requestRoute("/rethrow")).text()).toContain("<h1>Found</h1>");
  const missing = await requestRoute("/rethrow?missing=1");
  expect(missing.status).toBe(404);
  expect(await missing.text()).not.toContain("Swallowed");
});

test("unstable_noStore(): リクエストのたびに描画する", async () => {
  const first = await requestRoute("/no-store");
  expect(first.headers.get("cache-control")).toContain("no-store");
  expect(await first.text()).toContain("Users <!-- -->1");
  db.users.push("Bob");
  expect(await (await requestRoute("/no-store")).text()).toContain("Users <!-- -->2");
});

test("unstable_cache: 同じキーの結果を使い回す", async () => {
  expect(await (await requestRoute("/cached")).text()).toContain("Cached users <!-- -->1");
  db.users.push("Bob");
  expect(await (await requestRoute("/cached")).text()).toContain("Cached users <!-- -->1");
  expect(db.cacheCalls).toBe(1);
});

test("unstable_cache のキャッシュはテストごとに分かれる", async () => {
  db.users.push("Bob");
  expect(await (await requestRoute("/cached")).text()).toContain("Cached users <!-- -->2");
  expect(db.cacheCalls).toBe(1);
});

test("Server Action の updateTag で、同じ応答に新しい値が出る", async () => {
  const app = await renderRoute("/tagged");
  expect(app.getByText("Tagged 0")).toBeDefined();
  await app.user.click(app.getByRole("button", { name: "Bump" }));
  await app.findByText("Tagged 1");
  expect(app.cache.getInvalidatedTags()).toContain("tagged");
});

test("draftMode(): Route Handler の enable() のクッキーで有効になる", async () => {
  expect((await renderRoute("/draft", { mode: "ssr" })).getByRole("heading").textContent).toBe("Draft off");
  const res = await requestRoute("/api/draft");
  const cookie = Bun.Cookie.parse(res.headers.getSetCookie().find((c) => c.startsWith("__prerender_bypass="))!);
  const app = await renderRoute("/draft", { mode: "ssr", cookies: { [cookie.name]: cookie.value } });
  expect(app.getByRole("heading").textContent).toBe("Draft on");
});

test("next/form: 送信はクエリを付けたクライアントのナビゲーション", async () => {
  const app = await renderRoute("/search");
  expect(app.getByText("No query")).toBeDefined();
  await app.user.type(app.getByRole("textbox", { name: "Query" }), "bun");
  await app.user.click(app.getByRole("button", { name: "Search" }));
  await app.findByText("Results for bun");
  expect(location.pathname + location.search).toBe("/search?q=bun");
});

test("useLinkStatus: ナビゲーションの間は pending", async () => {
  const app = await renderRoute("/link-status");
  expect(app.getByText("(idle)")).toBeDefined();
  const gate = Promise.withResolvers<void>();
  db.gate = gate.promise;
  await app.user.click(app.getByRole("link", { name: /Open target/ }));
  await app.findByText("(loading)");
  gate.resolve();
  await app.findByRole("heading", { name: "Target page" });
});

test("useServerInsertedHTML: SSR の HTML に <style> を差し込む", async () => {
  const html = await (await requestRoute("/inserted")).text();
  expect(html.match(/<style id="inserted-style">/g)).toHaveLength(1);
  const app = await renderRoute("/inserted");
  expect(document.getElementById("inserted-style")?.textContent).toBe(".inserted { color: rebeccapurple; }");
  expect(app.getByRole("heading", { name: "Inserted styles" })).toBeDefined();
});

test("next/script: afterInteractive と lazyOnload、インラインのスクリプトを実行する", async () => {
  const app = await renderRoute("/scripts");
  await app.waitFor(() => expect(document.body.dataset.inline).toBe("ran"));
  await app.waitFor(() => expect(document.body.dataset.after).toBe("ran"));
  await app.waitFor(() => expect(document.body.dataset.lazy).toBe("ran"));
});

test("Metadata のルート: manifest.ts と generateSitemaps", async () => {
  const manifest = await requestRoute("/manifest.webmanifest");
  expect(manifest.headers.get("content-type")).toBe("application/manifest+json");
  expect((await manifest.json()).short_name).toBe("Fixture");
  const html = await (await requestRoute("/meta/hello")).text();
  expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"/>');
  for (const id of [0, 1]) {
    const sitemap = await requestRoute(`/catalog/sitemap/${id}.xml`);
    expect(sitemap.headers.get("content-type")).toBe("application/xml");
    expect(await sitemap.text()).toContain(`<loc>https://example.com/catalog/${id}/item</loc>`);
  }
});

test("Metadata: generateImageMetadata の複数のアイコン", async () => {
  const html = await (await requestRoute("/badges")).text();
  const hrefs = [...html.matchAll(/<link rel="icon" href="(\/badges\/icon\/[^"?]+)[^"]*"[^>]*sizes="(\d+x\d+)"/g)].map((m) => [m[1], m[2]]);
  expect(hrefs).toEqual([
    ["/badges/icon/small", "16x16"],
    ["/badges/icon/large", "48x48"],
  ]);
  const icon = await requestRoute("/badges/icon/small");
  expect(icon.headers.get("content-type")).toBe("image/png");
});
